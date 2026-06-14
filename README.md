<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/license-GPL%20v2-green.svg" alt="GPL v2">
  <img src="https://img.shields.io/badge/platform-Linux%20Wayland-orange.svg" alt="Linux Wayland">
  <img src="https://img.shields.io/badge/ASR-whisper.cpp%20%7C%20faster--whisper-purple.svg" alt="Dual ASR">
  <img src="https://img.shields.io/badge/LLM-DeepSeek%20%7C%20OpenRouter%20%7C%20Ollama-yellow.svg" alt="Triple LLM">
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

## Desktop UI (Tauri + React)

`stt-ui` is a Tauri-based desktop application with a React frontend and Python engine sidecar:
- **Onboarding wizard**: First-run setup with system checks, microphone selection, model download, and shortcut configuration
- **Main panel**: Idle/Listening/Transcribing/Rewriting/Copied/Error status, start/stop, PTT, copy/clear, mic level meter
- **History sidebar**: Browse past transcripts with search, recopy, rerun cleanup, favorite, and delete
- **Settings panel**: Provider selector (DeepSeek/OpenRouter/Ollama), API key input, model/fallback model selection, ASR backend/profile, device, clipboard, debug mode
- **System tray**: Start/Stop listening from system tray, minimize to tray on close
- **Compact mode**: Mini window with optional always-on-top pin
- **Shortcut editor**: Remapping with conflict detection and scope labels

The Python engine is bundled as a Tauri sidecar via PyInstaller. Build it with:
```bash
./stt/build_sidecar.sh
```

Then build the Tauri app:
```bash
cd stt-ui && npm run tauri build
```

---

## Architecture

```
mic → sounddevice → numpy arrays → adaptive VAD → audio segments
                                                    ↓
                                           whisper.cpp | faster-whisper
                                           (BatchedInferencePipeline)
                                                    ↓
                                    DeepSeek | OpenRouter | Ollama (cleanup)
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
| `stt/transcription.py` | ASR engines (batched) | faster-whisper, whisper.cpp |
| `stt/llm.py` | LLM clients (streaming) | HTTP (DeepSeek, OpenRouter, Ollama) |
| `stt/clipboard.py` | Wayland clipboard | wl-copy subprocess |
| `stt/typing.py` | Focused-input typing | wtype subprocess |
| `stt/orchestrator.py` | Main loop wiring | All of the above |
| `stt/cli.py` | Argument parsing | argparse |

---

## LLM Providers

Three providers supported:

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

**Ollama** (local GPU inference):
```bash
# .env or CLI flag
--llm-provider ollama --llm-model qwen2.5:1.5b
```

DeepSeek takes priority if both keys are set. Provider is displayed at startup:
`LLM: cleanup (deepseek:deepseek-chat)` or `LLM: cleanup (openrouter:openai/gpt-4o-mini)`.

Override with `--llm-provider openrouter`, `--llm-provider deepseek`, or `--llm-provider ollama`.

---

## ASR Profiles

| Profile | Model | Backend | Best for |
|---|---|---|---|
| `auto` | large-v3-turbo / small.en | auto-detect | Strongest default |
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

### Batched Inference (GPU)

faster-whisper supports batched inference for 4-10x speedup on GPU:
```bash
stt --backend faster_whisper --model turbo --device cuda
```

The `BatchedInferencePipeline` is automatically used when `batch_size > 0` or when running on GPU.

### Word-Level Timestamps

Enable per-word timing for better UX:
```python
TranscriptionConfig(word_timestamps=True)
```

### Hotwords

Boost recognition of technical terms:
```python
TranscriptionConfig(hotwords="whisper,CTranslate2,STT")
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
| `--llm-provider` | auto | deepseek / openrouter / ollama |
| `--llm-model` | env | Model (env: `STT_LLM_MODEL`) |
| `--llm-fallback` | env | Fallback model (OpenRouter only) |
| `--deepseek-api-key` | env | DeepSeek API key (overrides `DEEPSEEK_API_KEY`) |
| `--openrouter-api-key` | env | OpenRouter API key (overrides `OPENROUTER_API_KEY`) |
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

Hardware:
  whisper.cpp: available (ggml CPU)
  faster-whisper: available (CUDA, 1 device(s))
  active: faster_whisper on cuda (model: large-v3-turbo)

Mic: [4] HD-Audio Generic: ALC257 Analog (rms=0.0089)
LLM: cleanup (openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free)
Typing: enabled  Clipboard: disabled

Listening... (speak naturally, Ctrl+C to stop)
----------------------------------------
[raw] um so I think we should refactor the the config module
[cleanup] I think we should refactor the config module.
[typed] ✓
----------------------------------------
^C

--- Latency (seconds) ---
  asr: n=15 p50=0.770 p95=1.457 min=0.327 max=2.851
  llm: n=13 p50=3.125 p95=3.950 min=1.441 max=4.048
  total: n=13 p50=4.368 p95=5.474 min=2.219 max=5.613

Done.
```

---

## Benchmarks

*Measured on RTX 4060 (CUDA, large-v3-turbo, Silero VAD) + DeepSeek Chat.*

| Stage | p50 | p95 | Notes |
|---|---|---|---|
| **ASR** | 0.77s | 1.46s | GPU turbo + Silero VAD |
| **LLM** | 3.13s | 3.95s | OpenRouter free model |
| **Total** | 4.37s | 5.47s | End-of-speech to typed output |

### Performance Improvements (v2)

- **BatchedInferencePipeline**: 4-10x ASR speedup on GPU with `batch_size=8`
- **INT8 quantization**: 40% less VRAM with minimal quality loss
- **LLM streaming**: Tokens appear as they arrive (SSE), not after full response
- **ASR semaphore early release**: Next utterance starts ASR while current does LLM
- **Parallel typing + clipboard**: wtype and wl-copy run concurrently

---

## History & Few-Shot Context

Transcripts are persisted to SQLite (`~/.local/share/stt/history.db`) with metadata: raw text, cleaned text, LLM mode, provider, model, latency, and timestamp. The orchestrator builds few-shot context from past correction pairs (raw → cleaned) using sentence embeddings, injecting the top-3 most similar examples into the LLM prompt. This improves rewrite quality over time as the system learns your speech patterns.

The Tauri UI reads the same database via a Rust `get_history` command for the history sidebar.

## Extending

### Add a new LLM rewrite mode

1. Add the enum value in `stt/config.py` → `LLMMode`
2. Add the instruction string in `stt/prompts.py` → `_MODE_INSTRUCTIONS`
3. Done — orchestrator, CLI, and LLM module pick it up.

### Add a new ASR backend

1. Add to `TranscriptionBackend` enum in `stt/config.py`
2. Implement `_transcribe_xxx()` in `stt/transcription.py`
3. Register in `transcribe()` dispatch

### Add a new LLM provider

1. Add to `LLMProvider` enum in `stt/config.py`
2. Add URL/key helpers in `stt/config.py`
3. Handle response format in `stt/llm.py` → `_call_api()`
4. Add streaming support in `stt/llm.py` → `_stream_api()`

---

## License

GNU General Public License v2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Designed and developed by <a href="https://www.akshatkotpalliwar.in/"><b>Akshat Kotpalliwar</b></a></sub>
</p>
