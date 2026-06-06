"""Voice-activity detection — adaptive streaming with hysteresis."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from stt.config import VADConfig
from stt.types import AudioSegment


def compute_rms(signal: np.ndarray) -> float:
    """Root-mean-square energy of a mono float32 signal."""
    if len(signal) == 0:
        return 0.0
    return float(np.sqrt(np.mean(signal.astype(np.float64) ** 2)))


@dataclass(frozen=True)
class VADEvent:
    kind: str  # "start" | "end"
    start_sample: int
    end_sample: int | None = None
    forced_split: bool = False


class StreamingEndpointDetector:
    """Adaptive endpoint detector with noise-floor tracking, dual-threshold
    hysteresis, window voting, and min/max utterance duration handling."""

    def __init__(self, config: VADConfig, sample_rate: int, block_size: int):
        self._config = config
        self._sample_rate = sample_rate
        self._block_size = block_size

        window_blocks = int(config.decision_window_sec * sample_rate / block_size)
        self._window_blocks = max(3, window_blocks)
        self._history: deque[bool] = deque(maxlen=self._window_blocks)

        self._noise_floor = max(config.silence_threshold_rms / max(config.noise_floor_margin, 1.0), 1e-6)
        self._in_speech = False
        self._speech_start_sample = 0
        self._consecutive_unvoiced = 0
        self._min_silence_blocks = max(1, int(config.silence_duration_sec * sample_rate / block_size))
        self._detrigger_ratio = config.detrigger_ratio
        self._min_speech_samples = int(config.min_recording_sec * sample_rate)
        self._max_speech_samples = int(config.max_recording_sec * sample_rate)

    @property
    def noise_floor(self) -> float:
        return self._noise_floor

    def thresholds(self) -> tuple[float, float]:
        end_th = max(self._config.silence_threshold_rms, self._noise_floor * self._config.noise_floor_margin)
        end_th = min(end_th, 0.1)
        start_th = max(end_th, end_th * self._config.start_threshold_multiplier)
        start_th = min(start_th, 0.2)
        return start_th, end_th

    def set_noise_floor(self, floor: float) -> None:
        self._noise_floor = max(1e-6, floor)

    def set_fast_commit(self, silence_duration_sec: float, detrigger_ratio: float) -> None:
        """Apply faster endpointing settings for lower turn latency."""
        self._min_silence_blocks = max(1, int(silence_duration_sec * self._sample_rate / self._block_size))
        self._detrigger_ratio = detrigger_ratio

    def update(self, rms: float, chunk_start_sample: int, chunk_end_sample: int) -> VADEvent | None:
        start_th, end_th = self.thresholds()

        # Track noise floor during non-speech via EMA
        if not self._in_speech and rms <= start_th:
            a = self._config.noise_floor_alpha
            self._noise_floor = a * self._noise_floor + (1.0 - a) * rms

        voiced = rms >= (end_th if self._in_speech else start_th)
        self._history.append(voiced)
        voiced_ratio = sum(self._history) / len(self._history)

        if not self._in_speech:
            if len(self._history) == self._history.maxlen and voiced_ratio >= self._config.trigger_ratio:
                pre_roll = int(self._window_blocks * self._block_size + self._config.pre_speech_padding_sec * self._sample_rate)
                self._speech_start_sample = max(0, chunk_end_sample - pre_roll)
                self._in_speech = True
                self._consecutive_unvoiced = 0
                return VADEvent(kind="start", start_sample=self._speech_start_sample)
            return None

        if voiced:
            self._consecutive_unvoiced = 0
        else:
            self._consecutive_unvoiced += 1

        speech_samples = chunk_end_sample - self._speech_start_sample
        if speech_samples >= self._max_speech_samples:
            return self._finish_segment(chunk_end_sample, forced_split=True)

        unvoiced_ratio = 1.0 - voiced_ratio
        should_end = (
            len(self._history) == self._history.maxlen
            and unvoiced_ratio >= self._detrigger_ratio
            and self._consecutive_unvoiced >= self._min_silence_blocks
            and speech_samples >= self._min_speech_samples
        )
        if should_end:
            trim = self._consecutive_unvoiced * self._block_size
            end_sample = max(self._speech_start_sample, chunk_end_sample - trim)
            end_sample = min(end_sample + int(self._config.pre_speech_padding_sec * self._sample_rate), chunk_end_sample)
            return self._finish_segment(end_sample, forced_split=False)

        return None

    def _finish_segment(self, end_sample: int, forced_split: bool) -> VADEvent:
        event = VADEvent(kind="end", start_sample=self._speech_start_sample,
                         end_sample=end_sample, forced_split=forced_split)
        self._in_speech = False
        self._speech_start_sample = 0
        self._consecutive_unvoiced = 0
        self._history.clear()
        return event


# Legacy factory (kept for one-shot mode compatibility)
def make_speech_detector(config: VADConfig):
    thresh = config.silence_threshold_rms
    silence_samples = int(config.silence_duration_sec * 16000)
    min_samples = int(config.min_recording_sec * 16000)
    _cell: list[int] = [-1]

    def is_speech(chunk, sr):
        return compute_rms(chunk) > thresh

    def should_stop(accumulated):
        n = len(accumulated)
        if n == 0: return False
        tail = accumulated[-4096:]
        rms = compute_rms(tail)
        if rms > thresh: _cell[0] = n; return False
        if _cell[0] < 0: _cell[0] = 0
        if (n - _cell[0]) >= silence_samples and n >= min_samples: return True
        return False

    def reset(): _cell[0] = -1
    return is_speech, should_stop, reset


def is_silent(segment: AudioSegment, threshold: float) -> bool:
    return compute_rms(segment.data) < threshold
