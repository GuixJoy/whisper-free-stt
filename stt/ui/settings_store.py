"""Persistence for UI settings and transcript history."""

from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict
from pathlib import Path

from stt.ui.models import TranscriptEntry, UISettings


def _config_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "stt"
    if os.environ.get("XDG_CONFIG_HOME"):
        return Path(os.environ["XDG_CONFIG_HOME"]) / "stt"
    if platform.system().lower() == "darwin":
        return Path.home() / "Library" / "Application Support" / "stt"
    return Path.home() / ".config" / "stt"


def settings_path() -> Path:
    return _config_dir() / "ui_settings.json"


def history_path() -> Path:
    return _config_dir() / "history.json"


def load_settings() -> UISettings:
    path = settings_path()
    if not path.exists():
        return UISettings()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return UISettings(
            input_device_index=data.get("input_device_index"),
            asr_backend=data.get("asr_backend", "auto"),
            whisper_model=data.get("whisper_model", ""),
            llm_enabled=bool(data.get("llm_enabled", True)),
            llm_mode=str(data.get("llm_mode", "cleanup")),
            clipboard_auto_copy=bool(data.get("clipboard_auto_copy", False)),
            push_to_talk_mode=bool(data.get("push_to_talk_mode", False)),
            auto_transcribe_mode=bool(data.get("auto_transcribe_mode", True)),
            show_raw_default=bool(data.get("show_raw_default", False)),
            theme=str(data.get("theme", "paper_ink")),
            launch_on_startup=bool(data.get("launch_on_startup", False)),
            shortcut_scope_preference=str(data.get("shortcut_scope_preference", "global_preferred")),
            shortcuts={**UISettings().shortcuts, **dict(data.get("shortcuts", {}))},
        )
    except Exception:
        return UISettings()


def save_settings(settings: UISettings) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")


def load_history() -> list[TranscriptEntry]:
    path = history_path()
    if not path.exists():
        return []
    try:
        raw_items = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    out: list[TranscriptEntry] = []
    for item in raw_items:
        try:
            out.append(
                TranscriptEntry(
                    id=str(item["id"]),
                    created_at=str(item["created_at"]),
                    raw=str(item.get("raw", "")),
                    cleaned=str(item.get("cleaned", "")),
                    favorite=bool(item.get("favorite", False)),
                    tags=tuple(item.get("tags", [])),
                )
            )
        except Exception:
            continue
    return out


def save_history(items: list[TranscriptEntry]) -> None:
    path = history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(item) for item in items]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
