"""Tests for stt/vad.py — compute_rms, spectral features, and streaming VAD."""

import unittest
import numpy as np


class TestComputeRMS(unittest.TestCase):
    """Tests for compute_rms — stays in float32 for speed."""

    def test_empty_returns_zero(self):
        from stt.vad import compute_rms
        self.assertEqual(compute_rms(np.array([], dtype=np.float32)), 0.0)

    def test_silence_returns_zero(self):
        from stt.vad import compute_rms
        audio = np.zeros(1024, dtype=np.float32)
        self.assertAlmostEqual(compute_rms(audio), 0.0)

    def test_known_value(self):
        """RMS of a constant signal equals the constant."""
        from stt.vad import compute_rms
        audio = np.full(1024, 0.5, dtype=np.float32)
        self.assertAlmostEqual(compute_rms(audio), 0.5, places=5)

    def test_returns_float(self):
        from stt.vad import compute_rms
        audio = np.random.uniform(-0.5, 0.5, 1024).astype(np.float32)
        result = compute_rms(audio)
        self.assertIsInstance(result, float)

    def test_positive_output(self):
        from stt.vad import compute_rms
        audio = np.random.uniform(-1.0, 1.0, 4096).astype(np.float32)
        self.assertGreater(compute_rms(audio), 0.0)

    def test_larger_signal_higher_rms(self):
        from stt.vad import compute_rms
        quiet = np.random.uniform(-0.1, 0.1, 1024).astype(np.float32)
        loud = quiet * 10
        self.assertGreater(compute_rms(loud), compute_rms(quiet))

    def test_works_with_different_lengths(self):
        from stt.vad import compute_rms
        for length in [1, 100, 1024, 16000, 48000]:
            audio = np.full(length, 0.3, dtype=np.float32)
            self.assertAlmostEqual(compute_rms(audio), 0.3, places=5)

    def test_float32_no_precision_loss_for_typical_audio(self):
        """For typical audio signals, float32 RMS should be close to float64."""
        from stt.vad import compute_rms
        rng = np.random.RandomState(42)
        audio_f32 = rng.uniform(-0.5, 0.5, 4096).astype(np.float32)
        rms_f32 = compute_rms(audio_f32)
        rms_f64 = float(np.sqrt(np.mean(audio_f32.astype(np.float64) ** 2)))
        self.assertAlmostEqual(rms_f32, rms_f64, places=4)


