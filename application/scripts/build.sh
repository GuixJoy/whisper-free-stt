#!/usr/bin/env bash
set -euo pipefail

# Build script: auto-detects available bundlers
# - CI (GitHub Actions): builds all targets (appimagetool is installed)
# - Local: builds only targets whose tools are available

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

TARGETS=""

case "$(uname -s)" in
  Linux)
    command -v dpkg-deb &>/dev/null && TARGETS="${TARGETS:+$TARGETS,}deb"
    command -v rpmbuild &>/dev/null && TARGETS="${TARGETS:+$TARGETS,}rpm"
    command -v appimagetool &>/dev/null && TARGETS="${TARGETS:+$TARGETS,}appimage"
    ;;
  Darwin)
    command -v hdiutil &>/dev/null && TARGETS="${TARGETS:+$TARGETS,}dmg"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    TARGETS="nsis"
    ;;
esac

if [ -z "$TARGETS" ]; then
  echo "Error: no installers available for $(uname -s). Install dpkg-deb, rpmbuild, or appimagetool." >&2
  exit 1
fi

echo "Building bundles: $TARGETS"

exec npx tauri build --bundles "$TARGETS" "$@"
