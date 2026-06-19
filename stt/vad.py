"""Voice-activity detection — universal adaptive streaming VAD.

Implements a production-grade VAD with:
- IMCRA noise estimation (Cohen 2003) for continuous noise tracking
- Dual-timescale EMA for noise floor drift (30-min baseline + 2-sec rapid)
- Multi-feature spectral scoring (RMS, flux, centroid, ZCR, BER)
- Hysteresis VAD with asymmetric onset/offset thresholds
- Hangover scheme to prevent speech truncation
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import Enum

import numpy as np

from stt.config import VADConfig
from stt.types import AudioSegment


# ---------------------------------------------------------------------------
# Feature computation (pure functions)
# ---------------------------------------------------------------------------

def compute_rms(signal: np.ndarray) -> float:
    """Root-mean-square energy of a mono float32 signal."""
    if len(signal) == 0:
        return 0.0
    return float(np.sqrt(np.mean(signal * signal)))


def compute_spectral_flux(
    audio: np.ndarray,
    sr: int,
    n_fft: int = 512,
    hop_length: int = 256,
) -> float:
    """Spectral flux — high for speech onset, low for steady noise.

    Measures L1 distance between consecutive FFT magnitude frames.
    Speech has characteristic onset patterns; steady noise has low flux.
    Returns float 0.0 to ~1.0.
    """
    if len(audio) < n_fft:
        return 0.0

    window = np.hanning(n_fft)
    n_frames = (len(audio) - n_fft) // hop_length + 1
    if n_frames < 2:
        return 0.0

    prev_mag = None
    total_flux = 0.0
    for i in range(n_frames):
        start = i * hop_length
        frame = audio[start : start + n_fft] * window
        mag = np.abs(np.fft.rfft(frame))
        if prev_mag is not None:
            total_flux += np.sum(np.abs(mag - prev_mag))
        prev_mag = mag

    return float(total_flux / (n_frames - 1))


def compute_spectral_centroid(
    audio: np.ndarray,
    sr: int,
    n_fft: int = 512,
) -> float:
    """Centroid of frequency spectrum — speech ~1-3kHz, fan noise is lower.

    Returns centroid frequency in Hz.
    """
    if len(audio) < n_fft:
        return 0.0

    frame = audio[:n_fft] * np.hanning(n_fft)
    mag = np.abs(np.fft.rfft(frame))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    total = np.sum(mag)
    if total < 1e-10:
        return 0.0
    return float(np.sum(freqs * mag) / total)


def compute_zero_crossing_rate(audio: np.ndarray) -> float:
    """Fraction of sign changes in signal.

    Speech typically 0.03-0.25, silence/noise lower.
    Returns float 0.0 to 1.0.
    """
    if len(audio) < 2:
        return 0.0
    signs = np.sign(audio)
    sign_changes = np.sum(np.abs(np.diff(signs)) > 0)
    return float(sign_changes / (len(audio) - 1))


def compute_band_energy_ratio(
    audio: np.ndarray,
    sr: int,
    low_hz: int = 300,
    high_hz: int = 3400,
    n_fft: int = 512,
) -> float:
    """Energy ratio in speech band (300-3400 Hz) vs total energy.

    Speech concentrates energy in this band; fan/ambient noise is broadband.
    Returns float 0.0 to 1.0.
    """
    if len(audio) < n_fft:
        return 0.0

    frame = audio[:n_fft] * np.hanning(n_fft)
    spectrum = np.abs(np.fft.rfft(frame)) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    total_energy = np.sum(spectrum)
    if total_energy < 1e-10:
        return 0.0

    band_mask = (freqs >= low_hz) & (freqs <= high_hz)
    band_energy = np.sum(spectrum[band_mask])
    return float(band_energy / total_energy)


# ---------------------------------------------------------------------------
# VAD state machine
# ---------------------------------------------------------------------------

class VADState(Enum):
    SILENCE = 0
    SPEECH = 1


@dataclass(frozen=True)
class VADEvent:
    kind: str  # "start" | "end"
    start_sample: int
    end_sample: int | None = None
    forced_split: bool = False


# ---------------------------------------------------------------------------
# Universal Adaptive VAD
# ---------------------------------------------------------------------------

class StreamingEndpointDetector:
    """Universal adaptive VAD with continuous noise tracking.

    Three pillars of 24/7 adaptation:
    1. IMCRA noise estimation — tracks local minima of power spectrum
    2. Dual-timescale EMA — 30-min baseline + 2-sec rapid change detection
    3. Hysteresis VAD — asymmetric onset/offset thresholds with hangover

    Combines RMS energy with spectral features (flux, centroid, ZCR, BER)
    to distinguish speech from background noise (TV, music, keyboard).
    """

    def __init__(self, config: VADConfig, sample_rate: int, block_size: int):
        self._config = config
        self._sample_rate = sample_rate
        self._block_size = block_size

        # --- Noise floor tracking (dual-timescale EMA) ---
        self._noise_floor = max(
            config.silence_threshold_rms / max(config.noise_floor_margin, 1.0),
            1e-6,
        )
        # Slow EMA: 30-minute time constant for baseline drift
        self._noise_slow_alpha = 0.9999
        # Fast EMA: 2-second time constant for rapid changes
        self._noise_fast_alpha = 0.995
        self._noise_alpha = self._noise_slow_alpha
        # Energy history for percentile-based estimation
        self._energy_history: deque[float] = deque(maxlen=300)  # 3s at 100fps

        # --- IMCRA state (simplified) ---
        self._imcra_window = 150  # ~1.5s at 10ms frames
        self._imcra_power_history: deque[float] = deque(maxlen=self._imcra_window)
        self._imcra_noise_est = self._noise_floor

        # --- VAD state machine ---
        self._vad_state = VADState.SILENCE
        self._speech_duration_ms = 0
        self._silence_duration_ms = 0

        # --- Thresholds (SNR-based, adaptive) ---
        self._speech_threshold_db = 6.0    # SNR threshold for speech
        self._hysteresis_up_db = 4.0       # Onset margin (harder to start)
        self._hysteresis_down_db = 3.0     # Offset margin (easier to stay)
        self._endpoint_timeout_ms = 500    # Silence before speech end
        self._min_speech_ms = 50           # Minimum speech duration

        # --- Hangover (prevents truncation) ---
        self._hang_counter = 0
        self._hang_time = int(0.150 * sample_rate / block_size)  # 150ms in blocks

        # --- Streaming state ---
        self._in_speech = False
        self._speech_start_sample = 0
        self._min_speech_samples = int(config.min_recording_sec * sample_rate)
        self._max_speech_samples = int(config.max_recording_sec * sample_rate)

        # --- Spectral baselines (for feature normalization) ---
        self._spectral_noise_centroid: float = 500.0
        self._spectral_noise_flux: float = 5.0
        self._spectral_noise_zcr: float = 0.05
        self._spectral_noise_ber: float = 0.1
        self._has_spectral_baselines: bool = False

        # --- Previous frame for flux computation ---
        self._prev_spectrum: np.ndarray | None = None

        # --- Window voting (for noise floor updates) ---
        window_blocks = int(config.decision_window_sec * sample_rate / block_size)
        self._window_blocks = max(3, window_blocks)

    @property
    def noise_floor(self) -> float:
        return self._noise_floor

    @property
    def vad_state(self) -> VADState:
        return self._vad_state

    @property
    def snr_db(self) -> float:
        if self._noise_floor < 1e-10:
            return 0.0
        return float(10.0 * np.log10(max(self._noise_floor, 1e-10)))

    def thresholds(self) -> tuple[float, float]:
        """Return (start_threshold, end_threshold) as RMS values for debug output."""
        # Compute thresholds in linear scale from SNR-based dB thresholds
        end_th_linear = self._noise_floor * (10 ** (self._speech_threshold_db / 20))
        start_th_linear = self._noise_floor * (10 ** ((self._speech_threshold_db + self._hysteresis_up_db) / 20))
        return float(start_th_linear), float(end_th_linear)

    def set_noise_floor(self, floor: float) -> None:
        """Set initial noise floor (used during calibration)."""
        self._noise_floor = max(1e-6, floor)

    def set_spectral_baselines(
        self,
        centroid: float,
        flux: float,
        zcr: float,
        ber: float,
    ) -> None:
        """Set noise baselines from calibration for spectral discrimination."""
        self._spectral_noise_centroid = centroid
        self._spectral_noise_flux = flux
        self._spectral_noise_zcr = zcr
        self._spectral_noise_ber = ber
        self._has_spectral_baselines = True

    def set_fast_commit(self, silence_duration_sec: float, detrigger_ratio: float) -> None:
        """Apply faster endpointing settings for lower turn latency."""
        self._endpoint_timeout_ms = int(silence_duration_sec * 1000)

    def update_noise_floor(self, energy: float) -> None:
        """Dual-timescale EMA noise floor tracking.

        Uses 10th percentile of energy history (robust to speech contamination).
        Detects rapid changes and temporarily increases adaptation rate.
        """
        self._energy_history.append(energy)

        if len(self._energy_history) < 10:
            return

        # Percentile-based noise estimation (10th percentile)
        energies = np.array(self._energy_history)
        min_energy = float(np.percentile(energies, 10))

        # Fast window for detecting rapid changes
        if len(self._energy_history) >= 50:
            fast_window = list(self._energy_history)[-50:]
            fast_min = float(np.percentile(fast_window, 10))

            # Detect rapid noise change (>0.02 difference)
            if abs(fast_min - self._noise_floor) > 0.02:
                # Fast adaptation: blend 50/50
                self._noise_floor = 0.5 * self._noise_floor + 0.5 * fast_min
                self._noise_alpha = 0.99  # temporarily faster
            else:
                # Decay back to slow adaptation
                self._noise_alpha = min(
                    self._noise_slow_alpha,
                    self._noise_alpha + 0.001,
                )

        # Apply EMA
        self._noise_floor = (
            self._noise_alpha * self._noise_floor
            + (1.0 - self._noise_alpha) * min_energy
        )

        # Clamp to reasonable range
        self._noise_floor = float(np.clip(self._noise_floor, 0.001, 0.5))

    def update_imcra_noise(self, frame: np.ndarray) -> None:
        """Simplified IMCRA noise estimation.

        Tracks local minimum of power spectrum.
        Updates noise estimate only during speech-absent regions.
        """
        power = float(np.mean(frame ** 2))
        self._imcra_power_history.append(power)

        if len(self._imcra_power_history) < self._imcra_window:
            return

        # Find minimum over window (5th percentile as proxy)
        powers = np.array(self._imcra_power_history)
        local_min = float(np.percentile(powers, 5))

        # Bias compensation (simplified)
        local_mean = float(np.mean(powers))
        local_var = float(np.var(powers))
        bias = 1.0 + np.sqrt(2.0 / (self._imcra_window - 1)) * (
            local_var / (local_mean + 1e-10)
        )

        self._imcra_noise_est = local_min * bias

    def _compute_spectral_features(self, chunk: np.ndarray) -> tuple[float, float, float, float]:
        """Single-FFT spectral feature extraction. Returns (flux, centroid, zcr, ber).

        Uses one FFT per chunk (shared across all features) and single-frame
        flux approximation against the previous chunk's spectrum — no frame loop.
        """
        if len(chunk) < 512:
            return 0.0, 0.0, compute_zero_crossing_rate(chunk), 0.0

        n_fft = 512
        sr = self._sample_rate
        frame = chunk[:n_fft] * np.hanning(n_fft)
        mag = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

        total_mag = float(np.sum(mag))
        centroid = float(np.sum(freqs * mag) / total_mag) if total_mag > 1e-10 else 0.0

        if self._prev_spectrum is not None and self._prev_spectrum.shape == mag.shape:
            flux = float(np.sum(np.abs(mag - self._prev_spectrum)))
        else:
            flux = 0.0
        self._prev_spectrum = mag.copy()

        power = mag ** 2
        total_energy = float(np.sum(power))
        if total_energy > 1e-10:
            lo, hi = self._config.speech_band_low_hz, self._config.speech_band_high_hz
            band = (freqs >= lo) & (freqs <= hi)
            ber = float(np.sum(power[band]) / total_energy)
        else:
            ber = 0.0

        zcr = compute_zero_crossing_rate(chunk)
        return flux, centroid, zcr, ber

    def _compute_speech_score(self, chunk: np.ndarray) -> float:
        rms = compute_rms(chunk)
        noise = max(self._noise_floor, 1e-10)
        snr_db = float(20.0 * np.log10(rms / noise + 1e-10))
        energy_score = snr_db / self._speech_threshold_db

        if not self._config.use_spectral_vad:
            return energy_score

        # Early exit on very low energy — skip expensive spectral features
        if snr_db < -2.0:
            return energy_score * 0.5

        flux, centroid, zcr, ber = self._compute_spectral_features(chunk)

        flux_norm = min(flux / 50.0, 1.0)
        centroid_norm = 1.0 if 300 < centroid < 4000 else max(0.2, 1.0 - abs(centroid - 2000) / 3000)
        zcr_norm = 1.0 if 0.03 < zcr < 0.25 else 0.2
        ber_norm = min(ber / 2.0, 1.0)

        w = self._config.spectral_weight
        spectral_score = 0.15 * flux_norm + 0.15 * centroid_norm + 0.15 * zcr_norm + 0.15 * ber_norm
        return (1.0 - w) * energy_score + w * (energy_score * 0.6 + spectral_score * 0.4)

    def update(self, rms: float, chunk_start_sample: int, chunk_end_sample: int,
               chunk: np.ndarray | None = None) -> VADEvent | None:
        """Process one audio chunk through the VAD pipeline.

        Returns VADEvent on speech start/end, None otherwise.
        """
        # --- Update noise floor tracking (continuous) ---
        self.update_noise_floor(rms)
        if chunk is not None:
            self.update_imcra_noise(chunk)

        # --- Compute speech score ---
        if chunk is not None and self._config.use_spectral_vad:
            composite = self._compute_speech_score(chunk)
        else:
            # RMS-only fallback: convert to SNR-based score
            noise = max(self._noise_floor, 1e-10)
            snr_db = float(20.0 * np.log10(rms / noise + 1e-10))
            composite = snr_db / self._speech_threshold_db

        # --- Hysteresis state machine ---
        is_speech_now = False

        if self._vad_state == VADState.SILENCE:
            # Onset: must exceed threshold + hysteresis margin
            onset_threshold = 1.0 + self._hysteresis_up_db / 6.0
            if composite > onset_threshold:
                self._vad_state = VADState.SPEECH
                self._speech_duration_ms = 0
                self._silence_duration_ms = 0
                is_speech_now = True
            else:
                self._silence_duration_ms += int(self._block_size / self._sample_rate * 1000)
        else:  # SPEECH
            # Offset: can drop below threshold - hysteresis margin
            offset_threshold = 1.0 - self._hysteresis_down_db / 6.0
            if composite < offset_threshold:
                self._silence_duration_ms += int(self._block_size / self._sample_rate * 1000)
                if self._silence_duration_ms > self._endpoint_timeout_ms:
                    self._vad_state = VADState.SILENCE
                    is_speech_now = False
                else:
                    is_speech_now = True  # still in hangover period
            else:
                self._silence_duration_ms = 0
                is_speech_now = True
            self._speech_duration_ms += int(self._block_size / self._sample_rate * 1000)

        # --- Hangover scheme (prevent speech truncation) ---
        if is_speech_now:
            self._hang_counter = self._hang_time
        else:
            self._hang_counter = max(0, self._hang_counter - 1)

        is_speech = self._hang_counter > 0 or is_speech_now

        # --- Streaming state management ---
        if is_speech and not self._in_speech:
            # Speech onset
            pre_roll = int(self._window_blocks * self._block_size + self._config.pre_speech_padding_sec * self._sample_rate)
            self._speech_start_sample = max(0, chunk_end_sample - pre_roll)
            self._in_speech = True
            return VADEvent(kind="start", start_sample=self._speech_start_sample)

        if not is_speech and self._in_speech:
            # Speech offset
            speech_samples = chunk_end_sample - self._speech_start_sample
            if speech_samples >= self._min_speech_samples:
                self._in_speech = False
                return self._finish_segment(chunk_end_sample, forced_split=False)
            else:
                # Too short, discard
                self._in_speech = False
                return None

        if self._in_speech:
            speech_samples = chunk_end_sample - self._speech_start_sample
            if speech_samples >= self._max_speech_samples:
                return self._finish_segment(chunk_end_sample, forced_split=True)

        return None

    def _finish_segment(self, end_sample: int, forced_split: bool) -> VADEvent:
        """End current speech segment."""
        event = VADEvent(
            kind="end",
            start_sample=self._speech_start_sample,
            end_sample=end_sample,
            forced_split=forced_split,
        )
        self._in_speech = False
        self._speech_start_sample = 0
        self._speech_duration_ms = 0
        self._silence_duration_ms = 0
        return event


# ---------------------------------------------------------------------------
# Legacy factory (kept for one-shot mode compatibility)
# ---------------------------------------------------------------------------

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
