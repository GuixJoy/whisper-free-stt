"""Application orchestrator — streaming mode with adaptive VAD.

Mic stays open. Transcription runs in background threads. Text prints as you speak.
"""

from __future__ import annotations

import asyncio as _asyncio
import json as _json
import signal
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

import numpy as np

from stt.config import AppConfig, LLMMode, TranscriptionBackend
from stt.audio_capture import mic_stream, find_default_microphone, find_best_microphone
from stt.vad import compute_rms, StreamingEndpointDetector
from stt.transcription import transcribe, warm_up_backend
from stt.llm import rewrite, rewrite_stream, _clean_response
from stt.clipboard import copy_to_clipboard
from stt.typing import type_to_focused_input
from stt.history import get_store
from stt.embeddings import build_few_shot_context as _build_few_shot_ctx


# ---------------------------------------------------------------------------
# Optional hooks for UI integration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RunHooks:
    on_state: Callable[[str], None] | None = None
    on_activity: Callable[[str], None] | None = None
    on_partial: Callable[[str], None] | None = None
    on_raw: Callable[[str], None] | None = None
    on_processed: Callable[[str], None] | None = None
    on_mic_level: Callable[[float], None] | None = None
    on_error: Callable[[str], None] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _echo(*args, **kwargs) -> None:
    print(*args, **kwargs, flush=True)


def _debug(config: AppConfig, *args, **kwargs) -> None:
    if config.debug:
        print("[debug]", *args, **kwargs, flush=True)


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
    """Emit a JSON event to stdout and/or WebSocket clients."""
    payload = _json.dumps(event)
    if config.json_mode:
        print(payload, flush=True)
    if _ws_clients and _ws_loop and _ws_loop.is_running():
        _asyncio.run_coroutine_threadsafe(_ws_broadcast(payload), _ws_loop)


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

def start_ws_server(port: int = 8765) -> None:
    """Start a WebSocket server in a daemon thread.  Connected clients receive
    all JSON events emitted by the orchestrator."""
    global _ws_loop
    import asyncio as _asyncio
    import websockets as _ws

    async def _handler(websocket):
        _ws_clients.append(websocket)
        try:
            await websocket.wait_closed()
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
    print(f"[ws] listening on ws://127.0.0.1:{port}", flush=True)


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
            lib_ok = False
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
    _echo(f"Typing: {'enabled' if config.typing.enabled else 'disabled'}")
    _echo(f"Clipboard: {'enabled' if config.clipboard.enabled else 'disabled'}")
    if config.vad.fast_commit:
        _echo("VAD: fast-commit mode")
    _echo()

    _echo("Listening... (speak naturally, Ctrl+C to stop)")
    _echo("-" * 40)
    _json_emit(config, {"type": "state", "state": "listening"})
    if hooks and hooks.on_state:
        hooks.on_state("listening")
    if hooks and hooks.on_activity:
        hooks.on_activity("Listening")

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
    try:
        # Store generator for both calibration and main loop; cleaned up in finally.
        stream_iter = mic_stream(config.audio, debug=False)
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            chunk = next(stream_iter)
            ring.extend(chunk)
            calib_rms.append(compute_rms(chunk))
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
            if hooks and hooks.on_activity:
                hooks.on_activity(msg)
            else:
                _echo(msg)

    chunk_count = 0
    utterance_id = 0
    try:
        for chunk in stream_iter:
            if not running or (stop_event is not None and stop_event.is_set()):
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
                _debug(config, f"live rms={rms:.6f} (start_th={st:.4f}, noise={detector.noise_floor:.4f})")

            event = detector.update(rms=rms, chunk_start_sample=chunk_start, chunk_end_sample=chunk_end)
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
    _echo("\nDone.")
    if hooks and hooks.on_state:
        hooks.on_state("idle")
    if hooks and hooks.on_activity:
        hooks.on_activity("Stopped")


