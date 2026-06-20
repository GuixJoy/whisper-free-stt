<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/license-GPL%20v2-green.svg" alt="GPL v2">
  <img src="https://img.shields.io/badge/platform-Linux-orange.svg" alt="Linux">
  <img src="https://img.shields.io/badge/ASR-whisper.cpp%20%7C%20faster--whisper-purple.svg" alt="Dual ASR">
  <img src="https://img.shields.io/badge/LLM-DeepSeek%20%7C%20OpenRouter%20%7C%20Ollama-yellow.svg" alt="Triple LLM">
  <img src="https://img.shields.io/badge/UI-Tauri%20v2%20%2B%20React%2019-blue.svg" alt="Tauri + React">
</p>

# STT — Speech-to-Text

> You think about things but can't write them because of cognitive load.

STT listens to your mic, transcribes your speech, cleans it up with an LLM, and types it into whatever you're focused on. No cloud. No account. Runs entirely on your machine.

---

## How It Works

```
You speak
   → mic captures audio (sounddevice, 16kHz float32)
   → adaptive VAD detects speech vs silence (IMCRA noise estimation + spectral scoring)
   → ASR transcribes (whisper.cpp or faster-whisper)
   → LLM cleans up punctuation, removes filler words (optional)
   → types into your focused window (wtype/xdotool) or copies to clipboard (wl-copy/xclip)
```

The mic stays open. You talk, it types. No button pressing needed.

---

## Quickstart

```bash
# Install
uv venv && source .venv/bin/activate && uv pip install -e .

# System deps (Debian/Ubuntu)
sudo apt install wl-clipboard wtype   # Wayland
# or: sudo apt install xclip xdotool  # X11

# Configure
cp .env.example .env
# Edit .env → set DEEPSEEK_API_KEY or OPENROUTER_API_KEY

# Run
stt
```

That's it. Speak — cleaned text appears wherever your cursor is.

### Desktop App

```bash
# Build the sidecar
./stt/build_sidecar.sh

# Build the Tauri app
cd stt-ui && npm run tauri build
```

---

## ASR: Two Backends, Five Profiles

STT uses two transcription engines depending on your hardware:

| Profile | Model | Backend | Size | Best for |
|---|---|---|---|---|
| `speed` | tiny.en | whisper.cpp | ~75 MB | Lowest latency on CPU |
| `balanced` | base.en | whisper.cpp | ~145 MB | Good balance |
| `accuracy` | small.en | whisper.cpp | ~465 MB | Better accuracy on CPU |
| `distil` | distil-large-v3 | faster-whisper | ~1.5 GB | High quality (GPU recommended) |
| `turbo` | large-v3-turbo | faster-whisper | ~3 GB | Best accuracy (GPU required) |

`auto` selects `turbo` if CUDA is available, otherwise `accuracy`.

whisper.cpp is fastest on CPU (10-16x faster than Python alternatives). faster-whisper supports more models and GPU inference via CTranslate2 with batched pipelines for 4-10x additional speedup.

```bash
stt --asr-profile speed      # fastest
stt --asr-profile accuracy   # more accurate
stt --asr-profile distil     # highest quality (needs GPU)
```

---

## LLM Cleanup

After transcription, an LLM cleans up the raw text — fixes punctuation, capitalization, removes filler words ("um", "uh"). Runs via streaming SSE so tokens appear as they arrive.

| Mode | What it does |
|---|---|
| `cleanup` | Fix punctuation, remove fillers (default) |
| `bullet_list` | Convert speech to a bulleted list |
| `email` | Rewrite as a professional email |
| `commit_message` | Convert to a conventional commit message |
| `off` | No LLM — raw transcript only |

### Providers

| Provider | Default model | Setup |
|---|---|---|
| **DeepSeek** | deepseek-chat | `DEEPSEEK_API_KEY=sk-...` |
| **OpenRouter** | openai/gpt-4o-mini | `OPENROUTER_API_KEY=sk-or-...` |
| **Ollama** | qwen2.5:1.5b | `--llm-provider ollama` (local) |

DeepSeek takes priority if both keys are set. OpenRouter supports a fallback model chain — if the primary fails, it tries the fallback automatically.

---

