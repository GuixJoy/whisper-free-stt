#!/usr/bin/env bash
set -euo pipefail

# Build the Python STT engine as a standalone binary for Tauri sidecar.
# Output: stt-ui/src-tauri/binaries/stt-engine (actual binary)
#         stt-ui/src-tauri/binaries/stt-engine-{target_triple} -> stt-engine (symlink)

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

SIDECAR_DIR="$PROJECT_ROOT/stt-ui/src-tauri/binaries"
TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-$(rustc -vV | grep host | cut -d' ' -f2)}"

echo "Building sidecar for target: ${TARGET_TRIPLE}"

mkdir -p "$SIDECAR_DIR"

# Build the bare-named binary that dev mode needs
uv run python -m PyInstaller \
  --onefile \
  --name "stt-engine" \
  --distpath "$SIDECAR_DIR" \
  --workpath /tmp/pyinstaller-stt-work \
  --specpath /tmp/pyinstaller-stt-spec \
  --add-data "$PROJECT_ROOT/stt/prompts.py:stt" \
  --collect-all sounddevice \
  --collect-all numpy \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  --collect-all noisereduce \
  --hidden-import websockets \
  --hidden-import pywhispercpp \
  "$PROJECT_ROOT/stt/cli.py"

# Tauri v2 build mode looks for stt-engine-{target_triple}, dev mode looks for stt-engine.
# Symlink so only one 178MB copy exists on disk.
ln -sf "stt-engine" "${SIDECAR_DIR}/stt-engine-${TARGET_TRIPLE}"

echo "Sidecar binary:  ${SIDECAR_DIR}/stt-engine"
echo "Target symlink:  ${SIDECAR_DIR}/stt-engine-${TARGET_TRIPLE} -> stt-engine"
