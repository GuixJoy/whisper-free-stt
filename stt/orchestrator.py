"""Application orchestrator — streaming mode with adaptive VAD.

Mic stays open. Transcription runs in background threads. Text prints as you speak.
"""

from __future__ import annotations

import asyncio as _asyncio
import faulthandler
import json as _json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

import numpy as np
from stt.log import get_logger
from stt.clipboard import copy_to_clipboard
from stt.typing import type_to_focused_input

# Enable fault handler so segfaults print a traceback instead of silent exit
try:
    faulthandler.enable()
except Exception:
    pass

from stt.config import AppConfig, LLMMode, TranscriptionBackend

logger = get_logger(__name__)
from stt.audio_capture import mic_stream, find_default_microphone, find_best_microphone
from stt.speaker import SpeakerVerifier
from stt.vad import (
    compute_rms, StreamingEndpointDetector,
    compute_spectral_centroid, compute_spectral_flux,
    compute_zero_crossing_rate, compute_band_energy_ratio,
)
from stt.transcription import transcribe, warm_up_backend
from stt.llm import rewrite, rewrite_stream, _clean_response
from stt.history import get_store
from stt.embeddings import build_few_shot_context as _build_few_shot_ctx


# ---------------------------------------------------------------------------
# Optional hooks for UI integration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RunHooks:
    on_state: Callable[[str], None] | None = None
    on_partial: Callable[[str], None] | None = None
    on_raw: Callable[[str], None] | None = None
    on_processed: Callable[[str], None] | None = None
    on_mic_level: Callable[[float], None] | None = None
    on_error: Callable[[str], None] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _echo(*args, **kwargs) -> None:
    msg = " ".join(str(a) for a in args)
    logger.info(msg)


def _debug(config: AppConfig, *args, **kwargs) -> None:
    if config.debug:
        msg = " ".join(str(a) for a in args)
        logger.debug(msg)


# WebSocket broadcast (populated when --ws-port is set)
_ws_clients: list = []
_ws_loop = None  # set by start_ws_server


async def _ws_broadcast(payload: str) -> None:
    """Send payload to all connected WS clients (async)."""
    dead: list = []
    for client in _ws_clients:
        try:
            await client.send(payload)
        except Exception:
            dead.append(client)
    for d in dead:
        if d in _ws_clients:
            _ws_clients.remove(d)

def _get_ws_loop():
    return _ws_loop


def _json_emit(config: AppConfig, event: dict) -> None:
    """Emit a JSON event to stdout, WebSocket clients, Socket.IO, and kakashi logger."""
    payload = _json.dumps(event)
    # Log every event via kakashi
    event_type = event.get("type", "event")
    if event_type == "mic":
        logger.debug("mic_level", level=event.get("level", 0))
    elif event_type == "state":
        logger.info("state_change", state=event.get("state"), utterance_id=event.get("utterance_id"))
    elif event_type == "raw":
        logger.info("transcription_raw", text=event.get("text", "")[:100], utterance_id=event.get("utterance_id"))
    elif event_type == "processed":
        logger.info("transcription_processed", text=event.get("text", "")[:100], utterance_id=event.get("utterance_id"))
    elif event_type == "llm_partial":
        logger.debug("llm_partial", text=event.get("text", "")[:100], utterance_id=event.get("utterance_id"))
    elif event_type == "error":
        logger.error("error", message=event.get("message"), utterance_id=event.get("utterance_id"))
    elif event_type == "dropped":
        logger.warning("dropped", reason=event.get("reason"), utterance_id=event.get("utterance_id"))
    else:
        logger.debug("event", type=event_type, payload=payload[:200])
    # Print to stdout for frontend consumption
    if config.json_mode:
        print(payload, flush=True)
    # Try legacy WebSocket broadcast
    if _ws_clients and _ws_loop and _ws_loop.is_running():
        _asyncio.run_coroutine_threadsafe(_ws_broadcast(payload), _ws_loop)
    # Try Socket.IO emit via server module
    try:
        from stt.server import emit_event
        event_type = event.get("type", "event")
        emit_event(event_type, event)
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# LLM concurrency limit (prevent rate-limit pile-up from rapid speech)
# ---------------------------------------------------------------------------

_llm_semaphore = threading.Semaphore(4)  # max 4 concurrent LLM calls (network I/O bound)
_asr_semaphore = threading.Semaphore(1)  # whisper.cpp needs serialization; faster-whisper OK with 1 due to early release
_SILENCE_HALLUCINATIONS = frozenset({
    "thank you",
    "thanks",
    "thank you for watching",
    "thanks for watching",
})


def _normalize_text(text: str) -> str:
    return text.strip().lower().rstrip(".,!?;:")


# ---------------------------------------------------------------------------
# WebSocket server (for browser UI integration)
# ---------------------------------------------------------------------------

# Audio queue: browser streams mic audio here for processing
_ws_audio_queue: deque[np.ndarray] = deque()
_ws_audio_ready = threading.Event()


