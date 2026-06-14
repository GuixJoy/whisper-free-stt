"""Tests for the new transcription features: batched inference, word timestamps, hotwords."""

import unittest
from unittest.mock import patch, MagicMock, PropertyMock
import numpy as np


class TestTranscriptionConfigNewFields(unittest.TestCase):
    """Tests for new TranscriptionConfig fields."""

    def test_batch_size_default_is_zero(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.batch_size, 0)

    def test_batch_size_settable(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(batch_size=8)
        self.assertEqual(cfg.batch_size, 8)

    def test_word_timestamps_default_false(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertFalse(cfg.word_timestamps)

    def test_word_timestamps_settable(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(word_timestamps=True)
        self.assertTrue(cfg.word_timestamps)

    def test_hotwords_default_empty(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.hotwords, "")

    def test_hotwords_settable(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(hotwords="whisper,CTranslate2")
        self.assertEqual(cfg.hotwords, "whisper,CTranslate2")

    def test_config_is_frozen(self):
        from stt.config import TranscriptionConfig
        from dataclasses import FrozenInstanceError
        cfg = TranscriptionConfig()
        with self.assertRaises(FrozenInstanceError):
            cfg.batch_size = 8  # type: ignore


class TestBatchedModelCache(unittest.TestCase):
    """Tests for batched model caching."""

    def test_batched_cache_exists(self):
        from stt.transcription import _batched_cache
        self.assertIsInstance(_batched_cache, dict)

    def test_get_batched_model_returns_pipeline(self):
        """When faster-whisper is available, get_batched_model returns a BatchedInferencePipeline."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        from stt.transcription import _get_batched_model, _batched_cache

        mock_pipeline = MagicMock()
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            device="cpu",
            compute_type=ComputeType.INT8,
        )
        # Clear cache
        base_key = f"tiny.en|cpu|int8|4"
        _batched_cache.pop(f"batched|{base_key}", None)

        with patch("stt.transcription._get_fw_model", return_value=MagicMock()), \
             patch("faster_whisper.BatchedInferencePipeline", return_value=mock_pipeline):
            result = _get_batched_model(cfg)
            # Result should be the mock_pipeline (what BatchedInferencePipeline returned)
            self.assertIs(result, mock_pipeline)

    def test_batched_cache_reuses_model(self):
        """Second call should return cached model, not create new one."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        from stt.transcription import _batched_cache, _get_batched_model

        mock_pipeline = MagicMock()
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            device="cpu",
            compute_type=ComputeType.INT8,
        )

        # Clear cache first
        key = f"batched|tiny.en|cpu|int8|4"
        _batched_cache.pop(key, None)

        with patch("stt.transcription._get_fw_model", return_value=MagicMock()), \
             patch("faster_whisper.BatchedInferencePipeline", return_value=mock_pipeline):
            result1 = _get_batched_model(cfg)
            result2 = _get_batched_model(cfg)
            # Both should return the same cached pipeline
            self.assertIs(result1, result2)


class TestVADKwargs(unittest.TestCase):
    """Tests for VAD kwargs construction."""

    def test_vad_disabled_returns_empty(self):
        from stt.config import TranscriptionConfig
        from stt.transcription import _build_vad_kwargs
        cfg = TranscriptionConfig(vad_filter=False)
        result = _build_vad_kwargs(cfg)
        self.assertEqual(result, {})

    def test_vad_enabled_returns_filter(self):
        from stt.config import TranscriptionConfig
        from stt.transcription import _build_vad_kwargs
        cfg = TranscriptionConfig(vad_filter=True)
        result = _build_vad_kwargs(cfg)
        self.assertIn("vad_filter", result)
        self.assertTrue(result["vad_filter"])
        self.assertIn("vad_parameters", result)


class TestTranscribeWithBatching(unittest.TestCase):
    """Tests for _transcribe_fw with batched inference."""

    def test_batch_size_auto_on_gpu(self):
        """When batch_size=0 and device=cuda, auto-select batch_size=8."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            device="cuda",
            batch_size=0,
        )
        # Auto batch size should be 8 on GPU
        batch_size = cfg.batch_size if cfg.batch_size > 0 else (8 if cfg.device == "cuda" else 0)
        self.assertEqual(batch_size, 8)

    def test_batch_size_auto_on_cpu(self):
        """When batch_size=0 and device=cpu, auto-select batch_size=0 (no batching)."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            device="cpu",
            batch_size=0,
        )
        batch_size = cfg.batch_size if cfg.batch_size > 0 else (8 if cfg.device == "cuda" else 0)
        self.assertEqual(batch_size, 0)

    def test_explicit_batch_size_overrides_auto(self):
        """Explicit batch_size > 0 overrides auto-detection."""
        from stt.config import TranscriptionConfig, TranscriptionBackend
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            device="cpu",
            batch_size=16,
        )
        batch_size = cfg.batch_size if cfg.batch_size > 0 else (8 if cfg.device == "cuda" else 0)
        self.assertEqual(batch_size, 16)


class TestWordTimestampsInTranscription(unittest.TestCase):
    """Tests for word timestamps parameter passing."""

    def test_word_timestamps_added_to_kwargs(self):
        """word_timestamps=True should be added to transcribe kwargs."""
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(word_timestamps=True)
        transcribe_kwargs = {}
        if cfg.word_timestamps:
            transcribe_kwargs["word_timestamps"] = True
        self.assertIn("word_timestamps", transcribe_kwargs)
        self.assertTrue(transcribe_kwargs["word_timestamps"])

    def test_word_timestamps_not_added_when_false(self):
        """word_timestamps=False should not be added to kwargs."""
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(word_timestamps=False)
        transcribe_kwargs = {}
        if cfg.word_timestamps:
            transcribe_kwargs["word_timestamps"] = True
        self.assertNotIn("word_timestamps", transcribe_kwargs)


class TestHotwordsInTranscription(unittest.TestCase):
    """Tests for hotwords parameter passing."""

    def test_hotwords_added_to_kwargs(self):
        """Non-empty hotwords should be added to transcribe kwargs."""
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(hotwords="whisper,CTranslate2")
        transcribe_kwargs = {}
        if cfg.hotwords:
            transcribe_kwargs["hotwords"] = cfg.hotwords
        self.assertIn("hotwords", transcribe_kwargs)
        self.assertEqual(transcribe_kwargs["hotwords"], "whisper,CTranslate2")

    def test_empty_hotwords_not_added(self):
        """Empty hotwords should not be added to kwargs."""
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(hotwords="")
        transcribe_kwargs = {}
        if cfg.hotwords:
            transcribe_kwargs["hotwords"] = cfg.hotwords
        self.assertNotIn("hotwords", transcribe_kwargs)


class TestASRSemaphore(unittest.TestCase):
    """Tests for ASR semaphore configuration."""

    def test_asr_semaphore_is_one(self):
        """ASR semaphore should be 1 for whisper.cpp compatibility."""
        from stt.orchestrator import _asr_semaphore
        self.assertEqual(_asr_semaphore._value, 1)

    def test_llm_semaphore_is_four(self):
        """LLM semaphore should be 4 for network I/O concurrency."""
        from stt.orchestrator import _llm_semaphore
        self.assertEqual(_llm_semaphore._value, 4)


class TestWarmUpBackend(unittest.TestCase):
    """Tests for warm_up_backend with batched model."""

    def test_warmup_calls_batched_on_gpu(self):
        """warm_up_backend should also warm up batched model on GPU."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        from stt.transcription import warm_up_backend

        with patch("stt.transcription._get_fw_model") as mock_fw, \
             patch("stt.transcription._get_batched_model") as mock_batched:
            cfg = TranscriptionConfig(
                backend=TranscriptionBackend.FASTER_WHISPER,
                device="cuda",
                batch_size=8,
            )
            warm_up_backend(cfg)
            mock_fw.assert_called_once()
            mock_batched.assert_called_once()

    def test_warmup_skips_batched_on_cpu(self):
        """warm_up_backend should NOT warm up batched model on CPU."""
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        from stt.transcription import warm_up_backend

        with patch("stt.transcription._get_fw_model") as mock_fw, \
             patch("stt.transcription._get_batched_model") as mock_batched:
            cfg = TranscriptionConfig(
                backend=TranscriptionBackend.FASTER_WHISPER,
                device="cpu",
                batch_size=0,
            )
            warm_up_backend(cfg)
            mock_fw.assert_called_once()
            mock_batched.assert_not_called()


if __name__ == "__main__":
    unittest.main()
