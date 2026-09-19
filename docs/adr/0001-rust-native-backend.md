# ADR 0001: Rust-Native Backend (Replace Python Sidecar)

Status: accepted

## Context

The Tauri v2 + React UI originally drove a Python engine shipped as a
sidecar binary: the UI spawned it and spoke JSON events over stdout.
That meant two runtimes in one product — a Python venv plus native
ASR deps (`whisper.cpp` / `faster-whisper`, CUDA) — fragile IPC,
slow startup, and painful packaging (see `stt/build_sidecar.sh` era).

## Decision

Move the whole pipeline into the Tauri Rust backend
(`application/src-tauri/src`): `cpal` audio capture, Silero VAD, Parakeet /
Whisper via `sherpa-onnx`, local Gemma 3 via `llama.cpp`, DeepSeek /
OpenRouter for cloud cleanup. The JSON-over-stdout protocol is replaced
by typed Tauri commands in `lib.rs`.

## Consequences

- Single binary to ship; no Python runtime, no sidecar process to supervise.
- Typed IPC (Tauri commands) instead of line-delimited JSON over a pipe.
- Cost: the Rust ML ecosystem is narrower — ASR/LLM depend on
  `sherpa-onnx` / `llama.cpp` bindings, and model download management
  (`models.rs`) lives in-app instead of reusing Python tooling.
