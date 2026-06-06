"""Shared immutable types used across modules."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class AudioSegment:
    """A chunk of recorded audio with metadata."""
    data: np.ndarray
    sample_rate: int
    start_time: float
    end_time: float

    @property
    def duration_sec(self) -> float:
        return self.end_time - self.start_time


@dataclass(frozen=True)
class TranscriptionResult:
    """Output from the transcription engine."""
    text: str
    language: str
    segments: tuple["TranscriptionSegment", ...] = ()

    @property
    def is_empty(self) -> bool:
        return len(self.text.strip()) == 0


@dataclass(frozen=True)
class TranscriptionSegment:
    """A single transcribed segment with timing."""
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class ProcessedUtterance:
    """The complete pipeline result for one utterance."""
    raw_text: str
    processed_text: str
    language: str
    duration_sec: float
    llm_mode_used: str
    clipboard_succeeded: bool = False
