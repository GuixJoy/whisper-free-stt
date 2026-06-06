"""Transcription via faster-whisper — CTranslate2 backend."""

from __future__ import annotations

import numpy as np
from faster_whisper import WhisperModel

from stt.config import TranscriptionConfig
from stt.types import TranscriptionResult, TranscriptionSegment

_fw_cache: dict[str, WhisperModel] = {}


def _trim_silence(audio: np.ndarray, threshold: float = 0.005) -> np.ndarray:
    """Trim trailing silence to reduce inference work."""
    if len(audio) == 0:
        return audio
    above = np.where(np.abs(audio) > threshold)[0]
    if len(above) == 0:
        return audio[:0]
    end = min(len(audio), above[-1] + int(0.2 * 16000))
    return audio[:end]


def transcribe(
    audio_data: np.ndarray,
    sample_rate: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe audio using faster-whisper. Model is cached after first load."""
    if len(audio_data) == 0:
        return TranscriptionResult(text="", language="")

    if audio_data.dtype != np.float32:
        audio_data = audio_data.astype(np.float32)
    peak = np.max(np.abs(audio_data))
    if peak > 1.0:
        audio_data = audio_data / peak
    elif peak == 0.0:
        return TranscriptionResult(text="", language="")

    audio_data = _trim_silence(audio_data)
    if len(audio_data) == 0:
        return TranscriptionResult(text="", language="")

    key = f"{config.model_name}|{config.device}|{config.compute_type.value}|{config.cpu_threads}"
    if key not in _fw_cache:
        _fw_cache[key] = WhisperModel(
            config.model_name, device=config.device,
            compute_type=config.compute_type.value, cpu_threads=config.cpu_threads,
        )
    model = _fw_cache[key]

    raw_segments, info = model.transcribe(
        audio_data, beam_size=config.beam_size, language=config.language,
    )

    segments = []
    text_parts = []
    for seg in raw_segments:
        text = seg.text.strip()
        segments.append(TranscriptionSegment(text=text, start=seg.start, end=seg.end))
        text_parts.append(text)

    return TranscriptionResult(
        text=" ".join(text_parts),
        language=info.language if info else "",
        segments=tuple(segments),
    )