# ---------------------------------------------------------------------------
# Background transcription + LLM + clipboard
# ---------------------------------------------------------------------------

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
    if hooks and hooks.on_activity:
        hooks.on_activity("Transcribing")
    ts_asr = time.monotonic()
    try:
        result = _transcribe_with_partials(audio, sr, config.transcription, _on_partial)
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
    if config.llm.mode is LLMMode.OFF:
        _json_emit(config, {"type": "processed", "text": raw, "utterance_id": utterance_id})
        _copy_and_sep(config, raw)
        if hooks and hooks.on_processed:
            hooks.on_processed(raw)
        if hooks and hooks.on_state:
            hooks.on_state("copied")
        total_elapsed = time.monotonic() - ts_total
        telemetry.record("total", total_elapsed)
        get_store().write_async(raw, raw, mode="off", duration_sec=total_elapsed)
        return

    _debug(config, f"LLM: mode={config.llm.mode.value}")
    _json_emit(config, {"type": "state", "state": "rewriting", "utterance_id": utterance_id})
    if hooks and hooks.on_state:
        hooks.on_state("rewriting")
    if hooks and hooks.on_activity:
        hooks.on_activity(f"Rewriting ({config.llm.mode.value})")

    # Build few-shot context from past corrected transcripts (latency-gated)
    few_shot_context = ""
    try:
        store = get_store()
        candidates = store.recent_cleanups(limit=20)
        if candidates:
            before_ctx = time.monotonic()
            few_shot_context = _build_few_shot_ctx(raw, candidates, top_k=3, max_tokens=400)
            ctx_ms = (time.monotonic() - before_ctx) * 1000
            if few_shot_context:
                _debug(config, f"few-shot: {ctx_ms:.0f}ms embedding latency")
    except Exception:
        pass

    ts_llm = time.monotonic()
    try:
        collected: list[str] = []
        with _llm_semaphore:
            for token in rewrite_stream(raw, config.llm, few_shot_context=few_shot_context):
                if token:
                    collected.append(token)
                    sys.stdout.write(token)
                    sys.stdout.flush()
        processed = _clean_response("".join(collected))
        llm_elapsed = time.monotonic() - ts_llm
        telemetry.record("llm", llm_elapsed)
        if not collected:
            processed = raw
        _echo(f"\n[{config.llm.mode.value}] {processed}")
        _json_emit(config, {"type": "processed", "text": processed, "utterance_id": utterance_id})
    except Exception as exc:
        _echo(f"LLM error: {exc}", file=sys.stderr)
        _json_emit(config, {"type": "error", "message": str(exc), "utterance_id": utterance_id})
        processed = raw
        if hooks and hooks.on_error:
            hooks.on_error(f"LLM error: {exc}")
        if hooks and hooks.on_state:
            hooks.on_state("error")

    _copy_and_sep(config, processed)
    if hooks and hooks.on_processed:
        hooks.on_processed(processed)
    if hooks and hooks.on_state:
        hooks.on_state("copied")
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
        # --- whisper.cpp with partial callback ---
        model = _get_cpp_model(tcfg)

        def _cpp_callback(seg):
            """pywhispercpp user callback receives one Segment."""
            text = seg.text.decode("utf-8") if isinstance(seg.text, bytes) else str(seg.text)
            on_partial(text)

        raw_segments = model.transcribe(
            audio,
            n_threads=tcfg.cpu_threads,
            no_context=not tcfg.condition_on_previous_text,
            single_segment=True,
            language=tcfg.language or "",
            new_segment_callback=_cpp_callback,
            temperature=0.0,
            temperature_inc=0.2,
            no_speech_thold=tcfg.whisper_no_speech_thold,
            entropy_thold=tcfg.whisper_entropy_thold,
            logprob_thold=tcfg.whisper_logprob_thold,
            suppress_non_speech_tokens=True,
            suppress_blank=True,
            greedy={"best_of": 5},
        )

        segments: list[TranscriptionSegment] = []
        text_parts: list[str] = []
        for seg in raw_segments:
            text = seg.text.strip() if isinstance(seg.text, str) else seg.text.decode("utf-8").strip()
            if not text or text in _JUNK_TOKENS:
                continue
            segments.append(TranscriptionSegment(text=text, start=seg.t0 * 0.01, end=seg.t1 * 0.01))
            text_parts.append(text)

        return TranscriptionResult(
            text=" ".join(text_parts),
            language=tcfg.language or "",
            segments=tuple(segments),
        )
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


def _copy_and_sep(config: AppConfig, text: str) -> None:
    """Type text and/or copy to clipboard in parallel for minimum latency."""
    typed = [False]
    copied = [False]
    threads: list[threading.Thread] = []
    if config.typing.enabled:
        threads.append(threading.Thread(target=lambda: typed.__setitem__(0, type_to_focused_input(text, config.typing)), daemon=True))
    if config.clipboard.enabled:
        threads.append(threading.Thread(target=lambda: copied.__setitem__(0, copy_to_clipboard(text, config.clipboard)), daemon=True))
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    if typed[0]:
        _echo("[typed] ✓")
    if copied[0]:
        _echo("[clipboard] ✓")
    _echo("-" * 40)


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
            _echo(f"LLM error: {exc}", file=sys.stderr)

    _echo("Done.")
