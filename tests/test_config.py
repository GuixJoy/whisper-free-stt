"""Tests for stt/config.py — configuration helpers and dataclasses."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class TestLLMProviderHelpers(unittest.TestCase):
    """Tests for pure helper functions that map LLMProvider to strings."""

    def test_base_url_deepseek(self):
        from stt.config import LLMProvider, _base_url_for
        url = _base_url_for(LLMProvider.DEEPSEEK)
        self.assertIn("deepseek.com", url)
        self.assertIn("chat/completions", url)

    def test_base_url_openrouter(self):
        from stt.config import LLMProvider, _base_url_for
        url = _base_url_for(LLMProvider.OPENROUTER)
        self.assertIn("openrouter.ai", url)
        self.assertIn("chat/completions", url)

    def test_api_key_env_deepseek(self):
        from stt.config import LLMProvider, _api_key_env_for
        key = _api_key_env_for(LLMProvider.DEEPSEEK)
        self.assertEqual(key, "DEEPSEEK_API_KEY")

    def test_api_key_env_openrouter(self):
        from stt.config import LLMProvider, _api_key_env_for
        key = _api_key_env_for(LLMProvider.OPENROUTER)
        self.assertEqual(key, "OPENROUTER_API_KEY")

    def test_default_model_deepseek(self):
        from stt.config import LLMProvider, _default_model_for
        model = _default_model_for(LLMProvider.DEEPSEEK)
        self.assertEqual(model, "deepseek-chat")

    def test_default_model_openrouter(self):
        from stt.config import LLMProvider, _default_model_for
        model = _default_model_for(LLMProvider.OPENROUTER)
        self.assertIn("gpt", model.lower())


class TestDetectProvider(unittest.TestCase):
    """Tests for _detect_provider() which reads environment variables."""

    def test_deepseek_key_selects_deepseek(self):
        from stt.config import LLMProvider, _detect_provider
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-test", "OPENROUTER_API_KEY": ""}, clear=False):
            # Remove OPENROUTER_API_KEY if present
            env = {k: v for k, v in os.environ.items()}
            env.pop("OPENROUTER_API_KEY", None)
            env["DEEPSEEK_API_KEY"] = "sk-test"
            with patch.dict(os.environ, env, clear=True):
                provider = _detect_provider()
                self.assertEqual(provider, LLMProvider.DEEPSEEK)

    def test_openrouter_key_only_selects_openrouter(self):
        from stt.config import LLMProvider, _detect_provider
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("DEEPSEEK_API_KEY", "OPENROUTER_API_KEY")}
        clean_env["OPENROUTER_API_KEY"] = "sk-openrouter"
        with patch.dict(os.environ, clean_env, clear=True):
            provider = _detect_provider()
            self.assertEqual(provider, LLMProvider.OPENROUTER)

    def test_no_keys_defaults_to_openrouter(self):
        from stt.config import LLMProvider, _detect_provider
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("DEEPSEEK_API_KEY", "OPENROUTER_API_KEY")}
        with patch.dict(os.environ, clean_env, clear=True):
            provider = _detect_provider()
            self.assertEqual(provider, LLMProvider.OPENROUTER)

    def test_deepseek_takes_priority_over_openrouter(self):
        """When both keys are set, DEEPSEEK takes priority (checked first)."""
        from stt.config import LLMProvider, _detect_provider
        with patch.dict(os.environ,
                        {"DEEPSEEK_API_KEY": "sk-deepseek", "OPENROUTER_API_KEY": "sk-openrouter"},
                        clear=False):
            provider = _detect_provider()
            self.assertEqual(provider, LLMProvider.DEEPSEEK)


class TestLLMConfigDefaults(unittest.TestCase):
    """Tests for LLMConfig.__post_init__ default model resolution."""

    def test_deepseek_gets_deepseek_chat_model(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("STT_LLM_MODEL", "STT_LLM_FALLBACK")}
        with patch.dict(os.environ, clean_env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.model, "deepseek-chat")

    def test_openrouter_gets_gpt_model(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("STT_LLM_MODEL", "STT_LLM_FALLBACK")}
        with patch.dict(os.environ, clean_env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.OPENROUTER, mode=LLMMode.CLEANUP)
        self.assertIn("gpt", cfg.model.lower())

    def test_openrouter_gets_fallback_model(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("STT_LLM_MODEL", "STT_LLM_FALLBACK")}
        with patch.dict(os.environ, clean_env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.OPENROUTER, mode=LLMMode.CLEANUP)
        self.assertTrue(cfg.fallback_model, "OpenRouter should have a fallback model")
        self.assertIn("claude", cfg.fallback_model.lower())

    def test_deepseek_has_no_fallback_model(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        clean_env = {k: v for k, v in os.environ.items()
                     if k not in ("STT_LLM_MODEL", "STT_LLM_FALLBACK")}
        with patch.dict(os.environ, clean_env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.fallback_model, "")

    def test_env_model_override_respected(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        env = {k: v for k, v in os.environ.items() if k != "STT_LLM_FALLBACK"}
        env["STT_LLM_MODEL"] = "my-custom-model"
        with patch.dict(os.environ, env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.model, "my-custom-model")

    def test_env_fallback_override_respected(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        env = {k: v for k, v in os.environ.items() if k != "STT_LLM_MODEL"}
        env["STT_LLM_FALLBACK"] = "my-fallback-model"
        with patch.dict(os.environ, env, clear=True):
            cfg = LLMConfig(provider=LLMProvider.OPENROUTER, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.fallback_model, "my-fallback-model")


class TestLLMConfigProperties(unittest.TestCase):
    """Tests for LLMConfig computed properties."""

    def test_api_key_env_property_deepseek(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.api_key_env, "DEEPSEEK_API_KEY")

    def test_api_key_env_property_openrouter(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        cfg = LLMConfig(provider=LLMProvider.OPENROUTER, mode=LLMMode.CLEANUP)
        self.assertEqual(cfg.api_key_env, "OPENROUTER_API_KEY")

    def test_base_url_property_deepseek(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        self.assertIn("deepseek.com", cfg.base_url)

    def test_base_url_property_openrouter(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        cfg = LLMConfig(provider=LLMProvider.OPENROUTER, mode=LLMMode.CLEANUP)
        self.assertIn("openrouter.ai", cfg.base_url)

    def test_config_is_frozen(self):
        """LLMConfig is a frozen dataclass — direct attribute mutation should raise."""
        from stt.config import LLMConfig, LLMProvider, LLMMode
        from dataclasses import FrozenInstanceError
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        with self.assertRaises(FrozenInstanceError):
            cfg.temperature = 0.9  # type: ignore[misc]


class TestLoadDotenv(unittest.TestCase):
    """Tests for load_dotenv() — .env file parsing."""

    def setUp(self):
        self._saved = dict(os.environ)

    def tearDown(self):
        # Restore environment
        os.environ.clear()
        os.environ.update(self._saved)

    def _write_env(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".env")
        with os.fdopen(fd, "w") as f:
            f.write(content)
        return path

    def test_basic_key_value(self):
        from stt.config import load_dotenv
        path = self._write_env("MY_TEST_KEY=hello\n")
        try:
            os.environ.pop("MY_TEST_KEY", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("MY_TEST_KEY"), "hello")
        finally:
            os.unlink(path)

    def test_export_prefix_stripped(self):
        from stt.config import load_dotenv
        path = self._write_env("export EXPORT_KEY=world\n")
        try:
            os.environ.pop("EXPORT_KEY", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("EXPORT_KEY"), "world")
        finally:
            os.unlink(path)

    def test_double_quoted_value_stripped(self):
        from stt.config import load_dotenv
        path = self._write_env('QUOTED_KEY="quoted value"\n')
        try:
            os.environ.pop("QUOTED_KEY", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("QUOTED_KEY"), "quoted value")
        finally:
            os.unlink(path)

    def test_single_quoted_value_stripped(self):
        from stt.config import load_dotenv
        path = self._write_env("SINGLE_QUOTED='single value'\n")
        try:
            os.environ.pop("SINGLE_QUOTED", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("SINGLE_QUOTED"), "single value")
        finally:
            os.unlink(path)

    def test_comments_ignored(self):
        from stt.config import load_dotenv
        path = self._write_env("# This is a comment\nREAL_KEY=real_value\n")
        try:
            os.environ.pop("REAL_KEY", None)
            load_dotenv(path)
            self.assertIsNone(os.environ.get("__This_is_a_comment"))
            self.assertEqual(os.environ.get("REAL_KEY"), "real_value")
        finally:
            os.unlink(path)

    def test_empty_lines_ignored(self):
        from stt.config import load_dotenv
        path = self._write_env("\n\nEMPTY_LINE_KEY=value\n\n")
        try:
            os.environ.pop("EMPTY_LINE_KEY", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("EMPTY_LINE_KEY"), "value")
        finally:
            os.unlink(path)

    def test_existing_env_not_overwritten(self):
        """load_dotenv must NOT override already-set environment variables."""
        from stt.config import load_dotenv
        path = self._write_env("PREEXISTING_KEY=from_file\n")
        try:
            os.environ["PREEXISTING_KEY"] = "from_env"
            load_dotenv(path)
            self.assertEqual(os.environ.get("PREEXISTING_KEY"), "from_env")
        finally:
            os.unlink(path)

    def test_nonexistent_file_is_noop(self):
        """load_dotenv with a missing file path should silently do nothing."""
        from stt.config import load_dotenv
        load_dotenv("/nonexistent/path/to/.env")  # Should not raise

    def test_line_without_equals_ignored(self):
        from stt.config import load_dotenv
        path = self._write_env("NO_EQUALS_HERE\nGOOD_KEY=good_value\n")
        try:
            os.environ.pop("NO_EQUALS_HERE", None)
            os.environ.pop("GOOD_KEY", None)
            load_dotenv(path)
            self.assertIsNone(os.environ.get("NO_EQUALS_HERE"))
            self.assertEqual(os.environ.get("GOOD_KEY"), "good_value")
        finally:
            os.unlink(path)

    def test_value_with_equals_sign_preserved(self):
        """Values containing '=' should not be truncated at second '='."""
        from stt.config import load_dotenv
        path = self._write_env("COMPLEX_KEY=value=with=equals\n")
        try:
            os.environ.pop("COMPLEX_KEY", None)
            load_dotenv(path)
            self.assertEqual(os.environ.get("COMPLEX_KEY"), "value=with=equals")
        finally:
            os.unlink(path)

    def test_path_as_string_accepted(self):
        from stt.config import load_dotenv
        path = self._write_env("STRING_PATH_KEY=str_value\n")
        try:
            os.environ.pop("STRING_PATH_KEY", None)
            load_dotenv(path)  # str, not Path
            self.assertEqual(os.environ.get("STRING_PATH_KEY"), "str_value")
        finally:
            os.unlink(path)

    def test_path_as_pathlib_accepted(self):
        from stt.config import load_dotenv
        path = self._write_env("PATHLIB_KEY=pathlib_value\n")
        try:
            os.environ.pop("PATHLIB_KEY", None)
            load_dotenv(Path(path))
            self.assertEqual(os.environ.get("PATHLIB_KEY"), "pathlib_value")
        finally:
            os.unlink(path)


class TestEnums(unittest.TestCase):
    """Tests for enum values referenced by the changed code."""

    def test_llm_mode_values(self):
        from stt.config import LLMMode
        self.assertEqual(LLMMode.OFF.value, "off")
        self.assertEqual(LLMMode.CLEANUP.value, "cleanup")
        self.assertEqual(LLMMode.BULLET_LIST.value, "bullet_list")
        self.assertEqual(LLMMode.EMAIL.value, "email")
        self.assertEqual(LLMMode.COMMIT_MESSAGE.value, "commit_message")

    def test_llm_provider_values(self):
        from stt.config import LLMProvider
        self.assertEqual(LLMProvider.DEEPSEEK.value, "deepseek")
        self.assertEqual(LLMProvider.OPENROUTER.value, "openrouter")

    def test_llm_mode_is_string_enum(self):
        """LLMMode values should be usable as plain strings."""
        from stt.config import LLMMode
        self.assertEqual(LLMMode.CLEANUP, "cleanup")
        self.assertEqual(LLMMode.OFF, "off")

    def test_transcription_backend_values(self):
        from stt.config import TranscriptionBackend
        self.assertEqual(TranscriptionBackend.WHISPER_CPP.value, "whisper_cpp")
        self.assertEqual(TranscriptionBackend.FASTER_WHISPER.value, "faster_whisper")

    def test_compute_type_values(self):
        from stt.config import ComputeType
        self.assertEqual(ComputeType.INT8.value, "int8")
        self.assertEqual(ComputeType.FLOAT16.value, "float16")
        self.assertEqual(ComputeType.AUTO.value, "auto")


class TestAudioConfig(unittest.TestCase):
    def test_default_sample_rate(self):
        from stt.config import AudioConfig
        cfg = AudioConfig()
        self.assertEqual(cfg.sample_rate, 16_000)

    def test_default_channels(self):
        from stt.config import AudioConfig
        cfg = AudioConfig()
        self.assertEqual(cfg.channels, 1)

    def test_is_frozen(self):
        from stt.config import AudioConfig
        from dataclasses import FrozenInstanceError
        cfg = AudioConfig()
        with self.assertRaises(FrozenInstanceError):
            cfg.sample_rate = 8000  # type: ignore[misc]


class TestTranscriptionConfigVADDefaults(unittest.TestCase):
    """Verify VAD-related TranscriptionConfig defaults that were changed in the PR."""

    def test_vad_filter_enabled_by_default(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertTrue(cfg.vad_filter)

    def test_vad_min_silence_ms_default(self):
        from stt.config import TranscriptionConfig
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.vad_min_silence_ms, 900)

    def test_default_backend_is_whisper_cpp(self):
        from stt.config import TranscriptionConfig, TranscriptionBackend
        cfg = TranscriptionConfig()
        self.assertEqual(cfg.backend, TranscriptionBackend.WHISPER_CPP)


class TestBuildConfigKeyInjection(unittest.TestCase):
    """Tests that build_config() injects CLI API keys into os.environ before LLMConfig reads them."""

    def setUp(self):
        self._saved = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def _make_args(self, **kwargs):
        """Build a minimal argparse.Namespace with defaults matching build_arg_parser()."""
        import argparse
        defaults = {
            "sample_rate": 16000,
            "device_index": None,
            "silence_threshold": None,
            "silence_duration": None,
            "min_duration": 0.5,
            "fast_commit": False,
            "asr_profile": "auto",
            "backend": None,
            "model": None,
            "compute_type": "auto",
            "device": "auto",
            "cpu_threads": 4,
            "language": None,
            "beam_size": None,
            "hotwords": "",
            "diarization": False,
            "diarization_threshold": 0.65,
            "llm_provider": None,
            "llm_mode": None,
            "llm_model": None,
            "llm_fallback": None,
            "llm_timeout": None,
            "deepseek_api_key": None,
            "openrouter_api_key": None,
            "clipboard": False,
            "no_type": False,
            "type_path": "wtype",
            "clipboard_path": "wl-copy",
            "debug": False,
            "json_mode": False,
            "ws_port": None,
            "ws_audio": False,
            "input_file": None,
            "list_microphones": False,
            "download_model": None,
            "log_file": None,
        }
        defaults.update(kwargs)
        return argparse.Namespace(**defaults)

    def test_deepseek_key_injected_into_environ(self):
        from stt.cli import build_config
        os.environ.pop("DEEPSEEK_API_KEY", None)
        args = self._make_args(deepseek_api_key="sk-deepseek-test")
        build_config(args)
        self.assertEqual(os.environ.get("DEEPSEEK_API_KEY"), "sk-deepseek-test")

    def test_openrouter_key_injected_into_environ(self):
        from stt.cli import build_config
        os.environ.pop("OPENROUTER_API_KEY", None)
        args = self._make_args(openrouter_api_key="sk-openrouter-test")
        build_config(args)
        self.assertEqual(os.environ.get("OPENROUTER_API_KEY"), "sk-openrouter-test")

    def test_both_keys_injected(self):
        from stt.cli import build_config
        os.environ.pop("DEEPSEEK_API_KEY", None)
        os.environ.pop("OPENROUTER_API_KEY", None)
        args = self._make_args(
            deepseek_api_key="sk-deepseek-test",
            openrouter_api_key="sk-openrouter-test",
        )
        build_config(args)
        self.assertEqual(os.environ.get("DEEPSEEK_API_KEY"), "sk-deepseek-test")
        self.assertEqual(os.environ.get("OPENROUTER_API_KEY"), "sk-openrouter-test")

    def test_none_keys_do_not_set_environ(self):
        from stt.cli import build_config
        os.environ.pop("DEEPSEEK_API_KEY", None)
        os.environ.pop("OPENROUTER_API_KEY", None)
        args = self._make_args(deepseek_api_key=None, openrouter_api_key=None)
        build_config(args)
        self.assertIsNone(os.environ.get("DEEPSEEK_API_KEY"))
        self.assertIsNone(os.environ.get("OPENROUTER_API_KEY"))

    def test_empty_string_keys_do_not_set_environ(self):
        from stt.cli import build_config
        os.environ.pop("DEEPSEEK_API_KEY", None)
        os.environ.pop("OPENROUTER_API_KEY", None)
        args = self._make_args(deepseek_api_key="", openrouter_api_key="")
        build_config(args)
        self.assertIsNone(os.environ.get("DEEPSEEK_API_KEY"))
        self.assertIsNone(os.environ.get("OPENROUTER_API_KEY"))

    def test_existing_env_not_overwritten_by_none(self):
        from stt.cli import build_config
        os.environ["DEEPSEEK_API_KEY"] = "pre-existing"
        args = self._make_args(deepseek_api_key=None)
        build_config(args)
        self.assertEqual(os.environ.get("DEEPSEEK_API_KEY"), "pre-existing")

    def test_cli_key_overrides_existing_env(self):
        from stt.cli import build_config
        os.environ["DEEPSEEK_API_KEY"] = "pre-existing"
        args = self._make_args(deepseek_api_key="sk-new-key")
        build_config(args)
        self.assertEqual(os.environ.get("DEEPSEEK_API_KEY"), "sk-new-key")

    def test_llm_model_injected_from_cli(self):
        from stt.cli import build_config
        args = self._make_args(llm_model="custom-model-v1")
        cfg = build_config(args)
        self.assertEqual(cfg.llm.model, "custom-model-v1")

    def test_llm_provider_injected_from_cli(self):
        from stt.config import LLMProvider
        from stt.cli import build_config
        args = self._make_args(llm_provider="deepseek")
        cfg = build_config(args)
        self.assertEqual(cfg.llm.provider, LLMProvider.DEEPSEEK)

    def test_llm_fallback_injected_from_cli(self):
        from stt.cli import build_config
        args = self._make_args(llm_fallback="fallback-model")
        cfg = build_config(args)
        self.assertEqual(cfg.llm.fallback_model, "fallback-model")


if __name__ == "__main__":
    unittest.main()