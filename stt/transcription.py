"""Transcription — whisper.cpp and faster-whisper backends.

whisper.cpp (default) is 10-16x faster on CPU.
faster-whisper supports more models (distil-large-v3, turbo) and GPU.
"""

from __future__ import annotations

import numpy as np

from stt.config import TranscriptionConfig, TranscriptionBackend
from stt.types import TranscriptionResult, TranscriptionSegment

# ---------------------------------------------------------------------------
# Model caches
# ---------------------------------------------------------------------------

_whisper_cpp_cache: dict[str, "object"] = {}  # pywhispercpp.Model
_faster_whisper_cache: dict[str, "object"] = {}  # faster_whisper.WhisperModel


def _get_cpp_model(config: TranscriptionConfig):
    """Return cached whisper.cpp model."""
    from pywhispercpp.model import Model as CppModel

    key = config.model_name
    if key not in _whisper_cpp_cache:
        _whisper_cpp_cache[key] = CppModel(
            config.model_name,
            print_progress=False,
            print_realtime=False,
            n_threads=config.cpu_threads,
        )
    return _whisper_cpp_cache[key]


def _get_fw_model(config: TranscriptionConfig):
    """Return cached faster-whisper model."""
    from faster_whisper import WhisperModel

    key = f"{config.model_name}|{config.device}|{config.compute_type.value}|{config.cpu_threads}"
    if key not in _faster_whisper_cache:
        _faster_whisper_cache[key] = WhisperModel(
            config.model_name,
            device=config.device,
            compute_type=config.compute_type.value,
            cpu_threads=config.cpu_threads,
        )
    return _faster_whisper_cache[key]


# ---------------------------------------------------------------------------
# Silence trimming (pure)
# ---------------------------------------------------------------------------

def _trim_silence(audio: np.ndarray, threshold: float = 0.005) -> np.ndarray:
    """Trim trailing samples below *threshold* amplitude."""
    if len(audio) == 0:
        return audio
    above = np.where(np.abs(audio) > threshold)[0]
    if len(above) == 0:
        return audio[:0]
    last_speech = above[-1]
    pad = int(0.2 * 16000)
    end = min(len(audio), last_speech + pad)
    return audio[:end]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def transcribe(
    audio_data: np.ndarray,
    sample_rate: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe audio using the configured backend.

    Returns:
        TranscriptionResult with text and optional segments.
    """
    if len(audio_data) == 0:
        return TranscriptionResult(text="", language="")

    # Normalise to float32 [-1, 1]
    if audio_data.dtype != np.float32:
        audio_data = audio_data.astype(np.float32)
    peak = np.max(np.abs(audio_data))
    if peak > 1.0:
        audio_data = audio_data / peak
    elif peak == 0.0:
        return TranscriptionResult(text="", language="")

    # Trim trailing silence
    audio_data = _trim_silence(audio_data)
    if len(audio_data) == 0:
        return TranscriptionResult(text="", language="")

    if config.backend is TranscriptionBackend.WHISPER_CPP:
        return _transcribe_cpp(audio_data, sample_rate, config)
    else:
        return _transcribe_fw(audio_data, sample_rate, config)


def warm_up_backend(config: TranscriptionConfig) -> None:
    """Preload model weights to avoid first-utterance cold-start latency."""
    if config.backend is TranscriptionBackend.WHISPER_CPP:
        _get_cpp_model(config)
    else:
        _get_fw_model(config)


# ---------------------------------------------------------------------------
# Backend implementations
# ---------------------------------------------------------------------------

def _transcribe_cpp(
    audio: np.ndarray,
    sr: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe via whisper.cpp (pywhispercpp)."""
    try:
        model = _get_cpp_model(config)
    except Exception as exc:
        raise RuntimeError(f"Failed to load whisper.cpp model '{config.model_name}': {exc}") from exc

    try:
        raw_segments = model.transcribe(
            audio,
            n_threads=config.cpu_threads,
            no_context=not config.condition_on_previous_text,
            single_segment=True,
            print_progress=False,
            print_realtime=False,
            language=config.language or "",
        )
    except Exception as exc:
        raise RuntimeError(f"whisper.cpp transcription failed: {exc}") from exc

    segments: list[TranscriptionSegment] = []
    text_parts: list[str] = []
    language = ""

    for seg in raw_segments:
        text = seg.text.strip()
        if not text or text in {"[BLANK_AUDIO]", "[MUSIC]", "[NOISE]"}:
            continue
        # pywhispercpp segment t0/t1 are 10ms ticks -> seconds
        segments.append(TranscriptionSegment(text=text, start=seg.t0 * 0.01, end=seg.t1 * 0.01))
        text_parts.append(text)

    return TranscriptionResult(
        text=" ".join(text_parts),
        language=language or (config.language or ""),
        segments=tuple(segments),
    )


def _transcribe_fw(
    audio: np.ndarray,
    sr: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe via faster-whisper. Falls back to CPU if CUDA fails."""
    try:
        model = _get_fw_model(config)
    except Exception as exc:
        raise RuntimeError(f"Failed to load faster-whisper model '{config.model_name}': {exc}") from exc

    try:
        raw_segments, info = model.transcribe(
            audio,
            beam_size=config.beam_size,
            language=config.language,
            condition_on_previous_text=config.condition_on_previous_text,
        )
    except Exception as exc:
        err = str(exc)
        # CUDA library missing — retry with CPU
        if "libcublas" in err or "cublas" in err.lower():
            import os
            os.environ["CT2_FORCE_CPU"] = "1"
            # Recreate model on CPU, bypassing cache
            from faster_whisper import WhisperModel
            fallback = WhisperModel(
                config.model_name,
                device="cpu",
                compute_type="int8",
                cpu_threads=config.cpu_threads,
            )
            raw_segments, info = fallback.transcribe(
                audio,
                beam_size=config.beam_size,
                language=config.language,
                condition_on_previous_text=config.condition_on_previous_text,
            )
        else:
            raise RuntimeError(f"faster-whisper transcription failed: {exc}") from exc

    segments: list[TranscriptionSegment] = []
    text_parts: list[str] = []

    for seg in raw_segments:
        text = seg.text.strip()
        segments.append(TranscriptionSegment(text=text, start=seg.start, end=seg.end))
        text_parts.append(text)

    return TranscriptionResult(
        text=" ".join(text_parts),
        language=info.language if info else "",
        segments=tuple(segments),
    )
