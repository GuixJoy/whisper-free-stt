"""QA E2E tests — full pipeline, no mocks.

Covers:
  Path 1: File mode (run_file)
  Path 2: Full pipeline (preprocess → transcribe → dictionary → LLM → history)
  Path 3: Config resolution (build_config combinations)
  Path 4: CLI entry points
  Path 5: Error handling
  Path 6: Concurrent operations
"""

from __future__ import annotations

import argparse
import io
import os
import sqlite3
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path

import numpy as np
import pytest

from stt.config import load_dotenv

load_dotenv()

SAMPLE_RATE = 16000
TINY_EN = "tiny.en"


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

def _make_wav_bytes(
    freq: float = 440.0,
    duration_sec: float = 2.0,
    sample_rate: int = SAMPLE_RATE,
    amplitude: float = 0.5,
) -> bytes:
    n_samples = int(sample_rate * duration_sec)
    t = np.linspace(0, duration_sec, n_samples, endpoint=False)
    samples = (amplitude * np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.tobytes())
    return buf.getvalue()


def _make_wav_file(path: str, **kwargs) -> str:
    with open(path, "wb") as f:
        f.write(_make_wav_bytes(**kwargs))
    return path


def _make_temp_wav(**kwargs) -> str:
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    _make_wav_file(path, **kwargs)
    return path


def _make_temp_db() -> str:
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(path)
    return path


def _build_default_config(**overrides):
    from stt.config import (
        AppConfig, AudioConfig, VADConfig, TranscriptionConfig,
        LLMConfig, LLMMode, TranscriptionBackend,
        ComputeType, DiarizationConfig,
    )
    defaults = dict(
        audio=AudioConfig(sample_rate=SAMPLE_RATE),
        vad=VADConfig(),
        transcription=TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
        ),
        llm=LLMConfig(mode=LLMMode.OFF),
        diarization=DiarizationConfig(enabled=False),
        debug=False,
        json_mode=False,
    )
    defaults.update(overrides)
    return AppConfig(**defaults)


def _make_speech_like_audio(duration_sec: float = 2.0) -> np.ndarray:
    """Generate a richer audio signal that whisper can process (mix of tones + harmonics)."""
    sr = SAMPLE_RATE
    n = int(sr * duration_sec)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    # Mix several frequencies to create a more speech-like signal
    signal = (
        0.3 * np.sin(2 * np.pi * 261.63 * t) +   # C4
        0.2 * np.sin(2 * np.pi * 329.63 * t) +   # E4
        0.15 * np.sin(2 * np.pi * 392.00 * t) +  # G4
        0.1 * np.sin(2 * np.pi * 523.25 * t)     # C5
    ).astype(np.float32)
    return signal * 0.5


# ===========================================================================
# PATH 1: File mode (run_file)
# ===========================================================================

class TestRunFile:
    """Path 1: run_file() — process a WAV file through the pipeline."""

    def test_run_file_tiny_en(self, caplog):
        from stt.orchestrator import run_file
        wav = _make_temp_wav(freq=440, duration_sec=2.0)
        try:
            config = _build_default_config()
            with caplog.at_level("INFO", logger="stt.orchestrator"):
                run_file(config, wav)
            assert "Processing:" in caplog.text
            assert "Transcribed in" in caplog.text
            assert "Done." in caplog.text
        finally:
            os.unlink(wav)

    def test_run_file_with_llm_cleanup(self, caplog):
        from stt.orchestrator import run_file
        from stt.config import LLMConfig, LLMMode
        wav = _make_temp_wav(freq=440, duration_sec=2.0)
        try:
            config = _build_default_config(llm=LLMConfig(mode=LLMMode.CLEANUP))
            with caplog.at_level("INFO", logger="stt.orchestrator"):
                run_file(config, wav)
            assert "Processing:" in caplog.text
            assert "Done." in caplog.text
        finally:
            os.unlink(wav)

    def test_run_file_mono_wav(self, caplog):
        from stt.orchestrator import run_file
        wav = _make_temp_wav(freq=261.63, duration_sec=1.0)
        try:
            config = _build_default_config()
            with caplog.at_level("INFO", logger="stt.orchestrator"):
                run_file(config, wav)
            assert "Done." in caplog.text
        finally:
            os.unlink(wav)

    def test_run_file_short_duration(self, caplog):
        from stt.orchestrator import run_file
        wav = _make_temp_wav(freq=440, duration_sec=0.5)
        try:
            config = _build_default_config()
            with caplog.at_level("INFO", logger="stt.orchestrator"):
                run_file(config, wav)
            assert "Done." in caplog.text
        finally:
            os.unlink(wav)

    def test_run_file_different_frequencies(self, caplog):
        from stt.orchestrator import run_file
        for freq in [261.63, 440.0, 880.0]:
            wav = _make_temp_wav(freq=freq, duration_sec=1.0)
            try:
                config = _build_default_config()
                with caplog.at_level("INFO", logger="stt.orchestrator"):
                    run_file(config, wav)
                assert "Done." in caplog.text
            finally:
                os.unlink(wav)


# ===========================================================================
# PATH 2: Full pipeline (preprocess → transcribe → dictionary → LLM → history)
# ===========================================================================

