#!/usr/bin/env bash
# Smoke test: cheap end-to-end sanity checks for the Floure app.
#
# This is NOT a WebDriver e2e suite. It verifies the app builds, the frontend
# dev server serves HTML, and both test suites pass. Real UI automation would
# need tauri-driver + WebKitWebDriver (webkit2gtk-driver on Linux) and is not
# implemented.
#
# Usage:
#   ./scripts/smoke-test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"

echo "══════════════════════════════════════════"
echo "  Floure smoke test"
echo "══════════════════════════════════════════"

# Build with the memory cap: llama.cpp's C++ units are heavy and the default
# one-job-per-core will exhaust RAM on a 16-core box.
CARGO="$SCRIPT_DIR/cargo-mem.sh"

echo "→ Building Tauri app..."
cd "$TAURI_DIR"
"$CARGO" build 2>&1 | tail -3

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

run_test() {
    local name="$1"
    local command="$2"
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo -n "  TEST $TESTS_TOTAL: $name ... "
    if eval "$command" > /tmp/smoke_test_output.txt 2>&1; then
        echo "PASS"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "FAIL"
        echo "    Output: $(head -5 /tmp/smoke_test_output.txt)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

run_test "App binary exists" "test -f '$TAURI_DIR/target/debug/stt-ui'"

run_test "Frontend dev server serves HTML" \
    "timeout 20 bash -c 'cd $APP_DIR && npx vite --port 5173 &>/tmp/vite_smoke.log & sleep 5 && curl -sf http://localhost:5173 | grep -qi html && kill %1 2>/dev/null'"

run_test "Frontend tests pass" \
    "cd $APP_DIR && npx vitest run --reporter=dot 2>&1 | grep -q 'passed'"

run_test "Rust tests pass" \
    "cd $TAURI_DIR && '$CARGO' test 2>&1 | grep -q 'test result: ok'"

echo ""
echo "══════════════════════════════════════════"
echo "  Results: $TESTS_PASSED/$TESTS_TOTAL passed, $TESTS_FAILED failed"
echo "══════════════════════════════════════════"

if [ "$TESTS_FAILED" -gt 0 ]; then
    exit 1
fi