## Adaptive VAD

The voice activity detection is not a simple energy threshold. It uses:

- **IMCRA noise estimation** (Cohen 2003) — continuously tracks the noise floor
- **Dual-timescale EMA** — 30-minute baseline + 2-second rapid adaptation
- **Multi-feature spectral scoring** — RMS energy, spectral flux, spectral centroid, zero-crossing rate, band energy ratio
- **Hysteresis VAD** — asymmetric onset/offset thresholds prevent toggling
- **Hangover scheme** — prevents speech truncation at utterance boundaries
- **Spectral speech detection** — distinguishes speech from noise in the 300-3400 Hz band

Fast-commit mode trades occasional mid-sentence cuts for ~40% faster endpointing.

---

## Desktop UI

The Tauri v2 + React 19 desktop app provides:

- **Onboarding wizard** — system checks, mic setup, model download, permissions
- **Live transcription feed** — real-time mic level meter, waveform, session stats (WPM, word count)
- **Model management** — browse, download, check status, and delete ASR models with progress tracking and disk usage summary
- **History** — full-text search over past transcripts (SQLite FTS5), recopy, rerun cleanup, favorites
- **Settings** — LLM provider, API keys, ASR profile, language, custom vocabulary
- **Config panel** — connection mode, permissions, output settings, command preview
- **Insights** — usage heatmap, stats overview, streak tracking, usage breakdown
- **System tray** — start/stop from tray, minimize on close
- **Widget mode** — compact always-on-top mini window
- **Global shortcut** — Super+Space to toggle anywhere

The Python engine runs as a Tauri sidecar. The UI communicates via JSON events over stdout.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PURE CORE                         │
│                                                     │
│  config (frozen dataclass)                          │
│  types (frozen dataclass)                           │
│  prompts (str → str, pure functions)                │
│  vad (np.ndarray → bool, pure functions)            │
├─────────────────────────────────────────────────────┤
│                  EFFECTFUL SHELL                     │
│                                                     │
│  audio_capture (sounddevice → numpy)                │
│  transcription (whisper.cpp / faster-whisper)       │
│  llm (DeepSeek / OpenRouter / Ollama, streaming)    │
│  clipboard (wl-copy / xclip subprocess)             │
│  typing (wtype / xdotool subprocess)                │
│  history (SQLite, thread-safe fire-and-forget)      │
│  embeddings (sentence-transformers, lazy-loaded)    │
├─────────────────────────────────────────────────────┤
│                     WIRING                           │
│                                                     │
│  orchestrator (streaming loop, background threads)  │
│  cli (argparse → AppConfig → run)                   │
│  server (FastAPI + Socket.IO for browser mode)      │
└─────────────────────────────────────────────────────┘
```

| Module | Role | Dependencies |
|---|---|---|
| `stt/config.py` | Immutable configuration | None |
| `stt/types.py` | Immutable data types | None |
| `stt/prompts.py` | LLM prompt templates | None |
| `stt/vad.py` | Voice-activity detection | numpy |
| `stt/audio_capture.py` | Microphone I/O | sounddevice, numpy |
| `stt/transcription.py` | ASR backends | faster-whisper, pywhispercpp |
| `stt/llm.py` | LLM clients | urllib (stdlib) |
| `stt/clipboard.py` | Clipboard output | wl-copy / xclip (subprocess) |
| `stt/typing.py` | Focused-input typing | wtype / xdotool (subprocess) |
| `stt/history.py` | Transcript persistence | sqlite3 (stdlib) |
| `stt/embeddings.py` | Few-shot context retrieval | sentence-transformers (optional) |
| `stt/speaker.py` | Speaker verification | resemblyzer (optional) |
| `stt/server.py` | Browser UI backend | FastAPI, Socket.IO |
| `stt/orchestrator.py` | Main pipeline | All of the above |

---

## History & Few-Shot Learning

Transcripts are saved to SQLite (`~/.local/share/stt/history.db`) with metadata: raw text, cleaned text, LLM mode, provider, model, and timestamp. FTS5 full-text search is indexed automatically via triggers.

If `sentence-transformers` is installed, the orchestrator retrieves past correction pairs (raw → cleaned) as few-shot examples for the LLM. The top-3 most similar transcripts are injected into the prompt, so the system learns your speech patterns over time.

---

## Benchmarks

*RTX 4060, CUDA, large-v3-turbo, Silero VAD + OpenRouter free model.*

| Stage | p50 | p95 |
|---|---|---|
| **ASR** | 0.77s | 1.46s |
| **LLM** | 3.13s | 3.95s |
| **Total** | 4.37s | 5.47s |

### What makes it fast

- **BatchedInferencePipeline** — 4-10x ASR speedup on GPU with batch_size=8
- **INT8 quantization** — 40% less VRAM with minimal quality loss
- **LLM streaming** — tokens appear as they arrive via SSE
- **ASR semaphore early release** — next utterance starts ASR while current does LLM
- **Parallel output** — wtype and wl-copy run concurrently

---

## CLI Reference

| Flag | Default | Description |
|---|---|---|
| `--asr-profile` | auto | speed / balanced / accuracy / distil / turbo |
| `--backend` | auto | whisper_cpp / faster_whisper |
| `--model` | profile | Model name override |
| `--device` | auto | cpu / cuda |
| `--compute-type` | auto | int8 / float16 / float32 |
| `--cpu-threads` | 4 | CPU threads for whisper.cpp |
| `--language` | auto | Force language (e.g., en, hi, es) |
| `--hotwords` | — | Comma-separated terms to boost |
| `--llm-mode` | cleanup | off / cleanup / bullet_list / email / commit_message |
| `--llm-provider` | auto | deepseek / openrouter / ollama |
| `--llm-model` | provider default | LLM model name |
| `--llm-fallback` | — | Fallback model (OpenRouter) |
| `--silence-threshold` | 0.005 | RMS floor for VAD |
| `--silence-duration` | 0.9 | Seconds of silence to end utterance |
| `--min-duration` | 0.5 | Ignore utterances shorter than this |
| `--fast-commit` | false | Faster endpointing (lower latency) |
| `--clipboard` | false | Copy output to clipboard |
| `--no-type` | false | Disable typing to focused input |
| `--download-model` | — | Download a model and exit |
| `--list-microphones` | — | List mics and exit |
| `--ws-port` | — | Start WebSocket server for browser UI |
| `--ws-audio` | false | Accept audio from browser mic |
| `--input-file` | — | Process a WAV file instead of live mic |
| `--debug` | false | Print diagnostic info |
| `--json-mode` | false | JSON events to stdout (Tauri integration) |

---

## Example

```
$ stt