class TestSpectralFeatures(unittest.TestCase):
    """Tests for spectral feature functions."""

    def test_spectral_flux_silence(self):
        from stt.vad import compute_spectral_flux
        audio = np.zeros(1024, dtype=np.float32)
        flux = compute_spectral_flux(audio, sr=16000)
        self.assertAlmostEqual(flux, 0.0)

    def test_spectral_flux_tone(self):
        """A constant tone should have near-zero flux (no spectral change)."""
        from stt.vad import compute_spectral_flux
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        audio = 0.5 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
        flux = compute_spectral_flux(audio, sr=16000)
        self.assertLess(flux, 0.01)

    def test_spectral_flux_burst(self):
        """A sudden burst should have high flux."""
        from stt.vad import compute_spectral_flux
        audio = np.zeros(1024, dtype=np.float32)
        audio[256:512] = 0.5  # sudden burst
        flux = compute_spectral_flux(audio, sr=16000)
        self.assertGreater(flux, 0.01)

    def test_spectral_centroid_low_freq(self):
        """Low frequency signal should have low centroid."""
        from stt.vad import compute_spectral_centroid
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        audio = 0.5 * np.sin(2 * np.pi * 200 * t).astype(np.float32)
        centroid = compute_spectral_centroid(audio, sr=16000)
        self.assertLess(centroid, 500)

    def test_spectral_centroid_high_freq(self):
        """High frequency signal should have high centroid."""
        from stt.vad import compute_spectral_centroid
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        audio = 0.5 * np.sin(2 * np.pi * 3000 * t).astype(np.float32)
        centroid = compute_spectral_centroid(audio, sr=16000)
        self.assertGreater(centroid, 2000)

    def test_zero_crossing_rate_silence(self):
        from stt.vad import compute_zero_crossing_rate
        audio = np.zeros(1024, dtype=np.float32)
        zcr = compute_zero_crossing_rate(audio)
        self.assertAlmostEqual(zcr, 0.0)

    def test_zero_crossing_rate_sine(self):
        """A sine wave has ~2 crossings per cycle."""
        from stt.vad import compute_zero_crossing_rate
        t = np.linspace(0, 1, 16000, dtype=np.float32)
        audio = np.sin(2 * np.pi * 1000 * t).astype(np.float32)
        zcr = compute_zero_crossing_rate(audio)
        # 1000 Hz sine at 16kHz = ~2000 crossings / 15999 samples
        self.assertAlmostEqual(zcr, 2000 / 15999, places=2)

    def test_band_energy_ratio_tone_in_band(self):
        """Tone at 1000 Hz should have high band energy ratio."""
        from stt.vad import compute_band_energy_ratio
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        audio = 0.5 * np.sin(2 * np.pi * 1000 * t).astype(np.float32)
        ber = compute_band_energy_ratio(audio, sr=16000, low_hz=300, high_hz=3400)
        self.assertGreater(ber, 0.8)

    def test_band_energy_ratio_tone_outside_band(self):
        """Tone at 50 Hz should have low band energy ratio."""
        from stt.vad import compute_band_energy_ratio
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        audio = 0.5 * np.sin(2 * np.pi * 50 * t).astype(np.float32)
        ber = compute_band_energy_ratio(audio, sr=16000, low_hz=300, high_hz=3400)
        self.assertLess(ber, 0.2)

    def test_short_audio_returns_zero(self):
        """Functions should handle audio shorter than n_fft gracefully."""
        from stt.vad import (
            compute_spectral_flux, compute_spectral_centroid,
            compute_band_energy_ratio,
        )
        audio = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        self.assertEqual(compute_spectral_flux(audio, 16000), 0.0)
        self.assertEqual(compute_spectral_centroid(audio, 16000), 0.0)
        self.assertEqual(compute_band_energy_ratio(audio, 16000), 0.0)


class TestStreamingVAD(unittest.TestCase):
    """Tests for StreamingEndpointDetector with spectral features."""

    def _make_config(self, **overrides):
        from stt.config import VADConfig
        defaults = dict(
            silence_threshold_rms=0.005,
            silence_duration_sec=0.1,
            min_recording_sec=0.1,
            decision_window_sec=0.05,
            use_spectral_vad=True,
            spectral_weight=0.4,
        )
        defaults.update(overrides)
        return VADConfig(**defaults)

    def test_detector_creates(self):
        from stt.vad import StreamingEndpointDetector
        config = self._make_config()
        det = StreamingEndpointDetector(config, sample_rate=16000, block_size=1024)
        self.assertIsNotNone(det)

    def test_detector_speech_score_range(self):
        """Speech score should be non-negative (can exceed 1.0 for loud speech)."""
        from stt.vad import StreamingEndpointDetector
        config = self._make_config()
        det = StreamingEndpointDetector(config, sample_rate=16000, block_size=1024)
        chunk = np.random.uniform(-0.1, 0.1, 1024).astype(np.float32)
        score = det._compute_speech_score(chunk)
        self.assertGreaterEqual(score, 0.0)

    def test_detector_silence_low_score(self):
        """Silence should have low speech score (below threshold)."""
        from stt.vad import StreamingEndpointDetector
        config = self._make_config()
        det = StreamingEndpointDetector(config, sample_rate=16000, block_size=1024)
        silence = np.zeros(1024, dtype=np.float32)
        score = det._compute_speech_score(silence)
        # Silence should score below onset threshold (1.0 + hysteresis)
        self.assertLess(score, 1.5)

    def test_detector_update_with_chunk(self):
        from stt.vad import StreamingEndpointDetector
        config = self._make_config()
        det = StreamingEndpointDetector(config, sample_rate=16000, block_size=1024)
        chunk = np.random.uniform(-0.01, 0.01, 1024).astype(np.float32)
        event = det.update(rms=0.001, chunk_start_sample=0, chunk_end_sample=1024, chunk=chunk)
        # Should not trigger on silence
        self.assertIsNone(event)
