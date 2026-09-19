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
│  │sounddevice│  │faster-    │  │OpenRouter│  │wl-copy/wtype │  │
│  │→numpy arr│  │whisper /  │  │Ollama    │  │subprocess    │  │
│  │          │  │whisper.cpp│  │          │  │              │  │
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
                    ┌──────┴──────┐
                    │  Layer 1-3  │
                    │ dictionary  │
                    │ exact+fuzzy │
                    │  + LLM ctx  │
                    └──────┬──────┘
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
                        stdout (JSON) → Frontend (api-tauri.ts)
```

## Module Responsibilities

| Module | Role | Side Effects | Key Types |
|---|---|---|---|
| `stt/config.py` | All configuration as frozen dataclasses | None (except `load_dotenv`) | `AppConfig`, `AudioConfig`, `VADConfig`, `TranscriptionConfig`, `LLMConfig`, `ClipboardConfig`, `TypingConfig` |
| `stt/types.py` | Immutable data containers | None | `AudioSegment`, `TranscriptionResult`, `TranscriptionSegment`, `ProcessedUtterance` |
| `stt/prompts.py` | Centralized LLM prompt templates | None | `build_user_prompt(transcript, mode) → str` |
| `stt/vad.py` | Voice-activity detection, pure math over numpy | None | `compute_rms`, `VADState`, `VADEvent`, `StreamingEndpointDetector` |
| `stt/audio_capture.py` | Microphone I/O | `sounddevice.InputStream` | `mic_stream`, `record_utterance`, `find_best_microphone` |
| `stt/transcription.py` | ASR engine dispatch (batched) | disk I/O (model load), GPU/CPU inference | `transcribe`, `warm_up_backend`, `_get_batched_model` |
| `stt/llm.py` | LLM HTTP clients (streaming SSE) | `urllib.request` POST | `rewrite`, `rewrite_stream`, `_stream_api` |
| `stt/clipboard.py` | Wayland clipboard | `subprocess.run(["wl-copy"])` | `copy_to_clipboard(text, config) → bool` |
| `stt/typing.py` | Focused-input typing | `subprocess.run(["wtype"])` | `type_to_focused_input(text, config) → bool` |
| `stt/orchestrator.py` | Main loop wiring, PTT, hooks | All of the above | `run(config)`, `_transcribe_and_print`, `RunHooks` |
| `stt/cli.py` | Argument parsing, config construction | `argparse`, `os.environ` | `build_config(args) → AppConfig` |
| `stt/speaker.py` | Speaker verification | `resemblyzer` (neural) or numpy (spectral) | `SpeakerVerifier`, `embed`, `verify`, `enroll` |
| `stt/history.py` | SQLite transcript store + dictionary | disk I/O | `get_store()`, `TranscriptStore`, `apply_dictionary_replacements` |
| `stt/telemetry.py` | Latency tracking | None | `LatencyTracker`, `P50/P95` |
| `stt/_cpp_worker.py` | In-process whisper.cpp for frozen binary | model load | `run_worker()` |

## ASR Backends

Two transcription backends, selectable via `--backend`:

| Backend | Engine | Format | Speed (CPU) | Best For |
|---|---|---|---|---|
| `whisper_cpp` | `pywhispercpp` (ggml) | `.bin` (147-466MB) | 0.5s / 3s clip | CPU-only systems, Apple Silicon (Metal), iGPU (Vulkan) |
| `faster_whisper` | CTranslate2 | CTranslate2 (75MB-1.6GB) | 0.03s / 3s clip (GPU) | NVIDIA CUDA systems |

### Auto-selection

When `asrProfile` is `"auto"` (the default), `cli.py` detects CUDA and VRAM to pick
the optimal profile:

| VRAM | Profile | Model | Backend |
|---|---|---|---|
| ≥6 GB | `turbo` | large-v3-turbo (809M params, 4 decoder layers) | faster_whisper |
| ≥3 GB | `distil` | distil-large-v3 | faster_whisper |
| ≥1.5 GB | `small-cuda` | small.en on CUDA | faster_whisper |
| <1.5 GB or no CUDA | `accuracy` | small.en on CPU | whisper_cpp |

### ASR Profiles

Profiles map to model/beam/condition presets:

| Profile | Model | Beam | Backend | Speed |
|---|---|---|---|---|
| `speed` | tiny.en | 1 | whisper_cpp | ~10x realtime |
| `balanced` | base.en | 1 | whisper_cpp | ~5x realtime |
| `accuracy` | small.en | 3 | whisper_cpp | ~2x realtime |
| `small-cuda` | small.en | 3 | faster_whisper (CUDA) | ~20x realtime |
| `distil` | distil-large-v3 | 5 | faster_whisper (CUDA) | ~40x realtime |
| `turbo` | large-v3-turbo | 5 | faster_whisper (CUDA) | ~30x realtime |

### Latest Findings (2026)

- **whisper.cpp 1.8.3**: 12x speedup on integrated AMD/Intel GPUs via Vulkan (Ryzen 7 6800H: 0.3→3.4 RTF). Also supports OpenVINO for Intel Arc GPUs.
- **faster-whisper 1.1.0**: New batched inference 4x faster, VAD filter 3x faster on CPU, `large-v3-turbo` support.
- **faster-whisper2**: Fork with enhanced quantization and CTranslate2 improvements.
- **Whisper large-v3-turbo**: Pruned from 32→4 decoder layers, ~5x faster than large-v3 with minor quality loss. Parameters: 809M, d_model=1280, 20 attention heads.
- **Distil-Whisper**: Knowledge-distilled variants (distil-large-v3) for 6x speedup with <1% WER increase.

### Batched Inference

faster-whisper supports `BatchedInferencePipeline` for 4-10x speedup on GPU:

```python
from faster_whisper import WhisperModel, BatchedInferencePipeline
model = WhisperModel("turbo", device="cuda", compute_type="float16")
batched = BatchedInferencePipeline(model=model)
segments, info = batched.transcribe(audio, batch_size=16)
```

### Hooks vs Direct Output

`_output_text()` (clipboard + typing) is always called regardless of hooks. The `hooks`
callback is for state/display (UI updates via `_json_emit`), not for output. Both CLI
and UI modes need clipboard/typing to happen.

### CUDA Fallback Chain

```
Try CUDA + float16 → catch libcublas/cublas/OOM →
Try CUDA + int8   → catch libcublas/cublas/OOM →
Fall back to CPU + int8
```

## LLM Providers

Two LLM providers:

| Provider | URL | Auth Env Var | Fallback |
|---|---|---|---|
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY` | Primary → fallback model |
| Ollama | `localhost:11434/api/chat` | None (local) | None |

