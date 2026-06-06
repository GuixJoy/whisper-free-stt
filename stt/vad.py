"""Voice-activity detection — pure functions over numpy arrays."""

from __future__ import annotations

import numpy as np

from stt.config import VADConfig
from stt.types import AudioSegment


def compute_rms(signal: np.ndarray) -> float:
    """Root-mean-square energy of a mono float32 signal."""
    if len(signal) == 0:
        return 0.0
    return float(np.sqrt(np.mean(signal.astype(np.float64) ** 2)))


def make_speech_detector(
    config: VADConfig,
) -> tuple[
    "Callable[[np.ndarray, float], bool]",
    "Callable[[np.ndarray], bool]",
    "Callable[[], None]",
]:
    """Create (is_speech, should_stop, reset) predicates for the recording loop."""
    thresh = config.silence_threshold_rms
    silence_samples = int(config.silence_duration_sec * 16000)
    min_samples = int(config.min_recording_sec * 16000)
    _cell: list[int] = [-1]  # silence_start_sample

    def is_speech(chunk: np.ndarray, sample_rate: float) -> bool:
        return compute_rms(chunk) > thresh

    def should_stop(accumulated: np.ndarray) -> bool:
        n = len(accumulated)
        if n == 0:
            return False
        tail = accumulated[-4096:]
        rms = compute_rms(tail)
        if rms > thresh:
            _cell[0] = n
            return False
        if _cell[0] < 0:
            _cell[0] = 0
        silent_duration = n - _cell[0]
        if silent_duration >= silence_samples and n >= min_samples:
            return True
        return False

    def reset() -> None:
        _cell[0] = -1

    return is_speech, should_stop, reset


def is_silent(segment: AudioSegment, threshold: float) -> bool:
    return compute_rms(segment.data) < threshold