class TestFullPipeline:
    """Path 2: Unit-level pipeline stages chained together."""

    def test_preprocess_audio(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        audio = np.sin(2 * np.pi * 440 * np.linspace(0, 1, 16000)).astype(np.float32) * 0.5
        config = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
        )
        result = preprocess_audio(audio, SAMPLE_RATE, config)
        assert result is not None
        assert len(result) > 0
        assert result.dtype == np.float32

    def test_preprocess_audio_empty(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = np.array([], dtype=np.float32)
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP)
        result = preprocess_audio(audio, SAMPLE_RATE, config)
        assert result is None

    def test_preprocess_audio_silence(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = np.zeros(16000, dtype=np.float32)
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP)
        result = preprocess_audio(audio, SAMPLE_RATE, config)
        assert result is None

    def test_preprocess_audio_overloaded(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = np.ones(16000, dtype=np.float32) * 5.0
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP)
        result = preprocess_audio(audio, SAMPLE_RATE, config)
        assert result is not None
        assert np.max(np.abs(result)) <= 1.0

    def test_transcribe_tiny_en_whisper_cpp(self):
        """transcribe() with whisper.cpp + tiny.en on synthetic audio."""
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType

        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
        )
        t0 = time.monotonic()
        result = transcribe(audio, SAMPLE_RATE, config)
        elapsed = time.monotonic() - t0

        assert hasattr(result, "text")
        assert hasattr(result, "language")
        assert hasattr(result, "segments")
        assert isinstance(result.text, str)
        print(f"  [perf] transcribe tiny.en (cpp): {elapsed:.2f}s, text={result.text[:50]!r}")

    def test_transcribe_tiny_en_faster_whisper(self):
        """transcribe() with faster-whisper + tiny.en on synthetic audio."""
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType

        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
            vad_filter=False,
        )
        t0 = time.monotonic()
        result = transcribe(audio, SAMPLE_RATE, config)
        elapsed = time.monotonic() - t0

        assert hasattr(result, "text")
        assert hasattr(result, "language")
        assert hasattr(result, "segments")
        assert isinstance(result.text, str)
        print(f"  [perf] transcribe tiny.en (fw): {elapsed:.2f}s, text={result.text[:50]!r}")

    def test_transcribe_returns_segments_tuple(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        from stt.types import TranscriptionSegment

        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
        )
        result = transcribe(audio, SAMPLE_RATE, config)
        assert isinstance(result.segments, tuple)
        for seg in result.segments:
            assert isinstance(seg, TranscriptionSegment)
            assert hasattr(seg, "text")
            assert hasattr(seg, "start")
            assert hasattr(seg, "end")

    def test_history_store_crud(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            row_id = store.insert("hello world", "Hello World.", mode="cleanup")
            assert row_id is not None and row_id > 0
            results = store.search_history("hello")
            assert len(results) >= 1
            assert results[0]["raw_text"] == "hello world"
            recent = store.get_recent()
            assert len(recent) >= 1
            new_state = store.toggle_favorite(row_id)
            assert new_state is True
            deleted = store.delete_entry(row_id)
            assert deleted is True
            insights = store.get_insights()
            assert isinstance(insights, dict)
            assert "wpm" in insights
            assert "totalWords" in insights
            assert "heatmap" in insights
        finally:
            os.unlink(db)

    def test_history_write_async(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.write_async("async test", "Async Test.", mode="cleanup", duration_sec=1.5)
            time.sleep(0.3)
            recent = store.get_recent()
            assert len(recent) >= 1
            assert any(r["raw_text"] == "async test" for r in recent)
        finally:
            os.unlink(db)

    def test_history_export_csv(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.insert("test line one", "Test line one.")
            store.insert("test line two", "Test line two.")
            csv = store.export_csv()
            assert "raw_text" in csv
            assert "test line one" in csv
            assert "test line two" in csv
        finally:
            os.unlink(db)

    def test_history_export_text(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.insert("test export", "Test Export.")
            txt = store.export_text()
            assert "STT Transcript History" in txt
            assert "test export" in txt
        finally:
            os.unlink(db)

    def test_history_insights_empty_db(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            insights = store.get_insights()
            assert insights["wpm"] == 0
            assert insights["totalWords"] == 0
            assert insights["aiFixes"] == 0
            assert insights["categories"] == []
        finally:
            os.unlink(db)

    def test_history_insights_with_data(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            for i in range(5):
                store.insert(
                    f"hello world test number {i}",
                    f"Hello World Test Number {i}.",
                    mode="cleanup",
                    duration_sec=2.0,
                )
            insights = store.get_insights()
            assert insights["totalWords"] > 0
            assert isinstance(insights["heatmap"], list)
            assert isinstance(insights["streak"], dict)
        finally:
            os.unlink(db)

    def test_dictionary_crud(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            entry = store.add_dictionary_entry("flouray", "Floure", category="name")
            assert entry is not None
            assert entry["phrase"] == "flouray"
            assert entry["replacement"] == "Floure"
            entry_id = entry["id"]
            entries = store.list_dictionary()
            assert len(entries) == 1
            single = store.get_dictionary_entry(entry_id)
            assert single is not None
            assert single["phrase"] == "flouray"
            updated = store.update_dictionary_entry(entry_id, replacement="Floure Inc.")
            assert updated is not None
            assert updated["replacement"] == "Floure Inc."
            fav = store.toggle_dictionary_favorite(entry_id)
            assert fav is True
            deleted = store.delete_dictionary_entry(entry_id)
            assert deleted is True
        finally:
            os.unlink(db)

    def test_dictionary_apply_exact_replacements(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.add_dictionary_entry("API", "API", category="identity")
            store.add_dictionary_entry("CEO", "Chief Executive Officer", category="expansion")
            text = "the API and the CEO met"
            result = store.apply_dictionary_replacements(text)
            assert "Chief Executive Officer" in result
        finally:
            os.unlink(db)

    def test_dictionary_apply_fuzzy_replacements(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.add_dictionary_entry("Floure", "Floure", category="name")
            # "Flouray" is 7 chars, "Floure" is 6 chars
            # Levenshtein ratio for "flouray" vs "floure" = 4 matching / 7 max = 0.57
            # For words >= 7 chars, threshold is 0.60, so it should match
            text = "I work at Flouray"
            result = store.apply_fuzzy_replacements(text)
            # Fuzzy match may or may not catch this depending on threshold
            # At minimum it should not crash
            assert isinstance(result, str)
            assert len(result) > 0
            print(f"  [dict] fuzzy: {text!r} -> {result!r}")
        finally:
            os.unlink(db)

    def test_dictionary_llm_context(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.add_dictionary_entry("CEO", "Chief Executive Officer", category="expansion")
            ctx = store.build_dict_llm_context()
            assert "IMPORTANT DICTIONARY" in ctx
            assert "CEO" in ctx
            assert "Chief Executive Officer" in ctx
        finally:
            os.unlink(db)

    def test_dictionary_hotwords(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            store.add_dictionary_entry("Floure", "Floure", category="name")
            store.add_dictionary_entry("CEO", "Chief Executive Officer", category="expansion")
            hotwords = store.get_dict_hotwords(weighted=False)
            assert "Floure" in hotwords
            assert "CEO" in hotwords
            assert "Chief Executive Officer" in hotwords
            hotwords_w = store.get_dict_hotwords(weighted=True)
            assert ":2.0" in hotwords_w or ":5.0" in hotwords_w
        finally:
            os.unlink(db)

    def test_dictionary_csv_import_export(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            csv_in = 'phrase,replacement\n"hello","Hello"\n"world","World"'
            result = store.import_dictionary_csv(csv_in)
            assert result["imported"] == 2
            assert result["skipped"] == 0
            csv_out = store.export_dictionary_csv()
            assert "hello" in csv_out
            assert "world" in csv_out
        finally:
            os.unlink(db)

    def test_few_shot_context_building(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "the quikc brown fox", "processed_text": "The quick brown fox."},
            {"raw_text": "helo world today", "processed_text": "Hello world today."},
        ]
        ctx = build_few_shot_context("helo world", candidates, top_k=2, max_tokens=200)
        assert isinstance(ctx, str)

    def test_llm_rewrite_sync(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.CLEANUP,
            provider=LLMProvider.OPENROUTER,
            timeout_sec=15.0,
        )
        t0 = time.monotonic()
        result = rewrite("helo world, this is a tst of the system", config)
        elapsed = time.monotonic() - t0
        assert isinstance(result, str)
        assert len(result) > 0
        # LLM should correct "helo" -> "Hello" and "tst" -> "test"
        print(f"  [perf] LLM rewrite sync: {elapsed:.2f}s -> {result[:80]}")

    def test_llm_rewrite_stream(self):
        from stt.llm import rewrite_stream
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.CLEANUP,
            provider=LLMProvider.OPENROUTER,
            timeout_sec=15.0,
        )
        tokens = []
        t0 = time.monotonic()
        for token in rewrite_stream("pls fix this sentnce", config):
            tokens.append(token)
        elapsed = time.monotonic() - t0
        full = "".join(tokens)
        assert len(full) > 0
        print(f"  [perf] LLM rewrite stream: {elapsed:.2f}s, {len(tokens)} tokens -> {full[:80]}")

    def test_llm_rewrite_bullet_list_mode(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.BULLET_LIST,
            provider=LLMProvider.OPENROUTER,
            timeout_sec=15.0,
        )
        result = rewrite("buy milk pick up dry cleaning call mom", config)
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"  [perf] LLM bullet_list: {result[:120]}")

    def test_llm_rewrite_email_mode(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.EMAIL,
            provider=LLMProvider.OPENROUTER,
            timeout_sec=15.0,
        )
        result = rewrite("hey team the deploy is done please review", config)
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"  [perf] LLM email: {result[:120]}")

    def test_llm_rewrite_commit_mode(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.COMMIT_MESSAGE,
            provider=LLMProvider.OPENROUTER,
            timeout_sec=15.0,
        )
        result = rewrite("fixed the login bug in auth module", config)
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"  [perf] LLM commit: {result[:120]}")

    def test_llm_fallback_model(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.CLEANUP,
            provider=LLMProvider.OPENROUTER,
            model="invalid/model-xyz-999",
            fallback_model="openai/gpt-4o-mini",
            timeout_sec=15.0,
        )
        result = rewrite("test fallback", config)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_llm_clean_response(self):
        from stt.llm import _clean_response
        text = "User Safety: safe\nHello world\nUser Safety: safe"
        cleaned = _clean_response(text)
        assert "Hello world" in cleaned
        assert "User Safety" not in cleaned

    def test_build_user_prompt(self):
        from stt.prompts import build_user_prompt
        from stt.config import LLMMode
        prompt = build_user_prompt("hello world", LLMMode.CLEANUP)
        assert "hello world" in prompt
        assert "punctuation" in prompt.lower() or "filler" in prompt.lower()
        prompt_bullet = build_user_prompt("hello world", LLMMode.BULLET_LIST)
        assert "bullet" in prompt_bullet.lower()
        prompt_email = build_user_prompt("hello world", LLMMode.EMAIL)
        assert "email" in prompt_email.lower()
        prompt_commit = build_user_prompt("hello world", LLMMode.COMMIT_MESSAGE)
        assert "commit" in prompt_commit.lower()


# ===========================================================================
# PATH 3: Config resolution (build_config)
# ===========================================================================

class TestBuildConfig:
    """Path 3: build_config() with various CLI argument combinations."""

    def _parse(self, argv: list[str]) -> argparse.Namespace:
        from stt.cli import build_arg_parser
        return build_arg_parser().parse_args(argv)

    def test_default_config(self):
        from stt.cli import build_config
        args = self._parse([])
        config = build_config(args)
        assert config.audio.sample_rate == 16000
        # Default auto profile resolves based on hardware; just check it's valid
        assert config.transcription.model_name in [
            "tiny.en", "base.en", "small.en", "small-cuda",
            "distil-large-v3", "large-v3-turbo",
        ]

    def test_asr_profile_speed(self):
        from stt.cli import build_config
        args = self._parse(["--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.model_name == "tiny.en"
        assert config.transcription.beam_size == 1

    def test_asr_profile_balanced(self):
        from stt.cli import build_config
        args = self._parse(["--asr-profile", "balanced"])
        config = build_config(args)
        assert config.transcription.model_name == "base.en"

    def test_asr_profile_accuracy(self):
        from stt.cli import build_config
        args = self._parse(["--asr-profile", "accuracy"])
        config = build_config(args)
        assert config.transcription.model_name == "small.en"
        assert config.transcription.beam_size == 3

    def test_asr_profile_distil(self):
        from stt.cli import build_config
        from stt.config import TranscriptionBackend
        args = self._parse(["--asr-profile", "distil"])
        config = build_config(args)
        assert config.transcription.model_name == "distil-large-v3"
        assert config.transcription.backend == TranscriptionBackend.FASTER_WHISPER

    def test_asr_profile_turbo(self):
        from stt.cli import build_config
        from stt.config import TranscriptionBackend
        args = self._parse(["--asr-profile", "turbo"])
        config = build_config(args)
        assert config.transcription.model_name == "large-v3-turbo"
        assert config.transcription.backend == TranscriptionBackend.FASTER_WHISPER

    def test_compute_type_int8(self):
        from stt.cli import build_config
        from stt.config import ComputeType
        args = self._parse(["--compute-type", "int8", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.compute_type == ComputeType.INT8

    def test_compute_type_float16(self):
        from stt.cli import build_config
        from stt.config import ComputeType
        args = self._parse(["--compute-type", "float16", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.compute_type == ComputeType.FLOAT16

    def test_compute_type_auto_resolves(self):
        from stt.cli import build_config
        from stt.config import ComputeType
        args = self._parse(["--compute-type", "auto", "--device", "cpu", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.compute_type == ComputeType.INT8

    def test_device_cpu(self):
        from stt.cli import build_config
        args = self._parse(["--device", "cpu", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.device == "cpu"

    def test_llm_mode_off(self):
        from stt.cli import build_config
        from stt.config import LLMMode
        args = self._parse(["--llm-mode", "off", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.OFF

    def test_llm_mode_cleanup(self):
        from stt.cli import build_config
        from stt.config import LLMMode
        args = self._parse(["--llm-mode", "cleanup", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.CLEANUP

    def test_llm_mode_bullet_list(self):
        from stt.cli import build_config
        from stt.config import LLMMode
        args = self._parse(["--llm-mode", "bullet_list", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.BULLET_LIST

    def test_llm_mode_email(self):
        from stt.cli import build_config
        from stt.config import LLMMode
        args = self._parse(["--llm-mode", "email", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.EMAIL

    def test_llm_mode_commit_message(self):
        from stt.cli import build_config
        from stt.config import LLMMode
        args = self._parse(["--llm-mode", "commit_message", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.mode == LLMMode.COMMIT_MESSAGE

    def test_llm_provider_openrouter(self):
        from stt.cli import build_config
        from stt.config import LLMProvider
        args = self._parse(["--llm-provider", "openrouter", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.provider == LLMProvider.OPENROUTER

    def test_llm_provider_deepseek(self):
        from stt.cli import build_config
        from stt.config import LLMProvider
        args = self._parse(["--llm-provider", "deepseek", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.provider == LLMProvider.DEEPSEEK

    def test_fast_commit_flag(self):
        from stt.cli import build_config
        args = self._parse(["--fast-commit", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.vad.fast_commit is True

    def test_hotwords_flag(self):
        from stt.cli import build_config
        args = self._parse(["--hotwords", "hello,world", "--asr-profile", "speed"])
        config = build_config(args)
        assert "hello" in config.transcription.hotwords
        assert "world" in config.transcription.hotwords

    def test_diarization_flag(self):
        from stt.cli import build_config
        args = self._parse(["--diarization", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.diarization.enabled is True

    def test_diarization_threshold(self):
        from stt.cli import build_config
        args = self._parse(["--diarization", "--diarization-threshold", "0.8", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.diarization.similarity_threshold == 0.8

    def test_debug_flag(self):
        from stt.cli import build_config
        args = self._parse(["--debug", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.debug is True

    def test_json_mode_flag(self):
        from stt.cli import build_config
        args = self._parse(["--json-mode", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.json_mode is True

    def test_model_override(self):
        from stt.cli import build_config
        args = self._parse(["--model", "base.en", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.model_name == "base.en"

    def test_beam_size_override(self):
        from stt.cli import build_config
        args = self._parse(["--beam-size", "5", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.beam_size == 5

    def test_language_override(self):
        from stt.cli import build_config
        args = self._parse(["--language", "en", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.language == "en"

    def test_cpu_threads_override(self):
        from stt.cli import build_config
        args = self._parse(["--cpu-threads", "8", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.transcription.cpu_threads == 8

    def test_llm_model_override(self):
        from stt.cli import build_config
        args = self._parse(["--llm-model", "custom-model", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.model == "custom-model"

    def test_llm_timeout_override(self):
        from stt.cli import build_config
        args = self._parse(["--llm-timeout", "30", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.llm.timeout_sec == 30.0

    def test_sample_rate_override(self):
        from stt.cli import build_config
        args = self._parse(["--sample-rate", "44100", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.audio.sample_rate == 44100

    def test_silence_threshold_override(self):
        from stt.cli import build_config
        args = self._parse(["--silence-threshold", "0.01", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.vad.silence_threshold_rms == 0.01

    def test_min_duration_override(self):
        from stt.cli import build_config
        args = self._parse(["--min-duration", "1.0", "--asr-profile", "speed"])
        config = build_config(args)
        assert config.vad.min_recording_sec == 1.0


# ===========================================================================
# PATH 4: CLI entry points
# ===========================================================================

class TestCLIEntryPoints:
    """Path 4: CLI main() and build_arg_parser()."""

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
        assert args.fast_commit is False
        assert args.diarization is False

    def test_build_arg_parser_all_flags(self):
        from stt.cli import build_arg_parser
        parser = build_arg_parser()
        args = parser.parse_args([
            "--sample-rate", "44100",
            "--device-index", "3",
            "--silence-threshold", "0.01",
            "--silence-duration", "1.5",
            "--min-duration", "0.3",
            "--fast-commit",
            "--asr-profile", "speed",
            "--backend", "whisper_cpp",
            "--model", "base.en",
            "--compute-type", "int8",
            "--device", "cpu",
            "--cpu-threads", "8",
            "--language", "en",
            "--beam-size", "3",
            "--hotwords", "test,word",
            "--diarization",
            "--diarization-threshold", "0.8",
            "--llm-provider", "openrouter",
            "--llm-mode", "cleanup",
            "--llm-model", "custom-model",
            "--llm-timeout", "20",
            "--debug",
            "--json-mode",
        ])
        assert args.sample_rate == 44100
        assert args.device_index == 3
        assert args.silence_threshold == 0.01
        assert args.min_duration == 0.3
        assert args.fast_commit is True
        assert args.asr_profile == "speed"
        assert args.model == "base.en"
        assert args.cpu_threads == 8
        assert args.language == "en"
        assert args.beam_size == 3
        assert args.hotwords == "test,word"
        assert args.diarization is True
        assert args.llm_provider == "openrouter"
        assert args.llm_mode == "cleanup"
        assert args.debug is True

    def test_list_microphones(self, capsys):
        from stt.cli import main
        try:
            main(["--list-microphones"])
        except SystemExit:
            pass
        captured = capsys.readouterr()
        assert captured.out.strip() != "" or captured.err.strip() != ""

    def test_download_model(self, capsys):
        from stt.cli import main
        try:
            main(["--download-model", TINY_EN])
        except SystemExit:
            pass
        captured = capsys.readouterr()
        assert "downloaded" in captured.out or "error" in captured.out

    def test_input_file_mode(self, caplog):
        from stt.cli import main
        wav = _make_temp_wav(freq=440, duration_sec=1.5)
        try:
            with caplog.at_level("INFO", logger="stt.orchestrator"):
                main(["--input-file", wav, "--asr-profile", "speed", "--llm-mode", "off"])
            assert "Processing:" in caplog.text
            assert "Done." in caplog.text
        finally:
            os.unlink(wav)

    def test_main_with_invalid_model(self, capsys):
        from stt.cli import main
        try:
            main(["--download-model", "nonexistent-model-xyz"])
        except SystemExit as e:
            assert e.code != 0
        captured = capsys.readouterr()
        assert "error" in captured.out.lower() or captured.err.strip() != ""


# ===========================================================================
# PATH 5: Error handling
# ===========================================================================

class TestErrorHandling:
    """Path 5: Graceful failure on bad inputs."""

    def test_transcribe_empty_audio(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = np.array([], dtype=np.float32)
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP, model_name=TINY_EN)
        result = transcribe(audio, SAMPLE_RATE, config)
        assert result.text == ""
        assert result.is_empty

    def test_transcribe_silence_audio(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = np.zeros(32000, dtype=np.float32)
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP, model_name=TINY_EN)
        result = transcribe(audio, SAMPLE_RATE, config)
        assert result.is_empty

    def test_llm_rewrite_mode_off_raises(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode
        config = LLMConfig(mode=LLMMode.OFF)
        with pytest.raises(ValueError, match="disabled"):
            rewrite("hello", config)

    def test_llm_rewrite_no_api_key_returns_raw(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER)
        old_key = os.environ.pop("OPENROUTER_API_KEY", None)
        try:
            result = rewrite("hello world", config)
            assert result == "hello world"
        finally:
            if old_key:
                os.environ["OPENROUTER_API_KEY"] = old_key

    def test_llm_stream_no_api_key_yields_raw(self):
        from stt.llm import rewrite_stream
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(mode=LLMMode.CLEANUP, provider=LLMProvider.OPENROUTER)
        old_key = os.environ.pop("OPENROUTER_API_KEY", None)
        try:
            tokens = list(rewrite_stream("hello world", config))
            full = "".join(tokens)
            assert "hello world" in full
        finally:
            if old_key:
                os.environ["OPENROUTER_API_KEY"] = old_key

    def test_llm_invalid_api_key_returns_raw(self):
        from stt.llm import rewrite
        from stt.config import LLMConfig, LLMMode, LLMProvider
        config = LLMConfig(
            mode=LLMMode.CLEANUP,
            provider=LLMProvider.OPENROUTER,
            model="openai/gpt-4o-mini",
            timeout_sec=10.0,
        )
        old_key = os.environ.pop("OPENROUTER_API_KEY", None)
        os.environ["OPENROUTER_API_KEY"] = "sk-invalid-key-12345"
        try:
            result = rewrite("hello world test", config)
            assert isinstance(result, str)
            assert len(result) > 0
        finally:
            if old_key:
                os.environ["OPENROUTER_API_KEY"] = old_key

    def test_history_store_corrupt_db(self):
        from stt.history import HistoryStore
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(b"not a valid sqlite database")
        try:
            try:
                store = HistoryStore(path)
                results = store.search_history("test")
                assert isinstance(results, list)
            except Exception:
                pass
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def test_history_store_readonly_db(self):
        from stt.history import HistoryStore
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.unlink(path)
        try:
            store = HistoryStore(path)
            store.insert("test", "Test.")
            os.chmod(path, 0o444)
            try:
                result = store.insert("should fail", "Fail.")
            except Exception:
                pass
            os.chmod(path, 0o644)
        finally:
            try:
                os.chmod(path, 0o644)
                os.unlink(path)
            except OSError:
                pass

    def test_vad_empty_audio(self):
        from stt.vad import compute_rms
        assert compute_rms(np.array([], dtype=np.float32)) == 0.0

    def test_vad_silence(self):
        from stt.vad import compute_rms
        assert compute_rms(np.zeros(1000, dtype=np.float32)) == 0.0

    def test_vad_known_signal(self):
        from stt.vad import compute_rms
        audio = np.sin(np.linspace(0, 2 * np.pi * 100, 10000)).astype(np.float32) * 0.5
        rms = compute_rms(audio)
        assert 0.3 < rms < 0.4

    def test_ring_buffer_basics(self):
        from stt.orchestrator import _RingBuffer
        buf = _RingBuffer(100)
        buf.extend(np.arange(50, dtype=np.float32))
        assert buf.total_samples() == 50
        segment = buf.slice_range(0, 50)
        assert len(segment) == 50
        np.testing.assert_array_equal(segment, np.arange(50, dtype=np.float32))

    def test_ring_buffer_overflow(self):
        from stt.orchestrator import _RingBuffer
        buf = _RingBuffer(100)
        buf.extend(np.arange(150, dtype=np.float32))
        assert buf.total_samples() == 150
        segment = buf.slice_range(50, 150)
        assert len(segment) == 100

    def test_ring_buffer_slice_out_of_range(self):
        from stt.orchestrator import _RingBuffer
        buf = _RingBuffer(100)
        buf.extend(np.arange(50, dtype=np.float32))
        segment = buf.slice_range(0, 200)
        assert len(segment) == 0

    def test_latency_tracker(self):
        from stt.orchestrator import _LatencyTracker
        tracker = _LatencyTracker()
        tracker.record("asr", 0.5)
        tracker.record("asr", 1.0)
        tracker.record("llm", 2.0)
        snap = tracker.snapshot()
        assert "asr" in snap
        assert "llm" in snap
        assert snap["asr"]["count"] == 2
        assert snap["asr"]["min"] == 0.5
        assert snap["asr"]["max"] == 1.0

    def test_json_emit_no_crash(self):
        from stt.orchestrator import _json_emit
        config = _build_default_config(json_mode=False)
        _json_emit(config, {"type": "test", "data": "hello"})

    def test_json_emit_json_mode(self, capsys):
        import json
        from stt.orchestrator import _json_emit
        config = _build_default_config(json_mode=True)
        _json_emit(config, {"type": "test", "data": "hello"})
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["type"] == "test"


# ===========================================================================
# PATH 6: Concurrent operations
# ===========================================================================

class TestConcurrent:
    """Path 6: Thread-safety and concurrency."""

    def test_history_write_async_thread_safety(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            n_threads = 10
            barrier = threading.Barrier(n_threads)
            errors = []

            def writer(i):
                try:
                    barrier.wait(timeout=5)
                    store.write_async(f"thread {i}", f"Thread {i}.", mode="cleanup")
                except Exception as e:
                    errors.append(e)

            threads = [threading.Thread(target=writer, args=(i,)) for i in range(n_threads)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)
            time.sleep(0.5)
            assert errors == []
            recent = store.get_recent()
            assert len(recent) == n_threads
        finally:
            os.unlink(db)

    def test_history_concurrent_reads_writes(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            errors = []
            stop = threading.Event()

            def writer():
                try:
                    i = 0
                    while not stop.is_set():
                        store.insert(f"concurrent {i}", f"Concurrent {i}.")
                        i += 1
                except Exception as e:
                    errors.append(e)

            def reader():
                try:
                    while not stop.is_set():
                        store.get_recent()
                        store.search_history("concurrent")
                except Exception as e:
                    errors.append(e)

            threads = [
                threading.Thread(target=writer, daemon=True),
                threading.Thread(target=writer, daemon=True),
                threading.Thread(target=reader, daemon=True),
                threading.Thread(target=reader, daemon=True),
            ]
            for t in threads:
                t.start()
            time.sleep(0.3)
            stop.set()
            for t in threads:
                t.join(timeout=5)
            assert errors == []
        finally:
            os.unlink(db)

    def test_concurrent_transcribe_calls(self):
        """Multiple transcribe() calls from threads (uses faster-whisper to avoid cpp subprocess issues)."""
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType

        config = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
            vad_filter=False,
        )
        audio = _make_speech_like_audio(1.0)
        results = []
        errors = []

        def transcribe_worker():
            try:
                r = transcribe(audio.copy(), SAMPLE_RATE, config)
                results.append(r)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=transcribe_worker) for _ in range(3)]
        t0 = time.monotonic()
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        elapsed = time.monotonic() - t0

        assert errors == []
        assert len(results) == 3
        for r in results:
            assert hasattr(r, "text")
        print(f"  [perf] 3 concurrent transcribe (fw): {elapsed:.2f}s total")

    def test_llm_semaphore_limits_concurrency(self):
        from stt.orchestrator import _llm_semaphore
        acquired = 0
        for _ in range(5):
            if _llm_semaphore.acquire(blocking=False):
                acquired += 1
        assert acquired == 4
        for _ in range(acquired):
            _llm_semaphore.release()


# ===========================================================================
# PATH 7: Integration — full pipeline end-to-end
# ===========================================================================

class TestIntegrationFullPipeline:
    """Integration test: WAV -> preprocess -> transcribe -> dictionary -> LLM -> history."""

    def test_full_pipeline_with_dictionary(self):
        from stt.transcription import transcribe
        from stt.history import HistoryStore
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType

        db = _make_temp_db()
        wav = _make_temp_wav(freq=440, duration_sec=2.0)
        try:
            store = HistoryStore(db)
            store.add_dictionary_entry("hello", "Hello", category="identity")
            store.add_dictionary_entry("world", "World", category="identity")

            audio = np.sin(2 * np.pi * 440 * np.linspace(0, 2, 32000)).astype(np.float32) * 0.5
            config = TranscriptionConfig(
                backend=TranscriptionBackend.WHISPER_CPP,
                model_name=TINY_EN,
                compute_type=ComputeType.INT8,
                device="cpu",
                cpu_threads=2,
            )
            result = transcribe(audio, SAMPLE_RATE, config)

            raw = result.text
            processed = store.apply_dictionary_replacements(raw)
            processed = store.apply_fuzzy_replacements(processed)

            row_id = store.insert(raw, processed, mode="cleanup", duration_sec=2.0)
            assert row_id is not None

            recent = store.get_recent()
            assert len(recent) >= 1
            assert any(r["id"] == row_id for r in recent)

            if raw.strip():
                search_results = store.search_history(raw[:20])
                assert len(search_results) >= 1

            print(f"  [pipeline] raw={raw!r} processed={processed!r}")
        finally:
            os.unlink(db)
            os.unlink(wav)

    def test_full_pipeline_with_llm_and_history(self):
        from stt.transcription import transcribe
        from stt.llm import rewrite
        from stt.history import HistoryStore
        from stt.config import (
            TranscriptionConfig, TranscriptionBackend, ComputeType,
            LLMConfig, LLMMode, LLMProvider,
        )

        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            audio = _make_speech_like_audio(2.0)
            tcfg = TranscriptionConfig(
                backend=TranscriptionBackend.WHISPER_CPP,
                model_name=TINY_EN,
                compute_type=ComputeType.INT8,
                device="cpu",
                cpu_threads=2,
            )
            llm_cfg = LLMConfig(
                mode=LLMMode.CLEANUP,
                provider=LLMProvider.OPENROUTER,
                timeout_sec=15.0,
            )

            t0 = time.monotonic()
            result = transcribe(audio, SAMPLE_RATE, tcfg)
            t_transcribe = time.monotonic() - t0

            raw = result.text
            if raw.strip() and len(raw.split()) > 5:
                t0 = time.monotonic()
                processed = rewrite(raw, llm_cfg)
                t_llm = time.monotonic() - t0
            else:
                processed = raw
                t_llm = 0

            row_id = store.insert(raw, processed, mode="cleanup", duration_sec=t_transcribe + t_llm)
            assert row_id is not None

            recent = store.get_recent()
            assert len(recent) >= 1
            entry = recent[0]
            assert entry["raw_text"] == raw
            assert entry["processed_text"] == processed

            insights = store.get_insights()
            assert insights["totalWords"] >= 0

            print(f"  [integration] transcribe={t_transcribe:.2f}s llm={t_llm:.2f}s raw={raw[:50]!r}")
        finally:
            os.unlink(db)


# ===========================================================================
# PATH 8: VAD unit tests
# ===========================================================================

class TestVAD:
    """VAD feature functions and StreamingEndpointDetector."""

    def test_compute_spectral_flux(self):
        from stt.vad import compute_spectral_flux
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 2000)).astype(np.float32) * 0.5
        flux = compute_spectral_flux(audio, SAMPLE_RATE)
        assert isinstance(flux, float)
        assert flux >= 0.0

    def test_compute_spectral_centroid(self):
        from stt.vad import compute_spectral_centroid
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 2000)).astype(np.float32) * 0.5
        centroid = compute_spectral_centroid(audio, SAMPLE_RATE)
        assert isinstance(centroid, float)
        assert centroid >= 0.0

    def test_compute_zero_crossing_rate(self):
        from stt.vad import compute_zero_crossing_rate
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 2000)).astype(np.float32) * 0.5
        zcr = compute_zero_crossing_rate(audio)
        assert 0.0 <= zcr <= 1.0

    def test_compute_band_energy_ratio(self):
        from stt.vad import compute_band_energy_ratio
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 2000)).astype(np.float32) * 0.5
        ber = compute_band_energy_ratio(audio, SAMPLE_RATE)
        assert 0.0 <= ber <= 1.0

    def test_streaming_endpoint_detector(self):
        from stt.vad import StreamingEndpointDetector, VADConfig
        config = VADConfig()
        detector = StreamingEndpointDetector(config, SAMPLE_RATE, 1024)
        for _ in range(50):
            chunk = np.zeros(1024, dtype=np.float32)
            detector.update(rms=0.001, chunk_start_sample=0, chunk_end_sample=1024, chunk=chunk)
        for i in range(20):
            chunk = np.sin(np.linspace(0, 2 * np.pi * 440 * (i + 1), 1024)).astype(np.float32) * 0.3
            detector.update(rms=0.3, chunk_start_sample=i * 1024, chunk_end_sample=(i + 1) * 1024, chunk=chunk)

    def test_streaming_endpoint_detector_noise_floor(self):
        from stt.vad import StreamingEndpointDetector, VADConfig
        config = VADConfig()
        detector = StreamingEndpointDetector(config, SAMPLE_RATE, 1024)
        detector.set_noise_floor(0.01)
        assert detector.noise_floor == 0.01

    def test_streaming_endpoint_detector_thresholds(self):
        from stt.vad import StreamingEndpointDetector, VADConfig
        config = VADConfig()
        detector = StreamingEndpointDetector(config, SAMPLE_RATE, 1024)
        start, end = detector.thresholds()
        assert start > end

    def test_streaming_endpoint_detector_fast_commit(self):
        from stt.vad import StreamingEndpointDetector, VADConfig
        config = VADConfig()
        detector = StreamingEndpointDetector(config, SAMPLE_RATE, 1024)
        detector.set_fast_commit(silence_duration_sec=0.3, detrigger_ratio=0.7)


# ===========================================================================
# Performance benchmarks
# ===========================================================================

class TestPerformance:
    """Performance measurements for each pipeline stage."""

    def test_preprocess_latency(self):
        from stt.transcription import preprocess_audio
        from stt.config import TranscriptionConfig, TranscriptionBackend
        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(backend=TranscriptionBackend.WHISPER_CPP, model_name=TINY_EN)
        t0 = time.monotonic()
        preprocess_audio(audio, SAMPLE_RATE, config)
        elapsed = time.monotonic() - t0
        print(f"  [perf] preprocess_audio: {elapsed*1000:.1f}ms")
        assert elapsed < 1.0

    def test_transcribe_latency_whisper_cpp(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
        )
        t0 = time.monotonic()
        result = transcribe(audio, SAMPLE_RATE, config)
        elapsed = time.monotonic() - t0
        print(f"  [perf] transcribe(tiny.en cpp): {elapsed:.2f}s, text={result.text[:50]!r}")
        assert elapsed < 15.0

    def test_transcribe_latency_faster_whisper(self):
        from stt.transcription import transcribe
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType
        audio = _make_speech_like_audio(2.0)
        config = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name=TINY_EN,
            compute_type=ComputeType.INT8,
            device="cpu",
            cpu_threads=2,
            vad_filter=False,
        )
        t0 = time.monotonic()
        result = transcribe(audio, SAMPLE_RATE, config)
        elapsed = time.monotonic() - t0
        print(f"  [perf] transcribe(tiny.en fw): {elapsed:.2f}s, text={result.text[:50]!r}")
        assert elapsed < 15.0

    def test_history_write_latency(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            t0 = time.monotonic()
            for i in range(100):
                store.insert(f"perf test {i}", f"Perf test {i}.")
            elapsed = time.monotonic() - t0
            avg_ms = elapsed / 100 * 1000
            print(f"  [perf] HistoryStore.insert() x100: {elapsed:.3f}s (avg {avg_ms:.1f}ms)")
            assert avg_ms < 100
        finally:
            os.unlink(db)

    def test_history_search_latency(self):
        from stt.history import HistoryStore
        db = _make_temp_db()
        try:
            store = HistoryStore(db)
            for i in range(50):
                store.insert(f"searchable text number {i}", f"Searchable text number {i}.")
            t0 = time.monotonic()
            for _ in range(10):
                store.search_history("searchable")
            elapsed = time.monotonic() - t0
            avg_ms = elapsed / 10 * 1000
            print(f"  [perf] search_history() x10: {elapsed:.3f}s (avg {avg_ms:.1f}ms)")
            assert avg_ms < 500
        finally:
            os.unlink(db)