def start_ws_server(port: int = 8765) -> None:
    """Start a WebSocket server in a daemon thread.

    - Clients receive all JSON events emitted by the orchestrator.
    - Clients can send binary audio data (float32 PCM, mono, 16kHz) via WebSocket.
      The server feeds it into the audio queue for processing.
    """
    global _ws_loop
    import asyncio as _asyncio
    import websockets as _ws

    async def _handler(websocket):
        _ws_clients.append(websocket)
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    # Binary audio from browser: float32 PCM, mono, 16kHz
                    audio = np.frombuffer(message, dtype=np.float32)
                    if len(audio) > 0:
                        _ws_audio_queue.append(audio)
                        _ws_audio_ready.set()
                elif isinstance(message, str):
                    # JSON control messages from browser
                    try:
                        import json as _json
                        req = _json.loads(message)
                        if req.get("type") == "get_history":
                            limit = req.get("limit", 100)
                            rows = get_store().get_recent(limit)
                            resp = _json.dumps({"type": "history", "rows": rows})
                            await websocket.send(resp)
                        elif req.get("type") == "get_insights":
                            data = get_store().get_insights()
                            resp = _json.dumps({"type": "insights", "data": data})
                            await websocket.send(resp)
                        elif req.get("type") == "search_history":
                            query = req.get("query", "")
                            rows = get_store().search_history(query)
                            resp = _json.dumps({"type": "history", "rows": rows})
                            await websocket.send(resp)
                        elif req.get("type") == "export_history":
                            csv = get_store().export_csv()
                            resp = _json.dumps({"type": "export", "csv": csv})
                            await websocket.send(resp)
                        elif req.get("type") == "export_text":
                            text = get_store().export_text()
                            resp = _json.dumps({"type": "export", "text": text})
                            await websocket.send(resp)
                        elif req.get("type") == "toggle_favorite":
                            entry_id = req.get("id")
                            if entry_id:
                                new_state = get_store().toggle_favorite(entry_id)
                                resp = _json.dumps({"type": "favorited", "id": entry_id, "favorite": new_state})
                                await websocket.send(resp)
                        elif req.get("type") == "delete_entry":
                            entry_id = req.get("id")
                            if entry_id:
                                get_store().delete_entry(entry_id)
                                resp = _json.dumps({"type": "deleted", "id": entry_id})
                                await websocket.send(resp)
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            if websocket in _ws_clients:
                _ws_clients.remove(websocket)

    async def _serve():
        async with _ws.serve(_handler, "127.0.0.1", port):
            await _asyncio.get_running_loop().create_future()  # run forever

    def _run():
        global _ws_loop
        _ws_loop = _asyncio.new_event_loop()
        _asyncio.set_event_loop(_ws_loop)
        _ws_loop.run_until_complete(_serve())

    threading.Thread(target=_run, daemon=True).start()
    logger.info("listening on ws://127.0.0.1:%s", port)


# ---------------------------------------------------------------------------
# Latency telemetry (thread-safe, lock-free enough for debug use)
# ---------------------------------------------------------------------------

