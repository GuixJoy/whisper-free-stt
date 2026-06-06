"""CLI entrypoint — arg parsing and config construction."""

from __future__ import annotations

import argparse

from stt.config import (
    AppConfig, AudioConfig, ClipboardConfig, ComputeType,
    LLMConfig, LLMMode, TranscriptionConfig, VADConfig,
)
from stt.orchestrator import run


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stt",
        description="Local-first speech-to-text assistant for Linux Wayland",
    )
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--device-index", type=int, default=None)
    parser.add_argument("--silence-threshold", type=float, default=None)
    parser.add_argument("--silence-duration", type=float, default=1.5)
    parser.add_argument("--min-duration", type=float, default=0.5)
    parser.add_argument("--model", type=str, default=None, help="Whisper model name")
    parser.add_argument("--compute-type", type=str, default="int8")
    parser.add_argument("--device", type=str, default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--language", type=str, default=None)
    parser.add_argument("--beam-size", type=int, default=None)
    parser.add_argument("--llm-mode", type=str, default=None, choices=[e.value for e in LLMMode])
    parser.add_argument("--llm-model", type=str, default=None)
    parser.add_argument("--llm-timeout", type=float, default=None)
    parser.add_argument("--clipboard", action="store_true")
    parser.add_argument("--debug", action="store_true")
    return parser


def build_config(args: argparse.Namespace) -> AppConfig:
    defaults = LLMConfig()
    llm_mode = LLMMode(args.llm_mode) if args.llm_mode else defaults.mode
    llm_model = args.llm_model if args.llm_model else defaults.model
    llm_timeout = args.llm_timeout if args.llm_timeout else defaults.timeout_sec

    return AppConfig(
        audio=AudioConfig(sample_rate=args.sample_rate, device_index=args.device_index),
        vad=VADConfig(
            silence_threshold_rms=args.silence_threshold if args.silence_threshold else VADConfig.silence_threshold_rms,
            silence_duration_sec=args.silence_duration,
            min_recording_sec=args.min_duration,
        ),
        transcription=TranscriptionConfig(
            model_name=args.model if args.model else TranscriptionConfig.model_name,
            compute_type=ComputeType(args.compute_type),
            device=args.device, cpu_threads=args.cpu_threads,
            language=args.language,
            beam_size=args.beam_size if args.beam_size else TranscriptionConfig.beam_size,
        ),
        llm=LLMConfig(mode=llm_mode, model=llm_model, timeout_sec=llm_timeout),
        clipboard=ClipboardConfig(enabled=args.clipboard),
        debug=args.debug,
    )


def main(argv: list[str] | None = None) -> None:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    config = build_config(args)
    run(config)


if __name__ == "__main__":
    main()
