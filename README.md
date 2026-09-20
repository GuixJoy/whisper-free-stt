# Floure — Local Speech-to-Text

Floure listens to your mic, transcribes your speech, cleans it up with an LLM, and types it into whatever you're focused on. No cloud required. No account. The default setup runs entirely on your machine.

```
mic (cpal) → Silero VAD → Parakeet / Whisper (sherpa-onnx)
  → LLM cleanup (local S1-Mini via llama.cpp, or OpenRouter cloud)
  → type into focused window / clipboard
```

## Models

Downloaded on demand from the Models page (resumable, verified — see `docs/adr/0003-model-downloads.md`).

| Model | Backend | Size | Notes |
|---|---|---|---|
| Parakeet TDT 0.6B v2 (int8) | sherpa-onnx | ~460 MB | Default ASR. Fast English dictation. Recommended. |
| Whisper large-v3-turbo | sherpa-onnx | ~540 MB | Multilingual, high accuracy |
| Whisper base | sherpa-onnx | ~200 MB | Lightweight, any language |
| Silero VAD | sherpa-onnx | ~630 KB | Speech detection, auto-downloaded |
| S1-Mini Q4_K_M | llama.cpp | ~462 MB | Default local LLM for cleanup. Recommended. |
| Gemma 3 1B IT Q4_K_M | llama.cpp | ~806 MB | Alternative local LLM |

Cloud cleanup (optional): OpenRouter (`OPENROUTER_API_KEY`, default `openai/gpt-4o-mini`).

## Run from source

Prerequisites: pnpm, Rust toolchain, a mic, and (Linux) PipeWire/PulseAudio.

```bash
cd application && pnpm install
pnpm tauri dev          # full desktop app (Vite + Rust backend)
```

Useful slices:

```bash
cd application && pnpm dev                 # frontend only
cd application && pnpm build               # frontend build
cd application/src-tauri && cargo check    # Rust check
cd application/src-tauri && cargo test     # Rust tests
cd application && npx vitest run           # frontend tests
```

### Local GPU offload

The Rust backend prefers GPUs automatically: discrete NVIDIA → AMD → CPU (`application/src-tauri/src/compute.rs`). The local LLM offloads all layers via the llama.cpp Vulkan backend; ASR stays on CPU (int8 is already sub-second per utterance). Overrides: `FLOURE_COMPUTE=cpu|vulkan`, `FLOURE_MAIN_GPU=<index>`.

GPU build prerequisites (Linux only; Windows/macOS build CPU inference): Vulkan loader + headers, a GPU with a Vulkan ICD, `glslc` and SPIRV-Headers — see `.github/workflows/ci.yml` for how CI provisions them.

## Configuration

| What | Where |
|---|---|
| App config | `~/.config/floure/config.json` |
| Transcripts (SQLite + FTS5) | `~/.local/share/floure/history.db` |
| Models | `~/.local/share/floure/models/` |
| Data dir override | `STT_DATA_DIR` env var |

Copy `.env.example` to `.env` for API keys and optional overrides.

## Desktop UI

- **Onboarding wizard** — system checks, mic setup, model download, permissions
- **Live transcription feed** — mic level, waveform, push-to-talk (`CommandOrControl+Shift+Space`)
- **Model management** — browse, download with progress, status, delete, disk usage
- **History** — full-text search over past transcripts (SQLite FTS5), recopy, favorites
- **Dictionary** — custom vocabulary with auto-replacement
- **Settings** — LLM provider/mode, API keys, ASR profile, language, hotkey
- **Insights** — usage heatmap, streaks, stats
- **Widget mode** — compact always-on-top mini window; **system tray** with start/stop

Transcripts are saved with raw text, cleaned text, LLM mode, provider, model, and timestamp.

## Docs

- [CONTEXT.md](CONTEXT.md) — project brief, layout, commands
- [docs/adr/](docs/adr/) — architecture decisions (native backend, DB path, model downloads)
- [docs/](docs/) — algorithms and voice research notes

## License

GNU General Public License v2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Designed and developed by <a href="https://www.akshatkotpalliwar.in/"><b>Akshat Kotpalliwar</b></a></sub>
</p>
