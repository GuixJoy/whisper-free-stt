"""UI models for state, settings, history, and shortcuts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


SHORTCUT_ACTIONS: tuple[str, ...] = (
    "toggle_listening",
    "push_to_talk",
    "copy_transcript",
    "clear_transcript",
    "show_hide_window",
    "toggle_compact_mode",
)


SHORTCUT_LABELS: dict[str, str] = {
    "toggle_listening": "Toggle listening",
    "push_to_talk": "Push to talk",
    "copy_transcript": "Copy transcript",
    "clear_transcript": "Clear transcript",
    "show_hide_window": "Show/hide window",
    "toggle_compact_mode": "Toggle compact mode",
}


DEFAULT_SHORTCUTS: dict[str, str] = {
    "toggle_listening": "<Control-space>",
    "push_to_talk": "<Alt-space>",
    "copy_transcript": "<Control-Shift-c>",
    "clear_transcript": "<Control-Shift-x>",
    "show_hide_window": "<Control-Shift-h>",
    "toggle_compact_mode": "<Control-Shift-m>",
}


@dataclass(frozen=True)
class TranscriptEntry:
    id: str
    created_at: str
    raw: str
    cleaned: str
    favorite: bool = False
    tags: tuple[str, ...] = ()

    @property
    def snippet(self) -> str:
        text = (self.cleaned or self.raw).strip()
        return text[:120] + ("…" if len(text) > 120 else "")


@dataclass(frozen=True)
class UISettings:
    input_device_index: int | None = None
    asr_backend: str = "auto"
    whisper_model: str = ""
    llm_enabled: bool = True
    llm_mode: str = "cleanup"
    clipboard_auto_copy: bool = False
    push_to_talk_mode: bool = False
    auto_transcribe_mode: bool = True
    show_raw_default: bool = False
    theme: str = "paper_ink"
    launch_on_startup: bool = False
    shortcut_scope_preference: str = "global_preferred"
    shortcuts: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_SHORTCUTS))

