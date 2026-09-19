# ADR 0003: Model Downloads as Proper Installs

Status: accepted

## Context

Models (VAD, Parakeet/Whisper, LLM) download on demand from GitHub
Releases and HuggingFace. The original downloader treated any HTTP
response as success, so a 404 body was saved as the model file, marked
"Downloaded" by directory existence, and retried identically forever —
every PTT press failed with an unactionable error string.

## Decision

- Manifest (`MODEL_MANIFEST` in `application/src-tauri/src/models.rs`) pins exact
  asset URLs and byte sizes; all URLs are HEAD-checked when touched.
- `download_model` is the single installer for both callers (pipeline lazy
  download, Models-page button via `ModelManager::download`, which targets
  the per-model dir):
  - non-2xx HTTP status fails fast with the status in the error;
  - partial files resume via `Range` (416 → already complete; 200 → restart);
  - byte-count completion check; corrupt archives are deleted on extraction
    failure so they can never latch;
  - archives stream through the decoder (no full-file RAM read), nested
    archive folders are hoisted and backend files normalized to the flat
    layout `verify_model` checks;
  - `.downloaded` is written only after `verify_model` passes, and is
    trusted on later runs only if verification still passes.
- `check_model_status` reports `verify()` truth, never directory existence.
- Progress (`model_download_progress`) and terminal failure
  (`model_download_error`) are Tauri events; `useModels` subscribes for
  live bars, `asr_error` surfaces through the error banner with the message.

## Consequences

- A failed install always says why (HTTP status, byte counts, missing
  files) in the UI, not just the dev console.
- Interrupted downloads resume; poisoned payloads self-heal within one
  retry cycle; disk layout is `<model_dir>/<manifest-id>/` with no stray
  nesting.
- On-disk layout: `~/.local/share/floure/models/` (override via
  `STT_DATA_DIR`, shared with ADR 0002).
