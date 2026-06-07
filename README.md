<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/license-GPL%20v2-green.svg" alt="GPL v2">
  <img src="https://img.shields.io/badge/platform-Linux%20Wayland-orange.svg" alt="Linux Wayland">
  <img src="https://img.shields.io/badge/ASR-whisper.cpp%20%7C%20faster--whisper-purple.svg" alt="Dual ASR">
  <img src="https://img.shields.io/badge/LLM-DeepSeek%20%7C%20OpenRouter-yellow.svg" alt="Dual LLM">
</p>

# STT — Local Speech-to-Text Assistant

Local-first Python speech-to-text for Linux Wayland.  Speaks your words into existence.

Listens to your microphone, auto-detects speech/silence (adaptive VAD with
hysteresis + noise-floor calibration), transcribes, cleans up text with an LLM
by default, and types the result directly into your focused input field.

---

## Quickstart

```bash
# 1. Install
uv venv && source .venv/bin/activate && uv pip install -e .
sudo apt install wl-clipboard wtype   # Debian/Ubuntu

# 2. Configure
cp .env.example .env
# Edit .env → set your LLM key

# 3. Run
stt

# Optional: launch desktop UI
stt-ui
```

That's it.  Speak — cleaned text appears wherever your cursor is.

## Desktop UI (Tkinter, cross-platform shell)

`stt-ui` now includes:
- Main panel: Idle/Listening/Transcribing/Rewriting/Copied/Error status, start/stop, PTT, copy/clear, mic level meter
- Compact mode: mini window, optional always-on-top pin
- Settings panel: device/backend/model/LLM/clipboard/PTT/auto-transcribe/theme/startup placeholder
- Shortcut editor: remapping, conflict detection, scope labels
- Transcript history: search, recopy, rerun cleanup, favorite, delete
- Platform capability notes with Wayland fallback messaging

Current implementation uses Python + Tkinter for low startup overhead and simple backend integration.
Long-term production packaging target remains **Tauri + web UI + Python sidecar**.

---

## Architecture

```
mic → sounddevice → numpy arrays → adaptive VAD → audio segments
                                                    ↓
                                           whisper.cpp | faster-whisper
                                                    ↓
                                        DeepSeek | OpenRouter (cleanup)
                                                    ↓
                                            wtype → focused input
                                            wl-copy → clipboard
                                                    ↓
                                                 stdout
```

**Core principle:** pure functions at the center, effects at the edges.

| Module | Role | Side effects |
|---|---|---|
| `stt/config.py` | Immutable dataclass config | None |
| `stt/types.py` | Immutable data types | None |
| `stt/prompts.py` | Centralized prompt templates | None |
| `stt/vad.py` | Voice-activity detection | None |
| `stt/audio_capture.py` | Microphone I/O | sounddevice |
| `stt/transcription.py` | ASR engines | faster-whisper, whisper.cpp |
| `stt/llm.py` | LLM clients | HTTP (DeepSeek, OpenRouter) |
| `stt/clipboard.py` | Wayland clipboard | wl-copy subprocess |
| `stt/typing.py` | Focused-input typing | wtype subprocess |
| `stt/orchestrator.py` | Main loop wiring | All of the above |
| `stt/cli.py` | Argument parsing | argparse |

---

## LLM Providers

Two providers supported, auto-detected from which API key you set:

**DeepSeek** (faster, cheaper — recommended):
```bash
# .env
DEEPSEEK_API_KEY=sk-ea99...
STT_LLM_MODEL=deepseek-v4-flash
```

**OpenRouter** (multi-model, fallback chain):
```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
STT_LLM_MODEL=openai/gpt-4o-mini
STT_LLM_FALLBACK=anthropic/claude-3-5-haiku-latest
```

DeepSeek takes priority if both keys are set.  Provider is displayed at startup:
`LLM: cleanup (deepseek:deepseek-v4-flash)` or `LLM: cleanup (openrouter:openai/gpt-4o-mini)`.

Override with `--llm-provider openrouter` or `--llm-provider deepseek`.

---

## ASR Profiles

