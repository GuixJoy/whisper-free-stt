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
│  │          │  │whisper.cpp│  │Ollama   │  │              │  │
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
              (global lock)  (BatchedInferencePipeline)
                    │             │
                    └──────┬──────┘
                           ▼
                    TranscriptionResult(text, language, segments)
                           │
                           ▼
                    [LLM cleanup] (streaming SSE, background thread)
                           │
                    ┌──────┴──────┐
                    │             │
                  wtype        wl-copy
              (focused input)  (clipboard)
              [parallel]       [parallel]
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
| `stt/transcription.py` | ASR engine dispatch (batched) | disk I/O (model load), GPU/CPU inference | `transcribe`, `warm_up_backend`, `_get_batched_model` |
| `stt/llm.py` | LLM HTTP clients (streaming SSE) | `urllib.request` POST | `rewrite`, `rewrite_stream`, `_stream_api` |
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

### Batched Inference

faster-whisper supports `BatchedInferencePipeline` for 4-10x speedup on GPU:

```python
from faster_whisper import WhisperModel, BatchedInferencePipeline
model = WhisperModel("turbo", device="cuda", compute_type="float16")
batched = BatchedInferencePipeline(model=model)
segments, info = batched.transcribe(audio, batch_size=16)
```

### Word-Level Timestamps

```python
segments, _ = model.transcribe(audio, word_timestamps=True)
for segment in segments:
    for word in segment.words:
        print(f"[{word.start:.2fs -> {word.end:.2fs}] {word.word}")
```

### Hotwords

Boost recognition of technical terms:
```python
segments, _ = model.transcribe(audio, hotwords="STT,whisper,CTranslate2")
```

## LLM Providers

Three LLM providers:

| Provider | URL | Auth Env Var | Fallback |
|---|---|---|---|
| DeepSeek | `api.deepseek.com/chat/completions` | `DEEPSEEK_API_KEY` | None (paid) |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY` | Primary → fallback model |
| Ollama | `localhost:11434/api/chat` | None (local) | None |

DeepSeek takes priority if both keys are set. Override with `--llm-provider`.

### LLM Streaming

The LLM client supports SSE streaming for reduced perceived latency:

```python
def rewrite_stream(transcript, config, few_shot_context=""):
    """Yield tokens from the LLM as they arrive via SSE."""
    payload["stream"] = True
    for token in _stream_api(url, headers, payload, timeout):
        yield token  # Token appears immediately
```

Both OpenAI SSE and Ollama NDJSON formats are supported.

## Ring Buffer

A fixed-capacity (30 seconds @ 16kHz = 480,000 samples) pre-allocated numpy circular buffer.
Chunks are appended via `extend(chunk)` and retrieved via `slice_range(start, end)`.
The buffer tracks `_total` samples ever appended for absolute sample addressing.
This decouples audio accumulation from transcription: the mic thread writes
continuously while transcription threads read bounded segments.

## Concurrency Model

- **Main thread**: microphone streaming loop, VAD state machine
- **ASR warm-up thread**: loads model in background during calibration (daemon)
- **Transcription threads**: one per utterance, spawned on VAD "end" event (daemon)
- **LLM calls**: inline within the transcription thread (already backgrounded)
- **Typing + clipboard**: run in parallel threads (not sequential)

All shared state is either immutable (config, types) or single-writer (ring buffer
append via main thread, reads via daemon threads). No locks needed.

### ASR Semaphore

- whisper.cpp: `Semaphore(1)` — global lock serializes all transcribe calls
- faster-whisper: `Semaphore(1)` — early release allows next utterance to start ASR while current does LLM

### LLM Semaphore

- `Semaphore(4)` — allows up to 4 concurrent LLM calls (network I/O bound)