Hardware:
  whisper.cpp: available (ggml CPU)
  faster-whisper: available (CUDA, 1 device(s))
  active: faster_whisper on cuda (model: large-v3-turbo)

Mic: [4] HD-Audio Generic: ALC257 Analog (rms=0.0089)
LLM: cleanup (openrouter:gpt-4o-mini)
Typing: enabled  Clipboard: disabled

Listening...
----------------------------------------
[raw] um so I think we should refactor the the config module
[cleanup] I think we should refactor the config module.
[typed] ✓
----------------------------------------

--- Latency (seconds) ---
  asr: n=15 p50=0.770 p95=1.457
  llm: n=13 p50=3.125 p95=3.950
  total: n=13 p50=4.368 p95=5.474
```

---

## Extending

### New LLM rewrite mode

1. Add enum value in `stt/config.py` → `LLMMode`
2. Add instruction string in `stt/prompts.py` → `_MODE_INSTRUCTIONS`
3. Done — orchestrator, CLI, and UI pick it up automatically.

### New ASR backend

1. Add to `TranscriptionBackend` in `stt/config.py`
2. Implement `_transcribe_xxx()` in `stt/transcription.py`
3. Register in `transcribe()` dispatch

### New LLM provider

1. Add to `LLMProvider` in `stt/config.py`
2. Add URL/key helpers in `stt/config.py`
3. Handle response format in `stt/llm.py` → `_call_api()`
4. Add streaming in `stt/llm.py` → `_stream_api()`

---

## License

GNU General Public License v2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Designed and developed by <a href="https://www.akshatkotpalliwar.in/"><b>Akshat Kotpalliwar</b></a></sub>
</p>