| Profile | Model | Backend | Best for |
|---|---|---|---|
| `auto` | distil-large-v3 / small.en | auto-detect | Strongest default |
| `speed` | tiny.en | whisper.cpp | Lowest latency |
| `balanced` | base.en | whisper.cpp | Good balance |
| `accuracy` | small.en | whisper.cpp | Better accuracy on CPU |
| `distil` | distil-large-v3 | faster-whisper | High quality (GPU) |
| `turbo` | large-v3-turbo | faster-whisper | Lower latency on GPU |

```bash
stt --asr-profile speed     # fastest
stt --asr-profile accuracy  # more accurate
stt --asr-profile distil    # highest quality (needs GPU)
```

---

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--sample-rate` | 16000 | Audio sample rate (Hz) |
| `--device-index` | auto | Force specific mic |
| `--silence-threshold` | 0.005 | Base RMS floor for adaptive VAD |
| `--silence-duration` | 0.9 | Seconds of silence to end utterance |
| `--min-duration` | 0.5 | Ignore utterances shorter than this |
| `--asr-profile` | auto | speed / balanced / accuracy / distil / turbo |
| `--backend` | profile | whisper_cpp / faster_whisper |
| `--model` | profile | Model name override |
| `--device` | auto | cpu / cuda |
| `--compute-type` | auto | int8 / float16 / ... |
| `--llm-mode` | cleanup | off / cleanup / bullet_list / email / commit_message |
| `--llm-provider` | auto | deepseek / openrouter |
| `--llm-model` | env | Model (env: `STT_LLM_MODEL`) |
| `--llm-fallback` | env | Fallback model (OpenRouter only) |
| `--no-type` | false | Disable typing to focused input |
| `--clipboard` | false | Enable wl-copy clipboard output |
| `--debug` | false | Print diagnostic info |

---

## Example Session

```
$ stt

╔══════════════════════════════════╗
║   STT — Local Speech-to-Text    ║
╚══════════════════════════════════╝

ASR: large-v3-turbo (cuda)
LLM: cleanup (deepseek:deepseek-v4-flash)
Typing: enabled  Clipboard: disabled

Listening... (speak naturally, Ctrl+C to stop)
----------------------------------------
[raw] um so I think we should refactor the the config module
[cleanup] I think we should refactor the config module.
[typed] ✓
----------------------------------------
^C
Done.
```

---

## Benchmarks

*Measured 2026-06-07 on RTX 4060 (CUDA, large-v3-turbo) + DeepSeek Chat, 6 utterances.*

| Stage | p50 | p95 | Notes |
|---|---|---|---|
| **ASR** | 0.66s | 2.2s | GPU turbo — median sub-second. p95 is first-utterance CUDA warmup |
| **LLM** | 1.04s | 1.07s | DeepSeek Chat — tight variance, every call ~1s |
| **Total** | 1.81s | 3.3s | **Under 2 seconds** from end-of-speech to punctuated output |

At ~80 WPM average typing speed, this delivers **2× faster than manual typing** with proper punctuation and zero editing. LLM latency halved by switching from `deepseek-v4-flash` to `deepseek-chat` with an optimized 50-token prompt.

---

## Extending

### Add a new LLM rewrite mode

1. Add the enum value in `stt/config.py` → `LLMMode`
2. Add the instruction string in `stt/prompts.py` → `_MODE_INSTRUCTIONS`
3. Done — orchestrator, CLI, and LLM module pick it up.

### Add a new ASR backend

1. Add to `TranscriptionBackend` enum in `stt/config.py`
2. Implement `_transcribe_xxx()` in `stt/transcription.py`
3. Register in `transcribe()` dispatch

### Add a Tkinter UI

1. Create `stt/ui.py` with a Tkinter window
2. Run the orchestrator in a background thread; push transcripts via `queue.Queue`
3. All pure logic is UI-free — just consume `AppConfig` and call the pipeline

---

## License

GNU General Public License v2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Designed and developed by <a href="https://www.akshatkotpalliwar.in/"><b>Akshat Kotpalliwar</b></a></sub>
</p>
