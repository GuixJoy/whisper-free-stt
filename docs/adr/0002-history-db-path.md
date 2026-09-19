# ADR 0002: History DB Path

Status: accepted

## Context

Transcripts persist in SQLite. The app was renamed `stt` → `floure`,
so the old path `~/.local/share/stt/history.db` no longer matches the
product name — but deleting users' history on upgrade is unacceptable.
Tests and the legacy Python backend also need to point the DB elsewhere.

## Decision

- Canonical data dir is `~/.local/share/floure`; the history DB is
  `<data_dir>/history.db`.
- `STT_DATA_DIR` env var overrides the data dir (shared with the Python
  backend convention).
- `history_db_path()` in `application/src-tauri/src/config.rs` is the single
  source of truth for the path.
- One-time forward migration: if the canonical DB is missing, no override
  is set, and the legacy `~/.local/share/stt/history.db` exists, it is
  copied into place.

## Consequences

- Fresh installs and upgrades converge on one canonical path.
- Legacy history survives the rename exactly once; afterwards the legacy
  file is inert (never written, never re-copied once canonical exists).
- Anything needing an isolated DB (tests, dev) sets `STT_DATA_DIR`.
