"""Immutable configuration for the STT application.

.env support: call load_dotenv() before building config.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class LLMMode(str, Enum):
    OFF = "off"
    CLEANUP = "cleanup"
    BULLET_LIST = "bullet_list"
    EMAIL = "email"
    COMMIT_MESSAGE = "commit_message"


class LLMProvider(str, Enum):
    OPENROUTER = "openrouter"
    DEEPSEEK = "deepseek"


class TranscriptionBackend(str, Enum):
    WHISPER_CPP = "whisper_cpp"
    FASTER_WHISPER = "faster_whisper"


class ComputeType(str, Enum):
    INT8 = "int8"
    INT8_FLOAT16 = "int8_float16"
    INT16 = "int16"
    FLOAT16 = "float16"
    FLOAT32 = "float32"
    AUTO = "auto"


@dataclass(frozen=True)
class AudioConfig:
    sample_rate: int = 16_000
    channels: int = 1
    dtype: str = "float32"
    blocksize: int = 1024
    device_index: int | None = None


@dataclass(frozen=True)
class VADConfig:
    silence_threshold_rms: float = 0.005
    silence_duration_sec: float = 0.9
    min_recording_sec: float = 0.5
    pre_speech_padding_sec: float = 0.2
    max_recording_sec: float = 15.0
    start_threshold_multiplier: float = 1.15
    trigger_ratio: float = 0.6
    detrigger_ratio: float = 0.9
    decision_window_sec: float = 0.2
    noise_floor_alpha: float = 0.95
    noise_floor_margin: float = 2.0
    # Fast-commit: when set, use lower silence duration + higher detrigger ratio
    # for ~40% faster endpointing. Trades occasional mid-sentence cuts for speed.
    fast_commit: bool = False
    fast_silence_duration_sec: float = 0.5
    fast_detrigger_ratio: float = 0.75


@dataclass(frozen=True)
class TranscriptionConfig:
    backend: TranscriptionBackend = TranscriptionBackend.WHISPER_CPP
    model_name: str = "base.en"
    compute_type: ComputeType = ComputeType.INT8
    device: str = "cpu"
    cpu_threads: int = 4
    language: str | None = None
    beam_size: int = 1
    condition_on_previous_text: bool = True
    vad_filter: bool = True                # Use Silero VAD inside Whisper (GPU) instead of our RMS VAD
    vad_min_silence_ms: int = 900          # Silence before endpoint (matches our RMS VAD default)
    vad_max_speech_sec: float = 15.0       # Max speech before forced split
    noise_reduce: bool = True
    noise_reduce_prop_decrease: float = 0.85
    whisper_no_speech_thold: float = 0.5
    whisper_entropy_thold: float = 2.2
    whisper_compression_ratio_thold: float = 2.4
    whisper_logprob_thold: float = -1.0


def _env_default(key: str, fallback: str) -> str:
    return os.environ.get(key, fallback)


def _detect_provider() -> LLMProvider:
    if os.environ.get("DEEPSEEK_API_KEY"):
        return LLMProvider.DEEPSEEK
    if os.environ.get("OPENROUTER_API_KEY"):
        return LLMProvider.OPENROUTER
    return LLMProvider.OPENROUTER


def _base_url_for(provider: LLMProvider) -> str:
    if provider is LLMProvider.DEEPSEEK:
        return "https://api.deepseek.com/chat/completions"
    return "https://openrouter.ai/api/v1/chat/completions"


def _api_key_env_for(provider: LLMProvider) -> str:
    if provider is LLMProvider.DEEPSEEK:
        return "DEEPSEEK_API_KEY"
    return "OPENROUTER_API_KEY"


def _default_model_for(provider: LLMProvider) -> str:
    if provider is LLMProvider.DEEPSEEK:
        return "deepseek-chat"
    return "openai/gpt-4o-mini"


@dataclass(frozen=True)
class LLMConfig:
    mode: LLMMode = LLMMode.CLEANUP
    provider: LLMProvider = field(default_factory=_detect_provider)
    model: str = field(default_factory=lambda: _env_default("STT_LLM_MODEL", ""))
    fallback_model: str = field(default_factory=lambda: _env_default("STT_LLM_FALLBACK", ""))
    max_tokens: int = 256     # 256 is optimal for cleanup; modes like EMAIL override to >=512
    temperature: float = 0.2
    timeout_sec: float = 15.0

    def __post_init__(self) -> None:
        if not self.model:
            object.__setattr__(self, "model", _default_model_for(self.provider))
        if not self.fallback_model and self.provider is LLMProvider.OPENROUTER:
            object.__setattr__(self, "fallback_model", "anthropic/claude-3-5-haiku-latest")

    @property
    def api_key_env(self) -> str:
        return _api_key_env_for(self.provider)

    @property
    def base_url(self) -> str:
        return _base_url_for(self.provider)


@dataclass(frozen=True)
class ClipboardConfig:
    enabled: bool = False
    wl_copy_path: str = "wl-copy"


@dataclass(frozen=True)
class TypingConfig:
    enabled: bool = True
    wtype_path: str = "wtype"


@dataclass(frozen=True)
class AppConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    clipboard: ClipboardConfig = field(default_factory=ClipboardConfig)
    typing: TypingConfig = field(default_factory=TypingConfig)
    debug: bool = False
    json_mode: bool = False


def load_dotenv(path: str | Path | None = None) -> None:
    """Load KEY=value pairs from a .env file into os.environ."""
    if path is None:
        # Try cwd first, then project root, then home
        candidates = [
            Path.cwd() / ".env",
            Path(__file__).resolve().parent.parent / ".env",
            Path.home() / ".stt.env",
        ]
        for p in candidates:
            if p.exists():
                path = p
                break
        else:
            return
    elif isinstance(path, str):
        path = Path(path)
    if not path.exists():
        return
    content = path.read_text(encoding="utf-8")
    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and (
            (value.startswith('"') and value.endswith('"')) or
            (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        if key not in os.environ:
            os.environ[key] = value
