#!/usr/bin/env bash
# Run cargo with parallelism capped to half of available memory.
#
# Why: llama.cpp's C++ translation units are memory-hungry (measured in the
# multi-GiB range for a single -O3 unit). Cargo defaults to one job per core,
# so on a 16-core box the build runs -j16 and exhausts RAM — that is how a
# build crashed this machine with swap already full. This caps jobs to a
# budget of MemAvailable / 2 and forwards the same cap to CMake
# (llama-cpp-sys builds llama.cpp via cmake, which reads
# CMAKE_BUILD_PARALLEL_LEVEL, not CARGO_BUILD_JOBS).
#
# Usage:
#   ./scripts/cargo-mem.sh test
#   ./scripts/cargo-mem.sh check
#   ./scripts/cargo-mem.sh build --release
#
# Tuning:
#   CARGO_JOB_MEM_MB  per-job memory estimate (default 2048; raise if you OOM)
#   CARGO_JOB_MIN     floor for the job count (default 1)
#
# NOTE: this is a guard, not a guarantee. Close memory hogs (browsers) before
# a from-scratch llama.cpp build.
set -euo pipefail

PER_JOB_MB="${CARGO_JOB_MEM_MB:-2048}"
MIN_JOBS="${CARGO_JOB_MIN:-1}"
# Below this much free swap there is no headroom to absorb a spike, so run
# single-threaded regardless of the memory budget.
MIN_SWAP_MB="${CARGO_MIN_SWAP_MB:-512}"

if [ ! -r /proc/meminfo ]; then
    # Non-Linux fallback: don't guess, leave cargo's default alone.
    exec cargo "$@"
fi

avail_mb=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
swap_free_mb=$(awk '/^SwapFree:/ {print int($2 / 1024)}' /proc/meminfo)

budget_mb=$(( avail_mb / 2 ))
jobs=$(( budget_mb / PER_JOB_MB ))
[ "$jobs" -lt "$MIN_JOBS" ] && jobs="$MIN_JOBS"

reason="budget=${budget_mb}MiB / ${PER_JOB_MB}MiB"
if [ "$swap_free_mb" -lt "$MIN_SWAP_MB" ] && [ "$jobs" -gt 1 ]; then
    jobs=1
    reason="swap free ${swap_free_mb}MiB < ${MIN_SWAP_MB}MiB — no headroom"
fi

# Enforce the budget at the kernel level, not just by choosing a job count.
# A job-count estimate is a guess; a cgroup MemoryMax is a hard ceiling, so an
# over-budget build gets OOM-killed instead of taking the whole desktop down
# (and MemorySwapMax=0 stops it from thrashing swap). Re-exec once under the
# scope, guarded so we cannot recurse.
if [ -z "${CARGO_MEM_SCOPED:-}" ] && command -v systemd-run >/dev/null 2>&1; then
    echo "[cargo-mem] MemAvailable=${avail_mb}MiB  swapFree=${swap_free_mb}MiB  ->  jobs=${jobs}  (${reason})" >&2
    echo "[cargo-mem] enforcing MemoryMax=${budget_mb}M MemorySwapMax=0 via systemd-run scope" >&2
    export CARGO_MEM_SCOPED=1
    export CARGO_BUILD_JOBS="$jobs"
    export CMAKE_BUILD_PARALLEL_LEVEL="$jobs"
    exec systemd-run --user --scope --quiet \
        -p "MemoryMax=${budget_mb}M" \
        -p MemorySwapMax=0 \
        -- "$0" "$@"
fi

export CARGO_BUILD_JOBS="$jobs"
export CMAKE_BUILD_PARALLEL_LEVEL="$jobs"

echo "[cargo-mem] MemAvailable=${avail_mb}MiB  swapFree=${swap_free_mb}MiB  ->  jobs=${jobs}  (${reason})" >&2
exec cargo "$@"
