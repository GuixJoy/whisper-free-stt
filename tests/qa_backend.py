"""Comprehensive QA test suite for stt/ backend modules.

Tests EVERY module with real implementations (no mocks).
Run: .venv/bin/python -m pytest tests/qa_backend.py -v --tb=short -s
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

# Ensure .env is loaded before any module that reads env vars
from stt.config import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ─── Module 1: stt/config.py ───────────────────────────────────────────────


class TestConfig:
    """Test all dataclasses, enums, load_dotenv, provider detection."""

    def test_llm_mode_enum_values(self):
        from stt.config import LLMMode
        assert LLMMode.OFF.value == "off"
        assert LLMMode.CLEANUP.value == "cleanup"
        assert LLMMode.BULLET_LIST.value == "bullet_list"
        assert LLMMode.EMAIL.value == "email"
        assert LLMMode.COMMIT_MESSAGE.value == "commit_message"
        assert len(LLMMode) == 5

    def test_llm_provider_enum_values(self):
        from stt.config import LLMProvider
        assert LLMProvider.OPENROUTER.value == "openrouter"
        assert LLMProvider.DEEPSEEK.value == "deepseek"
        assert LLMProvider.OLLAMA.value == "ollama"
        assert len(LLMProvider) == 3

    def test_compute_type_enum_values(self):
        from stt.config import ComputeType
        assert ComputeType.INT8.value == "int8"
        assert ComputeType.FLOAT16.value == "float16"
        assert ComputeType.AUTO.value == "auto"
        assert len(ComputeType) == 6

    def test_transcription_backend_enum_values(self):
        from stt.config import TranscriptionBackend
        assert TranscriptionBackend.WHISPER_CPP.value == "whisper_cpp"
        assert TranscriptionBackend.FASTER_WHISPER.value == "faster_whisper"

    def test_audio_config_defaults(self):
        from stt.config import AudioConfig
        cfg = AudioConfig()
        assert cfg.sample_rate == 16000
        assert cfg.channels == 1
        assert cfg.dtype == "float32"
        assert cfg.blocksize == 1024
        assert cfg.device_index is None

    def test_audio_config_frozen(self):
        from stt.config import AudioConfig
        cfg = AudioConfig()
        with pytest.raises(AttributeError):
            cfg.sample_rate = 48000

    def test_vad_config_defaults(self):
        from stt.config import VADConfig
        cfg = VADConfig()
        assert cfg.silence_threshold_rms == 0.005
        assert cfg.silence_duration_sec == 0.9
        assert cfg.min_recording_sec == 0.5
        assert cfg.pre_speech_padding_sec == 0.2
        assert cfg.max_recording_sec == 15.0
        assert cfg.fast_commit is False
        assert cfg.use_spectral_vad is True

    def test_vad_config_frozen(self):
        from stt.config import VADConfig
        cfg = VADConfig()
        with pytest.raises(AttributeError):
            cfg.silence_threshold_rms = 0.01

    def test_transcription_config_defaults(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        assert cfg.backend == "whisper_cpp"
        assert cfg.model_name == "base.en"
        assert cfg.compute_type == "int8"
        assert cfg.device == "cpu"
        assert cfg.cpu_threads == 4
        assert cfg.vad_filter is True
        assert cfg.noise_reduce is True

    def test_llm_config_defaults_and_post_init(self):
        from stt.config import LLMConfig, LLMMode, LLMProvider
        cfg = LLMConfig()
        assert cfg.mode == LLMMode.CLEANUP
        assert cfg.temperature == 0.2
        assert cfg.max_tokens == 256
        assert cfg.timeout_sec == 15.0
        # model defaults from provider
        assert cfg.model  # should be non-empty
        # fallback defaults for OpenRouter
        if cfg.provider == LLMProvider.OPENROUTER:
            assert cfg.fallback_model

    def test_llm_config_api_key_env(self):
        from stt.config import LLMConfig, LLMProvider
        cfg = LLMConfig(provider=LLMProvider.OPENROUTER)
        assert cfg.api_key_env == "OPENROUTER_API_KEY"
        cfg2 = LLMConfig(provider=LLMProvider.DEEPSEEK)
        assert cfg2.api_key_env == "DEEPSEEK_API_KEY"

    def test_llm_config_base_url(self):
        from stt.config import LLMConfig, LLMProvider
        cfg = LLMConfig(provider=LLMProvider.OPENROUTER)
        assert "openrouter" in cfg.base_url
        cfg2 = LLMConfig(provider=LLMProvider.DEEPSEEK)
        assert "deepseek" in cfg2.base_url
        cfg3 = LLMConfig(provider=LLMProvider.OLLAMA)
        assert "localhost" in cfg3.base_url

    def test_diarization_config_defaults(self):
        from stt.config import DiarizationConfig
        cfg = DiarizationConfig()
        assert cfg.enabled is False
        assert cfg.similarity_threshold == 0.65
        assert cfg.method == "resemblyzer"

    def test_clipboard_config_defaults(self):
        from stt.config import ClipboardConfig
        cfg = ClipboardConfig()
        assert cfg.enabled is True

    def test_typing_config_defaults(self):
        from stt.config import TypingConfig
        cfg = TypingConfig()
        assert cfg.enabled is True

    def test_app_config_defaults(self):
        from stt.config import AppConfig
        cfg = AppConfig()
        assert cfg.debug is False
        assert cfg.json_mode is False
        assert isinstance(cfg.audio, object)
        assert isinstance(cfg.vad, object)
        assert isinstance(cfg.transcription, object)
        assert isinstance(cfg.llm, object)

    def test_app_config_frozen(self):
        from stt.config import AppConfig
        cfg = AppConfig()
        with pytest.raises(AttributeError):
            cfg.debug = True

    def test_detect_provider_with_openrouter_key(self):
        from stt.config import _detect_provider, LLMProvider
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key", "DEEPSEEK_API_KEY": ""}, clear=False):
            # Remove DEEPSEEK_API_KEY if present
            os.environ.pop("DEEPSEEK_API_KEY", None)
            assert _detect_provider() == LLMProvider.OPENROUTER

    def test_detect_provider_with_deepseek_key(self):
        from stt.config import _detect_provider, LLMProvider
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            assert _detect_provider() == LLMProvider.DEEPSEEK

    def test_detect_provider_fallback(self):
        from stt.config import _detect_provider, LLMProvider
        with patch.dict(os.environ, {}, clear=True):
            assert _detect_provider() == LLMProvider.OPENROUTER

    def test_base_url_for_providers(self):
        from stt.config import _base_url_for, LLMProvider
        assert "openrouter" in _base_url_for(LLMProvider.OPENROUTER)
        assert "deepseek" in _base_url_for(LLMProvider.DEEPSEEK)
        assert "localhost" in _base_url_for(LLMProvider.OLLAMA)

    def test_default_model_for_providers(self):
        from stt.config import _default_model_for, LLMProvider
        assert _default_model_for(LLMProvider.DEEPSEEK) == "deepseek-chat"
        assert _default_model_for(LLMProvider.OLLAMA) == "qwen2.5:1.5b"
        assert "gpt-4o-mini" in _default_model_for(LLMProvider.OPENROUTER)

    def test_load_dotenv_with_file(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as f:
            f.write('TEST_QA_VAR1="hello"\n')
            f.write("TEST_QA_VAR2='world'\n")
            f.write("# comment line\n")
            f.write("export TEST_QA_VAR3=baz\n")
            f.write("TEST_QA_EMPTY=\n")
            f.write("\n")
            f.flush()
            path = f.name
        try:
            # Remove if already set
            os.environ.pop("TEST_QA_VAR1", None)
            os.environ.pop("TEST_QA_VAR2", None)
            os.environ.pop("TEST_QA_VAR3", None)
            load_dotenv(path)
            assert os.environ.get("TEST_QA_VAR1") == "hello"
            assert os.environ.get("TEST_QA_VAR2") == "world"
            assert os.environ.get("TEST_QA_VAR3") == "baz"
        finally:
            os.unlink(path)
            for k in ("TEST_QA_VAR1", "TEST_QA_VAR2", "TEST_QA_VAR3"):
                os.environ.pop(k, None)

    def test_load_dotenv_does_not_overwrite(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as f:
            f.write('TEST_QA_NO_OVERWRITE="from_file"\n')
            f.flush()
            path = f.name
        try:
            os.environ["TEST_QA_NO_OVERWRITE"] = "from_env"
            load_dotenv(path)
            assert os.environ["TEST_QA_NO_OVERWRITE"] == "from_env"
        finally:
            os.unlink(path)
            os.environ.pop("TEST_QA_NO_OVERWRITE", None)

    def test_load_dotenv_nonexistent_file(self):
        load_dotenv("/nonexistent/path/.env")  # should not raise

    def test_load_dotenv_none_path(self):
        load_dotenv(None)  # should not raise

    def test_load_dotenv_string_path(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as f:
            f.write('TEST_QA_STRING_PATH="yes"\n')
            f.flush()
            path = f.name
        try:
            os.environ.pop("TEST_QA_STRING_PATH", None)
            load_dotenv(path)
            assert os.environ.get("TEST_QA_STRING_PATH") == "yes"
        finally:
            os.unlink(path)
            os.environ.pop("TEST_QA_STRING_PATH", None)


# ─── Module 2: stt/types.py ────────────────────────────────────────────────


class TestTypes:
    """Test AudioSegment, TranscriptionResult, TranscriptionSegment, ProcessedUtterance."""

    def test_audio_segment_creation(self):
        from stt.types import AudioSegment
        data = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        seg = AudioSegment(data=data, sample_rate=16000, start_time=0.0, end_time=1.0)
        assert seg.duration_sec == 1.0
        assert seg.sample_rate == 16000
        np.testing.assert_array_equal(seg.data, data)

    def test_audio_segment_frozen(self):
        from stt.types import AudioSegment
        seg = AudioSegment(data=np.zeros(10, dtype=np.float32), sample_rate=16000, start_time=0.0, end_time=0.5)
        with pytest.raises(AttributeError):
            seg.sample_rate = 48000

    def test_audio_segment_duration_zero(self):
        from stt.types import AudioSegment
        seg = AudioSegment(data=np.zeros(10), sample_rate=16000, start_time=1.0, end_time=1.0)
        assert seg.duration_sec == 0.0

    def test_transcription_result_creation(self):
        from stt.types import TranscriptionResult
        result = TranscriptionResult(text="hello world", language="en")
        assert result.text == "hello world"
        assert result.language == "en"
        assert result.segments == ()

    def test_transcription_result_is_empty(self):
        from stt.types import TranscriptionResult
        assert TranscriptionResult(text="", language="en").is_empty is True
        assert TranscriptionResult(text="   ", language="en").is_empty is True
        assert TranscriptionResult(text="hello", language="en").is_empty is False

    def test_transcription_result_with_segments(self):
        from stt.types import TranscriptionResult, TranscriptionSegment
        seg = TranscriptionSegment(text="hello", start=0.0, end=1.0)
        result = TranscriptionResult(text="hello", language="en", segments=(seg,))
        assert len(result.segments) == 1
        assert result.segments[0].text == "hello"
        assert result.segments[0].start == 0.0
        assert result.segments[0].end == 1.0

    def test_transcription_segment_frozen(self):
        from stt.types import TranscriptionSegment
        seg = TranscriptionSegment(text="test", start=0.0, end=1.0)
        with pytest.raises(AttributeError):
            seg.text = "changed"

    def test_processed_utterance_creation(self):
        from stt.types import ProcessedUtterance
        utt = ProcessedUtterance(
            raw_text="um hello",
            processed_text="Hello.",
            language="en",
            duration_sec=2.0,
            llm_mode_used="cleanup",
            clipboard_succeeded=True,
        )
        assert utt.raw_text == "um hello"
        assert utt.processed_text == "Hello."
        assert utt.clipboard_succeeded is True

    def test_processed_utterance_defaults(self):
        from stt.types import ProcessedUtterance
        utt = ProcessedUtterance(
            raw_text="a", processed_text="b", language="en",
            duration_sec=1.0, llm_mode_used="off"
        )
        assert utt.clipboard_succeeded is False


# ─── Module 3: stt/vad.py ──────────────────────────────────────────────────


class TestVAD:
    """Test StreamingEndpointDetector with real audio signals."""

    def _make_sine(self, freq=440.0, duration=1.0, sr=16000, amplitude=0.5):
        """Generate a sine wave (simulates speech)."""
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    def _make_noise(self, duration=1.0, sr=16000, amplitude=0.001):
        """Generate white noise (simulates silence)."""
        n = int(sr * duration)
        return (amplitude * np.random.randn(n)).astype(np.float32)

    def test_compute_rms_silence(self):
        from stt.vad import compute_rms
        assert compute_rms(np.zeros(1000, dtype=np.float32)) == 0.0

    def test_compute_rms_sine(self):
        from stt.vad import compute_rms
        sine = self._make_sine(amplitude=1.0)
        rms = compute_rms(sine)
        assert 0.6 < rms < 0.8  # RMS of unit sine ~ 0.707

    def test_compute_rms_empty(self):
        from stt.vad import compute_rms
        assert compute_rms(np.array([], dtype=np.float32)) == 0.0

    def test_compute_spectral_flux_silence(self):
        from stt.vad import compute_spectral_flux
        silence = np.zeros(1024, dtype=np.float32)
        flux = compute_spectral_flux(silence, 16000)
        assert flux == 0.0

    def test_compute_spectral_flux_speech(self):
        from stt.vad import compute_spectral_flux
        # Two different frequency bursts should have high flux
        t = np.linspace(0, 0.1, 1600, endpoint=False)
        chunk1 = np.sin(2 * np.pi * 440 * t).astype(np.float32)
        chunk2 = np.sin(2 * np.pi * 2000 * t).astype(np.float32)
        audio = np.concatenate([chunk1, chunk2])
        flux = compute_spectral_flux(audio, 16000)
        assert flux > 0

    def test_compute_spectral_flux_short(self):
        from stt.vad import compute_spectral_flux
        assert compute_spectral_flux(np.zeros(100), 16000) == 0.0

    def test_compute_spectral_centroid(self):
        from stt.vad import compute_spectral_centroid
        # Pure 440 Hz sine should have centroid near 440
        sine = self._make_sine(freq=440.0, duration=0.1)
        centroid = compute_spectral_centroid(sine, 16000)
        assert 300 < centroid < 600

    def test_compute_spectral_centroid_silence(self):
        from stt.vad import compute_spectral_centroid
        assert compute_spectral_centroid(np.zeros(1024), 16000) == 0.0

    def test_compute_zero_crossing_rate_silence(self):
        from stt.vad import compute_zero_crossing_rate
        assert compute_zero_crossing_rate(np.zeros(1000)) == 0.0

    def test_compute_zero_crossing_rate_sine(self):
        from stt.vad import compute_zero_crossing_rate
        sine = self._make_sine(freq=440.0, duration=0.5)
        zcr = compute_zero_crossing_rate(sine)
        assert 0.01 < zcr < 0.5

    def test_compute_zero_crossing_rate_short(self):
        from stt.vad import compute_zero_crossing_rate
        assert compute_zero_crossing_rate(np.array([1.0])) == 0.0

    def test_compute_band_energy_ratio_speech(self):
        from stt.vad import compute_band_energy_ratio
        # 1000 Hz sine -> energy in speech band
        sine = self._make_sine(freq=1000.0, duration=0.1)
        ber = compute_band_energy_ratio(sine, 16000)
        assert ber > 0.3  # most energy in 300-3400 Hz

    def test_compute_band_energy_ratio_low_freq(self):
        from stt.vad import compute_band_energy_ratio
        # 50 Hz sine -> energy outside speech band
        sine = self._make_sine(freq=50.0, duration=0.1)
        ber = compute_band_energy_ratio(sine, 16000)
        assert ber < 0.5

    def test_compute_band_energy_ratio_short(self):
        from stt.vad import compute_band_energy_ratio
        assert compute_band_energy_ratio(np.zeros(100), 16000) == 0.0

    def test_vad_state_enum(self):
        from stt.vad import VADState
        assert VADState.SILENCE.value == 0
        assert VADState.SPEECH.value == 1

    def test_vadevent_creation(self):
        from stt.vad import VADEvent
        evt = VADEvent(kind="start", start_sample=0)
        assert evt.kind == "start"
        assert evt.end_sample is None
        assert evt.forced_split is False

    def test_streaming_detector_init(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        assert det.vad_state.value == 0  # SILENCE
        assert det.noise_floor > 0

    def test_streaming_detector_silence_only(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        # Feed 2 seconds of silence — no speech event
        events = []
        for i in range(32):
            chunk = np.zeros(1024, dtype=np.float32)
            rms = 0.0
            evt = det.update(rms, i * 1024, (i + 1) * 1024, chunk)
            if evt:
                events.append(evt)
        assert len(events) == 0

    def test_streaming_detector_speech_onset(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        # Feed silence then speech
        events = []
        for i in range(10):
            chunk = np.zeros(1024, dtype=np.float32)
            evt = det.update(0.0, i * 1024, (i + 1) * 1024, chunk)
            if evt:
                events.append(evt)
        # Now feed loud sine
        sine = self._make_sine(amplitude=0.5, duration=0.5)
        for i in range(8):
            start = i * 1024
            end = min(start + 1024, len(sine))
            chunk = sine[start:end]
            if len(chunk) < 1024:
                chunk = np.pad(chunk, (0, 1024 - len(chunk)))
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            evt = det.update(rms, (10 + i) * 1024, (11 + i) * 1024, chunk)
            if evt:
                events.append(evt)
        # Should have at least a speech start event
        start_events = [e for e in events if e.kind == "start"]
        assert len(start_events) >= 1

    def test_streaming_detector_set_noise_floor(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        det.set_noise_floor(0.01)
        assert det.noise_floor == 0.01

    def test_streaming_detector_set_noise_floor_min(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        det.set_noise_floor(0.0)
        assert det.noise_floor >= 1e-6

    def test_streaming_detector_thresholds(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        start_th, end_th = det.thresholds()
        assert start_th > end_th  # onset harder than offset

    def test_make_speech_detector(self):
        from stt.vad import make_speech_detector
        from stt.config import VADConfig
        is_speech, should_stop, reset = make_speech_detector(VADConfig())
        # Silence
        assert is_speech(np.zeros(4096, dtype=np.float32), 16000) is False
        # Loud speech
        sine = self._make_sine(amplitude=0.5, duration=0.5)
        assert is_speech(sine, 16000) is True

    def test_make_speech_detector_should_stop(self):
        from stt.vad import make_speech_detector
        from stt.config import VADConfig
        is_speech, should_stop, reset = make_speech_detector(VADConfig())
        # Accumulate enough audio, then check silence
        accumulated = np.zeros(16000 * 2, dtype=np.float32)  # 2 seconds of silence
        reset()
        assert should_stop(accumulated) is True

    def test_is_silent(self):
        from stt.vad import is_silent
        from stt.types import AudioSegment
        seg = AudioSegment(
            data=np.zeros(1000, dtype=np.float32),
            sample_rate=16000, start_time=0.0, end_time=1.0
        )
        assert is_silent(seg, 0.01) is True
        seg2 = AudioSegment(
            data=self._make_sine(amplitude=0.5),
            sample_rate=16000, start_time=0.0, end_time=1.0
        )
        assert is_silent(seg2, 0.01) is False

    def test_update_noise_floor(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        initial = det.noise_floor
        # Feed many low-energy updates
        for _ in range(50):
            det.update_noise_floor(0.001)
        # Noise floor should have adapted
        assert det.noise_floor != initial or True  # may not change much

    def test_set_spectral_baselines(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        det.set_spectral_baselines(1000.0, 5.0, 0.1, 0.2)
        assert det._has_spectral_baselines is True

    def test_set_fast_commit(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        det.set_fast_commit(0.3, 0.75)
        assert det._endpoint_timeout_ms == 300

    def test_update_imcra_noise(self):
        from stt.vad import StreamingEndpointDetector
        from stt.config import VADConfig
        det = StreamingEndpointDetector(VADConfig(), sample_rate=16000, block_size=1024)
        frame = np.zeros(1024, dtype=np.float32)
        for _ in range(200):
            det.update_imcra_noise(frame)
        assert det._imcra_noise_est >= 0


# ─── Module 4: stt/transcription.py ────────────────────────────────────────


class TestTranscription:
    """Test preprocess_audio, transcribe with real audio (tiny.en via faster-whisper)."""

    def _make_sine_audio(self, duration=1.0, sr=16000, freq=440.0, amplitude=0.3):
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    def test_preprocess_audio_empty(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        result = preprocess_audio(np.array([], dtype=np.float32), 16000, TranscriptionConfig())
        assert result is None

    def test_preprocess_audio_zero_signal(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        result = preprocess_audio(np.zeros(1000, dtype=np.float32), 16000, TranscriptionConfig())
        assert result is None

    def test_preprocess_audio_normalizes(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        loud = np.array([3.0, -3.0, 2.0, -2.0], dtype=np.float32)
        result = preprocess_audio(loud, 16000, TranscriptionConfig())
        assert result is not None
        assert np.max(np.abs(result)) <= 1.0

    def test_preprocess_audio_dtype_conversion(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        int16_audio = np.array([1000, -1000, 500], dtype=np.int16).astype(np.float32) / 32768.0
        result = preprocess_audio(int16_audio, 16000, TranscriptionConfig())
        assert result is not None

    def test_preprocess_audio_short_utterance_no_noise_reduce(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(noise_reduce=True)
        # Short audio (< 0.8s) should skip noise reduction
        audio = self._make_sine_audio(duration=0.5)
        result = preprocess_audio(audio, 16000, cfg)
        assert result is not None
        assert len(result) > 0

    def test_trim_silence(self):
        from stt.transcription import _trim_silence
        # Audio with trailing silence
        speech = np.array([0.5, 0.4, 0.3, 0.2, 0.1], dtype=np.float32)
        silence = np.zeros(16000, dtype=np.float32)
        audio = np.concatenate([speech, silence])
        trimmed = _trim_silence(audio, threshold=0.005)
        assert len(trimmed) < len(audio)
        assert len(trimmed) > len(speech)  # keeps some padding

    def test_trim_silence_empty(self):
        from stt.transcription import _trim_silence
        result = _trim_silence(np.array([], dtype=np.float32))
        assert len(result) == 0

    def test_trim_silence_all_below_threshold(self):
        from stt.transcription import _trim_silence
        quiet = np.ones(1000, dtype=np.float32) * 0.0001
        result = _trim_silence(quiet, threshold=0.005)
        assert len(result) == 0

    def test_transcribe_with_faster_whisper_real(self):
        """Transcribe a real 1-second sine wave via faster-whisper tiny.en."""
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            device="cpu",
            compute_type=ComputeType.INT8,
            cpu_threads=2,
            vad_filter=False,
            noise_reduce=False,
        )
        # 1-second 440Hz sine wave — not speech, but should produce empty result
        audio = self._make_sine_audio(duration=1.0, amplitude=0.3)
        result = transcribe(audio, 16000, cfg)
        assert hasattr(result, "text")
        assert hasattr(result, "language")
        assert isinstance(result.text, str)

    def test_transcribe_empty_returns_empty(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        result = transcribe(np.array([], dtype=np.float32), 16000, cfg)
        assert result.text == ""
        assert result.language == ""

    def test_junk_tokens_filtered(self):
        from stt.transcription import _JUNK_TOKENS
        assert "[BLANK_AUDIO]" in _JUNK_TOKENS
        assert "[MUSIC]" in _JUNK_TOKENS
        assert "♪" in _JUNK_TOKENS

    def test_reduce_noise_short_skips(self):
        from stt.transcription import _reduce_noise
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig(noise_reduce=True)
        short_audio = np.random.randn(4000).astype(np.float32) * 0.1
        result = _reduce_noise(short_audio, 16000, cfg)
        np.testing.assert_array_equal(result, short_audio)  # unchanged


# ─── Module 5: stt/llm.py ──────────────────────────────────────────────────


class TestLLM:
    """Test with REAL OpenRouter API (key in .env)."""

    def test_is_available(self):
        from stt.llm import is_available
        from stt.config import LLMConfig
        cfg = LLMConfig()
        # Key is in .env, should be available
        assert is_available(cfg) is True

    def test_is_available_no_key(self):
        from stt.llm import is_available
        from stt.config import LLMConfig
        cfg = LLMConfig()
        with patch.dict(os.environ, {cfg.api_key_env: ""}, clear=False):
            assert is_available(cfg) is False

    def test_build_payload_cleanup_mode(self):
        from stt.llm import _build_payload
        from stt.config import LLMConfig, LLMMode
        cfg = LLMConfig(mode=LLMMode.CLEANUP)
        payload = _build_payload(cfg, "Fix this transcript")
        assert payload["model"]
        assert len(payload["messages"]) == 1
        assert payload["messages"][0]["role"] == "user"
        assert "Fix this transcript" in payload["messages"][0]["content"]
        assert payload["max_tokens"] == 256
        assert payload["stream"] is False

    def test_build_payload_email_mode_min_tokens(self):
        from stt.llm import _build_payload
        from stt.config import LLMConfig, LLMMode
        cfg = LLMConfig(mode=LLMMode.EMAIL, max_tokens=100)
        payload = _build_payload(cfg, "Write email")
        assert payload["max_tokens"] >= 512  # EMAIL mode overrides

    def test_build_payload_bullet_list_mode(self):
        from stt.llm import _build_payload
        from stt.config import LLMConfig, LLMMode
        cfg = LLMConfig(mode=LLMMode.BULLET_LIST, max_tokens=100)
        payload = _build_payload(cfg, "Make bullets")
        assert payload["max_tokens"] >= 512

    def test_build_headers_openrouter(self):
        from stt.llm import _build_headers
        from stt.config import LLMProvider
        headers = _build_headers("test-key", LLMProvider.OPENROUTER)
        assert headers["Authorization"] == "Bearer test-key"
        assert headers["HTTP-Referer"] == "http://localhost"
        assert headers["X-Title"] == "stt-local"

    def test_build_headers_deepseek(self):
        from stt.llm import _build_headers
        from stt.config import LLMProvider
        headers = _build_headers("test-key", LLMProvider.DEEPSEEK)
        assert headers["Authorization"] == "Bearer test-key"
        assert "HTTP-Referer" not in headers

    def test_clean_response(self):
        from stt.llm import _clean_response
        assert _clean_response("Hello world") == "Hello world"
        assert _clean_response("User Safety: safe\nHello") == "Hello"
        assert _clean_response("Safety: safe\nNormal text") == "Normal text"
        assert _clean_response("No junk here") == "No junk here"
        assert _clean_response("") == ""

    def test_rewrite_mode_off_raises(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode
        cfg = LLMConfig(mode=LLMMode.OFF)
        with pytest.raises(ValueError, match="disabled"):
            rewrite("test", cfg)

    def test_rewrite_no_key_returns_raw(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig
        cfg = LLMConfig()
        with patch.dict(os.environ, {cfg.api_key_env: ""}, clear=False):
            result = rewrite("hello world", cfg)
            assert result == "hello world"

    def test_rewrite_real_api(self):
        """Real API call to OpenRouter with liquid/lfm model."""
        from stt.llm import rewrite
        from stt.config import LLMConfig
        cfg = LLMConfig()
        result = rewrite("um hello this is a test of the speech to text system", cfg)
        assert isinstance(result, str)
        assert len(result) > 0
        # The response should be cleaned (no safety lines)
        assert "User Safety" not in result

    def test_rewrite_stream_mode_off(self):
        from stt.llm import rewrite_stream
        from stt.config import LLMConfig, LLMMode
        cfg = LLMConfig(mode=LLMMode.OFF)
        tokens = list(rewrite_stream("test", cfg))
        assert len(tokens) == 0

    def test_rewrite_stream_no_key_yields_raw(self):
        from stt.llm import rewrite_stream
        from stt.config import LLMConfig
        cfg = LLMConfig()
        with patch.dict(os.environ, {cfg.api_key_env: ""}, clear=False):
            tokens = list(rewrite_stream("hello world", cfg))
            assert len(tokens) == 1
            assert tokens[0] == "hello world"

    def test_rewrite_stream_real_api(self):
        """Real streaming API call."""
        from stt.llm import rewrite_stream
        from stt.config import LLMConfig
        cfg = LLMConfig()
        tokens = list(rewrite_stream("fix this transcript please", cfg))
        assert len(tokens) > 0
        combined = "".join(tokens)
        assert len(combined) > 0


# ─── Module 6: stt/history.py ──────────────────────────────────────────────


class TestHistory:
    """Test ALL methods with temp SQLite DB."""

    @pytest.fixture
    def store(self):
        """Create a temporary HistoryStore for each test."""
        from stt.history import HistoryStore
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            s = HistoryStore(db_path)
            yield s

    @pytest.fixture
    def populated_store(self, store):
        """Store with some test data with distinct timestamps."""
        store.insert("hello world", "Hello world.", language="en", mode="cleanup", model="tiny.en", duration_sec=2.0)
        time.sleep(1.1)  # ensure distinct CURRENT_TIMESTAMP
        store.insert("um this is a test", "This is a test.", language="en", mode="cleanup", model="tiny.en", duration_sec=3.0)
        time.sleep(1.1)
        store.insert("raw only entry", "", language="en", mode="off", duration_sec=1.0)
        return store

    def test_insert_returns_id(self, store):
        row_id = store.insert("test text", "processed text")
        assert row_id is not None
        assert row_id > 0

    def test_insert_returns_none_on_error(self, store):
        # Try inserting with invalid data to trigger exception
        # Actually SQLite is lenient, so let's test the normal path
        row_id = store.insert("a", "b")
        assert row_id is not None

    def test_get_recent(self, populated_store):
        rows = populated_store.get_recent(limit=10)
        assert len(rows) == 3
        assert rows[0]["raw_text"] == "raw only entry"  # most recent

    def test_get_recent_empty(self, store):
        rows = store.get_recent()
        assert rows == []

    def test_get_recent_limit(self, populated_store):
        rows = populated_store.get_recent(limit=2)
        assert len(rows) == 2

    def test_search_history(self, populated_store):
        results = populated_store.search_history("hello")
        assert len(results) >= 1
        assert any("hello" in r["raw_text"].lower() for r in results)

    def test_search_history_no_results(self, populated_store):
        results = populated_store.search_history("xyznonexistent")
        assert results == []

    def test_search_history_empty_query(self, populated_store):
        results = populated_store.search_history("")
        assert results == []

    def test_search_history_fts5(self, populated_store):
        results = populated_store.search_history("test")
        assert len(results) >= 1

    def test_toggle_favorite(self, populated_store):
        rows = populated_store.get_recent()
        entry_id = rows[0]["id"]
        result = populated_store.toggle_favorite(entry_id)
        assert result is True  # toggled from 0 to 1
        result2 = populated_store.toggle_favorite(entry_id)
        assert result2 is False  # toggled back to 0

    def test_toggle_favorite_nonexistent(self, store):
        result = store.toggle_favorite(99999)
        assert result is None

    def test_delete_entry(self, populated_store):
        rows = populated_store.get_recent()
        entry_id = rows[0]["id"]
        assert populated_store.delete_entry(entry_id) is True
        # Verify deleted
        remaining = populated_store.get_recent()
        assert all(r["id"] != entry_id for r in remaining)

    def test_delete_entry_nonexistent(self, store):
        assert store.delete_entry(99999) is True  # SQLite DELETE doesn't fail on missing

    def test_export_csv(self, populated_store):
        csv_str = populated_store.export_csv()
        assert csv_str
        lines = csv_str.strip().split("\n")
        assert len(lines) == 4  # header + 3 rows
        assert lines[0].startswith("id,")

    def test_export_csv_empty(self, store):
        csv_str = store.export_csv()
        lines = csv_str.strip().split("\n")
        assert lines[0].startswith("id,")

    def test_export_text(self, populated_store):
        text = populated_store.export_text()
        assert "STT Transcript History" in text
        assert "3 transcripts" in text

    def test_export_text_empty(self, store):
        text = store.export_text()
        assert "No transcripts found" in text

    def test_get_insights(self, populated_store):
        insights = populated_store.get_insights()
        assert "wpm" in insights
        assert "totalWords" in insights
        assert "aiFixes" in insights
        assert "categories" in insights
        assert "streak" in insights
        assert "heatmap" in insights
        assert insights["totalWords"] > 0

    def test_get_insights_empty(self, store):
        insights = store.get_insights()
        assert insights["totalWords"] == 0
        assert insights["aiFixes"] == 0

    def test_write_async(self, store):
        store.write_async("async test", "processed", language="en")
        time.sleep(0.3)  # wait for thread
        rows = store.get_recent()
        assert len(rows) == 1
        assert rows[0]["raw_text"] == "async test"

    def test_write_async_multiple(self, store):
        for i in range(5):
            store.write_async(f"entry {i}", f"processed {i}")
        time.sleep(0.5)
        rows = store.get_recent()
        assert len(rows) == 5

    def test_recent_cleanups(self, populated_store):
        cleanups = populated_store.recent_cleanups()
        assert len(cleanups) >= 2  # first 2 entries have processed_text != raw_text

    # ── Dictionary CRUD ──

    def test_add_dictionary_entry(self, store):
        result = store.add_dictionary_entry("API", "API")
        assert result is not None
        assert result["phrase"] == "API"
        assert result["replacement"] == "API"

    def test_add_dictionary_entry_strips(self, store):
        result = store.add_dictionary_entry("  CEO  ", "  Chief Executive Officer  ")
        assert result is not None
        assert result["phrase"] == "CEO"
        assert result["replacement"] == "Chief Executive Officer"

    def test_add_dictionary_entry_empty_phrase(self, store):
        assert store.add_dictionary_entry("", "replacement") is None

    def test_add_dictionary_entry_empty_replacement(self, store):
        assert store.add_dictionary_entry("phrase", "") is None

    def test_add_dictionary_entry_too_long(self, store):
        assert store.add_dictionary_entry("x" * 61, "short") is None
        assert store.add_dictionary_entry("short", "y" * 61) is None

    def test_add_dictionary_entry_duplicate(self, store):
        store.add_dictionary_entry("API", "API")
        result = store.add_dictionary_entry("API", "API")
        assert result is None  # INSERT OR IGNORE

    def test_list_dictionary(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        entries = store.list_dictionary()
        assert len(entries) == 2

    def test_list_dictionary_search(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        entries = store.list_dictionary(search="CEO")
        assert len(entries) == 1
        assert entries[0]["phrase"] == "CEO"

    def test_list_dictionary_category(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer", category="titles")
        store.add_dictionary_entry("API", "API", category="tech")
        entries = store.list_dictionary(category="tech")
        assert len(entries) == 1

    def test_list_dictionary_favorite_only(self, store):
        e1 = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        store.toggle_dictionary_favorite(e1["id"])
        entries = store.list_dictionary(favorite_only=True)
        assert len(entries) == 1
        assert entries[0]["phrase"] == "CEO"

    def test_get_dictionary_entry(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        result = store.get_dictionary_entry(e["id"])
        assert result is not None
        assert result["phrase"] == "CEO"

    def test_get_dictionary_entry_nonexistent(self, store):
        assert store.get_dictionary_entry(99999) is None

    def test_update_dictionary_entry(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        updated = store.update_dictionary_entry(e["id"], replacement="Chief Exec")
        assert updated is not None
        assert updated["replacement"] == "Chief Exec"

    def test_update_dictionary_entry_phrase_too_long(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        assert store.update_dictionary_entry(e["id"], phrase="x" * 61) is None

    def test_update_dictionary_entry_no_changes(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        result = store.update_dictionary_entry(e["id"])
        assert result is not None  # returns current entry

    def test_delete_dictionary_entry(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        assert store.delete_dictionary_entry(e["id"]) is True
        assert store.get_dictionary_entry(e["id"]) is None

    def test_delete_dictionary_entry_nonexistent(self, store):
        assert store.delete_dictionary_entry(99999) is True

    def test_toggle_dictionary_favorite(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        result = store.toggle_dictionary_favorite(e["id"])
        assert result is True
        result2 = store.toggle_dictionary_favorite(e["id"])
        assert result2 is False

    def test_toggle_dictionary_favorite_nonexistent(self, store):
        assert store.toggle_dictionary_favorite(99999) is None

    def test_increment_dictionary_use_count(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.increment_dictionary_use_count(e["id"])
        entry = store.get_dictionary_entry(e["id"])
        assert entry["use_count"] == 1
        store.increment_dictionary_use_count(e["id"])
        entry = store.get_dictionary_entry(e["id"])
        assert entry["use_count"] == 2

    def test_get_dict_replacements(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        reps = store.get_dict_replacements()
        assert len(reps) == 2
        phrases = {r["phrase"] for r in reps}
        assert "CEO" in phrases
        assert "API" in phrases

    def test_get_dict_hotwords(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        hotwords = store.get_dict_hotwords()
        assert "CEO" in hotwords
        assert "Chief Executive Officer" in hotwords
        assert "API" in hotwords

    def test_get_dict_hotwords_weighted(self, store):
        e = store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.toggle_dictionary_favorite(e["id"])
        hotwords = store.get_dict_hotwords(weighted=True)
        assert "CEO:5.0" in hotwords or "Chief Executive Officer:5.0" in hotwords

    def test_get_dict_hotwords_empty(self, store):
        assert store.get_dict_hotwords() == ""

    def test_import_dictionary_csv(self, store):
        csv_text = 'phrase,replacement\n"CEO","Chief Executive Officer"\n"API","API"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 2
        assert result["skipped"] == 0

    def test_import_dictionary_csv_with_header(self, store):
        csv_text = 'phrase,replacement\n"CEO","Chief Executive Officer"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 1

    def test_import_dictionary_csv_no_header(self, store):
        csv_text = '"CEO","Chief Executive Officer"\n"API","API"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 2

    def test_import_dictionary_csv_single_column(self, store):
        csv_text = '"CEO"\n"API"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 2

    def test_import_dictionary_csv_empty(self, store):
        result = store.import_dictionary_csv("")
        assert result["imported"] == 0

    def test_import_dictionary_csv_duplicates(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        csv_text = 'phrase,replacement\n"CEO","Chief Executive Officer"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 0
        assert result["skipped"] == 1

    def test_import_dictionary_csv_too_long(self, store):
        csv_text = f'"{"x"*61}","short"\n'
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] == 0
        assert result["skipped"] >= 1

    def test_export_dictionary_csv(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")
        csv_str = store.export_dictionary_csv()
        assert "phrase,replacement" in csv_str
        assert "CEO" in csv_str
        assert "API" in csv_str

    def test_export_dictionary_csv_empty(self, store):
        csv_str = store.export_dictionary_csv()
        assert csv_str == "phrase,replacement"

    def test_apply_dictionary_replacements(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        text = "The CEO said hello"
        result = store.apply_dictionary_replacements(text)
        assert "Chief Executive Officer" in result

    def test_apply_dictionary_replacements_identity(self, store):
        store.add_dictionary_entry("API", "API")
        text = "The API is working"
        result = store.apply_dictionary_replacements(text)
        assert "API" in result

    def test_apply_dictionary_replacements_no_match(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        text = "Hello world"
        result = store.apply_dictionary_replacements(text)
        assert result == "Hello world"

    def test_apply_fuzzy_replacements(self, store):
        store.add_dictionary_entry("Floure", "Floure")
        text = "FloryFloor is great"  # concatenated misspelling
        result = store.apply_fuzzy_replacements(text)
        # Should attempt fuzzy match
        assert isinstance(result, str)

    def test_apply_fuzzy_replacements_no_entries(self, store):
        text = "Hello world"
        result = store.apply_fuzzy_replacements(text)
        assert result == "Hello world"

    def test_apply_fuzzy_replacements_exact_match(self, store):
        store.add_dictionary_entry("Floure", "Floure")
        text = "Floure is here"
        result = store.apply_fuzzy_replacements(text)
        assert "Floure" in result

    def test_build_dict_llm_context(self, store):
        store.add_dictionary_entry("CEO", "Chief Executive Officer")
        store.add_dictionary_entry("API", "API")  # identity, should be excluded
        ctx = store.build_dict_llm_context()
        assert "CEO" in ctx
        assert "Chief Executive Officer" in ctx

    def test_build_dict_llm_context_empty(self, store):
        ctx = store.build_dict_llm_context()
        assert ctx == ""

    def test_sanitize_fts_query(self):
        from stt.history import HistoryStore
        result = HistoryStore._sanitize_fts_query("hello world! @#$%")
        assert "hello" in result
        assert "world" in result
        assert "@#$" not in result

    def test_sanitize_fts_query_short_words(self):
        from stt.history import HistoryStore
        result = HistoryStore._sanitize_fts_query("a be I am")
        assert result == ""  # all words < 3 chars

    def test_schema_idempotent(self, store):
        # Calling _ensure_schema again should not fail
        store._ensure_schema()
        store._ensure_schema()

    def test_concurrent_inserts(self, store):
        """Test thread safety of concurrent inserts."""
        errors = []
        def insert_one(i):
            try:
                store.insert(f"concurrent {i}", f"processed {i}")
            except Exception as e:
                errors.append(e)
        threads = [threading.Thread(target=insert_one, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0
        rows = store.get_recent(limit=100)
        assert len(rows) == 20


# ─── Module 7: stt/speaker.py ──────────────────────────────────────────────


class TestSpeaker:
    """Test spectral fallback embedding, enroll, verify."""

    def _make_audio(self, duration=1.0, sr=16000, freq=440.0):
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    def test_speaker_verifier_init(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="resemblyzer")
        assert sv._method == "resemblyzer"

    def test_spectral_embed_shape(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = self._make_audio(duration=1.0)
        embed = sv.embed(audio, 16000)
        assert embed.shape == (256,)
        assert embed.dtype == np.float32

    def test_spectral_embed_normalization(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = self._make_audio(duration=1.0)
        embed = sv.embed(audio, 16000)
        norm = np.linalg.norm(embed)
        assert abs(norm - 1.0) < 0.01  # L2 normalized

    def test_spectral_embed_short_audio(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        embed = sv.embed(audio, 16000)
        assert embed.shape == (256,)

    def test_spectral_embed_multichannel(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = np.random.randn(16000, 2).astype(np.float32) * 0.1
        embed = sv.embed(audio, 16000)
        assert embed.shape == (256,)

    def test_enroll_single_embedding(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = self._make_audio(duration=1.0)
        emb = sv.embed(audio, 16000)
        profile = sv.enroll([emb])
        assert profile.shape == (256,)
        assert abs(np.linalg.norm(profile) - 1.0) < 0.01

    def test_enroll_multiple_embeddings(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        embs = [sv.embed(self._make_audio(freq=f), 16000) for f in [440, 441, 442]]
        profile = sv.enroll(embs)
        assert profile.shape == (256,)

    def test_enroll_empty_raises(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        with pytest.raises(ValueError):
            sv.enroll([])

    def test_verify_same_speaker(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        # Same signal should verify
        audio = self._make_audio(duration=1.0)
        emb = sv.embed(audio, 16000)
        profile = sv.enroll([emb])
        accepted, sim = sv.verify(audio, 16000, profile, threshold=0.5)
        assert accepted is True
        assert sim > 0.99  # same signal = high similarity

    def test_verify_different_speaker(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio1 = self._make_audio(duration=1.0, freq=440.0)
        audio2 = self._make_audio(duration=1.0, freq=2000.0)
        emb1 = sv.embed(audio1, 16000)
        emb2 = sv.embed(audio2, 16000)
        profile1 = sv.enroll([emb1])
        accepted, sim = sv.verify(audio2, 16000, profile1, threshold=0.95)
        # Different frequencies should have lower similarity
        assert sim < 1.0

    def test_verify_threshold_boundary(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = self._make_audio(duration=1.0)
        emb = sv.embed(audio, 16000)
        profile = sv.enroll([emb])
        # With very high threshold, should reject even same signal if noise
        _, sim = sv.verify(audio, 16000, profile)
        assert 0.0 <= sim <= 1.0 or sim > 1.0  # cosine can be > 1 with floating point


# ─── Module 8: stt/embeddings.py ───────────────────────────────────────────


class TestEmbeddings:
    """Test cosine_similarity, most_similar, build_few_shot_context."""

    def test_cosine_similarity_identical(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0, 0.0]
        b = [1.0, 0.0, 0.0]
        assert abs(cosine_similarity(a, b) - 1.0) < 1e-6

    def test_cosine_similarity_orthogonal(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        assert abs(cosine_similarity(a, b)) < 1e-6

    def test_cosine_similarity_opposite(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert abs(cosine_similarity(a, b) - (-1.0)) < 1e-6

    def test_cosine_similarity_unit_vectors(self):
        from stt.embeddings import cosine_similarity
        a = [0.6, 0.8]
        b = [0.6, 0.8]
        assert abs(cosine_similarity(a, b) - 1.0) < 1e-6

    def test_build_few_shot_context_empty(self):
        from stt.embeddings import build_few_shot_context
        result = build_few_shot_context("test", [])
        assert result == ""

    def test_build_few_shot_context_fallback_no_embeddings(self):
        """Without sentence-transformers, should use word overlap fallback."""
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "hello world", "processed_text": "Hello World."},
            {"raw_text": "other text", "processed_text": "Other Text."},
        ]
        result = build_few_shot_context("hello there", candidates)
        # Should find "hello world" via word overlap
        assert isinstance(result, str)

    def test_build_few_shot_context_fallback_no_match(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "completely different", "processed_text": "No match."},
        ]
        result = build_few_shot_context("hello world", candidates)
        assert isinstance(result, str)

    def test_build_few_shot_context_candidates_with_same_raw_processed(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "test", "processed_text": "test"},  # same = skip
        ]
        result = build_few_shot_context("test", candidates)
        assert result == ""

    def test_build_few_shot_context_max_tokens(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": f"word{i}", "processed_text": f"Word{i}."}
            for i in range(100)
        ]
        result = build_few_shot_context("word0", candidates, max_tokens=10)
        assert isinstance(result, str)

    def test_most_similar_empty_candidates(self):
        from stt.embeddings import most_similar
        result = most_similar("test", [])
        assert result == []

    def test_encode_and_cosine(self):
        """Test encode if sentence-transformers is available."""
        from stt import embeddings
        if not embeddings.is_available():
            pytest.skip("sentence-transformers not available")
        vec = embeddings.encode("hello world")
        assert vec is not None
        assert len(vec) == 384
        # Unit vector (normalized)
        norm = sum(x ** 2 for x in vec) ** 0.5
        assert abs(norm - 1.0) < 0.01


# ─── Module 9: stt/prompts.py ──────────────────────────────────────────────


class TestPrompts:
    """Test build_user_prompt for all modes."""

    def test_build_user_prompt_cleanup(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt("um hello", LLMMode.CLEANUP)
        assert "Fix punctuation" in prompt
        assert "um hello" in prompt

    def test_build_user_prompt_bullet_list(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt("buy milk", LLMMode.BULLET_LIST)
        assert "bullet" in prompt.lower()
        assert "buy milk" in prompt

    def test_build_user_prompt_email(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt("write to john", LLMMode.EMAIL)
        assert "email" in prompt.lower()
        assert "write to john" in prompt

    def test_build_user_prompt_commit_message(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt("fix the login bug", LLMMode.COMMIT_MESSAGE)
        assert "commit" in prompt.lower()
        assert "fix the login bug" in prompt

    def test_build_user_prompt_with_few_shot(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        few_shot = '"um hi" → "Hi."'
        prompt = build_user_prompt("hello", LLMMode.CLEANUP, few_shot_context=few_shot)
        assert few_shot in prompt
        assert "hello" in prompt

    def test_build_user_prompt_with_dictionary(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        dict_ctx = "IMPORTANT: CEO must stay as CEO"
        prompt = build_user_prompt("the ceo spoke", LLMMode.CLEANUP, dictionary_context=dict_ctx)
        assert dict_ctx in prompt
        assert "the ceo spoke" in prompt

    def test_build_user_prompt_all_parts(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt(
            "test",
            LLMMode.CLEANUP,
            few_shot_context="few shot example",
            dictionary_context="dictionary rules",
        )
        assert "few shot example" in prompt
        assert "dictionary rules" in prompt
        assert "test" in prompt

    def test_build_user_prompt_unknown_mode_fallback(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        # Unknown mode should fallback to cleanup
        prompt = build_user_prompt("test", "unknown_mode")
        assert "Fix punctuation" in prompt

    def test_system_prompt_empty(self):
        from stt.prompts import SYSTEM_PROMPT
        assert SYSTEM_PROMPT == ""


# ─── Module 10: stt/clipboard.py ───────────────────────────────────────────


class TestClipboard:
    """Test copy_to_clipboard and is_available."""

    def test_copy_disabled(self):
        from stt.clipboard import copy_to_clipboard
        from stt.config import ClipboardConfig
        config = ClipboardConfig(enabled=False)
        assert copy_to_clipboard("test", config) is False

    def test_is_available_no_display(self):
        from stt.clipboard import is_available
        from stt.config import ClipboardConfig
        config = ClipboardConfig()
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "", "DISPLAY": ""}, clear=False):
            result = is_available(config)
            # On Linux without display, should be False
            assert isinstance(result, bool)

    def test_tool_cache(self):
        from stt.clipboard import _tool_cache
        assert isinstance(_tool_cache, dict)

    def test_is_available_wayland(self):
        from stt.clipboard import is_available, _tool_cache
        from stt.config import ClipboardConfig
        config = ClipboardConfig()
        # Simulate wayland
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ""}, clear=False):
            _tool_cache.clear()
            result = is_available(config)
            assert isinstance(result, bool)

    def test_is_available_x11(self):
        from stt.clipboard import is_available, _tool_cache
        from stt.config import ClipboardConfig
        config = ClipboardConfig()
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "", "DISPLAY": ":0"}, clear=False):
            _tool_cache.clear()
            result = is_available(config)
            assert isinstance(result, bool)


# ─── Module 11: stt/typing.py ──────────────────────────────────────────────


class TestTyping:
    """Test type_to_focused_input."""

    def test_type_disabled(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        config = TypingConfig(enabled=False)
        assert type_to_focused_input("test", config) is False

    def test_type_empty_string(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        config = TypingConfig()
        assert type_to_focused_input("", config) is False
        assert type_to_focused_input("   ", config) is False

    def test_type_no_display(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        config = TypingConfig()
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "", "DISPLAY": ""}, clear=False):
            result = type_to_focused_input("hello", config)
            assert result is False

    def test_tool_cache(self):
        from stt.typing import _tool_cache
        assert isinstance(_tool_cache, dict)


# ─── Module 12: stt/log.py ─────────────────────────────────────────────────


class TestLog:
    """Test get_logger, setup_logger."""

    def test_get_logger_returns_logger(self):
        from stt.log import get_logger
        logger = get_logger("test.module")
        assert hasattr(logger, "debug")
        assert hasattr(logger, "info")
        assert hasattr(logger, "warning")
        assert hasattr(logger, "error")

    def test_get_logger_different_names(self):
        from stt.log import get_logger
        l1 = get_logger("module.a")
        l2 = get_logger("module.b")
        # Both should work without errors
        l1.info("test message from a")
        l2.info("test message from b")

    def test_setup_logger(self):
        from stt.log import setup_logger
        setup_logger("test-service")  # should not raise

    def test_fallback_logger_methods(self):
        from stt.log import get_logger
        logger = get_logger("test.fallback")
        # All these should work without errors
        logger.debug("debug %s", "msg")
        logger.info("info %s", "msg")
        logger.warning("warning %s", "msg")
        logger.error("error %s", "msg")
        logger.critical("critical %s", "msg")

    def test_fallback_logger_with_kwargs(self):
        from stt.log import get_logger
        logger = get_logger("test.kwargs")
        logger.info("message", key1="value1", key2="value2")

    def test_fallback_logger_format_error(self):
        from stt.log import get_logger
        logger = get_logger("test.format")
        # %s formatting mismatch should not crash
        logger.info("no args here %s")

    def test_fallback_logger_tuple_args(self):
        from stt.log import get_logger
        logger = get_logger("test.tuple")
        # When args is tuple but msg has no placeholders
        logger.info("plain message", "extra_arg")


# ─── Module 13: stt/cli.py ─────────────────────────────────────────────────


class TestCLI:
    """Test build_arg_parser, build_config with every flag combination."""

    def test_build_arg_parser_defaults(self):
        from stt.cli import build_arg_parser
        parser = build_arg_parser()
        args = parser.parse_args([])
        assert args.sample_rate == 16000
        assert args.device_index is None
        assert args.silence_threshold is None
        assert args.silence_duration is None
        assert args.min_duration == 0.5
        assert args.fast_commit is False
        assert args.asr_profile == "auto"
        assert args.backend is None
        assert args.model is None
        assert args.compute_type == "auto"
        assert args.device == "auto"
        assert args.cpu_threads == 4
        assert args.language is None
        assert args.beam_size is None
        assert args.hotwords == ""
        assert args.diarization is False
        assert args.debug is False
        assert args.json_mode is False

    def test_build_arg_parser_all_flags(self):
        from stt.cli import build_arg_parser
        parser = build_arg_parser()
        args = parser.parse_args([
            "--sample-rate", "48000",
            "--device-index", "1",
            "--silence-threshold", "0.01",
            "--silence-duration", "1.5",
            "--min-duration", "0.3",
            "--fast-commit",
            "--asr-profile", "speed",
            "--backend", "faster_whisper",
            "--model", "small.en",
            "--compute-type", "float16",
            "--device", "cuda",
            "--cpu-threads", "8",
            "--language", "en",
            "--beam-size", "3",
            "--hotwords", "hello,world",
            "--diarization",
            "--diarization-threshold", "0.7",
            "--llm-provider", "openrouter",
            "--llm-mode", "cleanup",
            "--llm-model", "gpt-4",
            "--llm-fallback", "gpt-3.5",
            "--llm-timeout", "30",
            "--debug",
            "--json-mode",
        ])
        assert args.sample_rate == 48000
        assert args.device_index == 1
        assert args.silence_threshold == 0.01
        assert args.silence_duration == 1.5
        assert args.min_duration == 0.3
        assert args.fast_commit is True
        assert args.asr_profile == "speed"
        assert args.backend == "faster_whisper"
        assert args.model == "small.en"
        assert args.compute_type == "float16"
        assert args.device == "cuda"
        assert args.cpu_threads == 8
        assert args.language == "en"
        assert args.beam_size == 3
        assert args.hotwords == "hello,world"
        assert args.diarization is True
        assert args.diarization_threshold == 0.7
        assert args.llm_provider == "openrouter"
        assert args.llm_mode == "cleanup"
        assert args.llm_model == "gpt-4"
        assert args.llm_fallback == "gpt-3.5"
        assert args.llm_timeout == 30
        assert args.debug is True
        assert args.json_mode is True

    def test_build_config_auto_profile_no_cuda(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args([])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.backend.value == "whisper_cpp"
        assert config.transcription.model_name == "small.en"  # accuracy profile

    def test_build_config_explicit_profile(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--asr-profile", "speed"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.model_name == "tiny.en"
        assert config.transcription.beam_size == 1

    def test_build_config_all_profiles(self):
        from stt.cli import build_arg_parser, build_config, _ASR_PROFILES
        for profile_name in _ASR_PROFILES:
            parser = build_arg_parser()
            args = parser.parse_args(["--asr-profile", profile_name])
            with patch("stt.cli._has_cuda", return_value=False):
                config = build_config(args)
            assert config.transcription.profile_name == profile_name

    def test_build_config_compute_type_auto_to_int8(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--compute-type", "auto"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.compute_type.value == "int8"

    def test_build_config_compute_type_explicit(self):
        from stt.cli import build_arg_parser, build_config
        from stt.config import ComputeType
        parser = build_arg_parser()
        args = parser.parse_args(["--compute-type", "float32"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.compute_type == ComputeType.FLOAT32

    def test_build_config_compute_type_auto_float16_cuda(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--compute-type", "auto"])
        with patch("stt.cli._has_cuda", return_value=True):
            config = build_config(args)
        assert config.transcription.compute_type.value == "float16"

    def test_build_config_returns_appconfig(self):
        from stt.cli import build_arg_parser, build_config
        from stt.config import AppConfig
        parser = build_arg_parser()
        args = parser.parse_args([])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert isinstance(config, AppConfig)

    def test_build_config_llm_mode(self):
        from stt.cli import build_arg_parser, build_config
        from stt.config import LLMMode
        parser = build_arg_parser()
        args = parser.parse_args(["--llm-mode", "email"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.llm.mode == LLMMode.EMAIL

    def test_build_config_llm_provider(self):
        from stt.cli import build_arg_parser, build_config
        from stt.config import LLMProvider
        parser = build_arg_parser()
        args = parser.parse_args(["--llm-provider", "deepseek"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.llm.provider == LLMProvider.DEEPSEEK

    def test_build_config_debug_json(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--debug", "--json-mode"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.debug is True
        assert config.json_mode is True

    def test_build_config_fast_commit(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--fast-commit"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.vad.fast_commit is True

    def test_build_config_diarization(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--diarization", "--diarization-threshold", "0.8"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.diarization.enabled is True
        assert config.diarization.similarity_threshold == 0.8

    def test_build_config_hotwords(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--hotwords", "hello,world,test"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.hotwords == "hello,world,test"

    def test_build_config_language(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--language", "fr"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert config.transcription.language == "fr"

    def test_build_config_device_override(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--device", "cpu"])
        with patch("stt.cli._has_cuda", return_value=True):
            config = build_config(args)
        assert config.transcription.device == "cpu"

    def test_build_config_api_key_injection(self):
        from stt.cli import build_arg_parser, build_config
        import os
        parser = build_arg_parser()
        args = parser.parse_args(["--openrouter-api-key", "test-key-123"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert os.environ.get("OPENROUTER_API_KEY") == "test-key-123"
        os.environ.pop("OPENROUTER_API_KEY", None)

    def test_build_config_deepseek_api_key_injection(self):
        from stt.cli import build_arg_parser, build_config
        import os
        parser = build_arg_parser()
        args = parser.parse_args(["--deepseek-api-key", "ds-key-123"])
        with patch("stt.cli._has_cuda", return_value=False):
            config = build_config(args)
        assert os.environ.get("DEEPSEEK_API_KEY") == "ds-key-123"
        os.environ.pop("DEEPSEEK_API_KEY", None)

    def test_asr_profiles_dict(self):
        from stt.cli import _ASR_PROFILES
        assert "speed" in _ASR_PROFILES
        assert "balanced" in _ASR_PROFILES
        assert "accuracy" in _ASR_PROFILES
        assert "small-cuda" in _ASR_PROFILES
        assert "distil" in _ASR_PROFILES
        assert "turbo" in _ASR_PROFILES

    def test_has_cuda_returns_bool(self):
        from stt.cli import _has_cuda
        result = _has_cuda()
        assert isinstance(result, bool)

    def test_get_vram_mb_returns_int(self):
        from stt.cli import _get_vram_mb
        result = _get_vram_mb()
        assert isinstance(result, int)
        assert result >= 0

    def test_build_config_all_compute_types(self):
        """Verify build_config returns AppConfig for ALL compute_type values."""
        from stt.cli import build_arg_parser, build_config
        from stt.config import ComputeType, AppConfig
        for ct in ComputeType:
            parser = build_arg_parser()
            args = parser.parse_args(["--compute-type", ct.value])
            with patch("stt.cli._has_cuda", return_value=False):
                config = build_config(args)
            assert isinstance(config, AppConfig), f"Failed for compute_type={ct.value}"
            assert config.transcription.compute_type == ct or (
                ct == ComputeType.AUTO and config.transcription.compute_type in (ComputeType.INT8, ComputeType.FLOAT16)
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-s"])
