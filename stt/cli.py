"""CLI entrypoint — parses args, builds config, launches orchestrator."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

from stt.config import (
    AppConfig,
    AudioConfig,
    ClipboardConfig,
    ComputeType,
    LLMConfig,
    LLMMode,
    LLMProvider,
    TranscriptionBackend,
    TranscriptionConfig,
    TypingConfig,
    VADConfig,
    load_dotenv,
)
from stt.orchestrator import run


@dataclass(frozen=True)
class _ASRProfile:
    model_name: str
    beam_size: int
    condition_on_previous_text: bool
    backend: TranscriptionBackend = TranscriptionBackend.WHISPER_CPP


_ASR_PROFILES: dict[str, _ASRProfile] = {
    # whisper.cpp (fastest on CPU) — English-optimized models
    "speed": _ASRProfile(model_name="tiny.en", beam_size=1, condition_on_previous_text=False),
    "balanced": _ASRProfile(model_name="base.en", beam_size=1, condition_on_previous_text=True),
    "accuracy": _ASRProfile(model_name="small.en", beam_size=3, condition_on_previous_text=True),
    # faster-whisper (supports distil/turbo models not in whisper.cpp)
    "distil": _ASRProfile(
        model_name="distil-large-v3", beam_size=5, condition_on_previous_text=False,
        backend=TranscriptionBackend.FASTER_WHISPER,
    ),
    "turbo": _ASRProfile(
        model_name="large-v3-turbo", beam_size=1, condition_on_previous_text=False,
        backend=TranscriptionBackend.FASTER_WHISPER,
    ),
}


def _has_cuda() -> bool:
    """Check if CUDA is actually usable (not just compiled in)."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() == 0:
            return False
        # Verify the runtime library is loadable — some installs have CUDA
        # compiled in but missing libcublas.so at runtime.
        import ctypes
        try:
            ctypes.CDLL("libcublas.so.12")
        except OSError:
            try:
                ctypes.CDLL("libcublas.so.11")
            except OSError:
                return False
        return True
    except Exception:
        return False


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the argument parser.  Pure — no side effects."""
    parser = argparse.ArgumentParser(
        prog="stt",
        description="Local-first speech-to-text assistant for Linux Wayland",
    )

    # Audio
    parser.add_argument("--sample-rate", type=int, default=16000, help="Audio sample rate (Hz)")
    parser.add_argument("--device-index", type=int, default=None, help="Microphone device index")

    # VAD
    parser.add_argument("--silence-threshold", type=float, default=None, help="RMS silence threshold (default: 0.005)")
    parser.add_argument("--silence-duration", type=float, default=None, help="Seconds of silence before stopping")
    parser.add_argument("--min-duration", type=float, default=0.5, help="Minimum recording duration (seconds)")

    # Whisper
    parser.add_argument(
        "--asr-profile",
        type=str,
        default="auto",
        choices=["auto"] + list(_ASR_PROFILES.keys()),
        help="ASR preset: auto, speed, balanced, accuracy, distil, turbo",
    )
    parser.add_argument(
        "--backend",
        type=str,
        default=None,
        choices=[e.value for e in TranscriptionBackend],
        help="ASR engine: whisper_cpp (fastest CPU) or faster_whisper",
    )
    parser.add_argument("--model", type=str, default=None, help="Model name override (default: profile-dependent)")
    parser.add_argument("--compute-type", type=str, default="auto", choices=[e.value for e in ComputeType])
    parser.add_argument("--device", type=str, default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--cpu-threads", type=int, default=4, help="CPU threads")
    parser.add_argument("--language", type=str, default=None, help="Force transcription language (e.g., 'en')")
    parser.add_argument("--beam-size", type=int, default=None, help="Beam size (default: profile-dependent)")

    # LLM — defaults=None so we can fall back to env/.env
    parser.add_argument(
        "--llm-provider",
        type=str,
        default=None,
        choices=["auto"] + [e.value for e in LLMProvider],
        help="LLM backend: auto (detect from env), deepseek, or openrouter",
    )
    parser.add_argument(
        "--llm-mode",
        type=str,
        default=None,
        choices=[e.value for e in LLMMode],
        help="LLM rewrite mode (env: STT_LLM_MODE)",
    )
    parser.add_argument("--llm-model", type=str, default=None, help="LLM model (env: STT_LLM_MODEL)")
    parser.add_argument("--llm-fallback", type=str, default=None, help="Fallback model (env: STT_LLM_FALLBACK, OpenRouter only)")
    parser.add_argument("--llm-timeout", type=float, default=None, help="LLM timeout in seconds")

    # Clipboard
    parser.add_argument("--clipboard", action="store_true", help="Copy final text to Wayland clipboard (wl-copy)")
    parser.add_argument("--no-type", action="store_true", help="Do not type final text into focused input")
    parser.add_argument("--type-path", type=str, default="wtype", help="Typing binary path (default: wtype)")

    # Debug
    parser.add_argument("--debug", action="store_true", help="Print diagnostic info at each pipeline stage")

    return parser


def build_config(args: argparse.Namespace) -> AppConfig:
    """Build an immutable AppConfig from CLI args + env.

    Precedence: CLI flag > env var > hardcoded default.
    """
    # Build a vanilla LLMConfig first to get env-based defaults, then
    # override with any explicit CLI flags.
    llm_defaults = LLMConfig()

    llm_mode = LLMMode(args.llm_mode) if args.llm_mode is not None else llm_defaults.mode
    llm_model = args.llm_model if args.llm_model is not None else llm_defaults.model
    llm_fallback = args.llm_fallback if args.llm_fallback is not None else llm_defaults.fallback_model
    llm_timeout = args.llm_timeout if args.llm_timeout is not None else llm_defaults.timeout_sec

    # Provider: CLI override > auto-detect from env
    if args.llm_provider and args.llm_provider != "auto":
        llm_provider = LLMProvider(args.llm_provider)
    else:
        llm_provider = llm_defaults.provider

    has_cuda = _has_cuda()
    profile_name = args.asr_profile
    if profile_name == "auto":
        profile_name = "turbo" if has_cuda else "balanced"

    profile = _ASR_PROFILES[profile_name]
    model_name = args.model if args.model is not None else profile.model_name
    beam_size = args.beam_size if args.beam_size is not None else profile.beam_size
    backend = TranscriptionBackend(args.backend) if args.backend is not None else profile.backend
    device = args.device if args.device != "auto" else ("cuda" if has_cuda else "cpu")
    compute_type = ComputeType(args.compute_type)
    if compute_type is ComputeType.AUTO:
        compute_type = ComputeType.FLOAT16 if device == "cuda" else ComputeType.INT8

    return AppConfig(
        audio=AudioConfig(
            sample_rate=args.sample_rate,
            device_index=args.device_index,
        ),
        vad=VADConfig(
            silence_threshold_rms=args.silence_threshold if args.silence_threshold is not None else VADConfig.silence_threshold_rms,
            silence_duration_sec=args.silence_duration if args.silence_duration is not None else VADConfig.silence_duration_sec,
            min_recording_sec=args.min_duration,
        ),
        transcription=TranscriptionConfig(
            backend=backend,
            model_name=model_name,
            compute_type=compute_type,
            device=device,
            cpu_threads=args.cpu_threads,
            language=args.language,
            beam_size=beam_size,
            condition_on_previous_text=profile.condition_on_previous_text,
        ),
        llm=LLMConfig(
            mode=llm_mode,
            provider=llm_provider,
            model=llm_model,
            fallback_model=llm_fallback,
            timeout_sec=llm_timeout,
        ),
        clipboard=ClipboardConfig(
            enabled=args.clipboard,
        ),
        typing=TypingConfig(
            enabled=not args.no_type,
            wtype_path=args.type_path,
        ),
        debug=args.debug,
    )


def _ensure_cuda_libs() -> None:
    """Add Ollama's CUDA 12 libs to LD_LIBRARY_PATH if they exist."""
    cuda_paths = [
        "/usr/local/lib/ollama/cuda_v12",
        "/usr/local/lib/ollama/cuda_v13",
    ]
    import os as _os
    ld_path = _os.environ.get("LD_LIBRARY_PATH", "")
    for p in cuda_paths:
        if _os.path.isdir(p) and p not in ld_path:
            ld_path = f"{p}:{ld_path}" if ld_path else p
    if ld_path != _os.environ.get("LD_LIBRARY_PATH", ""):
        _os.environ["LD_LIBRARY_PATH"] = ld_path


def main(argv: list[str] | None = None) -> None:
    """Parse args → build config → run.  Impure: reads argv, .env, launches app."""
    # Load .env before anything else — so config defaults can see it
    load_dotenv()
    _ensure_cuda_libs()

    parser = build_arg_parser()
    args = parser.parse_args(argv)
    config = build_config(args)
    run(config)


if __name__ == "__main__":
    main()
