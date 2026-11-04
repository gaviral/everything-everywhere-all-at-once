#!/bin/sh
# Every test that needs no key and no network: the core's Rust tests, the UI's type check and build, and each
# offline UI check (scripts/*-check.mjs). CI runs this on every push; run it yourself the same way.
#   sh scripts/test.sh
# composer-check is left out: it needs a running core and real model calls.
set -u
cd "$(dirname "$0")/.." || exit 1
failed=0
# Only the optional host runner may admit concurrent checks. Its policy also
# serializes inherited heavy leases and pressure; never share a suite lease.
jobs=1
if [ -n "${PRECHECK_RUNNER:-}" ]; then
  policy=$(python3 "$PRECHECK_RUNNER" --jobs) || policy=1
  if [ "$policy" = 2 ] && [ "${PRECHECK_JOBS:-2}" != 1 ]; then jobs=2; fi
fi
check_logs=$(mktemp -d "${TMPDIR:-/tmp}/offline-checks.XXXXXX") || exit 1
trap 'rm -rf "$check_logs"' EXIT
[ -d ui/node_modules ] || (cd ui && npm ci --no-audit --no-fund) || exit 1

echo "== Rust tests (core)"
if (cd core && cargo test --quiet) > "$check_logs/core.log" 2>&1; then
  echo "PASS  $(awk '/^test result/ { p += $4; i += $8 } END { print p " Rust tests pass (" i " ignored)" }' "$check_logs/core.log")"
else echo "FAIL  core tests"; grep -vE '^(running|test .* ok|\.+)' "$check_logs/core.log" | tail -40; failed=1; fi

echo "== UI type check and build"
if (cd ui && npm run --silent build) > "$check_logs/build.log" 2>&1; then echo "PASS  UI builds"; else echo "FAIL  UI build"; tail -30 "$check_logs/build.log"; failed=1; fi

echo "== UI checks"
# xargs waits for every worker. Each worker writes only its own files; reporting
# and standalone timing rows are emitted below in the original filename order.
for c in scripts/*-check.mjs; do
  case "$c" in *composer-check.mjs) continue ;; esac
  printf '%s\0' "$c"
done | xargs -0 -n 1 -P "$jobs" sh -c '
  check_logs=$1; runner=$2; c=$3
  name=$(basename "$c" .mjs)
  start=$(date +%s)
  if [ -n "$runner" ]; then
    python3 "$runner" --check "$c" > "$check_logs/$name.log" 2>&1
  else
    node "$c" > "$check_logs/$name.log" 2>&1
  fi
  rc=$?
  printf "%s\n" "$(($(date +%s)-start))" > "$check_logs/$name.elapsed" || exit 1
  printf "%s\n" "$rc" > "$check_logs/$name.status"
' sh "$check_logs" "${PRECHECK_RUNNER:-}" || {
  echo "FAIL  UI check worker"; failed=1
}
total=0; passed=0
for c in scripts/*-check.mjs; do
  case "$c" in *composer-check.mjs) continue ;; esac
  total=$((total + 1)); name=$(basename "$c" .mjs)
  rc=$(cat "$check_logs/$name.status" 2>/dev/null) || rc=missing
  # The runner writes execution and lease-wait timings itself. Standalone runs
  # retain the host TSV's three-column name/exit/elapsed format.
  if [ -z "${PRECHECK_RUNNER:-}" ] && [ -n "${PRECHECK_TIMINGS:-}" ]; then
    elapsed=$(cat "$check_logs/$name.elapsed" 2>/dev/null) || elapsed=0
    printf '%s\t%s\t%s\n' "$name" "$rc" "$elapsed" >> "$PRECHECK_TIMINGS" || failed=1
  fi
  # Exit 3: unavailable on this machine, skipped rather than failed.
  if [ "$rc" = 0 ]; then passed=$((passed + 1)); echo "PASS  $name"
  elif [ "$rc" = 3 ]; then total=$((total - 1)); echo "SKIP  $name: $(tail -1 "$check_logs/$name.log" | sed 's/^SKIP [^:]*: //')"
  else
    echo "FAIL  $name"
    [ "$rc" != missing ] || echo "        missing worker status"
    tail -20 "$check_logs/$name.log" 2>/dev/null | sed 's/^/        /'
    failed=1
  fi
done
echo "$passed of $total UI checks pass"
[ $failed = 0 ] && echo "OK: every offline test passes." || echo "Some tests failed (above)."
exit $failed
