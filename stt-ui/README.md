# STT UI — Tauri Desktop Application

A Tauri v2 + React + TypeScript desktop application for local speech-to-text.

## Features

- **Onboarding wizard**: First-run setup with system checks, microphone selection, model download
- **Main panel**: Real-time status, start/stop, mic level meter, transcript feed
- **History sidebar**: Browse past transcripts with search and copy
- **Settings panel**: LLM provider, API keys, ASR backend/profile selection
- **System tray**: Start/Stop listening from tray, minimize to tray on close
- **Keyboard shortcuts**: Space to start/stop, Escape to close modals

## Architecture

```
stt-ui/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Commands, system tray, window management
│   │   └── main.rs      # Entry point
│   ├── capabilities/    # Permission definitions
│   └── Cargo.toml       # Rust dependencies
├── src/                 # React frontend
│   ├── App.tsx          # Main application
│   ├── App.css          # Doodle design system
│   ├── api.ts           # STT API interface
│   ├── api-tauri.ts     # Tauri sidecar communication
│   ├── api-ws.ts        # WebSocket dev mode
│   ├── store.ts         # State management
│   └── components/      # UI components
└── package.json         # Frontend dependencies
```

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (frontend + Tauri)
pnpm tauri dev

# Build for production
pnpm tauri build
```

## System Tray

The app includes a system tray with:
- **Show Window**: Bring window to front
- **Start Listening**: Start STT engine
- **Stop Listening**: Stop STT engine
- **Quit**: Exit application

Left-click on tray icon shows the window. Close button minimizes to tray.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start/Stop listening |
| `Escape` | Close modals |

## Permissions

The app requires these Tauri permissions:
- `core:default` — Window management
- `shell:allow-execute` — Sidecar execution
- `notification:default` — System notifications
- `store:default` — Key-value persistence

## Tech Stack

- **Backend**: Tauri v2, Rust, SQLite
- **Frontend**: React 18, TypeScript, Vite
- **Styling**: CSS (Doodle design system)
- **Animation**: Framer Motion
- **State**: React hooks + localStorage
