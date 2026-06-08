#!/usr/bin/env bash
set -euo pipefail

# Build the Python STT engine as a standalone binary for Tauri sidecar.
# Requires: PyInstaller, Python 3.11+, all stt deps installed.
# Output: stt-ui/src-tauri/binaries/stt-engine-{target_triple}

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

SIDECAR_DIR="$PROJECT_ROOT/stt-ui/src-tauri/binaries"
TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-$(rustc -vV | grep host | cut -d' ' -f2)}"
SIDECAR_OUTPUT="stt-engine-${TARGET_TRIPLE}"

echo "Building sidecar for target: ${TARGET_TRIPLE}"

mkdir -p "$SIDECAR_DIR"

uv run python -m PyInstaller \
  --onefile \
  --name "stt-engine-${TARGET_TRIPLE}" \
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

echo "Sidecar built: ${SIDECAR_DIR}/${SIDECAR_OUTPUT}"
echo "Add to tauri.conf.json → bundle.externalBin: [\"binaries/${SIDECAR_OUTPUT}\"]"
