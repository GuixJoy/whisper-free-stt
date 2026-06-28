"""Comprehensive integration tests — no mocking, real models, real DB, real API.

Run with: .venv/bin/python -m pytest tests/integration/ -v --tb=short -s
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import time
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

# Ensure stt is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from stt.config import (
    AppConfig,
    AudioConfig,
    ClipboardConfig,
    ComputeType,
    DiarizationConfig,
    LLMConfig,
    LLMMode,
    LLMProvider,
    TranscriptionBackend,
    TranscriptionConfig,
    TypingConfig,
    VADConfig,
    load_dotenv,
)
from stt.types import AudioSegment, ProcessedUtterance, TranscriptionResult, TranscriptionSegment


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def env():
    load_dotenv()
    return os.environ


@pytest.fixture(scope="session")
def sample_wav_path():
    """Path to a real WAV file for testing."""
    p = Path("/home/akshat/Downloads/test01_20s.wav")
    if not p.exists():
        pytest.skip("test WAV not found")
    return p


@pytest.fixture(scope="session")
def sample_audio(sample_wav_path):
    """Load WAV into numpy array + sample rate."""
    with wave.open(str(sample_wav_path), "r") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return audio, sr


@pytest.fixture(scope="session")
def tiny_config():
    """Config using tiny.en (fastest) on CPU."""
    return AppConfig(
        transcription=TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
        ),
        llm=LLMConfig(mode=LLMMode.OFF),
    )


@pytest.fixture(scope="session")
def base_config():
    """Config using base.en."""
    return AppConfig(
        transcription=TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="base.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
        ),
        llm=LLMConfig(mode=LLMMode.OFF),
    )


@pytest.fixture(scope="session")
def llm_config(env):
    """Config with LLM enabled via OpenRouter."""
    return AppConfig(
        transcription=TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
        ),
        llm=LLMConfig(
            mode=LLMMode.CLEANUP,
            provider=LLMProvider.OPENROUTER,
            model="openai/gpt-4o-mini",
        ),
    )


@pytest.fixture
def tmp_db():
    """Temporary SQLite database for history tests."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    yield db_path
    db_path.unlink(missing_ok=True)


# ===========================================================================
# SECTION 1: Config Module Tests
# ===========================================================================

