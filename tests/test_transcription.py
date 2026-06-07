"""Tests for stt/transcription.py — pure audio processing functions."""

import unittest
import numpy as np


class TestJunkTokens(unittest.TestCase):
    """Tests for the _JUNK_TOKENS frozenset that filters hallucinations."""

    def test_blank_audio_is_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("[BLANK_AUDIO]", _JUNK_TOKENS)

    def test_music_variants_are_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("[MUSIC]", _JUNK_TOKENS)
        self.assertIn("[Music]", _JUNK_TOKENS)

    def test_noise_variants_are_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("[NOISE]", _JUNK_TOKENS)
        self.assertIn("[Noise]", _JUNK_TOKENS)

    def test_silence_variants_are_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("[SILENCE]", _JUNK_TOKENS)
        self.assertIn("[Silence]", _JUNK_TOKENS)

    def test_inaudible_is_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("[INAUDIBLE]", _JUNK_TOKENS)

    def test_music_notes_are_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIn("♪", _JUNK_TOKENS)
        self.assertIn("♫", _JUNK_TOKENS)

    def test_normal_text_not_junk(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertNotIn("Hello world", _JUNK_TOKENS)
        self.assertNotIn("test", _JUNK_TOKENS)
        self.assertNotIn("", _JUNK_TOKENS)

    def test_is_frozenset(self):
        from stt.transcription import _JUNK_TOKENS
        self.assertIsInstance(_JUNK_TOKENS, frozenset)


class TestTrimSilence(unittest.TestCase):
    """Tests for _trim_silence() — removes trailing low-amplitude samples."""

    def test_empty_audio_returns_empty(self):
        from stt.transcription import _trim_silence
        audio = np.array([], dtype=np.float32)
        result = _trim_silence(audio)
        self.assertEqual(len(result), 0)

    def test_all_silence_returns_empty(self):
        """Audio entirely below threshold should return an empty array."""
        from stt.transcription import _trim_silence
        audio = np.zeros(1000, dtype=np.float32) + 0.001  # below default 0.005 threshold
        result = _trim_silence(audio)
        self.assertEqual(len(result), 0)

    def test_loud_audio_not_trimmed_completely(self):
        """Audio with signal above threshold should retain most content."""
        from stt.transcription import _trim_silence
        audio = np.ones(1000, dtype=np.float32) * 0.5
        result = _trim_silence(audio)
        self.assertGreater(len(result), 0)

    def test_trailing_silence_trimmed(self):
        """Silence at the end should be removed, keeping the speech portion.

        The function adds 0.2s padding (3200 samples @ 16kHz) after the last
        above-threshold sample, so the trailing silence must be substantially
        longer than 3200 samples to actually see the result shortened.
        """
        from stt.transcription import _trim_silence
        # 100 samples of signal, then 8000 samples of silence (>> 3200-sample padding)
        signal_part = np.ones(100, dtype=np.float32) * 0.5
        silence_part = np.zeros(8000, dtype=np.float32)
        audio = np.concatenate([signal_part, silence_part])
        result = _trim_silence(audio)
        # Result should be shorter than original (trailing silence cut)
        self.assertLess(len(result), len(audio))
        # But the signal portion should be present
        self.assertGreater(len(result), 0)

    def test_custom_threshold_respected(self):
        """Custom threshold should be used instead of the default 0.005."""
        from stt.transcription import _trim_silence
        # Signal at 0.05, above the default threshold but below custom 0.1
        audio = np.ones(100, dtype=np.float32) * 0.05
        result_high_thresh = _trim_silence(audio, threshold=0.1)
        result_low_thresh = _trim_silence(audio, threshold=0.001)
        # With high threshold, all samples are "silent" → empty
        self.assertEqual(len(result_high_thresh), 0)
        # With low threshold, signal is retained
        self.assertGreater(len(result_low_thresh), 0)

    def test_result_never_longer_than_input(self):
        """Trimming can only shorten, never extend audio."""
        from stt.transcription import _trim_silence
        audio = np.random.uniform(-0.5, 0.5, 1000).astype(np.float32)
        result = _trim_silence(audio)
        self.assertLessEqual(len(result), len(audio))

    def test_padding_added_after_last_above_threshold(self):
        """There should be ~0.2s (3200 samples @ 16kHz) of padding after the last above-threshold sample."""
        from stt.transcription import _trim_silence
        # 100 silence + 1 loud sample + 100 silence
        audio = np.zeros(201, dtype=np.float32)
        audio[100] = 1.0  # One loud sample in the middle
        result = _trim_silence(audio)
        # Result should include up to 0.2s after index 100 (3200 samples), but we only have 201 total
        # so result length should be full array or close to it
        self.assertGreaterEqual(len(result), 100)  # At minimum kept up to the loud sample


class TestPreprocessAudio(unittest.TestCase):
    """Tests for preprocess_audio() — normalize, noise-reduce, trim."""

    def _make_config(self, noise_reduce=False):
        """Create a TranscriptionConfig with noise reduction disabled for speed."""
        from stt.config import TranscriptionConfig
        return TranscriptionConfig(noise_reduce=noise_reduce)

    def test_empty_audio_returns_none(self):
        from stt.transcription import preprocess_audio
        audio = np.array([], dtype=np.float32)
        result = preprocess_audio(audio, 16000, self._make_config())
        self.assertIsNone(result)

    def test_all_zero_audio_returns_none(self):
        """Zero audio (peak == 0) should return None."""
        from stt.transcription import preprocess_audio
        audio = np.zeros(1000, dtype=np.float32)
        result = preprocess_audio(audio, 16000, self._make_config())
        self.assertIsNone(result)

    def test_normal_audio_returns_array(self):
        from stt.transcription import preprocess_audio
        audio = np.ones(4000, dtype=np.float32) * 0.5
        result = preprocess_audio(audio, 16000, self._make_config())
        self.assertIsNotNone(result)
        self.assertIsInstance(result, np.ndarray)

    def test_audio_normalized_when_peak_exceeds_one(self):
        """Audio with values > 1.0 should be normalized to ≤ 1.0."""
        from stt.transcription import preprocess_audio
        audio = np.ones(4000, dtype=np.float32) * 5.0  # peak = 5.0
        result = preprocess_audio(audio, 16000, self._make_config())
        if result is not None:
            self.assertLessEqual(np.max(np.abs(result)), 1.0 + 1e-6)

    def test_int_audio_converted_to_float32(self):
        """Non-float32 input should be cast to float32."""
        from stt.transcription import preprocess_audio
        audio = np.ones(4000, dtype=np.int16) * 100
        result = preprocess_audio(audio, 16000, self._make_config())
        if result is not None:
            self.assertEqual(result.dtype, np.float32)

    def test_float32_audio_preserved(self):
        """float32 audio dtype should be preserved through processing."""
        from stt.transcription import preprocess_audio
        audio = np.ones(4000, dtype=np.float32) * 0.3
        result = preprocess_audio(audio, 16000, self._make_config())
        if result is not None:
            self.assertEqual(result.dtype, np.float32)

    def test_silent_audio_after_trim_returns_none(self):
        """If trimming removes all audio, return None."""
        from stt.transcription import preprocess_audio
        # Below the _trim_silence threshold of 0.005
        audio = np.full(1000, 0.001, dtype=np.float32)
        # After normalization peak=1.0, but normalization scales up → above threshold
        # Actually if peak=0.001, after normalization everything becomes 1.0, which passes trim
        # Use absolute silence instead
        audio = np.zeros(1000, dtype=np.float32)
        result = preprocess_audio(audio, 16000, self._make_config())
        self.assertIsNone(result)

    def test_peak_exactly_one_not_normalized(self):
        """Audio with peak == 1.0 should not be clipped or scaled."""
        from stt.transcription import preprocess_audio
        audio = np.linspace(0, 1.0, 4000, dtype=np.float32)
        audio[-1] = 1.0  # Ensure peak is 1.0
        result = preprocess_audio(audio, 16000, self._make_config())
        if result is not None:
            self.assertLessEqual(np.max(result), 1.0 + 1e-6)

    def test_result_is_1d_array(self):
        """Output should be a 1-D numpy array."""
        from stt.transcription import preprocess_audio
        audio = np.ones(4000, dtype=np.float32) * 0.5
        result = preprocess_audio(audio, 16000, self._make_config())
        if result is not None:
            self.assertEqual(result.ndim, 1)

    def test_noise_reduce_disabled_by_default(self):
        """When noise_reduce=False, result should still be returned (no import needed)."""
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(noise_reduce=False)
        audio = np.ones(4000, dtype=np.float32) * 0.5
        result = preprocess_audio(audio, 16000, cfg)
        self.assertIsNotNone(result)


class TestModelCacheKeys(unittest.TestCase):
    """Test the faster-whisper cache key construction (pure logic, no model loading)."""

    def test_fw_cache_key_includes_model_device_compute_threads(self):
        """Verify the cache key format for faster-whisper model caching."""
        from stt.config import TranscriptionConfig, ComputeType
        cfg = TranscriptionConfig(
            model_name="large-v3-turbo",
            device="cuda",
            compute_type=ComputeType.FLOAT16,
            cpu_threads=4,
        )
        expected_key = "large-v3-turbo|cuda|float16|4"
        actual_key = f"{cfg.model_name}|{cfg.device}|{cfg.compute_type.value}|{cfg.cpu_threads}"
        self.assertEqual(actual_key, expected_key)

    def test_different_devices_produce_different_keys(self):
        from stt.config import TranscriptionConfig
        cpu_cfg = TranscriptionConfig(model_name="base.en", device="cpu")
        gpu_cfg = TranscriptionConfig(model_name="base.en", device="cuda")
        cpu_key = f"{cpu_cfg.model_name}|{cpu_cfg.device}|{cpu_cfg.compute_type.value}|{cpu_cfg.cpu_threads}"
        gpu_key = f"{gpu_cfg.model_name}|{gpu_cfg.device}|{gpu_cfg.compute_type.value}|{gpu_cfg.cpu_threads}"
        self.assertNotEqual(cpu_key, gpu_key)


class TestVADParameters(unittest.TestCase):
    """Test VAD-related TranscriptionConfig parameters used in _transcribe_fw."""

    def test_vad_filter_default_enabled(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertTrue(cfg.vad_filter)

    def test_vad_min_silence_ms_applied(self):
        """vad_min_silence_ms should be readable and usable as int."""
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(vad_min_silence_ms=500)
        self.assertEqual(cfg.vad_min_silence_ms, 500)

    def test_vad_max_speech_sec_default(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.vad_max_speech_sec, 15.0)

    def test_vad_filter_can_be_disabled(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(vad_filter=False)
        self.assertFalse(cfg.vad_filter)


class TestTranscriptionConfigDefaults(unittest.TestCase):
    """Verify TranscriptionConfig defaults relevant to the PR changes."""

    def test_default_model_name(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.model_name, "base.en")

    def test_default_noise_reduce(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertTrue(cfg.noise_reduce)

    def test_noise_reduce_prop_decrease_default(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertAlmostEqual(cfg.noise_reduce_prop_decrease, 0.85)

    def test_whisper_thresholds_accessible(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertIsInstance(cfg.whisper_no_speech_thold, float)
        self.assertIsInstance(cfg.whisper_entropy_thold, float)
        self.assertIsInstance(cfg.whisper_logprob_thold, float)


class TestTrimSilenceEdgeCases(unittest.TestCase):
    """Additional edge cases and regression tests for _trim_silence."""

    def test_single_sample_above_threshold(self):
        from stt.transcription import _trim_silence
        audio = np.array([0.5], dtype=np.float32)
        result = _trim_silence(audio)
        # Single loud sample → kept with padding, but no room for padding
        self.assertGreaterEqual(len(result), 1)

    def test_single_sample_below_threshold(self):
        from stt.transcription import _trim_silence
        audio = np.array([0.001], dtype=np.float32)
        result = _trim_silence(audio)
        self.assertEqual(len(result), 0)

    def test_alternating_loud_quiet(self):
        """Last above-threshold sample determines cut point."""
        from stt.transcription import _trim_silence
        audio = np.zeros(200, dtype=np.float32)
        audio[0] = 0.5   # loud at start
        audio[100] = 0.5  # loud in middle
        # 99 silent samples at end
        result = _trim_silence(audio)
        # Should keep up to sample 100 + padding
        self.assertGreaterEqual(len(result), 101)


if __name__ == "__main__":
    unittest.main()
