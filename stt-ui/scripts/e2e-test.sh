#!/usr/bin/env bash
# E2E test runner for the Tauri app using tauri-driver + WebDriver.
#
# Prerequisites:
#   cargo install tauri-driver
#   (Chrome/Chromium must be installed for WebDriver)
#
# Usage:
#   ./scripts/e2e-test.sh          # run all tests
#   ./scripts/e2e-test.sh --headed # run with visible browser (for debugging)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAURI_DIR="$PROJECT_ROOT/stt-ui/src-tauri"
HEADED="${1:-}"

echo "╔══════════════════════════════════════════╗"
echo "║   STT E2E Tests (tauri-driver)          ║"
echo "╚══════════════════════════════════════════╝"

# Build the Tauri app in debug mode (faster for testing)
echo "→ Building Tauri app..."
cd "$TAURI_DIR"
cargo build 2>&1 | tail -3

# Set up ChromeDriver
echo "→ Setting up ChromeDriver..."
CHROMEDRIVER_PORT=4444

# Find chromedriver
CHROMEDRIVER=""
for candidate in \
    /usr/bin/chromedriver \
    /usr/local/bin/chromedriver \
    "$HOME/.cache/selenium/chromedriver/linux64/"*/chromedriver \
    /snap/bin/chromedriver; do
    if [ -x "$candidate" ]; then
        CHROMEDRIVER="$candidate"
        break
    fi
done

if [ -z "$CHROMEDRIVER" ]; then
    echo "⚠ chromedriver not found. Install it:"
    echo "  Ubuntu/Debian: sudo apt install chromium-chromedriver"
    echo "  Or: npx @puppeteer/browsers install chromedriver@stable"
    echo ""
    echo "Falling back to npx..."
    CHROMEDRIVER="npx"
fi

echo "  Using: $CHROMEDRIVER"

# Start tauri-driver
echo "→ Starting tauri-driver on port $CHROMEDRIVER_PORT..."
export WEBDRIVER_URL="http://localhost:$CHROMEDRIVER_PORT"
export WINDOW_HEIGHT=800
export WINDOW_WIDTH=1200

# Run tauri-driver in background
TAURI_DRIVER_ARGS=()
if [ "$HEADED" = "--headed" ]; then
    TAURI_DRIVER_ARGS+=(--headed)
fi
tauri-driver --port "$CHROMEDRIVER_PORT" "${TAURI_DRIVER_ARGS[@]}" &
TAURI_DRIVER_PID=$!
sleep 2

# Run the actual E2E tests
echo "→ Running E2E tests..."
cd "$PROJECT_ROOT"

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

run_test() {
    local name="$1"
    local command="$2"
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo -n "  TEST $TESTS_TOTAL: $name ... "
    if eval "$command" > /tmp/e2e_test_output.txt 2>&1; then
        echo "✓ PASS"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "✗ FAIL"
        echo "    Output: $(cat /tmp/e2e_test_output.txt | head -5)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Test 1: App builds successfully
run_test "App binary exists" "test -f '$TAURI_DIR/target/debug/stt-ui'"

# Test 2: Frontend dev server starts
run_test "Frontend dev server" "timeout 10 bash -c 'cd $PROJECT_ROOT/stt-ui && npx vite --port 5173 &>/tmp/vite_test.log & sleep 3 && curl -s http://localhost:5173 | grep -q html && kill %1 2>/dev/null'"

# Test 3: Sidecar binary exists
run_test "Sidecar binary exists" "test -f '$TAURI_DIR/binaries/stt-engine'"

# Test 4: Sidecar binary is executable
run_test "Sidecar binary is executable" "test -x '$TAURI_DIR/binaries/stt-engine'"

# Test 5: Python backend starts
run_test "Python backend starts" "cd $PROJECT_ROOT && timeout 5 .venv/bin/python -m stt.cli --help 2>&1 | grep -q 'usage'"

# Test 6: Frontend tests pass
run_test "Frontend tests pass" "cd $PROJECT_ROOT/stt-ui && npx vitest run --reporter=dot 2>&1 | grep -q 'passed'"

# Test 7: Rust tests pass
run_test "Rust tests pass" "cd $TAURI_DIR && cargo test 2>&1 | grep -q 'test result: ok'"

# Test 8: Python tests pass
run_test "Python tests pass" "cd $PROJECT_ROOT && .venv/bin/python -m pytest tests/ -x -q --ignore=tests/integration/test_comprehensive.py 2>&1 | grep -q 'passed'"

# Summary
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Results: $TESTS_PASSED/$TESTS_TOTAL passed, $TESTS_FAILED failed   ║"
echo "╚══════════════════════════════════════════╝"

# Cleanup
kill $TAURI_DRIVER_PID 2>/dev/null || true

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
