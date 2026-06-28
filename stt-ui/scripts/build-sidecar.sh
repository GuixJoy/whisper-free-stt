#!/usr/bin/env bash
set -euo pipefail

# Build the Python STT engine as a standalone binary for Tauri sidecar.
# Output: stt-ui/src-tauri/binaries/stt-engine (actual binary)
#         stt-ui/src-tauri/binaries/stt-engine-{target_triple} (actual binary)

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

SIDECAR_DIR="$PROJECT_ROOT/stt-ui/src-tauri/binaries"
TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-$(rustc -vV | grep host | cut -d' ' -f2)}"

echo "Building sidecar for target: ${TARGET_TRIPLE}"

mkdir -p "$SIDECAR_DIR"

# ── Compatibility: Detect OS path separator for PyInstaller --add-data ──
SEP=":"
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
  SEP=";"
fi

# ── Compatibility: Fallback command for Python/UV execution ──
if command -v uv &> /dev/null; then
  PYTHON_CMD="uv run python"
else
  if [ -f "$PROJECT_ROOT/.venv/bin/python" ]; then
    PYTHON_CMD="$PROJECT_ROOT/.venv/bin/python"
  elif [ -f "$PROJECT_ROOT/.venv/Scripts/python" ]; then
    PYTHON_CMD="$PROJECT_ROOT/.venv/Scripts/python"
  else
    PYTHON_CMD="python3"
  fi
fi

echo "Using Python command: ${PYTHON_CMD}"

# Define local, cross-platform build temporary directories (avoids failing on Windows due to no /tmp)
WORK_DIR="${SIDECAR_DIR}/build/work"
SPEC_DIR="${SIDECAR_DIR}/build/spec"
mkdir -p "$WORK_DIR" "$SPEC_DIR"

# Build the bare-named binary that dev mode needs
$PYTHON_CMD -m PyInstaller \
  --onefile \
  --name "stt-engine" \
  --distpath "$SIDECAR_DIR" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --add-data "${PROJECT_ROOT}/stt/prompts.py${SEP}stt" \
  --collect-all sounddevice \
  --collect-all numpy \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  --collect-all noisereduce \
  --hidden-import websockets \
  --hidden-import pywhispercpp \
  --hidden-import stt._cpp_worker \
  --exclude-module matplotlib \
  --exclude-module scipy \
  --exclude-module tensorflow \
  --exclude-module torch \
  --exclude-module tkinter \
  --exclude-module PyQt5 \
  --exclude-module PyQt6 \
  --exclude-module PIL \
  --exclude-module IPython \
  --exclude-module notebook \
  --exclude-module pytest \
  --exclude-module numpy.f2py.tests \
  --exclude-module numpy.random.tests \
  --exclude-module numpy.linalg.tests \
  --exclude-module numpy.ma.tests \
  --exclude-module numpy.matrixlib.tests \
  --exclude-module numpy.polynomial.tests \
  --exclude-module numpy.testing.tests \
  --exclude-module numpy.typing.tests \
  --exclude-module numpy.tests \
  "${PROJECT_ROOT}/stt/cli.py"

# Tauri v2 build mode looks for stt-engine-{target_triple}, dev mode looks for stt-engine.
# Copy so both exist as actual files (tauri_build doesn't follow symlinks).
cp "${SIDECAR_DIR}/stt-engine" "${SIDECAR_DIR}/stt-engine-${TARGET_TRIPLE}"

# Clean up local temporary build files
rm -rf "${SIDECAR_DIR}/build"

echo "Sidecar binary:  ${SIDECAR_DIR}/stt-engine"
echo "Target binary:  ${SIDECAR_DIR}/stt-engine-${TARGET_TRIPLE}"
