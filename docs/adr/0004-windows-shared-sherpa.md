# ADR 0004: Shared Sherpa Linkage on the Windows Branch

Status: accepted (Windows_New branch only)

## Context

ADR 0001 requires a "single binary to ship" (no Python runtime, no sidecar
process). On Windows, the prebuilt sherpa-onnx **static** archive is built
with `/MT` (static CRT). Linking it into our `/MD` binary produced dozens
of `LNK2005` duplicate-symbol errors against `msvcprt` — the static objects
carry the C++ standard library with them. There is no `/MT` switch for our
side that Cargo can express per-target, and rebuilding sherpa from source
per machine is out of the question for a downloadable app.

## Decision

Link sherpa-onnx **shared** (`sherpa-onnx-c-api` + `onnxruntime` DLLs shipped
beside the exe) via the crate's `shared` feature, on all targets of this
branch (Cargo cannot scope features of one dependency to one target).

This contradicts the letter of ADR-0001 ("single binary"), but not its
intent: there is still no runtime, no interpreter, no sidecar process —
only native libraries next to the executable, as is standard on Windows.

## Consequences

- Windows: `floure.exe` + 5 DLLs in one folder; verified by linking and
  running the release binary locally (CI has no Windows job to do it).
- Linux/macOS: linkage changes from static to shared there too. The
  crate sets an rpath and copies the `.so`/`.dylib` files, but **merging
  this branch upstream must either bundle those libraries in the Tauri
  release or revert non-Windows targets to static first** — otherwise the
  Linux release ships without its libraries. Upstream releases are
  Linux-only (`release.yml`), so this is currently contained to the fork.
- Revisit if sherpa ships an `/MD` static archive for Windows.
