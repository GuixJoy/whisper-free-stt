# STT UI — Tauri Desktop Application

A Tauri v2 + React + TypeScript desktop application for local speech-to-text.
Competing with Wispr Flow — every button, every feature must work.

## Features

- **Onboarding wizard**: First-run setup with system checks, microphone selection, model download
- **Main panel**: Real-time status, start/stop, mic level meter, transcript feed
- **History sidebar**: Browse past transcripts with search and copy
- **Settings panel**: LLM provider, API keys, ASR backend/profile selection, hotkey config
- **Insights page**: Usage stats, heatmap, weekly words, streak tracking
- **Voice Intelligence**: Live transcript analysis with mode-specific insights
- **Floating widget**: Compact always-on-top mic toggle
- **System tray**: Start/Stop listening from tray, minimize to tray on close
- **Keyboard shortcuts**: Configurable global hotkey (default Ctrl+Shift+Space)

## Architecture

```
application/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Commands (59+), system tray, window management, SQLite
│   │   ├── tests.rs     # 59 integration tests (serialization, DB, IPC, insights)
│   │   └── main.rs      # Entry point (thin passthrough)
│   ├── capabilities/    # Permission definitions
│   ├── binaries/        # PyInstaller sidecar binary (stt-engine)
│   └── Cargo.toml       # Rust dependencies (tauri, rusqlite, serde, csv)
├── src/                 # React frontend
│   ├── App.tsx          # Main app (state, hotkey, engine lifecycle, PTT)
│   ├── App.css          # Doodle design system
│   ├── api.ts           # STT API interface (event types)
│   ├── api-tauri.ts     # Tauri sidecar communication (stdout JSON parsing)
│   ├── api-ws.ts        # WebSocket dev mode
│   ├── store.ts         # State management (React Context + useReducer)
│   └── components/
│       ├── SettingsPanel.tsx     # Hotkey, LLM, ASR settings
│       ├── InsightsPage.tsx     # Usage stats, heatmap, weekly words
│       ├── HistoryPage.tsx      # Transcript search, export, bulk ops
│       ├── VoiceIntelligence.tsx # Live transcript display
│       └── ...
├── scripts/
│   ├── build-sidecar.sh # PyInstaller build (165MB binary)
│   └── e2e-test.sh      # Playwright + tauri-driver E2E
└── package.json         # Frontend dependencies
```

### Sidecar Communication

The backend runs as a Tauri sidecar (Python process). Communication:

- **Backend → Frontend**: stdout JSON lines (`_json_emit` in `orchestrator.py`)
- **Frontend → Backend**: CLI args on spawn (`--json-mode`, `--asr-profile`, etc.)
- **Events**: `state`, `raw`, `processed`, `error`, `dropped`, `llm_partial`, `mic`
- **Debug**: stderr lines (`_echo`) → logged as `console.warn` by frontend

### Default Settings

- `asrProfile: "auto"` — backend detects CUDA/VRAM and picks best model
- `backend: "auto"` — auto-selects whisper_cpp (CPU) or faster_whisper (GPU)
- `typing: true` + `clipboard: true` — both active in all modes
- `hotkey: "CommandOrControl+Shift+Space"` — global push-to-talk
- `llmMode: "cleanup"` — grammar/spelling cleanup
- `llmProvider: "openrouter"` — default LLM provider

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (frontend + Tauri)
pnpm tauri dev

# Build for production
pnpm tauri build

# Run tests
npx vitest run                    # TypeScript tests (67)
cd src-tauri && cargo test -- --test-threads=1  # Rust tests (59)
```

## Building the Sidecar

The Python backend is compiled to a standalone binary via PyInstaller:

```bash
cd scripts && bash build-sidecar.sh
# Output: src-tauri/binaries/stt-engine-{target_triple} (165MB)
```

Includes: scipy (for noisereduce), all ASR backends, LLM clients.
Excludes: unused transitive deps for size reduction.

## System Tray

The app includes a system tray with:
- **Show Window**: Bring window to front
- **Start Listening**: Start STT engine
- **Stop Listening**: Stop STT engine
- **Toggle Widget**: Show/hide floating widget
- **Quit**: Exit application

Left-click on tray icon shows the window. Close button minimizes to tray.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Shift+Space` | Global push-to-talk (configurable) |
| `Escape` | Close modals |

## Permissions

The app requires these Tauri permissions:
- `core:default` — Window management
- `shell:allow-execute` — Sidecar execution
- `notification:default` — System notifications
- `store:default` — Key-value persistence
- `global-shortcut:default` — Hotkey registration
- `clipboard-manager:default` — Clipboard access
- `updater:default` — Auto-updates from GitHub releases

## Tech Stack

- **Backend**: Tauri v2, Rust, SQLite (via rusqlite)
- **Frontend**: React 18, TypeScript, Vite
- **Styling**: CSS (Doodle design system)
- **Animation**: Framer Motion
- **State**: React hooks + localStorage + Context/Reducer
- **ASR**: whisper.cpp (CPU) + faster-whisper (GPU) via Python sidecar
- **LLM**: DeepSeek, OpenRouter, Ollama (streaming SSE)
- **Audio**: sounddevice (Python), WebAudio API (browser fallback)
- **IPC**: Tauri commands + stdout JSON sidecar protocol