### LLM Modes

| Mode | Behavior |
|---|---|
| `off` | No LLM processing, raw ASR text only |
| `cleanup` | Grammar/spelling cleanup (fast, low token usage) |
| `formal` | Formal rewrite (more tokens) |
| `concise` | Concise summary |
| `custom` | Custom prompt from user |

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

## Dictionary System (3 Layers)

| Layer | Type | Location | Description |
|---|---|---|---|
| 1 | Exact regex | `history.py:apply_dictionary_replacements` | Word-boundary regex replacements |
| 2 | Fuzzy phonetic | `history.py:apply_fuzzy_replacements` | Levenshtein ratio matching (0.8 threshold) |
| 3 | LLM context | `orchestrator.py:_build_dict_llm_context` | Injected into LLM prompt as domain glossary |

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

### Semaphores

- **ASR**: `Semaphore(1)` — serializes all transcribe calls (whisper.cpp has global lock)
- **LLM**: `Semaphore(4)` — allows up to 4 concurrent LLM calls (network I/O bound)

### ASR Overlap Dropping

When an utterance arrives while ASR is busy, it's dropped (non-blocking acquire).
This prevents queue buildup and ensures the most recent speech is always processed.

## Sidecar Communication (UI Mode)

When running as a Tauri sidecar, the backend communicates via stdout JSON lines:

| Event | Direction | Description |
|---|---|---|
| `state` | Backend → Frontend | Engine state changes (listening, transcribing, rewriting) |
| `raw` | Backend → Frontend | Original ASR text |
| `processed` | Backend → Frontend | LLM-corrected text |
| `llm_partial` | Backend → Frontend | Streaming LLM tokens |
| `error` | Backend → Frontend | Error messages |
| `dropped` | Backend → Frontend | Dropped utterances (empty, hallucination) |
| `mic` | Backend → Frontend | Microphone RMS level |

- `_json_emit()` sends structured events to stdout + WebSocket + Socket.IO
- `_echo()` sends debug/status to stderr (logged as `console.warn` by frontend)
- `hooks` callbacks trigger `_json_emit` for real-time UI updates

## IPC Commands (Tauri)

Registered in `lib.rs`:

| Command | Description |
|---|---|
| `get_history` | Fetch transcript rows from SQLite |
| `get_insights` | Aggregate usage stats (words, streak, heatmap) |
| `get_voice_intelligence` | Live transcript analysis |
| `get_dictionary` | Fetch dictionary entries |
| `add_dictionary_entry` | Add custom word replacement |
| `update_dictionary_entry` | Modify existing entry |
| `delete_dictionary_entry` | Remove entry |
| `toggle_dictionary_favorite` | Toggle favorite status |
| `import_dictionary_csv` | Bulk import from CSV |
| `export_dictionary_csv` | Export to CSV |
| `check_model_status` | Check if model file exists |
| `delete_model_file` | Remove cached model |
| `type_text` | Platform-specific paste (wtype/xdotool) |
| `get_foreground_hwnd` | Get active window handle |
| `set_foreground_hwnd` | Focus window |
| `widget::*` | Floating widget controls |

## Platform Support

| Platform | Typing | Clipboard | Notes |
|---|---|---|---|
| Wayland (Hyprland) | `wtype` | `wl-copy` | Primary target |
| X11 | `xdotool` | `xclip`/`xsel` | Fallback |
| Windows | `keybd_event` (SendInput) | `ctypes` clipboard | via `win32` module |
| macOS | Not implemented | Not implemented | Planned |

## Testing

| Layer | Framework | Command | Count |
|---|---|---|---|
| Rust unit/integration | `cargo test` | `cd application/src-tauri && cargo test -- --test-threads=1` | 59 |
| TypeScript unit | vitest | `npx vitest run` | 67 |
| Python unit | pytest | `uv run python -m pytest` | TBD |
| E2E | Playwright + tauri-driver | `scripts/e2e-test.sh` | TBD |

## Key Design Decisions

1. **No mocking** — real models, real .env, real testing
2. **Backend handles all typing** — frontend `type_text` removed to prevent double-typing
3. **`asr_text` preserves original ASR** — `raw` is working copy for dict/LLM
4. **Hallucination check runs before dictionary** — prevents dict masking hallucinations
5. **Backend PTT loop reuses mic stream** — no recalibration between sessions
6. **`settingsVersion` counter** — triggers engine re-run on settings save
7. **Frozen binary `run_worker()`** — creates NEW WhisperModel per call (no caching from `warm_up_backend`)
8. **PyInstaller sidecar excludes unused deps** — but NOT scipy (noisereduce depends on it)
9. **`INVOKE_KEY`** is `"__invoke-key__"` in `tauri::test` module
