"""Microphone capture via sounddevice.

This module is the sole owner of microphone I/O.
Supports both one-shot (record_utterance) and continuous streaming (mic_stream).
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable, Iterator

import numpy as np
import sounddevice as sd

from stt.config import AudioConfig
from stt.types import AudioSegment

# ---------------------------------------------------------------------------
# One-shot recording (original)
# ---------------------------------------------------------------------------

_FramesDeque = deque[np.ndarray]


def _make_callback(
    frames: _FramesDeque,
    sample_rate: int,
    start_event: threading.Event,
) -> Callable[[np.ndarray, int, object, int], None]:
    def _callback(indata: np.ndarray, frames_count: int, time_info: object, status: int) -> None:
        if status:
            import sys
            print(f"audio stream status: {status}", file=sys.stderr)
        frames.append(indata[:, 0].copy())
        start_event.set()
    return _callback


def list_microphones() -> list[dict[str, object]]:
    """Return available input devices."""
    devices: list[dict[str, object]] = []
    for idx, dev in enumerate(sd.query_devices()):
        if dev["max_input_channels"] > 0:
            devices.append({
                "index": idx,
                "name": dev["name"],
                "channels": dev["max_input_channels"],
                "default_samplerate": dev["default_samplerate"],
            })
    return devices


def find_default_microphone() -> int | None:
    """Return the device index of the default input, or None."""
    try:
        default = sd.query_devices(kind="input")
        return default["index"] if default is not None else None
    except Exception:
        devices = list_microphones()
        return devices[0]["index"] if devices else None


def find_best_microphone(sample_rate: int = 16000) -> tuple[int, str, float]:
    """Sample every input device briefly and return (index, name, peak_rms).

    Picks the mic with the highest RMS — the one actively hearing something.
    Falls back to the default mic if all are silent.
    """
    from stt.vad import compute_rms

    mics = list_microphones()
    if not mics:
        raise RuntimeError("No microphone found.")

    # Exclude loopback/monitor devices
    candidates = [
        m for m in mics
        if "loopback" not in m["name"].lower()
        and "monitor" not in m["name"].lower()
    ]
    if not candidates:
        candidates = mics

    best_idx = candidates[0]["index"]
    best_name = str(candidates[0]["name"])
    best_rms = 0.0

    for mic in candidates:
        idx = mic["index"]
        try:
            rms = _sample_mic_rms(idx, sample_rate, duration=0.3)
        except Exception:
            rms = 0.0
        if rms > best_rms:
            best_rms = rms
            best_idx = idx
            best_name = str(mic["name"])

    # If all are silent, fall back to default
    if best_rms < 0.001:
        default = find_default_microphone()
        if default is not None:
            best_idx = default
            best_name = str(sd.query_devices(device=default)["name"])

    return best_idx, best_name, best_rms


def _sample_mic_rms(device_index: int, sample_rate: int, duration: float) -> float:
    """Open a mic briefly and return the peak RMS observed."""
    from stt.vad import compute_rms

    frames: _FramesDeque = deque()
    started = threading.Event()

    def _cb(indata: np.ndarray, n: int, ti: object, st: int) -> None:
        if not st:
            frames.append(indata[:, 0].copy())
            started.set()

    stream = sd.InputStream(
        samplerate=sample_rate,
        channels=1,
        dtype="float32",
        blocksize=2048,
        device=device_index,
        callback=_cb,
    )

    best = 0.0
    deadline = time.monotonic() + duration
    with stream:
        started.wait(timeout=1.0)
        while time.monotonic() < deadline:
            if frames:
                chunk = frames.popleft()
                rms = compute_rms(chunk)
                if rms > best:
                    best = rms
            else:
                sd.sleep(50)
    return best


def record_utterance(
    config: AudioConfig,
    should_stop: Callable[[np.ndarray], bool],
    debug: bool = False,
) -> AudioSegment:
    """Record audio until *should_stop* returns True on a chunk."""
    device_index = config.device_index
    if device_index is None:
        device_index = find_default_microphone()
    if device_index is None:
        raise RuntimeError("No microphone found.")

    if debug:
        print(f"[debug] audio: opening InputStream(device={device_index}, "
              f"sr={config.sample_rate}, blocksize={config.blocksize})", flush=True)

    frames: _FramesDeque = deque()
    start_event = threading.Event()
    callback = _make_callback(frames, config.sample_rate, start_event)

    stream = sd.InputStream(
        samplerate=config.sample_rate,
        channels=config.channels,
        dtype=config.dtype,
        blocksize=config.blocksize,
        device=device_index,
        callback=callback,
    )

    chunk_count = 0
    with stream:
        start_event.wait(timeout=5.0)
        if not start_event.is_set():
            raise RuntimeError("Microphone stream started but no data received.")

        if debug:
            print("[debug] audio: first chunk received, accumulating...", flush=True)

        while not should_stop(_collect_frames(frames)):
            sd.sleep(int(config.blocksize / config.sample_rate * 1000))
            chunk_count += 1
            if debug and chunk_count % 10 == 0:
                dur = len(_collect_frames(frames)) / config.sample_rate
                print(f"[debug] audio: {dur:.1f}s accumulated ({chunk_count} chunks)...", flush=True)

    data = _collect_frames(frames)
    if debug:
        print(f"[debug] audio: recording stopped, total {len(data)/config.sample_rate:.1f}s "
              f"({len(data)} samples)", flush=True)

    return AudioSegment(data=data, sample_rate=config.sample_rate, start_time=0.0,
                        end_time=len(data) / config.sample_rate)


# ---------------------------------------------------------------------------
# Continuous streaming (mic stays open forever)
# ---------------------------------------------------------------------------

def mic_stream(
    config: AudioConfig,
    debug: bool = False,
) -> Iterator[np.ndarray]:
    """Yield audio chunks continuously from the microphone.

    The mic is opened ONCE. Each yielded value is a numpy array of
    float32 samples (mono) at config.sample_rate, containing *blocksize*
    samples per chunk (~128ms at 16kHz/2048).

    Yields forever — the caller must break the loop.
    """
    device_index = config.device_index
    if device_index is None:
        device_index = find_default_microphone()
    if device_index is None:
        raise RuntimeError("No microphone found.")

    if debug:
        print(f"[debug] audio: opening persistent stream (device={device_index}, "
              f"sr={config.sample_rate}, blocksize={config.blocksize})", flush=True)

    # Thread-safe queue for audio chunks
    chunk_queue: deque[np.ndarray] = deque()
    chunk_ready = threading.Event()

    def _callback(indata: np.ndarray, frames_count: int, time_info: object, status: int) -> None:
        if status:
            import sys
            print(f"audio stream status: {status}", file=sys.stderr)
        chunk_queue.append(indata[:, 0].copy())
        chunk_ready.set()

    stream = sd.InputStream(
        samplerate=config.sample_rate,
        channels=config.channels,
        dtype=config.dtype,
        blocksize=config.blocksize,
        device=device_index,
        callback=_callback,
    )

    with stream:
        if debug:
            print("[debug] audio: persistent stream active", flush=True)

        while True:
            # Wait for next chunk
            while not chunk_queue:
                chunk_ready.wait(timeout=0.5)
                chunk_ready.clear()
                if not chunk_queue:
                    sd.sleep(10)
                    continue
            chunk = chunk_queue.popleft()
            yield chunk


def _collect_frames(frames: _FramesDeque) -> np.ndarray:
    if not frames:
        return np.array([], dtype=np.float32)
    return np.concatenate(list(frames))
