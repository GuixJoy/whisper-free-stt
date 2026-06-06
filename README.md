# STT — Local Speech-to-Text Assistant

Local-first Python speech-to-text for Linux Wayland.

Listens to your microphone, auto-detects speech/silence (adaptive VAD with
hysteresis + noise-floor calibration), transcribes, cleans up text with LLM by
default, and types output into your currently focused input field.

## Architecture

```
mic → sounddevice → numpy arrays → VAD → audio segments
                                          ↓
                                   faster-whisper
                                          ↓
                                [OpenRouter LLM rewrite]
                                          ↓
                                 [wl-copy clipboard]
                                          ↓
                                       stdout
```

**Core principle:** pure functions at the center, effects at the edges.

- `stt/config.py` — immutable dataclass config (pure)
- `stt/types.py` — immutable data types (pure)
- `stt/prompts.py` — centralized prompt templates (pure)
- `stt/vad.py` — voice-activity detection over numpy (pure)
- `stt/audio_capture.py` — microphone I/O boundary (effectful)
- `stt/transcription.py` — faster-whisper I/O boundary (effectful)
- `stt/llm.py` — OpenRouter HTTP boundary (effectful)
- `stt/clipboard.py` — wl-copy subprocess boundary (effectful)
- `stt/orchestrator.py` — imperative shell wiring (effectful)
- `stt/cli.py` — arg parsing and config construction (effectful)

## Install

```bash
uv venv
source .venv/bin/activate
uv pip install -e .

# Optional: system deps
sudo apt install wl-clipboard wtype    # Debian/Ubuntu
```

## Quickstart with .env

```bash
cp .env.example .env
# Edit .env — paste your OpenRouter key
```

## Run

```bash
# Basic: listen → transcribe → cleanup → type into focused input
stt   # or: sst

# Disable typing (print-only flow)
stt --no-type

# Override cleanup mode on the CLI
stt --llm-mode bullet_list

# With clipboard output
stt --clipboard

# Full pipeline with larger model
stt --llm-mode cleanup --clipboard --model small

# Auto-select best default (GPU: distil+cuda+fp16, CPU-only: whisper.cpp balanced)
stt

# Force high-quality distil-whisper profile on GPU
stt --asr-profile distil --device cuda --compute-type float16

# See all options
stt --help
```

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--sample-rate` | 16000 | Audio sample rate (Hz) |
| `--device-index` | auto | Force specific mic |
| `--silence-threshold` | 0.005 | Base RMS floor for adaptive VAD |
| `--silence-duration` | 1.5 | Seconds of silence to end utterance |
| `--min-duration` | 0.5 | Ignore utterances shorter than this |
| `--model` | profile-dependent | model name override |
| `--asr-profile` | auto | auto / speed / balanced / accuracy / distil / turbo |
| `--compute-type` | auto | auto / int8 / float16 / ... |
| `--device` | auto | auto / cpu / cuda |
| `--llm-mode` | cleanup | off / cleanup / bullet_list / email / commit_message |
| `--llm-model` | env | Primary OpenRouter model (env: `STT_LLM_MODEL`) |
| `--llm-fallback` | env | Fallback model (env: `STT_LLM_FALLBACK`) |
| `--no-type` | false | Disable typing to focused input |
| `--type-path` | wtype | Typing binary path |
| `--clipboard` | false | Enable wl-copy clipboard output |

## Insertion points

### OpenRouter — already wired

Set `--llm-mode` to anything except `off`.  See `stt/llm.py` and `stt/prompts.py`.
To add a new rewrite mode:

1. Add the enum value in `stt/config.py` → `LLMMode`.
2. Add the instruction string in `stt/prompts.py` → `_MODE_INSTRUCTIONS`.
3. Done — the orchestrator, CLI, and LLM module pick it up automatically.

### wl-copy — already wired

Pass `--clipboard`.  See `stt/clipboard.py`.

## Test plan

1. `python -c "from stt.config import AppConfig; c = AppConfig(); print(c)"`
   — config constructs cleanly.
2. `python -c "from stt.vad import compute_rms; import numpy as np; print(compute_rms(np.zeros(1000, dtype=np.float32)))"` — returns 0.0.
3. `python -c "from stt.prompts import build_user_prompt; from stt.config import LLMMode; print(build_user_prompt('hello', LLMMode.CLEANUP))"` — returns formatted prompt.
4. Run `stt --help` — all flags appear.
5. Run `stt` with a mic, speak a sentence, confirm transcript appears.
6. Run `stt --llm-mode cleanup` with `OPENROUTER_API_KEY` set — confirm rewrite.
7. Run `stt --clipboard` then `wl-paste` — confirm clipboard contents.
8. Run `stt --model small` — confirm larger model loads and transcribes.

## Example session

```
$ stt --llm-mode cleanup

╔══════════════════════════════════╗
║   STT — Local Speech-to-Text    ║
╚══════════════════════════════════╝

Microphone: index=1
Whisper model: tiny
LLM mode: cleanup
Clipboard: disabled

Listening... (Ctrl+C to stop)
----------------------------------------
[raw] um so I think we should refactor the the config module to use uh frozen dataclasses
[cleanup] I think we should refactor the config module to use frozen dataclasses.
----------------------------------------
^C
Done.
```

## Adding a Tkinter UI later

1. Create `stt/ui.py` with a class or function-based Tkinter window.
2. Run the orchestrator in a background thread; push transcripts via a
   `queue.Queue` to the UI thread.
3. The UI reads from the queue and updates a text widget.
4. Since all pure logic is already in `stt/vad.py`, `stt/prompts.py`,
   `stt/config.py`, and `stt/types.py`, the Tkinter layer only needs to
   consume the same `AppConfig` and call `_process_one_utterance` in a loop.
5. The orchestrator's `_process_one_utterance` is already factored so you
   can call it from any event loop (Tkinter, asyncio, etc.) by passing the
   VAD stop predicate.