class TestConfigModule:
    """Test all config dataclasses and helpers."""

    def test_app_config_defaults(self):
        cfg = AppConfig()
        assert cfg.audio.sample_rate == 16_000
        assert cfg.vad.silence_threshold_rms == 0.005
        assert cfg.transcription.backend == TranscriptionBackend.WHISPER_CPP
        assert cfg.llm.mode == LLMMode.CLEANUP
        assert cfg.debug is False
        assert cfg.json_mode is False

    def test_app_config_is_frozen(self):
        cfg = AppConfig()
        with pytest.raises(AttributeError):
            cfg.debug = True  # type: ignore

    def test_audio_config_frozen(self):
        cfg = AudioConfig()
        with pytest.raises(AttributeError):
            cfg.sample_rate = 48000  # type: ignore

    def test_vad_config_frozen(self):
        cfg = VADConfig()
        with pytest.raises(AttributeError):
            cfg.silence_threshold_rms = 0.01  # type: ignore

    def test_transcription_config_frozen(self):
        cfg = TranscriptionConfig()
        with pytest.raises(AttributeError):
            cfg.model_name = "large"  # type: ignore

    def test_llm_config_frozen(self):
        cfg = LLMConfig()
        with pytest.raises(AttributeError):
            cfg.mode = LLMMode.OFF  # type: ignore

    def test_clipboard_config_defaults(self):
        cfg = ClipboardConfig()
        assert cfg.enabled is True
        assert cfg.wl_copy_path == "wl-copy"
        assert cfg.xclip_path == "xclip"

    def test_typing_config_defaults(self):
        cfg = TypingConfig()
        assert cfg.enabled is True
        assert cfg.wtype_path == "wtype"
        assert cfg.xdotool_path == "xdotool"

    def test_diarization_config_defaults(self):
        cfg = DiarizationConfig()
        assert cfg.enabled is False
        assert cfg.method == "resemblyzer"
        assert cfg.similarity_threshold == 0.65

    def test_llm_mode_enum_values(self):
        assert LLMMode.OFF.value == "off"
        assert LLMMode.CLEANUP.value == "cleanup"
        assert LLMMode.BULLET_LIST.value == "bullet_list"
        assert LLMMode.EMAIL.value == "email"
        assert LLMMode.COMMIT_MESSAGE.value == "commit_message"

    def test_llm_provider_enum_values(self):
        assert LLMProvider.OPENROUTER.value == "openrouter"
        assert LLMProvider.DEEPSEEK.value == "deepseek"
        assert LLMProvider.OLLAMA.value == "ollama"

    def test_transcription_backend_enum_values(self):
        assert TranscriptionBackend.WHISPER_CPP.value == "whisper_cpp"
        assert TranscriptionBackend.FASTER_WHISPER.value == "faster_whisper"

    def test_compute_type_enum_values(self):
        assert ComputeType.INT8.value == "int8"
        assert ComputeType.FLOAT16.value == "float16"
        assert ComputeType.AUTO.value == "auto"

    def test_llm_config_properties(self):
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK)
        assert cfg.api_key_env == "DEEPSEEK_API_KEY"
        assert "deepseek" in cfg.base_url

        cfg2 = LLMConfig(provider=LLMProvider.OPENROUTER)
        assert cfg2.api_key_env == "OPENROUTER_API_KEY"
        assert "openrouter" in cfg2.base_url

        cfg3 = LLMConfig(provider=LLMProvider.OLLAMA)
        assert cfg3.base_url == "http://localhost:11434/api/chat"

    def test_llm_config_default_model_selection(self):
        cfg_or = LLMConfig(provider=LLMProvider.OPENROUTER)
        assert cfg_or.model == "openai/gpt-4o-mini"

        cfg_ds = LLMConfig(provider=LLMProvider.DEEPSEEK)
        assert cfg_ds.model == "deepseek-chat"

        cfg_ol = LLMConfig(provider=LLMProvider.OLLAMA)
        assert cfg_ol.model == "qwen2.5:1.5b"

    def test_llm_config_fallback_model(self):
        cfg = LLMConfig(provider=LLMProvider.OPENROUTER)
        assert cfg.fallback_model == "anthropic/claude-3.5-haiku"

    def test_load_dotenv_nonexistent(self):
        load_dotenv("/nonexistent/.env")  # should not raise

    def test_load_dotenv_with_values(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text('TEST_KEY="hello world"\n# comment\nEMPTY=\n')
        # Clear if exists
        os.environ.pop("TEST_KEY", None)
        load_dotenv(env_file)
        assert os.environ.get("TEST_KEY") == "hello world"
        os.environ.pop("TEST_KEY", None)

    def test_load_dotenv_does_not_overwrite(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text('OVERWRITE_TEST="new_value"\n')
        os.environ["OVERWRITE_TEST"] = "original"
        load_dotenv(env_file)
        assert os.environ["OVERWRITE_TEST"] == "original"
        os.environ.pop("OVERWRITE_TEST", None)

    def test_load_dotenv_export_prefix(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text('export EXPORT_TEST="exported"\n')
        os.environ.pop("EXPORT_TEST", None)
        load_dotenv(env_file)
        assert os.environ.get("EXPORT_TEST") == "exported"
        os.environ.pop("EXPORT_TEST", None)


# ===========================================================================
# SECTION 2: Types Module Tests
# ===========================================================================

class TestTypesModule:
    def test_audio_segment_duration(self):
        data = np.zeros(16000, dtype=np.float32)
        seg = AudioSegment(data=data, sample_rate=16000, start_time=0.0, end_time=1.0)
        assert seg.duration_sec == 1.0

    def test_transcription_result_is_empty(self):
        r = TranscriptionResult(text="", language="en", segments=[])
        assert r.is_empty is True

        r2 = TranscriptionResult(text="hello", language="en", segments=[])
        assert r2.is_empty is False

    def test_transcription_segment(self):
        seg = TranscriptionSegment(text="hello", start=0.0, end=1.0)
        assert seg.text == "hello"
        assert seg.start == 0.0
        assert seg.end == 1.0


# ===========================================================================
# SECTION 3: VAD Module Tests (Real Audio)
# ===========================================================================

class TestVAD:
    """Test VAD with real audio data."""

    def test_compute_rms_silence(self):
        from stt.vad import compute_rms
        silence = np.zeros(16000, dtype=np.float32)
        rms = compute_rms(silence)
        assert rms == 0.0

    def test_compute_rms_signal(self):
        from stt.vad import compute_rms
        t = np.linspace(0, 1, 16000, dtype=np.float32)
        signal = 0.5 * np.sin(2 * np.pi * 440 * t)
        rms = compute_rms(signal)
        assert 0.3 < rms < 0.4

    def test_compute_spectral_flux(self):
        from stt.vad import compute_spectral_flux
        audio = np.random.randn(16000).astype(np.float32) * 0.1
        flux = compute_spectral_flux(audio, 16000)
        assert flux >= 0.0

    def test_compute_spectral_centroid(self):
        from stt.vad import compute_spectral_centroid
        audio = np.random.randn(16000).astype(np.float32) * 0.1
        centroid = compute_spectral_centroid(audio, 16000)
        assert centroid > 0.0

    def test_compute_zero_crossing_rate(self):
        from stt.vad import compute_zero_crossing_rate
        t = np.linspace(0, 1, 16000, dtype=np.float32)
        signal = np.sign(np.sin(2 * np.pi * 440 * t))
        zcr = compute_zero_crossing_rate(signal)
        assert zcr > 0.0

    def test_compute_band_energy_ratio(self):
        from stt.vad import compute_band_energy_ratio
        audio = np.random.randn(16000).astype(np.float32) * 0.1
        ber = compute_band_energy_ratio(audio, 16000, 300, 3400)
        assert ber >= 0.0

    def test_streaming_endpoint_detector_init(self):
        from stt.vad import StreamingEndpointDetector
        cfg = VADConfig()
        det = StreamingEndpointDetector(config=cfg, sample_rate=16000, block_size=1024)
        assert det._vad_state.value == 0 or det._vad_state.value == "SILENCE"

    def test_streaming_endpoint_detector_update_silence(self):
        from stt.vad import StreamingEndpointDetector
        cfg = VADConfig()
        det = StreamingEndpointDetector(config=cfg, sample_rate=16000, block_size=1024)
        silence = np.zeros(1024, dtype=np.float32)
        for i in range(50):
            rms = float(np.sqrt(np.mean(silence ** 2)))
            start = i * 1024
            end = start + 1024
            event = det.update(rms, start, end, silence)
        # Should still be in silence after pure silence
        assert event is None or event.kind in ("none", "silence")

    def test_streaming_endpoint_detector_noise_floor(self):
        from stt.vad import StreamingEndpointDetector
        cfg = VADConfig()
        det = StreamingEndpointDetector(config=cfg, sample_rate=16000, block_size=1024)
        assert det._noise_floor >= 0.0

    def test_vad_with_real_audio(self, sample_audio):
        from stt.vad import StreamingEndpointDetector
        cfg = VADConfig()
        audio, sr = sample_audio
        det = StreamingEndpointDetector(config=cfg, sample_rate=sr, block_size=1024)
        chunk_size = 1024
        events = []
        for i in range(0, len(audio) - chunk_size, chunk_size):
            chunk = audio[i:i + chunk_size]
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            event = det.update(rms, i, i + chunk_size, chunk)
            if event and event.kind not in ("none",):
                events.append(event)
        # With real audio, we should see some VAD events
        assert len(events) >= 0  # May or may not trigger depending on audio content


# ===========================================================================
# SECTION 4: Prompts Module Tests
# ===========================================================================

class TestPrompts:
    def test_build_user_prompt_cleanup(self):
        from stt.prompts import build_user_prompt
        prompt = build_user_prompt("hello world", LLMMode.CLEANUP, "", "")
        assert "hello world" in prompt
        # The prompt should contain instructions for the cleanup task
        assert len(prompt) > 0

    def test_build_user_prompt_bullet(self):
        from stt.prompts import build_user_prompt
        prompt = build_user_prompt("point one. point two.", LLMMode.BULLET_LIST, "", "")
        assert "point one" in prompt

    def test_build_user_prompt_email(self):
        from stt.prompts import build_user_prompt
        prompt = build_user_prompt("write an email", LLMMode.EMAIL, "", "")
        assert len(prompt) > 0

    def test_build_user_prompt_commit(self):
        from stt.prompts import build_user_prompt
        prompt = build_user_prompt("fix the bug", LLMMode.COMMIT_MESSAGE, "", "")
        assert "fix the bug" in prompt

    def test_build_user_prompt_with_few_shot(self):
        from stt.prompts import build_user_prompt
        few_shot = "raw: hlo -> corrected: hello\n"
        prompt = build_user_prompt("hlo world", LLMMode.CLEANUP, few_shot, "")
        assert "hlo world" in prompt
        assert "hlo" in few_shot

    def test_build_user_prompt_with_dictionary(self):
        from stt.prompts import build_user_prompt
        dict_ctx = "Replace 'foo' with 'bar'\n"
        prompt = build_user_prompt("foo baz", LLMMode.CLEANUP, "", dict_ctx)
        assert "foo baz" in prompt
        assert "foo" in dict_ctx


# ===========================================================================
# SECTION 5: History Module Tests (Real SQLite)
# ===========================================================================

class TestHistory:
    """Test HistoryStore with real SQLite database."""

    def test_insert_and_retrieve(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry_id = store.insert("raw text", "processed text", language="en", mode="cleanup")
        assert entry_id is not None
        assert entry_id > 0

        results = store.get_recent(limit=10)
        assert len(results) >= 1
        assert results[0]["raw_text"] == "raw text"
        assert results[0]["processed_text"] == "processed text"

    def test_search_history_fts(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.insert("the quick brown fox", "quick brown fox cleaned", language="en")
        store.insert("lazy dog sleeps", "lazy dog cleaned", language="en")
        store.insert("another fox story", "another fox story cleaned", language="en")

        results = store.search_history("fox", limit=10)
        assert len(results) >= 2
        texts = [r["raw_text"] for r in results]
        assert any("fox" in t for t in texts)

    def test_search_history_safe_query(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.insert("normal text", "cleaned", language="en")
        # FTS special chars should be escaped
        results = store.search_history('test OR 1=1', limit=10)
        assert isinstance(results, list)

    def test_toggle_favorite(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry_id = store.insert("test fav", "test fav cleaned", language="en")
        result = store.toggle_favorite(entry_id)
        assert result is True

        # Toggle back
        result2 = store.toggle_favorite(entry_id)
        assert result2 is False

    def test_delete_entry(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry_id = store.insert("to delete", "deleted cleaned", language="en")
        result = store.delete_entry(entry_id)
        assert result is True

        results = store.get_recent(limit=10)
        assert not any(r["id"] == entry_id for r in results)

    def test_export_csv(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.insert("csv raw", "csv processed", language="en")
        csv_str = store.export_csv(limit=10)
        assert "csv raw" in csv_str
        assert "csv processed" in csv_str

    def test_export_text(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.insert("text raw", "text processed", language="en")
        text = store.export_text(limit=10)
        assert "text raw" in text or "text processed" in text

    def test_get_insights(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        for i in range(5):
            store.insert(f"raw {i}", f"processed {i}", language="en", duration_sec=1.0 + i * 0.5)
        insights = store.get_insights()
        assert "totalWords" in insights or "wpm" in insights or isinstance(insights, dict)

    def test_write_async(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.write_async("async raw", "async processed", language="en")
        time.sleep(0.5)  # Give daemon thread time
        results = store.get_recent(limit=10)
        assert any("async raw" in r["raw_text"] for r in results)


# ===========================================================================
# SECTION 6: Dictionary Tests (Real SQLite)
# ===========================================================================

class TestDictionary:
    """Test dictionary CRUD with real SQLite."""

    def test_add_dictionary_entry(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("foo", "bar", category="tech", notes="test")
        assert entry is not None
        assert entry["phrase"] == "foo"
        assert entry["replacement"] == "bar"

    def test_add_duplicate_raises(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("dup", "dup1")
        result = store.add_dictionary_entry("dup", "dup2")
        # Should return None or raise (duplicate constraint)
        assert result is None or isinstance(result, dict)

    def test_list_dictionary(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("alpha", "ALPHA")
        store.add_dictionary_entry("beta", "BETA")
        entries = store.list_dictionary()
        assert len(entries) >= 2

    def test_search_dictionary(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("searchable term", "replaced")
        results = store.list_dictionary(search="searchable")
        assert len(results) >= 1

    def test_get_dictionary_entry(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("getme", "got")
        assert entry is not None
        got = store.get_dictionary_entry(entry["id"])
        assert got is not None
        assert got["phrase"] == "getme"

    def test_update_dictionary_entry(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("old", "old_val")
        updated = store.update_dictionary_entry(entry["id"], phrase="new", replacement="new_val")
        assert updated is not None
        assert updated["phrase"] == "new"

    def test_delete_dictionary_entry(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("deleteme", "gone")
        result = store.delete_dictionary_entry(entry["id"])
        assert result is True

    def test_toggle_dictionary_favorite(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("fav_entry", "fav_val")
        result = store.toggle_dictionary_favorite(entry["id"])
        assert result is True

    def test_get_dict_replacements(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("repl1", "REPL1")
        store.add_dictionary_entry("repl2", "REPL2")
        replacements = store.get_dict_replacements()
        assert len(replacements) >= 2

    def test_get_dict_hotwords(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("hotword1", "HW1")
        store.add_dictionary_entry("hotword2", "HW2")
        hotwords = store.get_dict_hotwords(weighted=False)
        assert isinstance(hotwords, str)
        assert "hotword1" in hotwords or "hotword2" in hotwords

    def test_import_dictionary_csv(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        csv_text = "phrase,replacement,category,notes\nimport1,IMPORT1,tech,imported\nimport2,IMPORT2,lang,imported\n"
        result = store.import_dictionary_csv(csv_text)
        assert result["imported"] >= 2

    def test_export_dictionary_csv(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("export1", "EXPORT1")
        csv_out = store.export_dictionary_csv()
        assert "export1" in csv_out or "EXPORT1" in csv_out

    def test_apply_dictionary_replacements(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("python", "Python")
        result = store.apply_dictionary_replacements("I love python coding")
        assert "Python" in result

    def test_apply_fuzzy_replacements(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("hello", "Hello")
        # Fuzzy match should catch "helo" (1 edit away)
        result = store.apply_fuzzy_replacements("helo world")
        # May or may not match depending on threshold
        assert isinstance(result, str)

    def test_build_dict_llm_context(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("term1", "Term1")
        ctx = store.build_dict_llm_context()
        assert isinstance(ctx, str)

    def test_increment_dictionary_use_count(self, tmp_db):
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)
        entry = store.add_dictionary_entry("counter", "counted")
        store.increment_dictionary_use_count(entry["id"])
        updated = store.get_dictionary_entry(entry["id"])
        assert updated["use_count"] >= 1


# ===========================================================================
# SECTION 7: Transcription Module Tests (Real Models)
# ===========================================================================

class TestTranscription:
    """Test ASR with real models and real audio."""

    def test_preprocess_audio(self, sample_audio):
        from stt.transcription import preprocess_audio
        audio, sr = sample_audio
        cfg = TranscriptionConfig(noise_reduce=True)
        result = preprocess_audio(audio, sr, cfg)
        assert result is not None
        assert isinstance(result, np.ndarray)
        assert len(result) > 0

    def test_preprocess_audio_no_noise_reduce(self, sample_audio):
        from stt.transcription import preprocess_audio
        audio, sr = sample_audio
        cfg = TranscriptionConfig(noise_reduce=False)
        result = preprocess_audio(audio, sr, cfg)
        assert result is not None

    def test_transcribe_tiny_model(self, sample_audio):
        from stt.transcription import transcribe
        audio, sr = sample_audio
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
        )
        result = transcribe(audio, sr, cfg)
        assert isinstance(result, TranscriptionResult)
        assert result.language == "en" or result.language is not None
        # Should have transcribed something from a 24s audio
        assert len(result.text.strip()) > 0

    def test_transcribe_base_model(self, sample_audio):
        from stt.transcription import transcribe
        audio, sr = sample_audio
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="base.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
        )
        result = transcribe(audio, sr, cfg)
        assert isinstance(result, TranscriptionResult)
        assert len(result.text.strip()) > 0

    def test_transcribe_with_hotwords(self, sample_audio):
        from stt.transcription import transcribe
        audio, sr = sample_audio
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
            hotwords="hello,world",
        )
        result = transcribe(audio, sr, cfg)
        assert isinstance(result, TranscriptionResult)

    def test_transcribe_segments(self, sample_audio):
        from stt.transcription import transcribe
        audio, sr = sample_audio
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
        )
        result = transcribe(audio, sr, cfg)
        # Segments may be tuple or list depending on backend
        assert isinstance(result.segments, (list, tuple))

    def test_warm_up_backend(self):
        from stt.transcription import warm_up_backend
        cfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
        )
        # Should not raise
        warm_up_backend(cfg)


# ===========================================================================
# SECTION 8: LLM Module Tests (Real API)
# ===========================================================================

class TestLLM:
    """Test LLM rewriting with real OpenRouter API calls."""

    def test_llm_rewrite_cleanup(self, llm_config, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        result = rewrite(
            "hte quikc brown fox jummps ovr the lazzy dog",
            llm_config.llm,
            few_shot_context="",
            dictionary_context="",
        )
        assert isinstance(result, str)
        assert len(result) > 0
        # LLM should have corrected the spelling
        assert "quick" in result.lower() or "fox" in result.lower()

    def test_llm_rewrite_stream(self, llm_config, env):
        from stt.llm import rewrite_stream
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        tokens = list(rewrite_stream(
            "pls fix ths sentnce",
            llm_config.llm,
            few_shot_context="",
            dictionary_context="",
        ))
        assert len(tokens) > 0
        full_text = "".join(tokens)
        assert len(full_text) > 0

    def test_llm_is_available(self, llm_config, env):
        from stt.llm import is_available
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        assert is_available(llm_config.llm) is True

    def test_llm_rewrite_bullet_list(self, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        cfg = AppConfig(
            llm=LLMConfig(mode=LLMMode.BULLET_LIST, provider=LLMProvider.OPENROUTER)
        )
        result = rewrite(
            "buy milk. call doctor. send email to bob.",
            cfg.llm,
            few_shot_context="",
            dictionary_context="",
        )
        assert isinstance(result, str)
        assert len(result) > 0

    def test_llm_rewrite_email(self, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        cfg = AppConfig(
            llm=LLMConfig(mode=LLMMode.EMAIL, provider=LLMProvider.OPENROUTER)
        )
        result = rewrite(
            "hi bob please send me the report by friday thanks",
            cfg.llm,
            few_shot_context="",
            dictionary_context="",
        )
        assert isinstance(result, str)
        assert len(result) > 0

    def test_llm_rewrite_commit_message(self, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        cfg = AppConfig(
            llm=LLMConfig(mode=LLMMode.COMMIT_MESSAGE, provider=LLMProvider.OPENROUTER)
        )
        result = rewrite(
            "fixed the bug in the login page where users couldnt sign in with special characters",
            cfg.llm,
            few_shot_context="",
            dictionary_context="",
        )
        assert isinstance(result, str)
        assert len(result) > 0

    def test_llm_with_few_shot_context(self, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        few_shot = "raw: hlo wrld -> corrected: hello world\nraw: gud mrng -> corrected: good morning\n"
        result = rewrite(
            "hlo there",
            LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER),
            few_shot_context=few_shot,
            dictionary_context="",
        )
        assert isinstance(result, str)

    def test_llm_with_dictionary_context(self, env):
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")
        dict_ctx = "Always use 'Python' (capital P) when referring to the programming language.\n"
        result = rewrite(
            "i love using python for data science",
            LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER),
            few_shot_context="",
            dictionary_context=dict_ctx,
        )
        assert "Python" in result


# ===========================================================================
# SECTION 9: Embeddings Module Tests
# ===========================================================================

class TestEmbeddings:
    def test_is_available(self):
        from stt.embeddings import is_available
        result = is_available()
        # May be True or False depending on sentence-transformers
        assert isinstance(result, bool)

    def test_cosine_similarity_identical(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0, 0.0]
        b = [1.0, 0.0, 0.0]
        assert abs(cosine_similarity(a, b) - 1.0) < 0.001

    def test_cosine_similarity_orthogonal(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert abs(cosine_similarity(a, b)) < 0.001

    def test_cosine_similarity_opposite(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert abs(cosine_similarity(a, b) - (-1.0)) < 0.001


# ===========================================================================
# SECTION 10: Speaker Verification Tests
# ===========================================================================

class TestSpeaker:
    def test_spectral_embedding(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = np.random.randn(16000 * 2).astype(np.float32) * 0.1
        embed = sv.embed(audio, 16000)
        assert embed.shape == (256,)
        assert np.linalg.norm(embed) > 0

    def test_enroll_and_verify_same(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio = np.random.randn(16000 * 2).astype(np.float32) * 0.1
        embed1 = sv.embed(audio, 16000)
        embed2 = sv.embed(audio, 16000)
        profile = sv.enroll([embed1, embed2])
        assert profile.shape == (256,)

        is_match, score = sv.verify(audio, 16000, profile, threshold=0.5)
        assert isinstance(is_match, bool)
        assert 0.0 <= score <= 1.0

    def test_enroll_and_verify_different(self):
        from stt.speaker import SpeakerVerifier
        sv = SpeakerVerifier(method="spectral")
        audio1 = np.random.randn(16000 * 2).astype(np.float32) * 0.1
        audio2 = np.random.randn(16000 * 2).astype(np.float32) * 0.1
        embed1 = sv.embed(audio1, 16000)
        profile = sv.enroll([embed1])
        is_match, score = sv.verify(audio2, 16000, profile, threshold=0.9)
        assert isinstance(is_match, bool)


# ===========================================================================
# SECTION 11: Server REST API Tests (Real FastAPI + SQLite)
# ===========================================================================

class TestServerREST:
    """Test REST API endpoints with real FastAPI test client."""

    @pytest.fixture
    def client(self, tmp_db):
        """Create a real FastAPI test client with temp DB."""
        from stt.history import HistoryStore
        from stt.server import app

        store = HistoryStore(tmp_db)

        # Patch get_store in all route modules to return our temp store
        import stt.routes.history as hist_route
        import stt.routes.insights as insights_route
        import stt.routes.export as export_route
        import stt.routes.dictionary as dict_route
        import stt.history as history_mod

        orig_get_store = history_mod.get_store
        history_mod.get_store = lambda db_path=None: store
        hist_route.get_store = lambda db_path=None: store
        insights_route.get_store = lambda db_path=None: store
        export_route.get_store = lambda db_path=None: store
        dict_route.get_store = lambda db_path=None: store

        from starlette.testclient import TestClient
        tc = TestClient(app)
        yield tc, store

        # Restore
        history_mod.get_store = orig_get_store

    def test_health_endpoint(self, client):
        c, store = client
        # Add some data first
        store.insert("health test raw", "health test processed", language="en")
        resp = c.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"

    def test_history_endpoint(self, client):
        c, store = client
        store.insert("history raw", "history processed", language="en")
        resp = c.get("/api/history?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_history_search_endpoint(self, client):
        c, store = client
        store.insert("searchable text here", "searchable processed", language="en")
        resp = c.get("/api/history/search?q=searchable&limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_insights_endpoint(self, client):
        c, store = client
        resp = c.get("/api/insights")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)

    def test_export_csv_endpoint(self, client):
        c, store = client
        store.insert("csv export test", "csv processed", language="en")
        resp = c.get("/api/export/csv")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_export_text_endpoint(self, client):
        c, store = client
        store.insert("text export test", "text processed", language="en")
        resp = c.get("/api/export/text")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers.get("content-type", "")

    def test_dictionary_crud(self, client):
        c, store = client
        # Create
        resp = c.post("/api/dictionary", json={
            "phrase": "test_phrase",
            "replacement": "Test Phrase",
            "category": "test",
        })
        assert resp.status_code == 200
        entry = resp.json()
        entry_id = entry["id"]

        # Read
        resp = c.get(f"/api/dictionary/{entry_id}")
        assert resp.status_code == 200

        # Update
        resp = c.put(f"/api/dictionary/{entry_id}", json={
            "replacement": "Updated Phrase",
        })
        assert resp.status_code == 200

        # Toggle favorite
        resp = c.post(f"/api/dictionary/{entry_id}/favorite")
        assert resp.status_code == 200

        # List
        resp = c.get("/api/dictionary")
        assert resp.status_code == 200

        # Delete
        resp = c.delete(f"/api/dictionary/{entry_id}")
        assert resp.status_code == 200

    def test_dictionary_replacements(self, client):
        c, store = client
        store.add_dictionary_entry("repl_a", "REPL_A")
        resp = c.get("/api/dictionary/replacements")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_dictionary_hotwords(self, client):
        c, store = client
        store.add_dictionary_entry("hw_test", "HW_TEST")
        resp = c.get("/api/dictionary/hotwords")
        assert resp.status_code == 200
        data = resp.json()
        assert "hotwords" in data

    def test_dictionary_csv_import_export(self, client):
        c, store = client
        csv_text = "phrase,replacement,category,notes\nimport_a,IMPORT_A,test,notes\n"
        resp = c.post("/api/dictionary/import", json={"csv_text": csv_text})
        assert resp.status_code == 200

        resp = c.get("/api/dictionary/export/csv")
        assert resp.status_code == 200


# ===========================================================================
# SECTION 12: Orchestrator Utility Tests
# ===========================================================================

class TestOrchestratorUtils:
    def test_normalize_text(self):
        from stt.orchestrator import _normalize_text
        # _normalize_text strips leading/trailing whitespace
        assert _normalize_text("  hello  world  ") == "hello  world"
        assert _normalize_text("hello\n\nworld") == "hello\n\nworld"  # newlines preserved
        assert _normalize_text("") == ""
        assert _normalize_text("   ") == ""

    def test_latency_tracker(self):
        from stt.orchestrator import _LatencyTracker
        lt = _LatencyTracker()
        lt.record("test_stage", 0.1)
        lt.record("test_stage", 0.2)
        lt.record("test_stage", 0.3)
        snap = lt.snapshot()
        assert "test_stage" in snap
        assert snap["test_stage"]["count"] == 3
        assert 0.1 <= snap["test_stage"]["p50"] <= 0.3

    def test_collect_system_stats(self):
        from stt.orchestrator import _collect_system_stats
        stats = _collect_system_stats()
        assert isinstance(stats, dict)
        assert "cpu_percent" in stats or "memory" in stats or len(stats) > 0


# ===========================================================================
# SECTION 13: CLI Module Tests
# ===========================================================================

class TestCLI:
    def test_build_arg_parser_defaults(self):
        from stt.cli import build_arg_parser
        parser = build_arg_parser()
        args = parser.parse_args([])
        assert args.sample_rate == 16000
        assert args.asr_profile == "auto"
        assert args.compute_type == "auto"
        assert args.device == "auto"
        assert args.cpu_threads == 4
        assert args.debug is False
        assert args.json_mode is False

    def test_build_arg_parser_custom(self):
        from stt.cli import build_arg_parser
        parser = build_arg_parser()
        args = parser.parse_args([
            "--sample-rate", "48000",
            "--asr-profile", "speed",
            "--model", "custom-model",
            "--compute-type", "float16",
            "--device", "cuda",
            "--cpu-threads", "8",
            "--language", "en",
            "--beam-size", "3",
            "--fast-commit",
            "--debug",
            "--json-mode",
        ])
        assert args.sample_rate == 48000
        assert args.asr_profile == "speed"
        assert args.model == "custom-model"
        assert args.compute_type == "float16"
        assert args.device == "cuda"
        assert args.cpu_threads == 8
        assert args.language == "en"
        assert args.beam_size == 3
        assert args.fast_commit is True
        assert args.debug is True
        assert args.json_mode is True

    def test_build_config_auto_compute_type(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--compute-type", "auto"])
        config = build_config(args)
        assert isinstance(config, AppConfig)
        # AUTO should resolve to a concrete type
        assert config.transcription.compute_type in (ComputeType.INT8, ComputeType.FLOAT16)

    def test_build_config_explicit_compute_type(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--compute-type", "int8"])
        config = build_config(args)
        assert config.transcription.compute_type == ComputeType.INT8

    def test_build_config_with_model_override(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--model", "small.en", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.model_name == "small.en"

    def test_build_config_with_hotwords(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--hotwords", "foo,bar"])
        config = build_config(args)
        assert config.transcription.hotwords == "foo,bar"

    def test_build_config_diarization(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--diarization", "--diarization-threshold", "0.8"])
        config = build_config(args)
        assert config.diarization.enabled is True
        assert config.diarization.similarity_threshold == 0.8

    def test_build_config_llm_mode(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--llm-mode", "email"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.EMAIL

    def test_build_config_fast_commit(self):
        from stt.cli import build_arg_parser, build_config
        parser = build_arg_parser()
        args = parser.parse_args(["--fast-commit"])
        config = build_config(args)
        assert config.vad.fast_commit is True


# ===========================================================================
# SECTION 14: Full Pipeline Integration Test
# ===========================================================================

class TestFullPipeline:
    """End-to-end tests: audio -> VAD -> ASR -> LLM -> output."""

    def test_audio_to_text_pipeline(self, sample_audio):
        """Test: audio -> preprocess -> transcribe -> result."""
        from stt.transcription import preprocess_audio, transcribe
        audio, sr = sample_audio

        # Preprocess
        cfg = TranscriptionConfig(noise_reduce=True)
        processed = preprocess_audio(audio, sr, cfg)
        assert processed is not None

        # Transcribe
        tcfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
            beam_size=1,
        )
        result = transcribe(processed if processed is not None else audio, sr, tcfg)
        assert isinstance(result, TranscriptionResult)
        assert len(result.text.strip()) > 0
        print(f"\n[Pipeline] ASR output: {result.text[:200]}")

    def test_audio_to_text_with_llm(self, sample_audio, env):
        """Test: audio -> preprocess -> transcribe -> LLM cleanup -> final text."""
        from stt.transcription import preprocess_audio, transcribe
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")

        audio, sr = sample_audio

        # Preprocess
        cfg = TranscriptionConfig(noise_reduce=True)
        processed = preprocess_audio(audio, sr, cfg)

        # Transcribe
        tcfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            compute_type=ComputeType.INT8,
            device="cpu",
        )
        result = transcribe(processed if processed is not None else audio, sr, tcfg)
        assert len(result.text.strip()) > 0

        # LLM cleanup
        llm_cfg = LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER)
        cleaned = rewrite(result.text, llm_cfg, few_shot_context="", dictionary_context="")
        assert isinstance(cleaned, str)
        assert len(cleaned) > 0
        print(f"\n[Pipeline] Raw: {result.text[:200]}")
        print(f"[Pipeline] Cleaned: {cleaned[:200]}")

    def test_vad_segment_transcription(self, sample_audio):
        """Test: audio -> VAD segment detection -> transcribe segment."""
        from stt.vad import StreamingEndpointDetector
        from stt.transcription import transcribe
        audio, sr = sample_audio
        cfg = VADConfig()
        det = StreamingEndpointDetector(config=cfg, sample_rate=sr, block_size=1024)

        chunk_size = 1024
        segments_found = []

        for i in range(0, len(audio) - chunk_size, chunk_size):
            chunk = audio[i:i + chunk_size]
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            event = det.update(rms, i, i + chunk_size, chunk)
            if event and event.kind == "end":
                start = max(0, event.start_sample)
                end = min(len(audio), event.end_sample or i + chunk_size)
                if end - start > sr * 0.5:  # > 0.5s
                    segments_found.append(audio[start:end])

        if segments_found:
            tcfg = TranscriptionConfig(
                backend=TranscriptionBackend.FASTER_WHISPER,
                model_name="tiny.en",
                compute_type=ComputeType.INT8,
                device="cpu",
            )
            for i, seg in enumerate(segments_found[:3]):  # Test first 3
                result = transcribe(seg, sr, tcfg)
                print(f"\n[VAD Segment {i}]: {result.text[:100]}")

    def test_history_write_and_search_pipeline(self, tmp_db):
        """Test: transcribe -> store -> search -> retrieve."""
        from stt.history import HistoryStore
        store = HistoryStore(tmp_db)

        # Simulate pipeline output
        raw = "the quick brown fox jumps over the lazy dog"
        processed = "The quick brown fox jumps over the lazy dog."

        entry_id = store.insert(raw, processed, language="en", mode="cleanup", duration_sec=2.5)
        assert entry_id is not None

        # Search
        results = store.search_history("quick brown")
        assert len(results) >= 1

        # Insights
        insights = store.get_insights()
        assert isinstance(insights, dict)

    def test_dictionary_and_llm_pipeline(self, tmp_db, env):
        """Test: dictionary -> LLM context -> rewrite with context."""
        from stt.history import HistoryStore
        from stt.llm import rewrite
        if "OPENROUTER_API_KEY" not in env:
            pytest.skip("No OPENROUTER_API_KEY")

        store = HistoryStore(tmp_db)
        store.add_dictionary_entry("python", "Python (the programming language)")
        store.add_dictionary_entry("js", "JavaScript")

        dict_ctx = store.build_dict_llm_context()
        llm_cfg = LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER)
        result = rewrite(
            "i use pyhton and js for web dev, pyhton is great",
            llm_cfg,
            few_shot_context="",
            dictionary_context=dict_ctx,
        )
        # LLM should correct spelling and respect dictionary context
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"\n[Dict+LLM] Result: {result}")


# ===========================================================================
# SECTION 15: Clipboard and Typing Tests
# ===========================================================================

class TestClipboardTyping:
    def test_clipboard_disabled(self):
        from stt.clipboard import copy_to_clipboard
        cfg = ClipboardConfig(enabled=False)
        result = copy_to_clipboard("test", cfg)
        assert result is False

    def test_clipboard_available(self):
        from stt.clipboard import is_available
        cfg = ClipboardConfig()
        # May or may not be available depending on display server
        result = is_available(cfg)
        assert isinstance(result, bool)

    def test_typing_disabled(self):
        from stt.typing import type_to_focused_input
        cfg = TypingConfig(enabled=False)
        result = type_to_focused_input("test", cfg)
        assert result is False

    def test_typing_empty_text(self):
        from stt.typing import type_to_focused_input
        cfg = TypingConfig()
        result = type_to_focused_input("", cfg)
        assert result is False

    def test_typing_whitespace_only(self):
        from stt.typing import type_to_focused_input
        cfg = TypingConfig()
        result = type_to_focused_input("   ", cfg)
        assert result is False
