"""Tests for stt/vad.py — compute_rms and streaming VAD."""

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
