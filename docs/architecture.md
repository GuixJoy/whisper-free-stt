# Architecture

## Overview

STT is a local-first speech-to-text assistant for Linux Wayland. It follows the
**functional-core / imperative-shell** pattern: pure functions at the center,
I/O effects pushed to the edges.

```
┌──────────────────────────────────────────────────────────────┐
│                      PURE CORE                               │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ config   │  │  types   │  │ prompts  │  │     vad      │  │
│  │ frozen   │  │ frozen   │  │ str→str  │  │  np→bool     │  │
│  │dataclass │  │dataclass │  │ pure fns │  │ pure fns     │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
├──────────────────────────────────────────────────────────────┤
│                    EFFECTFUL SHELL                            │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌────────┐  ┌──────────────┐  │
│  │ audio    │  │transcript │  │  llm    │  │  clipboard   │  │
│  │ capture  │  │           │  │         │  │  + typing     │  │
│  │sounddevice│  │faster-    │  │DeepSeek │  │wl-copy/wtype │  │
│  │→numpy arr│  │whisper /  │  │OpenRoutr│  │subprocess    │  │
│  │          │  │whisper.cpp│  │HTTP POST│  │              │  │
│  └──────────┘  └───────────┘  └────────┘  └──────────────┘  │
├──────────────────────────────────────────────────────────────┤
│                      WIRING                                   │
│                                                              │
│  ┌─────────────────┐  ┌───────────────────────────────────┐  │
│  │  orchestrator   │  │           cli                      │  │
│  │  streaming loop │  │  argparse → AppConfig → run()      │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

```
Microphone
    │
    ▼
sounddevice InputStream (callback-driven, 1024-sample blocks @ 16kHz)
    │
    ▼
numpy float32 mono array per chunk (~64ms)
    │
    ▼
StreamingEndpointDetector.update(rms, sample_pos)
    │
    ├── "start" event → mark speech_start_sample in ring buffer
    │
    └── "end" event → ring.slice_range(start, end) → AudioSegment
                           │
                           ▼
                    transcribe(audio, sr, config)
                           │
                    ┌──────┴──────┐
                    │             │
              whisper.cpp    faster-whisper
              (ggml, CPU)    (CTranslate2, GPU/CPU)
                    │             │
                    └──────┬──────┘
                           ▼
                    TranscriptionResult(text, language, segments)
                           │
                           ▼
                    [LLM cleanup] (optional, background thread)
                           │
                           ▼
                    ┌──────┴──────┐
                    │             │
                  wtype        wl-copy
              (focused input)  (clipboard)
                    │             │
                    └──────┬──────┘
                           ▼
                        stdout
```

## Module Responsibilities

| Module | Role | Side Effects | Key Types |
|---|---|---|---|
| `stt/config.py` | All configuration as frozen dataclasses | None (except `load_dotenv`) | `AppConfig`, `AudioConfig`, `VADConfig`, `TranscriptionConfig`, `LLMConfig`, `ClipboardConfig`, `TypingConfig` |
| `stt/types.py` | Immutable data containers | None | `AudioSegment`, `TranscriptionResult`, `TranscriptionSegment`, `ProcessedUtterance` |
| `stt/prompts.py` | Centralized LLM prompt templates | None | `build_user_prompt(transcript, mode) → str` |
| `stt/vad.py` | Voice-activity detection, pure math over numpy | None | `compute_rms`, `VADEvent`, `StreamingEndpointDetector` |
| `stt/audio_capture.py` | Microphone I/O | `sounddevice.InputStream` | `mic_stream`, `record_utterance`, `find_best_microphone` |
| `stt/transcription.py` | ASR engine dispatch | disk I/O (model load), GPU/CPU inference | `transcribe`, `warm_up_backend` |
| `stt/llm.py` | LLM HTTP clients | `urllib.request` POST | `rewrite(transcript, config) → str` |
| `stt/clipboard.py` | Wayland clipboard | `subprocess.run(["wl-copy"])` | `copy_to_clipboard(text, config) → bool` |
| `stt/typing.py` | Focused-input typing | `subprocess.run(["wtype"])` | `type_to_focused_input(text, config) → bool` |
| `stt/orchestrator.py` | Main loop wiring | All of the above | `run(config)`, `_transcribe_and_print` |
| `stt/cli.py` | Argument parsing, config construction | `argparse`, `os.environ` | `build_config(args) → AppConfig` |

## ASR Backends

Two transcription backends, selectable via `--backend`:

| Backend | Engine | Format | Speed (CPU) | Best For |
|---|---|---|---|---|
| `whisper_cpp` | `pywhispercpp` (ggml) | `.bin` (147-466MB) | 0.5s / 3s clip | CPU-only systems |
| `faster_whisper` | CTranslate2 | CTranslate2 (75MB-1.6GB) | 0.03s / 3s clip (GPU) | CUDA systems |

Auto-selection: if CUDA is detected (libcublas.so.12 loadable), `faster_whisper` with `large-v3-turbo` on GPU. Otherwise `whisper_cpp` with `base.en` on CPU.

## LLM Providers

Two LLM providers, auto-detected from environment:

| Provider | URL | Auth Env Var | Fallback |
|---|---|---|---|
| DeepSeek | `api.deepseek.com/chat/completions` | `DEEPSEEK_API_KEY` | None (paid) |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY` | Primary → fallback model |

DeepSeek takes priority if both keys are set. Override with `--llm-provider`.

## Ring Buffer

A fixed-capacity (30 seconds @ 16kHz = 480,000 samples) deque-backed buffer.
Chunks are appended via `extend(chunk)` and retrieved via `slice_range(start, end)`.
The buffer tracks `_total` samples ever appended for absolute sample addressing.
This decouples audio accumulation from transcription: the mic thread writes
continuously while transcription threads read bounded segments.

## Concurrency Model

- **Main thread**: microphone streaming loop, VAD state machine
- **ASR warm-up thread**: loads model in background during calibration (daemon)
- **Transcription threads**: one per utterance, spawned on VAD "end" event (daemon)
- **LLM calls**: inline within the transcription thread (already backgrounded)

All shared state is either immutable (config, types) or single-writer (ring buffer
append via main thread, reads via daemon threads). No locks needed.
