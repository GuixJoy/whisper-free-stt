"""Application orchestrator — wires components into the main loop."""

from __future__ import annotations

import signal
import sys
import threading
import time

import numpy as np

from stt.config import AppConfig, LLMMode
from stt.audio_capture import record_utterance, find_default_microphone
from stt.vad import make_speech_detector, compute_rms
from stt.transcription import transcribe
from stt.llm import rewrite
from stt.clipboard import copy_to_clipboard


def _echo(*args, **kwargs) -> None:
    print(*args, **kwargs, flush=True)


def _debug(config: AppConfig, *args, **kwargs) -> None:
    if config.debug:
        print("[debug]", *args, **kwargs, flush=True)


def run(config: AppConfig) -> None:
    """Main loop: listen → transcribe → [rewrite] → [clipboard] → repeat."""
    _echo("╔══════════════════════════════════╗")
    _echo("║   STT — Local Speech-to-Text    ║")
    _echo("╚══════════════════════════════════╝")
    _echo()

    mic_index = find_default_microphone()
    if mic_index is None:
        _echo("ERROR: No microphone detected.", file=sys.stderr)
        sys.exit(1)

    _echo(f"Microphone: index={mic_index}")
    _echo(f"Whisper model: {config.transcription.model_name}")
    _echo(f"LLM mode: {config.llm.mode.value}")
    _echo(f"Clipboard: {'enabled' if config.clipboard.enabled else 'disabled'}")
    _echo()
    _echo("Listening... (Ctrl+C to stop)")
    _echo("-" * 40)

    _, should_stop, vad_reset = make_speech_detector(config.vad)
    signal.signal(signal.SIGINT, lambda sig, frame: sys.exit(0))

    iteration = 0
    while True:
        iteration += 1
        _debug(config, f"--- iteration {iteration} ---")
        try:
            vad_reset()
            segment = record_utterance(config.audio, should_stop, debug=config.debug)
            rms = compute_rms(segment.data)
            _debug(config, f"segment: {segment.duration_sec:.1f}s, rms={rms:.4f}")

            if segment.duration_sec < config.vad.min_recording_sec or rms < config.vad.silence_threshold_rms:
                continue

            result = transcribe(segment.data, segment.sample_rate, config.transcription)
            if result.is_empty:
                continue

            raw = result.text
            _echo(f"\n[raw] {raw}")

            processed = raw
            if config.llm.mode is not LLMMode.OFF:
                thread = threading.Thread(
                    target=_llm_then_clipboard,
                    args=(config, raw),
                    daemon=True,
                )
                thread.start()
            else:
                _clipboard(config, raw)
                _echo("-" * 40)

        except RuntimeError as exc:
            _echo(f"Error: {exc}", file=sys.stderr)
            time.sleep(1.0)
        except Exception as exc:
            _echo(f"Unexpected error: {exc}", file=sys.stderr)
            time.sleep(1.0)


def _llm_then_clipboard(config: AppConfig, raw: str) -> None:
    try:
        processed = rewrite(raw, config.llm)
        _echo(f"[{config.llm.mode.value}] {processed}")
    except Exception as exc:
        _echo(f"LLM error: {exc}", file=sys.stderr)
        processed = raw
    _clipboard(config, processed)
    _echo("-" * 40)


def _clipboard(config: AppConfig, text: str) -> None:
    if config.clipboard.enabled and copy_to_clipboard(text, config.clipboard):
        _echo("[clipboard] ✓")
