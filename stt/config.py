"""Immutable configuration for the STT application.

All configuration lives here. No hidden globals — pass config instances explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class LLMMode(str, Enum):
    """What the LLM should do with the raw transcript."""
    OFF = "off"
    CLEANUP = "cleanup"
    BULLET_LIST = "bullet_list"
    EMAIL = "email"
    COMMIT_MESSAGE = "commit_message"


class ComputeType(str, Enum):
    """Whisper compute type for faster-whisper / CTranslate2."""
    INT8 = "int8"
    INT8_FLOAT16 = "int8_float16"
    INT16 = "int16"
    FLOAT16 = "float16"
    FLOAT32 = "float32"
    AUTO = "auto"


@dataclass(frozen=True)
class AudioConfig:
    """Microphone capture settings."""
    sample_rate: int = 16_000
    channels: int = 1
    dtype: str = "float32"
    blocksize: int = 2048
    device_index: int | None = None


@dataclass(frozen=True)
class VADConfig:
    """Voice-activity detection parameters."""
    silence_threshold_rms: float = 0.005
    silence_duration_sec: float = 1.5
    min_recording_sec: float = 0.5
    pre_speech_padding_sec: float = 0.2


@dataclass(frozen=True)
class TranscriptionConfig:
    """ASR settings."""
    model_name: str = "base"
    compute_type: ComputeType = ComputeType.INT8
    device: str = "cpu"
    cpu_threads: int = 4
    language: str | None = None
    beam_size: int = 1


@dataclass(frozen=True)
class LLMConfig:
    """LLM settings."""
    mode: LLMMode = LLMMode.OFF
    model: str = "openai/gpt-4o-mini"
    api_key_env: str = "OPENROUTER_API_KEY"
    max_tokens: int = 1024
    temperature: float = 0.2
    timeout_sec: float = 15.0
    base_url: str = "https://openrouter.ai/api/v1/chat/completions"


@dataclass(frozen=True)
class ClipboardConfig:
    """Clipboard integration settings."""
    enabled: bool = False
    wl_copy_path: str = "wl-copy"


@dataclass(frozen=True)
class AppConfig:
    """Aggregate config — pass a single instance through the app."""
    audio: AudioConfig = field(default_factory=AudioConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    clipboard: ClipboardConfig = field(default_factory=ClipboardConfig)
    debug: bool = False