class _LatencyTracker:
    """Collect timing samples per stage, compute P50/P95 on demand."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._samples: dict[str, list[float]] = {}

    def record(self, stage: str, elapsed: float) -> None:
        with self._lock:
            self._samples.setdefault(stage, []).append(elapsed)

    def snapshot(self) -> dict[str, dict[str, float]]:
        with self._lock:
            out: dict[str, dict[str, float]] = {}
            for stage, vals in sorted(self._samples.items()):
                if not vals:
                    continue
                s = sorted(vals)
                # Use numpy percentile for stable p95 interpolation.
                # The simple index int(len*0.95) snaps to max with small
                # samples (e.g. 14 utterances → s[13]=max), skewing p95.
                import numpy as np
                out[stage] = {
                    "count": len(s),
                    "p50": float(np.percentile(s, 50)),
                    "p95": float(np.percentile(s, 95)),
                    "min": s[0],
                    "max": s[-1],
                }
            return out


# ---------------------------------------------------------------------------
# Hardware probe
# ---------------------------------------------------------------------------

def _probe_hardware(config: AppConfig) -> None:
    """Print explicit backend capability diagnostics at startup."""
    results: list[str] = []

    # --- whisper.cpp ---
    try:
        from pywhispercpp.model import Model as CppModel
        results.append("whisper.cpp: available (ggml CPU)")
    except Exception as exc:
        results.append(f"whisper.cpp: unavailable ({exc})")

    # --- faster-whisper ---
    try:
        import ctranslate2
        cuda_devices = ctranslate2.get_cuda_device_count()
        if cuda_devices > 0:
            # Verify libcublas is actually loadable
            import ctypes
            import sys
            import os
            import site
            lib_ok = False
            if sys.platform == "win32":
                # Check pip-installed nvidia-cublas package
                for sp in (site.getsitepackages() if hasattr(site, 'getsitepackages') else []):
                    cublas_dll = os.path.join(sp, "nvidia", "cublas", "bin", "cublas64_12.dll")
                    if os.path.isfile(cublas_dll):
                        try:
                            ctypes.CDLL(cublas_dll)
                            lib_ok = True
                            break
                        except OSError:
                            continue
                if not lib_ok:
                    for lib in ("cublas64_12.dll", "cublas64_11.dll"):
                        try:
                            ctypes.CDLL(lib)
                            lib_ok = True
                            break
                        except OSError:
                            continue
            else:
                for lib in ("libcublas.so.12", "libcublas.so.11"):
                    try:
                        ctypes.CDLL(lib)
                        lib_ok = True
                        break
                    except OSError:
                        continue
            if lib_ok:
                results.append(f"faster-whisper: available (CUDA, {cuda_devices} device(s))")
            else:
                results.append(f"faster-whisper: available (CPU fallback — libcublas not loadable, {cuda_devices} CUDA device(s) detected but unusable)")
        else:
            results.append("faster-whisper: available (CPU only, no CUDA devices)")
    except Exception as exc:
        results.append(f"faster-whisper: unavailable ({exc})")

    # --- Active backend ---
    backend = config.transcription.backend
    device = config.transcription.device
    results.append(f"active: {backend.value} on {device} (model: {config.transcription.model_name})")

    for line in results:
        _echo(f"  {line}")


# ---------------------------------------------------------------------------
# Ring buffer
# ---------------------------------------------------------------------------

class _RingBuffer:
    """Pre-allocated numpy circular buffer — avoids per-chunk Python object overhead."""

    def __init__(self, max_samples: int):
        self._buf = np.zeros(max_samples, dtype=np.float32)
        self._max = max_samples
        self._total = 0

    def extend(self, chunk: np.ndarray) -> None:
        n = len(chunk)
        if n >= self._max:
            self._buf[:] = chunk[-self._max:]
            self._total += n
            return
        pos = self._total % self._max
        self._total += n
        end = pos + n
        if end <= self._max:
            self._buf[pos:end] = chunk
        else:
            first = self._max - pos
            self._buf[pos:] = chunk[:first]
            self._buf[:n - first] = chunk[first:]

    def slice_range(self, start_sample: int, end_sample: int) -> np.ndarray:
        """Return a copy of samples [start_sample, end_sample)."""
        n = end_sample - start_sample
        if n <= 0:
            return np.zeros(0, dtype=np.float32)
        oldest = max(0, self._total - self._max)
        if start_sample < oldest or end_sample > self._total:
            return np.zeros(0, dtype=np.float32)
        start_pos = start_sample % self._max
        end_pos = end_sample % self._max
        if start_pos < end_pos:
            return self._buf[start_pos:end_pos].copy()
        return np.concatenate([self._buf[start_pos:self._max], self._buf[:end_pos]])

    def total_samples(self) -> int:
        return self._total


# ---------------------------------------------------------------------------
# System resource collection
# ---------------------------------------------------------------------------

_CLK_TCK: int | None = None

def _collect_system_stats() -> dict[str, str]:
    """Collect CPU, memory, and GPU usage at end of run.

    Uses /proc for CPU/memory (zero deps) and nvidia-smi for GPU.
    Returns dict of label → formatted string, or empty dict on failure.
    """
    stats: dict[str, str] = {}

    try:
        # --- CPU usage (process-level, average over lifetime) ---
        with open("/proc/self/stat") as f:
            parts = f.read().split()
        utime = int(parts[13])
        stime = int(parts[14])
        cutime = int(parts[15])
        cstime = int(parts[16])
        total_ticks = utime + stime + cutime + cstime

        global _CLK_TCK
        if _CLK_TCK is None:
            _CLK_TCK = int(os.sysconf(os.sysconf_names["SC_CLK_TCK"]))
        cpu_seconds = total_ticks / _CLK_TCK

        with open("/proc/uptime") as f:
            uptime_seconds = float(f.read().split()[0])

        with open("/proc/self/status") as f:
            status = f.read()

        # Process start time from /proc/self/stat (field 22, 0-indexed 21)
        start_ticks = int(parts[21])
        elapsed_seconds = uptime_seconds - (start_ticks / _CLK_TCK)

        if elapsed_seconds > 0:
            cpu_pct = 100.0 * cpu_seconds / elapsed_seconds
            stats["cpu"] = f"{cpu_pct:.1f}% avg ({cpu_seconds:.1f}s of {elapsed_seconds:.0f}s wall)"

        # --- Memory (VmRSS) ---
        m = re.search(r"VmRSS:\s+(\d+)\s+kB", status)
        if m:
            rss_mb = int(m.group(1)) / 1024
            stats["memory"] = f"{rss_mb:.0f} MB RSS"

        # --- GPU via nvidia-smi ---
        try:
            gpu_out = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True, text=True, timeout=3,
            )
            if gpu_out.returncode == 0:
                line = gpu_out.stdout.strip()
                if line:
                    parts_gpu = line.split(", ")
                    if len(parts_gpu) >= 4:
                        gpu_util = parts_gpu[0]
                        mem_used = parts_gpu[1]
                        mem_total = parts_gpu[2]
                        gpu_temp = parts_gpu[3]
                        stats["gpu"] = f"{gpu_util}% util, {mem_used}/{mem_total} MB, {gpu_temp}°C"
        except Exception:
            pass

    except Exception:
        pass

    return stats


# ---------------------------------------------------------------------------
# Top-level streaming loop
# ---------------------------------------------------------------------------

def run(
    config: AppConfig,
    *,
    stop_event: threading.Event | None = None,
    hooks: RunHooks | None = None,
    enable_signal_handlers: bool = True,
) -> None:
    """Continuous streaming: mic → adaptive VAD → transcribe → [LLM] → print."""
    telemetry = _LatencyTracker()
    stream_iter = None

    _echo("╔══════════════════════════════════╗")
    _echo("║   STT — Local Speech-to-Text    ║")
    _echo("╚══════════════════════════════════╝")
    _echo()

    # --- Hardware probe ---
    _echo("Hardware:")
    _probe_hardware(config)
    _echo()

    # --- Auto-detect mic ---
    try:
        if config.audio.device_index is not None:
            mic_index = config.audio.device_index
            mic_name = f"device {mic_index}"
        else:
            # Use default mic directly — avoids scanning all devices which can
            # destabilise PipeWire/PulseAudio's ALSA compatibility layer.
            default = find_default_microphone()
            if default is not None:
                mic_index, mic_name = default, f"device {default}"
            else:
                _echo("Scanning microphones...")
                mic_index, mic_name, _ = find_best_microphone(config.audio.sample_rate)
            _echo(f"Mic: [{mic_index}] {mic_name}")
            object.__setattr__(config.audio, "device_index", mic_index)
    except Exception as exc:
        if hooks and hooks.on_error:
            hooks.on_error(f"Microphone setup failed: {exc}")
        if hooks and hooks.on_state:
            hooks.on_state("error")
        return

    _echo(f"LLM: {config.llm.mode.value} ({config.llm.provider.value}:{config.llm.model})")
    if config.vad.fast_commit:
        _echo("VAD: fast-commit mode")
    _echo()

    # Emit model info so frontend can display the resolved profile/model
    _json_emit(config, {
        "type": "info",
        "profile": config.transcription.profile_name,
        "model": config.transcription.model_name,
        "backend": config.transcription.backend.value,
        "device": config.transcription.device,
    })

    # --- Wait for frontend to send "start_recording" before opening mic ---
    # This is the PTT gate: backend stays idle until explicitly told to record.
    #例外: when run directly from a terminal (TTY), auto-start immediately.
    _echo("Engine ready. Waiting for start_recording command...")
    _json_emit(config, {"type": "state", "state": "idle"})
    if hooks and hooks.on_state:
        hooks.on_state("idle")

    _start_event = threading.Event()
    _stop_event = threading.Event()
    _stdin_running = True
    _is_tty = sys.stdin.isatty()

    def _stdin_reader():
        """Read JSON commands from stdin (one per line)."""
        nonlocal _stdin_running
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = _json.loads(line)
                    if cmd.get("type") == "start_recording":
                        _start_event.set()
                    elif cmd.get("type") == "stop_recording":
                        _stop_event.set()
                        _start_event.set()  # Also unblocks if waiting
                        _stdin_running = False
                except _json.JSONDecodeError:
                    pass
        except (EOFError, OSError):
            pass
        except (EOFError, OSError):
            pass

    stdin_thread = threading.Thread(target=_stdin_reader, daemon=True)
    stdin_thread.start()

    if _is_tty:
        # Interactive terminal — auto-start recording immediately
        _echo("Running in terminal — auto-starting recording (Ctrl+C to stop)...")
        _start_event.set()
    else:
        # Piped from Tauri frontend — wait for start_recording command
        _start_event.wait()
    if not _stdin_running:
        _echo("Received stop before start — exiting.")
        return

    _echo("Recording started by frontend.")
    _json_emit(config, {"type": "state", "state": "listening"})
    if hooks and hooks.on_state:
        hooks.on_state("listening")

    sr = config.audio.sample_rate
    block_size = config.audio.blocksize
    ring = _RingBuffer(int(30 * sr))
    detector = StreamingEndpointDetector(config.vad, sr, block_size)

    # Apply fast-commit overrides on the detector directly
    if config.vad.fast_commit:
        detector.set_fast_commit(
            silence_duration_sec=config.vad.fast_silence_duration_sec,
            detrigger_ratio=config.vad.fast_detrigger_ratio,
        )

    # Warm the selected ASR backend in parallel with calibration.
    warmup_thread = threading.Thread(target=warm_up_backend, args=(config.transcription,), daemon=True)
    warmup_thread.start()

    # --- Noise floor calibration ---
    _debug(config, "calibrating noise floor (1.5s)...")
    calib_rms: list[float] = []
    calib_centroid: list[float] = []
    calib_flux: list[float] = []
    calib_zcr: list[float] = []
    calib_ber: list[float] = []
    try:
        # Store generator for both calibration and main loop; cleaned up in finally.
        stream_iter = mic_stream(config.audio, debug=False)
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            chunk = next(stream_iter)
            ring.extend(chunk)
            calib_rms.append(compute_rms(chunk))
            if config.vad.use_spectral_vad:
                calib_centroid.append(compute_spectral_centroid(chunk, sr))
                calib_flux.append(compute_spectral_flux(chunk, sr))
                calib_zcr.append(compute_zero_crossing_rate(chunk))
                calib_ber.append(compute_band_energy_ratio(
                    chunk, sr,
                    config.vad.speech_band_low_hz,
                    config.vad.speech_band_high_hz,
                ))
    except StopIteration:
        pass
    except Exception as exc:
        if hooks and hooks.on_error:
            hooks.on_error(f"Microphone stream failed: {exc}")
        if hooks and hooks.on_state:
            hooks.on_state("error")
        return

    if calib_rms:
        sorted_r = sorted(calib_rms)
        p10 = sorted_r[len(sorted_r) // 10]
        detector.set_noise_floor(p10)
        st, et = detector.thresholds()
        _debug(config, f"calibration: p10={p10:.4f}, start_th={st:.4f}, end_th={et:.4f}")

    if calib_centroid and config.vad.use_spectral_vad:
        # Use robust percentile (p10) like RMS — not mean, which is sensitive
        # to transient noise (mouse clicks, keyboard taps during calibration).
        sorted_c = sorted(calib_centroid)
        sorted_f = sorted(calib_flux)
        sorted_z = sorted(calib_zcr)
        sorted_b = sorted(calib_ber)
        p10_idx = max(0, len(sorted_c) // 10)
        avg_centroid = float(sorted_c[p10_idx])
        avg_flux = float(sorted_f[p10_idx])
        avg_zcr = float(sorted_z[p10_idx])
        avg_ber = float(sorted_b[p10_idx])
        detector.set_spectral_baselines(avg_centroid, avg_flux, avg_zcr, avg_ber)
        _debug(config, f"calibration: centroid={avg_centroid:.0f}Hz, flux={avg_flux:.4f}, "
               f"zcr={avg_zcr:.4f}, ber={avg_ber:.4f}")

    # --- Speaker enrollment ---
    speaker_verifier: SpeakerVerifier | None = None
    speaker_profile: NDArray[np.float32] | None = None
    if config.diarization.enabled:
        from numpy import NDArray
        speaker_verifier = SpeakerVerifier(method=config.diarization.method)
        enrollment_embs: list[NDArray[np.float32]] = []
        n_chunks = config.diarization.enrollment_chunks
        _debug(config, f"speaker enrollment: collecting {n_chunks} chunks...")
        try:
            for _ in range(n_chunks):
                chunk = next(stream_iter)
                ring.extend(chunk)
                emb = speaker_verifier.embed(chunk, sr)
                enrollment_embs.append(emb)
            if len(enrollment_embs) >= 2:
                speaker_profile = speaker_verifier.enroll(enrollment_embs)
                _debug(config, f"speaker profile created ({len(enrollment_embs)} chunks)")
            else:
                _debug(config, "speaker enrollment: insufficient audio, skipping")
                speaker_profile = None
        except StopIteration:
            _debug(config, "speaker enrollment: stream ended early")
            speaker_profile = None
        except Exception as exc:
            _debug(config, f"speaker enrollment failed: {exc}")
            speaker_profile = None

    running = True
    def _stop(_sig, _frame):
        nonlocal running
        running = False
        if stop_event is not None:
            stop_event.set()
    # Python only allows signal registration on the interpreter main thread.
    # UI integrations often run this loop in a worker thread, so we skip handlers there.
    if enable_signal_handlers:
        if threading.current_thread() == threading.main_thread():
            signal.signal(signal.SIGINT, _stop)
        else:
            msg = "Signal handlers disabled (run() is not on main thread)"
            _echo(msg)

    chunk_count = 0
    utterance_id = 0
    try:
        for chunk in stream_iter:
            if not running or (stop_event is not None and stop_event.is_set()) or _stop_event.is_set():
                break
            chunk_start = ring.total_samples()
            ring.extend(chunk)
            chunk_end = ring.total_samples()
            rms = compute_rms(chunk)
            if hooks and hooks.on_mic_level:
                hooks.on_mic_level(rms)
            if config.json_mode and chunk_count % 8 == 0:
                _json_emit(config, {"type": "mic", "level": round(rms, 6)})
            chunk_count += 1

            if config.debug and chunk_count % 8 == 0:
                st, et = detector.thresholds()
                noise = detector.noise_floor
                snr_db = 20 * np.log10(rms / max(noise, 1e-10)) if noise > 0 else 0
                state = detector.vad_state.name
                _debug(config, f"rms={rms:.6f} noise={noise:.4f} snr={snr_db:.1f}dB state={state}")
                if config.vad.use_spectral_vad:
                    score = detector._compute_speech_score(chunk)
                    _debug(config, f"  spectral: score={score:.4f}")

            event = detector.update(
                rms=rms,
                chunk_start_sample=chunk_start,
                chunk_end_sample=chunk_end,
                chunk=chunk if config.vad.use_spectral_vad else None,
            )
            if event is None or event.kind == "start":
                if event:
                    _debug(config, f"speech start at {event.start_sample/sr:.2f}s")
                continue
            if event.end_sample is None:
                continue

            segment = ring.slice_range(event.start_sample, event.end_sample)
            if len(segment) == 0:
                continue

            dur = len(segment) / sr
            rms_seg = compute_rms(segment)
            _debug(config, f"utterance: {dur:.1f}s, rms={rms_seg:.4f}"
                    + (" [forced split]" if event.forced_split else ""))

            if dur < config.vad.min_recording_sec:
                continue

            # Speaker gate: reject segments that don't match enrolled speaker
            if config.diarization.enabled and speaker_verifier is not None and speaker_profile is not None:
                accepted, score = speaker_verifier.verify(segment, sr, speaker_profile, threshold=config.diarization.similarity_threshold)
                _json_emit(config, {"type": "speaker", "accepted": accepted, "similarity": round(score, 4)})
                if not accepted:
                    _debug(config, f"speaker rejected: sim={score:.3f}")
                    continue

            utterance_id += 1
            thread = threading.Thread(
                target=_transcribe_and_print,
                args=(config, segment.copy(), sr, ring.total_samples() / sr, utterance_id, telemetry, hooks),
                daemon=True,
            )
            thread.start()

    except KeyboardInterrupt:
        pass
    finally:
        if stream_iter is not None:
            try:
                stream_iter.close()
            except Exception:
                pass

    # --- Print telemetry summary on exit ---
    snap = telemetry.snapshot()
    if snap:
        _echo("\n--- Latency (seconds) ---")
        for stage, stats in snap.items():
            _echo(f"  {stage}: n={stats['count']:.0f} "
                  f"p50={stats['p50']:.3f} p95={stats['p95']:.3f} "
                  f"min={stats['min']:.3f} max={stats['max']:.3f}")
    sys_stats = _collect_system_stats()
    if sys_stats:
        _echo("\n--- System ---")
        for k, v in sys_stats.items():
            _echo(f"  {k}: {v}")
    _echo("\nDone.")
    if hooks and hooks.on_state:
        hooks.on_state("idle")


# ---------------------------------------------------------------------------
# WebSocket audio mode: browser captures mic, streams audio to Python
# ---------------------------------------------------------------------------

def run_ws_audio(
    config: AppConfig,
    *,
    stop_event: threading.Event | None = None,
    hooks: RunHooks | None = None,
) -> None:
    """Process audio received from browser via WebSocket.

    The browser captures mic audio and sends float32 PCM chunks over WebSocket.
    This function feeds them into the same VAD + ASR pipeline as run(), but
    without opening the microphone directly.
    """
    telemetry = _LatencyTracker()

    _echo("╔══════════════════════════════════╗")
    _echo("║   STT — Browser Audio Mode      ║")
    _echo("╚══════════════════════════════════╝")
    _echo()
    _echo("Waiting for browser audio stream...")
    _echo("-" * 40)

    sr = config.audio.sample_rate
    block_size = config.audio.blocksize
    ring = _RingBuffer(int(30 * sr))
    detector = StreamingEndpointDetector(config.vad, sr, block_size)

    if config.vad.fast_commit:
        detector.set_fast_commit(
            silence_duration_sec=config.vad.fast_silence_duration_sec,
            detrigger_ratio=config.vad.fast_detrigger_ratio,
        )

    # Warm ASR backend in background
    warmup_thread = threading.Thread(target=warm_up_backend, args=(config.transcription,), daemon=True)
    warmup_thread.start()

    # No calibration — browser handles mic init. Use sensible defaults.
    detector.set_noise_floor(config.vad.silence_threshold_rms)

    running = True
    def _stop(_sig, _frame):
        nonlocal running
        running = False
        if stop_event is not None:
            stop_event.set()
    if enable_signal_handlers:
        if threading.current_thread() == threading.main_thread():
            signal.signal(signal.SIGINT, _stop)

    chunk_count = 0
    utterance_id = 0
    _json_emit(config, {
        "type": "info",
        "profile": config.transcription.profile_name,
        "model": config.transcription.model_name,
        "backend": config.transcription.backend.value,
        "device": config.transcription.device,
    })
    _json_emit(config, {"type": "state", "state": "listening"})
    if hooks and hooks.on_state:
        hooks.on_state("listening")

    try:
        while running:
            if stop_event is not None and stop_event.is_set():
                break

            # Wait for audio from browser (with timeout so we can check running)
            _ws_audio_ready.wait(timeout=0.2)

            # Process all queued chunks (don't clear — new chunks may arrive during processing)
            while _ws_audio_queue:
                chunk = _ws_audio_queue.popleft()
                chunk_start = ring.total_samples()
                ring.extend(chunk)
                chunk_end = ring.total_samples()
                rms = compute_rms(chunk)

                if hooks and hooks.on_mic_level:
                    hooks.on_mic_level(rms)
                if config.json_mode and chunk_count % 8 == 0:
                    _json_emit(config, {"type": "mic", "level": round(rms, 6)})

                chunk_count += 1

                if config.debug and chunk_count % 8 == 0:
                    noise = detector.noise_floor
                    snr_db = 20 * np.log10(rms / max(noise, 1e-10)) if noise > 0 else 0
                    state = detector.vad_state.name
                    _debug(config, f"rms={rms:.6f} noise={noise:.4f} snr={snr_db:.1f}dB state={state}")

                event = detector.update(
                    rms=rms,
                    chunk_start_sample=chunk_start,
                    chunk_end_sample=chunk_end,
                    chunk=chunk,
                )
                if event is None or event.kind == "start":
                    if event:
                        _debug(config, f"speech start at {event.start_sample/sr:.2f}s")
                    continue
                if event.end_sample is None:
                    continue

                segment = ring.slice_range(event.start_sample, event.end_sample)
                if len(segment) == 0:
                    continue

                dur = len(segment) / sr
                if dur < config.vad.min_recording_sec:
                    continue

                utterance_id += 1
                thread = threading.Thread(
                    target=_transcribe_and_print,
                    args=(config, segment.copy(), sr, ring.total_samples() / sr, utterance_id, telemetry, hooks),
                    daemon=True,
                )
                thread.start()

    except KeyboardInterrupt:
        pass

    snap = telemetry.snapshot()
    if snap:
        _echo("\n--- Latency (seconds) ---")
        for stage, stats in snap.items():
            _echo(f"  {stage}: n={stats['count']:.0f} "
                  f"p50={stats['p50']:.3f} p95={stats['p95']:.3f} "
                  f"min={stats['min']:.3f} max={stats['max']:.3f}")
    sys_stats = _collect_system_stats()
    if sys_stats:
        _echo("\n--- System ---")
        for k, v in sys_stats.items():
            _echo(f"  {k}: {v}")
    _echo("\nDone.")
    if hooks and hooks.on_state:
        hooks.on_state("idle")


# ---------------------------------------------------------------------------
# Background transcription + LLM + clipboard
# ---------------------------------------------------------------------------

def _output_text(text: str, config: AppConfig) -> None:
    """Type text into focused input and copy to clipboard (CLI mode only)."""
    if not text.strip():
        return
    # Type into focused input
    try:
        typed = type_to_focused_input(text, config.typing)
        if typed:
            _debug(config, "typed text into focused input")
        else:
            _debug(config, "typing skipped or failed")
    except Exception as exc:
        _debug(config, f"typing error: {exc}")
    # Copy to clipboard
    try:
        copied = copy_to_clipboard(text, config.clipboard)
        if copied:
            _debug(config, "copied to clipboard")
    except Exception as exc:
        _debug(config, f"clipboard error: {exc}")


def _transcribe_and_print(
    config: AppConfig,
    audio: np.ndarray,
    sr: int,
    timestamp: float,
    utterance_id: int,
    telemetry: _LatencyTracker,
    hooks: RunHooks | None = None,
) -> None:
    """Transcribe in background, emit partials via callback, then LLM + output."""

    # Partial hypothesis collector (filled by ASR callback during decode)
    partials: list[str] = []
    partial_lock = threading.Lock()

    def _on_partial(text: str) -> None:
        """Called by the ASR backend as segments are decoded."""
        clean = text.strip()
        if clean:
            if _normalize_text(clean) in _SILENCE_HALLUCINATIONS:
                return
            with partial_lock:
                partials.append(clean)
            _echo(f"  [partial] {clean}")
            if hooks and hooks.on_partial:
                hooks.on_partial(clean)

    ts_total = time.monotonic()

    # Drop overlap instead of queueing many decode jobs (keeps tail latency low).
    if not _asr_semaphore.acquire(blocking=False):
        _json_emit(
            config,
            {
                "type": "dropped",
                "utterance_id": utterance_id,
                "reason": "asr_busy",
                "duration_sec": round(len(audio) / sr, 3),
            },
        )
        return

    # --- Transcription (ASR semaphore held until decode completes) ---
    _json_emit(config, {"type": "state", "state": "transcribing", "utterance_id": utterance_id})
    if hooks and hooks.on_state:
        hooks.on_state("transcribing")
    ts_asr = time.monotonic()

    # Build a local transcription config (thread-safe, VAD already done by orchestrator)
    tcfg = config.transcription
    try:
        from stt.config import TranscriptionConfig
        # Always create a copy with vad_filter=False — orchestrator already segments audio
        tcfg = TranscriptionConfig(
            backend=tcfg.backend,
            model_name=tcfg.model_name,
            compute_type=tcfg.compute_type,
            device=tcfg.device,
            cpu_threads=tcfg.cpu_threads,
            language=tcfg.language,
            beam_size=tcfg.beam_size,
            condition_on_previous_text=tcfg.condition_on_previous_text,
            hotwords=tcfg.hotwords,
            word_timestamps=tcfg.word_timestamps,
            batch_size=tcfg.batch_size,
            noise_reduce=tcfg.noise_reduce,
            noise_reduce_prop_decrease=tcfg.noise_reduce_prop_decrease,
            vad_filter=False,  # orchestrator VAD already segmented this audio
            vad_min_silence_ms=tcfg.vad_min_silence_ms,
            vad_max_speech_sec=tcfg.vad_max_speech_sec,
            whisper_no_speech_thold=tcfg.whisper_no_speech_thold,
            whisper_entropy_thold=tcfg.whisper_entropy_thold,
            whisper_logprob_thold=tcfg.whisper_logprob_thold,
            whisper_compression_ratio_thold=tcfg.whisper_compression_ratio_thold,
        )

        # Merge dictionary hotwords into the local config
        use_weighted = tcfg.backend is not TranscriptionBackend.WHISPER_CPP
        dict_hotwords = get_store().get_dict_hotwords(weighted=use_weighted)
        if dict_hotwords:
            merged = ", ".join(filter(None, [tcfg.hotwords, dict_hotwords]))
            object.__setattr__(tcfg, "hotwords", merged)
            _debug(config, f"dictionary hotwords merged: {len(dict_hotwords.split(','))} terms")
    except Exception as exc:
        logger.warning("Failed to build transcription config with dictionary: %s", exc)

    try:
        result = _transcribe_with_partials(audio, sr, tcfg, _on_partial)
    except Exception as exc:
        _debug(config, f"transcription error: {exc}")
        if hooks and hooks.on_error:
            hooks.on_error(f"Transcription error: {exc}")
        if hooks and hooks.on_state:
            hooks.on_state("error")
        return
    finally:
        asr_elapsed = time.monotonic() - ts_asr
        telemetry.record("asr", asr_elapsed)
        _asr_semaphore.release()  # Release immediately — next utterance can start ASR

    _debug(config, f"transcribed {len(audio)/sr:.1f}s in {asr_elapsed:.1f}s ({result.language})")

    if result.is_empty:
        return

    raw = result.text

    # Layer 1: Exact dictionary replacements (regex word-boundary)
    try:
        raw_before = raw
        raw = get_store().apply_dictionary_replacements(raw)
        if raw != raw_before:
            _debug(config, f"dict exact: {raw_before!r} -> {raw!r}")
    except Exception as exc:
        logger.warning("Dictionary exact replacement failed: %s", exc)

    # Layer 2: Fuzzy phonetic matching (Levenshtein ratio)
    try:
        raw_before = raw
        raw = get_store().apply_fuzzy_replacements(raw)
        if raw != raw_before:
            _debug(config, f"dict fuzzy: {raw_before!r} -> {raw!r}")
    except Exception as exc:
        logger.warning("Dictionary fuzzy replacement failed: %s", exc)

    norm = _normalize_text(raw)

    # Filter common whisper silence hallucinations (e.g. "thank you")
    # when the captured segment has very low energy.
    if norm in _SILENCE_HALLUCINATIONS:
        seg_rms = compute_rms(audio)
        seg_dur = len(audio) / sr
        if seg_rms < 0.12 and seg_dur < 3.0:
            _json_emit(
                config,
                {
                    "type": "dropped",
                    "utterance_id": utterance_id,
                    "reason": "silence_hallucination",
                    "duration_sec": round(seg_dur, 3),
                },
            )
            return
    # Don't duplicate partial output if the final raw matches what we already showed
    if partials and raw.strip() == partials[-1].strip():
        _echo(f"\n[final] {raw}  ← confirmed")
    else:
        _echo(f"\n[raw] {raw}")
    _json_emit(config, {"type": "raw", "text": raw, "utterance_id": utterance_id})
    if hooks and hooks.on_raw:
        hooks.on_raw(raw)

    # --- LLM (no semaphore held — next utterance can start ASR in parallel) ---
    word_count = len(raw.split())
    if config.llm.mode is LLMMode.OFF or word_count <= 5:
        # Skip LLM for very short utterances (saves 2-3s per "Hi", "Ok", etc.)
        _json_emit(config, {"type": "processed", "text": raw, "utterance_id": utterance_id})
        if hooks and hooks.on_processed:
            hooks.on_processed(raw)
        # CLI mode: type text + copy to clipboard directly
        if not hooks:
            _output_text(raw, config)
        total_elapsed = time.monotonic() - ts_total
        telemetry.record("total", total_elapsed)
        get_store().write_async(raw, raw, mode="off" if config.llm.mode is LLMMode.OFF else "short", duration_sec=total_elapsed)
        return

    _debug(config, f"LLM: mode={config.llm.mode.value}")
    _json_emit(config, {"type": "state", "state": "rewriting", "utterance_id": utterance_id})
    if hooks and hooks.on_state:
        hooks.on_state("rewriting")

    # Build few-shot context from past corrected transcripts (latency-gated)
    few_shot_context = ""
    dict_llm_context = ""
    try:
        store = get_store()
        candidates = store.recent_cleanups(limit=20)
        if candidates:
            before_ctx = time.monotonic()
            few_shot_context = _build_few_shot_ctx(raw, candidates, top_k=3, max_tokens=400)
            ctx_ms = (time.monotonic() - before_ctx) * 1000
            if few_shot_context:
                _debug(config, f"few-shot: {ctx_ms:.0f}ms embedding latency")
        # Build dictionary context for LLM (Layer 3)
        dict_llm_context = store.build_dict_llm_context()
        if dict_llm_context:
            _debug(config, f"dict LLM context: {len(dict_llm_context)} chars")
    except Exception:
        pass

    ts_llm = time.monotonic()
    try:
        collected: list[str] = []
        with _llm_semaphore:
            for token in rewrite_stream(raw, config.llm, few_shot_context=few_shot_context, dictionary_context=dict_llm_context):
                if token:
                    collected.append(token)
                    sys.stdout.write(token)
                    sys.stdout.flush()
                    # Stream partial LLM result to browser in real-time
                    _json_emit(config, {"type": "llm_partial", "text": "".join(collected), "utterance_id": utterance_id})
        processed = _clean_response("".join(collected))
        llm_elapsed = time.monotonic() - ts_llm
        telemetry.record("llm", llm_elapsed)
        if not collected:
            processed = raw
        _echo(f"\n[{config.llm.mode.value}] {processed}")
        _json_emit(config, {"type": "processed", "text": processed, "utterance_id": utterance_id})
    except Exception as exc:
        logger.error("LLM error: %s", exc)
        _json_emit(config, {"type": "error", "message": str(exc), "utterance_id": utterance_id})
        processed = raw
        if hooks and hooks.on_error:
            hooks.on_error(f"LLM error: {exc}")
        if hooks and hooks.on_state:
            hooks.on_state("error")

    if hooks and hooks.on_processed:
        hooks.on_processed(processed)
    # CLI mode: type text + copy to clipboard directly
    if not hooks:
        _output_text(processed, config)
    total_elapsed = time.monotonic() - ts_total
    telemetry.record("total", total_elapsed)
    get_store().write_async(raw, processed, mode=config.llm.mode.value, duration_sec=total_elapsed)


def _transcribe_with_partials(
    audio: np.ndarray,
    sr: int,
    tcfg: "TranscriptionConfig",  # noqa: F821
    on_partial: "Callable[[str], None]",  # noqa: F821
) -> "TranscriptionResult":  # noqa: F821
    """
    Transcribe audio and emit partial hypotheses via the provided callback as decoding progresses.
    
    Calls `on_partial(text)` whenever a backend produces an intermediate segment/hypothesis. The final returned TranscriptionResult contains the concatenated final text, detected language, and a tuple of TranscriptionSegment entries.
    
    Parameters:
        audio (np.ndarray): Preprocessed audio samples (mono float32, range [-1, 1]).
        sr (int): Sample rate of `audio`.
        tcfg (TranscriptionConfig): Transcription backend/configuration options.
        on_partial (Callable[[str], None]): Callback invoked with each partial hypothesis text.
    
    Returns:
        TranscriptionResult: Object with `text` (final concatenated transcription), `language`, and `segments` (tuple of TranscriptionSegment for final segments).
    """
    from stt.transcription import (
        preprocess_audio, _get_cpp_model, _get_fw_model, _JUNK_TOKENS,
        _build_vad_kwargs,
    )
    from stt.types import TranscriptionResult, TranscriptionSegment
    from stt.config import TranscriptionBackend

    audio = preprocess_audio(audio, sr, tcfg)
    if audio is None:
        return TranscriptionResult(text="", language="")

    if tcfg.backend is TranscriptionBackend.WHISPER_CPP:
        # --- whisper.cpp via subprocess (crash isolation) ---
        # A native segfault in whisper.cpp kills the entire process. Running it
        # in a subprocess lets us survive and report the error properly.
        import json as _json
        import os
        import subprocess as _subprocess
        import sys as _sys
        import tempfile as _tempfile

        audio_path = None
        try:
            fd, audio_path = _tempfile.mkstemp(suffix=".npy")
            os.close(fd)
            np.save(audio_path, audio, allow_pickle=False)

            worker_cfg = {
                "model_name": tcfg.model_name,
                "audio_path": audio_path,
                "n_threads": tcfg.cpu_threads,
                "language": tcfg.language or "",
                "condition_on_previous_text": tcfg.condition_on_previous_text,
                "no_speech_thold": tcfg.whisper_no_speech_thold,
                "entropy_thold": tcfg.whisper_entropy_thold,
                "logprob_thold": tcfg.whisper_logprob_thold,
                "hotwords": tcfg.hotwords or "",
            }

            proc = _subprocess.run(
                [_sys.executable, "-u", "-m", "stt._cpp_worker"],
                input=_json.dumps(worker_cfg),
                capture_output=True,
                text=True,
                timeout=120,
            )

            if proc.returncode != 0:
                stderr_tail = (proc.stderr or "")[-500:]
                raise RuntimeError(
                    f"whisper.cpp worker crashed (exit {proc.returncode}): {stderr_tail}"
                )

            result = _json.loads(proc.stdout)
            if not result.get("ok"):
                raise RuntimeError(result.get("error", "whisper.cpp worker returned error"))

            text = result.get("text", "")
            if text:
                on_partial(text)

            segments: list[TranscriptionSegment] = []
            for s in result.get("segments", []):
                t = s.get("text", "").strip()
                if t and t not in _JUNK_TOKENS:
                    segments.append(TranscriptionSegment(text=t, start=s["start"], end=s["end"]))

            return TranscriptionResult(
                text=text,
                language=result.get("language", "") or (tcfg.language or ""),
                segments=tuple(segments),
            )

        except _subprocess.TimeoutExpired:
            raise RuntimeError("whisper.cpp transcription timed out (120s)")
        finally:
            if audio_path and os.path.exists(audio_path):
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass
    else:
        # --- faster-whisper: yield segments incrementally ---
        model = _get_fw_model(tcfg)
        fw_kwargs = _build_vad_kwargs(tcfg)
        raw_segments, info = model.transcribe(
            audio,
            beam_size=tcfg.beam_size,
            language=tcfg.language,
            condition_on_previous_text=tcfg.condition_on_previous_text,
            no_speech_threshold=tcfg.whisper_no_speech_thold,
            compression_ratio_threshold=tcfg.whisper_compression_ratio_thold,
            log_prob_threshold=tcfg.whisper_logprob_thold,
            **fw_kwargs,
        )

        segments = []
        text_parts = []
        for seg in raw_segments:
            text = seg.text.strip()
            if text:
                on_partial(text)
            if not text or text in _JUNK_TOKENS:
                continue
            segments.append(TranscriptionSegment(text=text, start=seg.start, end=seg.end))
            text_parts.append(text)

        return TranscriptionResult(
            text=" ".join(text_parts),
            language=info.language if info else "",
            segments=tuple(segments),
        )



# ---------------------------------------------------------------------------
# Dry-run: process a WAV file instead of live mic
# ---------------------------------------------------------------------------

def run_file(config: AppConfig, wav_path: str) -> None:
    """Process a single WAV file through the pipeline. Useful for testing."""
    import wave
    _echo(f"Processing: {wav_path}")
    with wave.open(wav_path, "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        sr = wf.getframerate()
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if wf.getnchannels() > 1:
            audio = audio.reshape(-1, wf.getnchannels()).mean(axis=1)

    if sr != config.audio.sample_rate:
        _echo(f"Warning: file sr={sr}, expected {config.audio.sample_rate}")

    from stt.transcription import transcribe as _transcribe_fn
    ts = time.monotonic()
    result = _transcribe_fn(audio, sr, config.transcription)
    elapsed = time.monotonic() - ts
    _echo(f"\n[raw] {result.text}")
    _echo(f"Transcribed in {elapsed:.1f}s (lang={result.language})")

    if config.llm.mode is not LLMMode.OFF and result.text.strip():
        try:
            with _llm_semaphore:
                processed = rewrite(result.text, config.llm)
            _echo(f"[{config.llm.mode.value}] {processed}")
        except Exception as exc:
            logger.error("LLM error: %s", exc)

    _echo("Done.")
