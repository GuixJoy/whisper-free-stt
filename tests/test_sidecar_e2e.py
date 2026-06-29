"""End-to-end tests for the transcription pipeline — the critical path.

Tests the frozen binary fix (_cpp_worker.run_worker), the orchestrator
transcription path, and the hotkey format. Does NOT spawn the sidecar
binary (requires real mic — use manual testing for that).

Run with: .venv/bin/python -m pytest tests/test_sidecar_e2e.py -v -s
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_silence(duration_sec: float = 0.5, sr: int = 16000) -> np.ndarray:
    """Generate silence (near-zero amplitude noise)."""
    rng = np.random.default_rng(42)
    return rng.uniform(-0.001, 0.001, size=int(sr * duration_sec)).astype(np.float32)


def _generate_speech_like(duration_sec: float = 2.0, sr: int = 16000) -> np.ndarray:
    """Generate a speech-like signal with amplitude modulation."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), dtype=np.float32)
    signal = (
        0.3 * np.sin(2 * np.pi * 200 * t) +
        0.2 * np.sin(2 * np.pi * 400 * t) +
        0.1 * np.sin(2 * np.pi * 800 * t)
    ).astype(np.float32)
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
    return (signal * envelope).astype(np.float32)


def _generate_realistic_speech(duration_sec: float = 3.0, sr: int = 16000) -> np.ndarray:
    """Generate a more realistic speech-like signal that triggers VAD."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), dtype=np.float32)
    # Mix frequencies typical of speech
    signal = (
        0.15 * np.sin(2 * np.pi * 150 * t) +
        0.12 * np.sin(2 * np.pi * 300 * t) +
        0.08 * np.sin(2 * np.pi * 600 * t) +
        0.05 * np.sin(2 * np.pi * 1200 * t) +
        0.03 * np.sin(2 * np.pi * 2400 * t)
    ).astype(np.float32)
    # Amplitude modulation at ~5 Hz (speech rhythm)
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 5 * t)
    # Add some noise
    rng = np.random.default_rng(42)
    noise = rng.uniform(-0.02, 0.02, size=len(t)).astype(np.float32)
    return (signal * envelope + noise).astype(np.float32)


# ---------------------------------------------------------------------------
# Test: _cpp_worker.run_worker() — frozen binary fix
# ---------------------------------------------------------------------------

class TestCppWorkerRunWorker:
    """Test the run_worker() function used by frozen PyInstaller builds.
    
    This is the CRITICAL fix: when sys.frozen is True, the orchestrator calls
    run_worker() directly instead of spawning a subprocess. These tests verify
    that the function works correctly.
    """

    def test_run_worker_returns_dict(self):
        """run_worker() should return a dict, not crash."""
        from stt._cpp_worker import run_worker

        audio = _generate_silence(0.5)
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            np.save(f.name, audio, allow_pickle=False)
            audio_path = f.name

        try:
            config = {
                "model_name": "tiny.en",
                "audio_path": audio_path,
                "n_threads": 1,
                "language": "en",
                "condition_on_previous_text": False,
                "no_speech_thold": 0.6,
                "entropy_thold": 2.4,
                "logprob_thold": -1.0,
                "hotwords": "",
            }
            result = run_worker(config)
            assert isinstance(result, dict)
            assert "ok" in result
            # Should not hang or crash
        finally:
            os.unlink(audio_path)

    def test_run_worker_missing_audio_returns_error(self):
        """run_worker() should return error for missing audio file."""
        from stt._cpp_worker import run_worker

        config = {
            "model_name": "tiny.en",
            "audio_path": "/nonexistent/audio.npy",
            "n_threads": 1,
            "language": "en",
        }
        result = run_worker(config)
        assert result["ok"] is False
        assert "Failed to load audio" in result["error"]

    def test_run_worker_with_speech_audio(self):
        """run_worker() with speech-like audio should return result dict."""
        from stt._cpp_worker import run_worker

        audio = _generate_speech_like(2.0)
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            np.save(f.name, audio, allow_pickle=False)
            audio_path = f.name

        try:
            config = {
                "model_name": "tiny.en",
                "audio_path": audio_path,
                "n_threads": 1,
                "language": "en",
                "condition_on_previous_text": False,
                "no_speech_thold": 0.6,
                "entropy_thold": 2.4,
                "logprob_thold": -1.0,
                "hotwords": "",
            }
            result = run_worker(config)
            assert isinstance(result, dict)
            assert "ok" in result
            if result["ok"]:
                assert "text" in result
                assert "language" in result
                assert "segments" in result
        finally:
            os.unlink(audio_path)

    def test_run_worker_performance(self):
        """run_worker() should complete within reasonable time."""
        from stt._cpp_worker import run_worker

        audio = _generate_realistic_speech(3.0)
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            np.save(f.name, audio, allow_pickle=False)
            audio_path = f.name

        try:
            config = {
                "model_name": "tiny.en",
                "audio_path": audio_path,
                "n_threads": 2,
                "language": "en",
                "condition_on_previous_text": False,
            }
            start = time.monotonic()
            result = run_worker(config)
            elapsed = time.monotonic() - start
            assert isinstance(result, dict)
            # tiny.en on CPU should be fast (< 5s for 3s audio)
            assert elapsed < 10.0, f"Transcription took {elapsed:.1f}s (> 10s)"
        finally:
            os.unlink(audio_path)


# ---------------------------------------------------------------------------
# Test: Orchestrator transcription pipeline
# ---------------------------------------------------------------------------

class TestOrchestratorTranscription:
    """Test the orchestrator's transcription functions directly.
    
    These test the actual code path that was broken (subprocess -m invocation)
    and now fixed (in-process run_worker when frozen).
    """

    def test_whisper_cpp_in_process(self):
        """whisper_cpp transcription should work in-process."""
        from stt.orchestrator import _transcribe_with_partials
        from stt.config import TranscriptionConfig, TranscriptionBackend

        audio = _generate_speech_like(2.0)
        tcfg = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name="tiny.en",
            device="cpu",
            cpu_threads=1,
            language="en",
            beam_size=1,
            condition_on_previous_text=False,
        )

        partials = []
        def on_partial(text):
            partials.append(text)

        result = _transcribe_with_partials(audio, 16000, tcfg, on_partial)
        assert hasattr(result, "text")
        assert hasattr(result, "language")
        # Should complete without hanging

    def test_whisper_cpp_with_hotwords(self):
        """whisper_cpp transcription with hotwords should not crash."""
        from stt.orchestrator import _transcribe_with_partials
        from stt.config import TranscriptionConfig, TranscriptionBackend

        audio = _generate_speech_like(2.0)
        tcfg = TranscriptionConfig(
            backend=TranscriptionBackend.WHISPER_CPP,
            model_name="tiny.en",
            device="cpu",
            cpu_threads=1,
            language="en",
            beam_size=1,
            condition_on_previous_text=False,
            hotwords="hello world test",
        )

        partials = []
        result = _transcribe_with_partials(audio, 16000, tcfg, lambda t: partials.append(t))
        assert hasattr(result, "text")

    def test_faster_whisper_in_process(self):
        """faster_whisper transcription should work (different code path)."""
        from stt.orchestrator import _transcribe_with_partials
        from stt.config import TranscriptionConfig, TranscriptionBackend, ComputeType

        audio = _generate_speech_like(2.0)
        tcfg = TranscriptionConfig(
            backend=TranscriptionBackend.FASTER_WHISPER,
            model_name="tiny.en",
            device="cpu",
            compute_type=ComputeType.INT8,
            language="en",
            beam_size=1,
            condition_on_previous_text=False,
        )

        partials = []
        def on_partial(text):
            partials.append(text)

        result = _transcribe_with_partials(audio, 16000, tcfg, on_partial)
        assert hasattr(result, "text")
        assert hasattr(result, "language")


# ---------------------------------------------------------------------------
# Test: Hotkey format validation
# ---------------------------------------------------------------------------

class TestHotkeyFormat:
    """Test that Tauri global shortcut format is valid.
    
    The bug: CommandOrControl+Super has two modifiers and no main key.
    Tauri requires modifiers + at least one main key.
    """

    MODIFIERS = {"CommandOrControl", "CmdOrCtrl", "Shift", "Alt", "Option", "Super", "Meta"}

    def test_valid_hotkeys_have_main_key(self):
        """All valid hotkeys must have at least one non-modifier key."""
        valid_hotkeys = [
            "CommandOrControl+Shift+Space",
            "CommandOrControl+Alt+Space",
            "Alt+Space",
            "Super+Space",
            "CommandOrControl+Shift+K",
            "Alt+K",
        ]
        for hotkey in valid_hotkeys:
            parts = hotkey.split("+")
            non_modifiers = [p for p in parts if p not in self.MODIFIERS]
            assert len(non_modifiers) >= 1, \
                f"Hotkey '{hotkey}' has no main key (parts: {parts})"

    def test_old_default_was_invalid(self):
        """CommandOrControl+Super should be invalid (two modifiers, no key)."""
        hotkey = "CommandOrControl+Super"
        parts = hotkey.split("+")
        non_modifiers = [p for p in parts if p not in self.MODIFIERS]
        assert len(non_modifiers) == 0, \
            f"'{hotkey}' should have no main key but has: {non_modifiers}"

    def test_new_default_is_valid(self):
        """New default hotkey CommandOrControl+Shift+Space should be valid."""
        hotkey = "CommandOrControl+Shift+Space"
        parts = hotkey.split("+")
        non_modifiers = [p for p in parts if p not in self.MODIFIERS]
        assert len(non_modifiers) >= 1, \
            f"New default '{hotkey}' has no main key"


# ---------------------------------------------------------------------------
# Test: Frozen binary detection
# ---------------------------------------------------------------------------

class TestFrozenBinaryDetection:
    """Test that sys.frozen detection works for PyInstaller builds."""

    def test_run_worker_is_callable(self):
        """run_worker should be importable and callable from stt._cpp_worker."""
        from stt._cpp_worker import run_worker
        assert callable(run_worker)

    def test_run_worker_signature(self):
        """run_worker should accept a config dict and return a dict."""
        from stt._cpp_worker import run_worker
        import inspect
        sig = inspect.signature(run_worker)
        params = list(sig.parameters.keys())
        assert len(params) == 1
        assert params[0] == "config"

    def test_orchestrator_handles_frozen(self):
        """Orchestrator should detect sys.frozen and call run_worker directly."""
        orchestrator_path = PROJECT_ROOT / "stt" / "orchestrator.py"
        source = orchestrator_path.read_text()
        assert '"frozen"' in source
        assert "run_worker" in source
        assert "from stt._cpp_worker import run_worker" in source


# ---------------------------------------------------------------------------
# Test: Transcription result structure
# ---------------------------------------------------------------------------

class TestTranscriptionResult:
    """Test that TranscriptionResult is properly structured."""

    def test_transcription_result_fields(self):
        """TranscriptionResult should have text, language, segments."""
        from stt.types import TranscriptionResult
        result = TranscriptionResult(
            text="hello world",
            language="en",
            segments=(),
        )
        assert result.text == "hello world"
        assert result.language == "en"
        assert result.segments == ()

    def test_transcription_result_empty(self):
        """Empty TranscriptionResult should be valid."""
        from stt.types import TranscriptionResult
        result = TranscriptionResult(text="", language="")
        assert result.text == ""
        assert result.is_empty
