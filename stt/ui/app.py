"""Cross-platform desktop UI for STT (Tkinter implementation)."""

from __future__ import annotations

import argparse
import queue
import threading
import tkinter as tk
import uuid
from dataclasses import replace
from tkinter import ttk

from stt.audio_capture import list_microphones
from stt.cli import _ensure_cuda_libs, build_arg_parser, build_config, load_dotenv
from stt.config import LLMMode, TranscriptionBackend
from stt.llm import rewrite
from stt.ui.backend import BackendEvent, BackendRunner
from stt.ui.models import (
    DEFAULT_SHORTCUTS,
    SHORTCUT_ACTIONS,
    SHORTCUT_LABELS,
    TranscriptEntry,
    UISettings,
    utc_now_iso,
)
from stt.ui.platform import capability_rows, detect_capabilities
from stt.ui.settings_store import load_history, load_settings, save_history, save_settings
from stt.ui.shortcuts import ShortcutManager, detect_conflicts, scope_for_action


class STTDesktopApp:
    _POLL_INTERVAL_MS = 40
    _MIC_LEVEL_SCALE = 30.0

    def __init__(self, root: tk.Tk, args: argparse.Namespace):
        self.root = root
        self.args = args
        self.capabilities = detect_capabilities()
        self.base_config = build_config(args)
        self.settings = load_settings()
        self.show_raw = tk.BooleanVar(value=self.settings.show_raw_default)
        self.status_var = tk.StringVar(value="Idle")
        self.activity_var = tk.StringVar(value="Ready")
        self.mic_level_var = tk.DoubleVar(value=0.0)
        self.armed = tk.BooleanVar(value=True)
        self.compact_on_top = tk.BooleanVar(value=False)
        self.shortcut_hint_var = tk.StringVar(value="")
        self.backend = BackendRunner()
        self.shortcut_manager = ShortcutManager(root)
        self.transcripts: list[TranscriptEntry] = load_history()
        self.filtered_transcripts: list[TranscriptEntry] = list(self.transcripts)
        self.compact_window: tk.Toplevel | None = None
        self.compact_status_var = tk.StringVar(value="Idle")
        self.compact_text_var = tk.StringVar(value="No transcript yet.")
        self.history_search_var = tk.StringVar(value="")
        self.shortcut_conflict_var = tk.StringVar(value="")
        self.shortcut_entries: dict[str, tk.Entry] = {}
        self.scope_labels: dict[str, tk.StringVar] = {}
        self.device_choice = tk.StringVar(value="")
        self.backend_choice = tk.StringVar(value=self.settings.asr_backend)
        self.model_choice = tk.StringVar(value=self.settings.whisper_model)
        self.llm_enabled_var = tk.BooleanVar(value=self.settings.llm_enabled)
        self.llm_mode_var = tk.StringVar(value=self.settings.llm_mode)
        self.clipboard_var = tk.BooleanVar(value=self.settings.clipboard_auto_copy)
        self.ptt_mode_var = tk.BooleanVar(value=self.settings.push_to_talk_mode)
        self.auto_transcribe_var = tk.BooleanVar(value=self.settings.auto_transcribe_mode)
        self.theme_var = tk.StringVar(value=self.settings.theme)
        self.launch_startup_var = tk.BooleanVar(value=self.settings.launch_on_startup)
        self.shortcut_scope_pref_var = tk.StringVar(value=self.settings.shortcut_scope_preference)
        self._build_ui()
        self._load_devices()
        self._refresh_transcript_view()
        self._refresh_history_list()
        self._bind_shortcuts()
        self.root.after(self._POLL_INTERVAL_MS, self._drain_events)

    def _build_ui(self) -> None:
        self.root.title("STT Sketch")
        self.root.geometry("1080x760")
        self.root.minsize(900, 620)
        bg = "#f9f4e8"
        ink = "#2b2623"
        accent = "#2f9e8f"
        card = "#fffdf6"
        self._ink = ink
        self._card_bg = card
        self.root.configure(bg=bg)

        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Sketch.TFrame", background=bg)
        style.configure("Card.TFrame", background=card, borderwidth=2, relief="groove")
        style.configure("Sketch.TLabel", background=bg, foreground=ink, font=("TkDefaultFont", 10))
        style.configure("CardLabel.TLabel", background=card, foreground=ink, font=("TkDefaultFont", 10))
        style.configure("Status.TLabel", background=card, foreground=ink, font=("TkDefaultFont", 24, "bold"))
        style.configure("Sketch.TButton", padding=8)
        style.configure("Sketch.Horizontal.TProgressbar", troughcolor="#efe7d6", background=accent, bordercolor=ink)

        outer = ttk.Frame(self.root, style="Sketch.TFrame", padding=14)
        outer.pack(fill="both", expand=True)
        top = ttk.Frame(outer, style="Card.TFrame", padding=12)
        top.pack(fill="x")
        self._build_status_header(top)

        notebook = ttk.Notebook(outer)
        notebook.pack(fill="both", expand=True, pady=(12, 0))

        main_tab = ttk.Frame(notebook, style="Card.TFrame", padding=12)
        history_tab = ttk.Frame(notebook, style="Card.TFrame", padding=12)
        settings_tab = ttk.Frame(notebook, style="Card.TFrame", padding=12)
        shortcuts_tab = ttk.Frame(notebook, style="Card.TFrame", padding=12)
        notebook.add(main_tab, text="Main")
        notebook.add(history_tab, text="History")
        notebook.add(settings_tab, text="Settings")
        notebook.add(shortcuts_tab, text="Shortcuts")

        self._build_main_tab(main_tab)
        self._build_history_tab(history_tab)
        self._build_settings_tab(settings_tab)
        self._build_shortcuts_tab(shortcuts_tab)

    def _build_status_header(self, parent: ttk.Frame) -> None:
        ttk.Label(parent, text="Status", style="CardLabel.TLabel").pack(anchor="w")
        ttk.Label(parent, textvariable=self.status_var, style="Status.TLabel").pack(anchor="w", pady=(2, 6))
        ttk.Progressbar(
            parent,
            maximum=1.0,
            variable=self.mic_level_var,
            style="Sketch.Horizontal.TProgressbar",
            length=320,
        ).pack(anchor="w")
        ttk.Label(parent, textvariable=self.activity_var, style="CardLabel.TLabel").pack(anchor="w", pady=(8, 2))

    def _build_main_tab(self, parent: ttk.Frame) -> None:
        controls = ttk.Frame(parent, style="Card.TFrame")
        controls.pack(fill="x")
        self.start_btn = ttk.Button(controls, text="Start", command=self.toggle_listening, style="Sketch.TButton")
        self.start_btn.pack(side="left", padx=(0, 8))
        self.ptt_btn = ttk.Button(controls, text="Push to Talk", style="Sketch.TButton")
        self.ptt_btn.pack(side="left", padx=(0, 8))
        self.ptt_btn.bind("<ButtonPress-1>", lambda _e: self._ptt_press())
        self.ptt_btn.bind("<ButtonRelease-1>", lambda _e: self._ptt_release())
        ttk.Checkbutton(controls, text="Armed", variable=self.armed, command=self._sync_armed).pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Copy transcript", command=self.copy_latest, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Clear transcript", command=self.clear_transcripts, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Toggle compact mode", command=self.toggle_compact_mode, style="Sketch.TButton").pack(side="left")

        prefs = ttk.Frame(parent, style="Card.TFrame")
        prefs.pack(fill="x", pady=(10, 8))
        ttk.Checkbutton(
            prefs,
            text="Show raw transcript",
            variable=self.show_raw,
            command=self._refresh_transcript_view,
        ).pack(side="left", padx=(0, 10))
        ttk.Checkbutton(
            prefs,
            text="Compact always-on-top",
            variable=self.compact_on_top,
            command=self._apply_compact_on_top,
        ).pack(side="left", padx=(0, 10))
        ttk.Label(prefs, textvariable=self.shortcut_hint_var, style="CardLabel.TLabel").pack(side="left")

        self.transcript_text = tk.Text(
            parent,
            wrap="word",
            height=16,
            bg=self._card_bg,
            fg=self._ink,
            bd=0,
            highlightthickness=0,
            font=("TkDefaultFont", 11),
            padx=8,
            pady=8,
        )
        self.transcript_text.pack(fill="both", expand=True, pady=(6, 0))
        self.transcript_text.configure(state="disabled")

        ttk.Label(parent, text="Activity log", style="CardLabel.TLabel").pack(anchor="w", pady=(8, 2))
        self.activity_text = tk.Text(
            parent,
            wrap="word",
            height=6,
            bg=self._card_bg,
            fg=self._ink,
            bd=0,
            highlightthickness=0,
            font=("TkDefaultFont", 9),
            padx=8,
            pady=6,
        )
        self.activity_text.pack(fill="x")
        self.activity_text.configure(state="disabled")

    def _build_history_tab(self, parent: ttk.Frame) -> None:
        top = ttk.Frame(parent, style="Card.TFrame")
        top.pack(fill="x")
        ttk.Label(top, text="Search", style="CardLabel.TLabel").pack(side="left", padx=(0, 6))
        entry = ttk.Entry(top, textvariable=self.history_search_var, width=48)
        entry.pack(side="left")
        entry.bind("<KeyRelease>", lambda _e: self._refresh_history_list())
        ttk.Button(top, text="Clear", command=lambda: self._clear_history_search(), style="Sketch.TButton").pack(side="left", padx=(8, 0))

        list_frame = ttk.Frame(parent, style="Card.TFrame")
        list_frame.pack(fill="both", expand=True, pady=(10, 8))
        self.history_list = tk.Listbox(list_frame, height=14)
        self.history_list.pack(fill="both", expand=True)

        actions = ttk.Frame(parent, style="Card.TFrame")
        actions.pack(fill="x")
        ttk.Button(actions, text="Re-copy", command=self.history_recopy_selected, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="Re-run cleanup", command=self.history_rerun_cleanup_selected, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="Favorite/Unfavorite", command=self.history_toggle_favorite_selected, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="Delete", command=self.history_delete_selected, style="Sketch.TButton").pack(side="left")

    def _build_settings_tab(self, parent: ttk.Frame) -> None:
        form = ttk.Frame(parent, style="Card.TFrame")
        form.pack(fill="x")
        self._grid_label(form, "Input device", 0)
        self.device_combo = ttk.Combobox(form, textvariable=self.device_choice, width=46, state="readonly")
        self.device_combo.grid(row=0, column=1, sticky="w", pady=2, padx=6)

        self._grid_label(form, "ASR backend", 1)
        ttk.Combobox(form, textvariable=self.backend_choice, values=["auto", "whisper_cpp", "faster_whisper"], width=18, state="readonly").grid(row=1, column=1, sticky="w", pady=2, padx=6)

        self._grid_label(form, "Whisper model", 2)
        ttk.Entry(form, textvariable=self.model_choice, width=32).grid(row=2, column=1, sticky="w", pady=2, padx=6)

        self._grid_label(form, "LLM mode", 3)
        ttk.Combobox(
            form,
            textvariable=self.llm_mode_var,
            values=[LLMMode.CLEANUP.value, LLMMode.BULLET_LIST.value, LLMMode.EMAIL.value, LLMMode.COMMIT_MESSAGE.value, LLMMode.OFF.value],
            width=20,
            state="readonly",
        ).grid(row=3, column=1, sticky="w", pady=2, padx=6)

        self._grid_label(form, "Theme", 4)
        ttk.Combobox(form, textvariable=self.theme_var, values=["paper_ink"], width=20, state="readonly").grid(row=4, column=1, sticky="w", pady=2, padx=6)

        flags = ttk.Frame(parent, style="Card.TFrame")
        flags.pack(fill="x", pady=(10, 8))
        ttk.Checkbutton(flags, text="LLM enabled", variable=self.llm_enabled_var).pack(anchor="w")
        ttk.Checkbutton(flags, text="Clipboard auto-copy", variable=self.clipboard_var).pack(anchor="w")
        ttk.Checkbutton(flags, text="Push-to-talk mode", variable=self.ptt_mode_var).pack(anchor="w")
        ttk.Checkbutton(flags, text="Auto-transcribe mode", variable=self.auto_transcribe_var).pack(anchor="w")
        # Placeholder only: platform-specific auto-start registration is deferred.
        ttk.Checkbutton(flags, text="Launch on startup", variable=self.launch_startup_var, state="disabled").pack(anchor="w")
        ttk.Label(flags, text="(Platform startup registration is not implemented yet.)", style="CardLabel.TLabel").pack(anchor="w")

        ttk.Label(parent, text=f"Platform: {self.capabilities.platform_label}", style="CardLabel.TLabel").pack(anchor="w", pady=(8, 4))
        matrix = ttk.Frame(parent, style="Card.TFrame")
        matrix.pack(fill="x")
        for idx, (cap, status) in enumerate(capability_rows(self.capabilities)):
            ttk.Label(matrix, text=cap, style="CardLabel.TLabel").grid(row=idx, column=0, sticky="w", padx=(0, 10), pady=1)
            ttk.Label(matrix, text=status, style="CardLabel.TLabel").grid(row=idx, column=1, sticky="w", pady=1)
        for note in self.capabilities.notes:
            ttk.Label(parent, text=f"• {note}", style="CardLabel.TLabel").pack(anchor="w")

        ttk.Button(parent, text="Save settings", command=self.save_settings, style="Sketch.TButton").pack(anchor="w", pady=(10, 0))

    def _build_shortcuts_tab(self, parent: ttk.Frame) -> None:
        ttk.Label(parent, text="Remap shortcuts (Tk-style key sequence):", style="CardLabel.TLabel").pack(anchor="w")
        grid = ttk.Frame(parent, style="Card.TFrame")
        grid.pack(fill="x", pady=(8, 8))

        ttk.Label(grid, text="Action", style="CardLabel.TLabel").grid(row=0, column=0, sticky="w", padx=4)
        ttk.Label(grid, text="Binding", style="CardLabel.TLabel").grid(row=0, column=1, sticky="w", padx=4)
        ttk.Label(grid, text="Scope", style="CardLabel.TLabel").grid(row=0, column=2, sticky="w", padx=4)

        for row, action in enumerate(SHORTCUT_ACTIONS, start=1):
            ttk.Label(grid, text=SHORTCUT_LABELS[action], style="CardLabel.TLabel").grid(row=row, column=0, sticky="w", padx=4, pady=2)
            entry = ttk.Entry(grid, width=22)
            entry.insert(0, self.settings.shortcuts.get(action, DEFAULT_SHORTCUTS[action]))
            entry.grid(row=row, column=1, sticky="w", padx=4, pady=2)
            self.shortcut_entries[action] = entry
            scope_var = tk.StringVar(
                value=scope_for_action(action, self.capabilities, self.shortcut_scope_pref_var.get())
            )
            self.scope_labels[action] = scope_var
            ttk.Label(grid, textvariable=scope_var, style="CardLabel.TLabel").grid(row=row, column=2, sticky="w", padx=4, pady=2)

        pref_row = ttk.Frame(parent, style="Card.TFrame")
        pref_row.pack(fill="x", pady=(4, 6))
        ttk.Label(pref_row, text="Shortcut scope preference", style="CardLabel.TLabel").pack(side="left", padx=(0, 6))
        ttk.Combobox(
            pref_row,
            textvariable=self.shortcut_scope_pref_var,
            values=["global_preferred", "focused_only"],
            width=20,
            state="readonly",
        ).pack(side="left")

        ttk.Label(parent, textvariable=self.shortcut_conflict_var, style="CardLabel.TLabel").pack(anchor="w", pady=(2, 8))
        actions = ttk.Frame(parent, style="Card.TFrame")
        actions.pack(fill="x")
        ttk.Button(actions, text="Apply shortcuts", command=self.apply_shortcuts_from_editor, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="Reset defaults", command=self.reset_shortcuts_defaults, style="Sketch.TButton").pack(side="left")

    def _grid_label(self, parent: ttk.Frame, text: str, row: int) -> None:
        ttk.Label(parent, text=text, style="CardLabel.TLabel").grid(row=row, column=0, sticky="w", pady=2)

    def _load_devices(self) -> None:
        try:
            devices = list_microphones()
        except Exception as exc:
            devices = []
            self._append_activity(f"Microphone enumeration failed: {exc}")
        options = ["Auto default"]
        for dev in devices:
            options.append(f"{dev['index']}: {dev['name']}")
        self.device_combo["values"] = options
        if self.settings.input_device_index is None:
            self.device_choice.set("Auto default")
        else:
            for option in options:
                if option.startswith(f"{self.settings.input_device_index}:"):
                    self.device_choice.set(option)
                    break
            if not self.device_choice.get():
                self.device_choice.set("Auto default")

    def _append_activity(self, line: str) -> None:
        self.activity_var.set(line)
        self.activity_text.configure(state="normal")
        self.activity_text.insert("end", f"{line}\n")
        self.activity_text.see("end")
        self.activity_text.configure(state="disabled")

    def _sync_armed(self) -> None:
        if not self.armed.get():
            self.stop_listening()
            self._append_activity("Sleeping (disarmed)")
        else:
            self._append_activity("Armed")

    def _ptt_press(self) -> None:
        if not self.ptt_mode_var.get():
            self.toggle_listening()
            return
        if not self.backend.is_running() and self.armed.get():
            self.start_listening()

    def _ptt_release(self) -> None:
        if self.ptt_mode_var.get() and self.backend.is_running():
            self.stop_listening()

    def _build_runtime_config(self):
        config = self.base_config
        llm_mode = LLMMode(self.llm_mode_var.get()) if self.llm_enabled_var.get() else LLMMode.OFF
        llm_cfg = replace(config.llm, mode=llm_mode)
        clip_cfg = replace(config.clipboard, enabled=self.clipboard_var.get())
        tcfg = config.transcription
        if self.backend_choice.get() in {"whisper_cpp", "faster_whisper"}:
            backend_map = {
                "whisper_cpp": TranscriptionBackend.WHISPER_CPP,
                "faster_whisper": TranscriptionBackend.FASTER_WHISPER,
            }
            tcfg = replace(tcfg, backend=backend_map[self.backend_choice.get()])
        if self.model_choice.get().strip():
            tcfg = replace(tcfg, model_name=self.model_choice.get().strip())
        acfg = config.audio
        if self.device_choice.get() and self.device_choice.get() != "Auto default":
            idx = int(self.device_choice.get().split(":", 1)[0])
            acfg = replace(acfg, device_index=idx)
        else:
            acfg = replace(acfg, device_index=None)
        return replace(config, audio=acfg, transcription=tcfg, llm=llm_cfg, clipboard=clip_cfg)

    def toggle_listening(self) -> None:
        if self.backend.is_running():
            self.stop_listening()
        else:
            self.start_listening()

    def start_listening(self) -> None:
        if not self.armed.get():
            self._append_activity("Cannot start while disarmed")
            return
        started = self.backend.start(self._build_runtime_config())
        if started:
            self._set_state("Listening")
            self._append_activity("Listening")
        else:
            self._append_activity("Already listening")

    def stop_listening(self) -> None:
        self.backend.stop()
        self._set_state("Idle")

    def _set_state(self, state: str) -> None:
        self.status_var.set(state)
        self.compact_status_var.set(state)
        self.start_btn.configure(text="Stop" if state == "Listening" else "Start")

    def _record_transcript(self, raw: str, cleaned: str) -> None:
        entry = TranscriptEntry(
            id=str(uuid.uuid4()),
            created_at=utc_now_iso(),
            raw=raw,
            cleaned=cleaned,
        )
        self.transcripts.append(entry)
        save_history(self.transcripts)
        self._refresh_transcript_view()
        self._refresh_history_list()
        self.compact_text_var.set(entry.snippet)

    def _update_latest_cleaned(self, cleaned: str) -> None:
        if not self.transcripts:
            self._record_transcript(raw=cleaned, cleaned=cleaned)
            return
        last = self.transcripts[-1]
        self.transcripts[-1] = TranscriptEntry(
            id=last.id,
            created_at=last.created_at,
            raw=last.raw,
            cleaned=cleaned,
            favorite=last.favorite,
            tags=last.tags,
        )
        save_history(self.transcripts)
        self._refresh_transcript_view()
        self._refresh_history_list()
        self.compact_text_var.set(self.transcripts[-1].snippet)

    def _refresh_transcript_view(self) -> None:
        lines: list[str] = []
        for item in self.transcripts:
            text = item.raw if self.show_raw.get() else (item.cleaned or item.raw)
            if text:
                lines.append(text)
        self.transcript_text.configure(state="normal")
        self.transcript_text.delete("1.0", "end")
        if lines:
            self.transcript_text.insert("1.0", "\n\n".join(lines))
        else:
            self.transcript_text.insert("1.0", "No transcript yet. Press Start and speak.")
        self.transcript_text.configure(state="disabled")

    def _latest_display_text(self) -> str:
        if not self.transcripts:
            return ""
        last = self.transcripts[-1]
        return last.raw if self.show_raw.get() else (last.cleaned or last.raw)

    def copy_latest(self) -> None:
        text = self._latest_display_text()
        if not text:
            self._append_activity("Nothing to copy")
            return
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
            self.root.update_idletasks()
            self._set_state("Copied")
            self._append_activity("Transcript copied")
            self.root.after(900, lambda: self._set_state("Idle"))
        except Exception as exc:
            self._set_state("Error")
            self._append_activity(f"Clipboard failed: {exc}")

    def clear_transcripts(self) -> None:
        self.transcripts.clear()
        save_history(self.transcripts)
        self._refresh_transcript_view()
        self._refresh_history_list()
        self.compact_text_var.set("No transcript yet.")
        self._append_activity("Transcript cleared")

    def toggle_window_visibility(self) -> None:
        if self.root.state() == "withdrawn":
            self.root.deiconify()
            self.root.lift()
            self._append_activity("Main window shown")
        else:
            self.root.withdraw()
            self._append_activity("Main window hidden")

    def toggle_compact_mode(self) -> None:
        if self.compact_window and self.compact_window.winfo_exists():
            self.compact_window.destroy()
            self.compact_window = None
            self._append_activity("Compact mode disabled")
            return
        self.compact_window = tk.Toplevel(self.root)
        self.compact_window.title("STT Mini")
        self.compact_window.geometry("360x180")
        self.compact_window.resizable(False, False)
        frame = ttk.Frame(self.compact_window, style="Card.TFrame", padding=10)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, textvariable=self.compact_status_var, style="CardLabel.TLabel").pack(anchor="w")
        ttk.Button(frame, text="Mic", command=self.toggle_listening, style="Sketch.TButton").pack(anchor="w", pady=(6, 6))
        ttk.Label(frame, textvariable=self.compact_text_var, style="CardLabel.TLabel", wraplength=320).pack(anchor="w")
        self._apply_compact_on_top()
        self._append_activity("Compact mode enabled")

    def _apply_compact_on_top(self) -> None:
        if self.compact_window and self.compact_window.winfo_exists():
            self.compact_window.attributes("-topmost", bool(self.compact_on_top.get()))

    def _drain_events(self) -> None:
        while True:
            try:
                event: BackendEvent = self.backend.events.get_nowait()
            except queue.Empty:
                break
            self._handle_event(event)
        if not self.backend.is_running() and self.status_var.get() == "Listening":
            self._set_state("Idle")
            self._append_activity("Stopped")
        self.root.after(self._POLL_INTERVAL_MS, self._drain_events)

    def _handle_event(self, event: BackendEvent) -> None:
        if event.kind == "state":
            mapping = {
                "idle": "Idle",
                "listening": "Listening",
                "transcribing": "Transcribing",
                "rewriting": "Rewriting",
                "copied": "Copied",
                "error": "Error",
            }
            self._set_state(mapping.get(str(event.payload), "Idle"))
        elif event.kind == "activity":
            self._append_activity(str(event.payload))
        elif event.kind == "partial":
            self._append_activity(f"Partial: {event.payload}")
        elif event.kind == "raw":
            self._record_transcript(raw=str(event.payload), cleaned="")
        elif event.kind == "processed":
            self._update_latest_cleaned(str(event.payload))
        elif event.kind == "mic":
            rms = float(event.payload)
            self.mic_level_var.set(max(0.0, min(1.0, rms * self._MIC_LEVEL_SCALE)))
        elif event.kind == "error":
            self._set_state("Error")
            self._append_activity(str(event.payload))

    def _clear_history_search(self) -> None:
        self.history_search_var.set("")
        self._refresh_history_list()

    def _refresh_history_list(self) -> None:
        needle = self.history_search_var.get().strip().lower()
        self.filtered_transcripts = []
        for item in self.transcripts:
            hay = f"{item.raw}\n{item.cleaned}\n{' '.join(item.tags)}".lower()
            if needle and needle not in hay:
                continue
            self.filtered_transcripts.append(item)

        self.history_list.delete(0, "end")
        for item in self.filtered_transcripts:
            fav = "★ " if item.favorite else ""
            self.history_list.insert("end", f"{fav}{item.created_at[:19]}  {item.snippet}")

    def _selected_history_entry(self) -> TranscriptEntry | None:
        selection = self.history_list.curselection()
        if not selection:
            return None
        idx = int(selection[0])
        if idx < 0 or idx >= len(self.filtered_transcripts):
            return None
        return self.filtered_transcripts[idx]

    def history_recopy_selected(self) -> None:
        item = self._selected_history_entry()
        if not item:
            self._append_activity("No history entry selected")
            return
        text = item.cleaned or item.raw
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
            self.root.update_idletasks()
            self._append_activity("History entry copied")
        except Exception as exc:
            self._append_activity(f"Clipboard failed: {exc}")

    def history_rerun_cleanup_selected(self) -> None:
        item = self._selected_history_entry()
        if not item:
            self._append_activity("No history entry selected")
            return
        if not self.llm_enabled_var.get():
            self._append_activity("Enable LLM first to re-run cleanup")
            return

        # Capture Tkinter values on the main thread before spawning worker
        runtime_llm = self._build_runtime_config().llm
        rewrite_mode = LLMMode(self.llm_mode_var.get())

        def _worker() -> None:
            try:
                updated = rewrite(item.raw, replace(runtime_llm, mode=rewrite_mode))
                self.root.after(0, lambda: self._apply_rerun_cleanup(item.id, updated))
            except Exception as exc:
                self.root.after(0, lambda: self._append_activity(f"Cleanup failed: {exc}"))

        threading.Thread(target=_worker, daemon=True).start()
        self._append_activity("Re-running cleanup...")

    def _apply_rerun_cleanup(self, entry_id: str, cleaned: str) -> None:
        updated: list[TranscriptEntry] = []
        for item in self.transcripts:
            if item.id == entry_id:
                updated.append(
                    TranscriptEntry(
                        id=item.id,
                        created_at=item.created_at,
                        raw=item.raw,
                        cleaned=cleaned,
                        favorite=item.favorite,
                        tags=item.tags,
                    )
                )
            else:
                updated.append(item)
        self.transcripts = updated
        save_history(self.transcripts)
        self._refresh_transcript_view()
        self._refresh_history_list()
        self._append_activity("Cleanup updated")

    def history_toggle_favorite_selected(self) -> None:
        item = self._selected_history_entry()
        if not item:
            self._append_activity("No history entry selected")
            return
        updated: list[TranscriptEntry] = []
        for row in self.transcripts:
            if row.id == item.id:
                updated.append(
                    TranscriptEntry(
                        id=row.id,
                        created_at=row.created_at,
                        raw=row.raw,
                        cleaned=row.cleaned,
                        favorite=not row.favorite,
                        tags=row.tags,
                    )
                )
            else:
                updated.append(row)
        self.transcripts = updated
        save_history(self.transcripts)
        self._refresh_history_list()
        self._append_activity("Favorite toggled")

    def history_delete_selected(self) -> None:
        item = self._selected_history_entry()
        if not item:
            self._append_activity("No history entry selected")
            return
        self.transcripts = [row for row in self.transcripts if row.id != item.id]
        save_history(self.transcripts)
        self._refresh_history_list()
        self._refresh_transcript_view()
        self._append_activity("History entry deleted")

    def save_settings(self) -> None:
        device_index: int | None = None
        chosen = self.device_choice.get().strip()
        if chosen and chosen != "Auto default":
            try:
                device_index = int(chosen.split(":", 1)[0])
            except Exception as exc:
                device_index = None
                self._append_activity(f"Invalid device selection '{chosen}': {exc}")
        self.settings = UISettings(
            input_device_index=device_index,
            asr_backend=self.backend_choice.get().strip() or "auto",
            whisper_model=self.model_choice.get().strip(),
            llm_enabled=self.llm_enabled_var.get(),
            llm_mode=self.llm_mode_var.get(),
            clipboard_auto_copy=self.clipboard_var.get(),
            push_to_talk_mode=self.ptt_mode_var.get(),
            auto_transcribe_mode=self.auto_transcribe_var.get(),
            show_raw_default=self.show_raw.get(),
            theme=self.theme_var.get(),
            launch_on_startup=self.launch_startup_var.get(),
            shortcut_scope_preference=self.shortcut_scope_pref_var.get(),
            shortcuts=self._current_shortcuts_from_editor(),
        )
        save_settings(self.settings)
        self._append_activity("Settings saved")
        self.apply_shortcuts_from_editor()

    def _current_shortcuts_from_editor(self) -> dict[str, str]:
        data = dict(DEFAULT_SHORTCUTS)
        for action in SHORTCUT_ACTIONS:
            data[action] = self.shortcut_entries[action].get().strip()
        return data

    def reset_shortcuts_defaults(self) -> None:
        for action in SHORTCUT_ACTIONS:
            entry = self.shortcut_entries[action]
            entry.delete(0, "end")
            entry.insert(0, DEFAULT_SHORTCUTS[action])
        self.apply_shortcuts_from_editor()

    def apply_shortcuts_from_editor(self) -> None:
        shortcuts = self._current_shortcuts_from_editor()
        conflicts = detect_conflicts(shortcuts)
        if conflicts:
            parts = [f"{seq}: {', '.join(actions)}" for seq, actions in conflicts.items()]
            self.shortcut_conflict_var.set(f"Conflicts: {' | '.join(parts)}")
        else:
            self.shortcut_conflict_var.set("No conflicts")
        self.settings = replace(
            self.settings,
            shortcuts=shortcuts,
            shortcut_scope_preference=self.shortcut_scope_pref_var.get(),
        )
        self._bind_shortcuts()
        for action in SHORTCUT_ACTIONS:
            self.scope_labels[action].set(
                scope_for_action(action, self.capabilities, self.shortcut_scope_pref_var.get())
            )

    def _bind_shortcuts(self) -> None:
        statuses = self.shortcut_manager.bind_focused(
            self.settings.shortcuts,
            {
                "toggle_listening": self.toggle_listening,
                "push_to_talk": self._ptt_press,
                "copy_transcript": self.copy_latest,
                "clear_transcript": self.clear_transcripts,
                "show_hide_window": self.toggle_window_visibility,
                "toggle_compact_mode": self.toggle_compact_mode,
            },
        )
        hints = []
        for status in statuses:
            if status.action == "toggle_listening" and status.sequence:
                hints.append(f"Start/stop {status.sequence}")
            if status.action == "copy_transcript" and status.sequence:
                hints.append(f"Copy {status.sequence}")
        self.shortcut_hint_var.set(" • ".join(hints) if hints else "No shortcuts configured")


def main(argv: list[str] | None = None) -> None:
    load_dotenv()
    _ensure_cuda_libs()
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    root = tk.Tk()
    app = STTDesktopApp(root, args)

    def _on_close() -> None:
        app.stop_listening()
        save_settings(app.settings)
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", _on_close)
    root.mainloop()
