"""Application orchestrator — streaming mode with adaptive VAD.

Mic stays open. Transcription runs in background threads. Text prints as you speak.
"""

from __future__ import annotations

import signal
import sys
import threading
import time
from collections import deque

import numpy as np

from stt.config import AppConfig, LLMMode
from stt.audio_capture import mic_stream, find_default_microphone, find_best_microphone
from stt.vad import compute_rms, StreamingEndpointDetector
from stt.transcription import transcribe
from stt.llm import rewrite
from stt.clipboard import copy_to_clipboard


def _echo(*args, **kwargs) -> None:
    print(*args, **kwargs, flush=True)


def _debug(config: AppConfig, *args, **kwargs) -> None:
    if config.debug:
        print("[debug]", *args, **kwargs, flush=True)


class _RingBuffer:
    """Fixed-size sample buffer with append and slice access."""

    def __init__(self, max_samples: int):
        self._buf: deque[float] = deque(maxlen=max_samples)
        self._total = 0

    def extend(self, chunk: np.ndarray) -> None:
        self._buf.extend(chunk.tolist())
        self._total += len(chunk)

    def slice_range(self, start_sample: int, end_sample: int) -> np.ndarray:
        available_start = self._total - len(self._buf)
        start_ix = max(start_sample, available_start) - available_start
        end_ix = max(start_ix, min(end_sample, self._total) - available_start)
        return np.array(list(self._buf)[start_ix:end_ix], dtype=np.float32)

    def total_samples(self) -> int:
        return self._total


def run(config: AppConfig) -> None:
    """Continuous streaming: mic → adaptive VAD → transcribe → [LLM] → print."""
    _echo("╔══════════════════════════════════╗")
    _echo("║   STT — Local Speech-to-Text    ║")
    _echo("╚══════════════════════════════════╝")
    _echo()

    # Auto-detect best mic or use user-specified device
    if config.audio.device_index is not None:
        mic_index = config.audio.device_index
        mic_name = f"device {mic_index}"
    else:
        _echo("Scanning microphones...")
        mic_index, mic_name, mic_rms = find_best_microphone(config.audio.sample_rate)
        _echo(f"Selected: [{mic_index}] {mic_name} (rms={mic_rms:.4f})")
        object.__setattr__(config.audio, "device_index", mic_index)

    _echo(f"ASR: {config.transcription.model_name} ({config.transcription.device})")
    _echo(f"LLM: {config.llm.mode.value} ({config.llm.provider.value}:{config.llm.model})")
    _echo(f"Clipboard: {'enabled' if config.clipboard.enabled else 'disabled'}")
    _echo()

    _debug(config, f"vad: threshold={config.vad.silence_threshold_rms}")
    _debug(config, "mic stream starting...")
    _echo("Listening... (speak naturally, Ctrl+C to stop)")
    _echo("-" * 40)

    sr = config.audio.sample_rate
    block_size = config.audio.blocksize
    ring = _RingBuffer(int(30 * sr))
    detector = StreamingEndpointDetector(config.vad, sr, block_size)

    # --- Noise floor calibration ---
    _debug(config, "calibrating noise floor (1.5s)...")
    calib_rms: list[float] = []
    try:
        stream_iter = mic_stream(config.audio, debug=False)
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            chunk = next(stream_iter)
            ring.extend(chunk)
            calib_rms.append(compute_rms(chunk))
    except StopIteration:
        pass

    if calib_rms:
        sorted_r = sorted(calib_rms)
        p10 = sorted_r[len(sorted_r) // 10]
        detector.set_noise_floor(p10)
        st, et = detector.thresholds()
        _debug(config, f"calibration: p10={p10:.4f}, start_th={st:.4f}, end_th={et:.4f}")

    running = True
    signal.signal(signal.SIGINT, lambda s, f: _stop())

    chunk_count = 0
    try:
        for chunk in stream_iter:
            chunk_start = ring.total_samples()
            ring.extend(chunk)
            chunk_end = ring.total_samples()
            rms = compute_rms(chunk)
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

            thread = threading.Thread(
                target=_transcribe_and_print, args=(config, segment.copy(), sr, ring.total_samples() / sr),
                daemon=True,
            )
            thread.start()

    except KeyboardInterrupt:
        pass
    finally:
        try:
            stream_iter.close()
        except Exception:
            pass

    _echo("\nDone.")


def _transcribe_and_print(config: AppConfig, audio: np.ndarray, sr: int, timestamp: float) -> None:
    ts = time.monotonic()
    try:
        result = transcribe(audio, sr, config.transcription)
    except Exception as exc:
        _debug(config, f"transcription error: {exc}")
        return
    _debug(config, f"transcribed {len(audio)/sr:.1f}s in {time.monotonic()-ts:.1f}s ({result.language})")

    if result.is_empty:
        return

    raw = result.text
    _echo(f"\n[raw] {raw}")

    if config.llm.mode is LLMMode.OFF:
        _copy_and_sep(config, raw)
        return

    _debug(config, f"LLM: mode={config.llm.mode.value}")
    try:
        processed = rewrite(raw, config.llm)
        _echo(f"[{config.llm.mode.value}] {processed}")
    except Exception as exc:
        _echo(f"LLM error: {exc}", file=sys.stderr)
        processed = raw

    _copy_and_sep(config, processed)


def _copy_and_sep(config: AppConfig, text: str) -> None:
    if config.clipboard.enabled and copy_to_clipboard(text, config.clipboard):
        _echo("[clipboard] ✓")
    _echo("-" * 40)


def _stop():
    pass  # signal handler placeholder
