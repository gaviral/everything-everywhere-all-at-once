#!/bin/sh
# Every test that needs no key and no network: the core's Rust tests, the UI's type check and build, and each
# offline UI check (scripts/*-check.mjs). CI runs this on every push; run it yourself the same way.
#   sh scripts/test.sh
# composer-check is left out: it needs a running core and real model calls.
set -u
cd "$(dirname "$0")/.." || exit 1
failed=0
[ -d ui/node_modules ] || (cd ui && npm ci --no-audit --no-fund) || exit 1

echo "== Rust tests (core)"
if out=$(cd core && cargo test --quiet 2>&1); then
  echo "PASS  $(echo "$out" | awk '/^test result/ { p += $4; i += $8 } END { print p " Rust tests pass (" i " ignored)" }')"
else echo "FAIL  core tests"; echo "$out" | grep -vE '^(running|test .* ok|\.+)' | tail -40; failed=1; fi

echo "== UI type check and build"
if out=$(cd ui && npm run --silent build 2>&1); then echo "PASS  UI builds"; else echo "FAIL  UI build"; echo "$out" | tail -30; failed=1; fi

echo "== UI checks"
total=0; passed=0
for c in scripts/*-check.mjs; do
  case "$c" in *composer-check.mjs) continue ;; esac
  total=$((total + 1)); name=$(basename "$c" .mjs)
  # Exit 3: the check can't run on this machine (points-check without Chrome), as precheck reads it: skipped, not failed.
  out=$(node "$c" 2>&1); rc=$?
  if [ $rc = 0 ]; then passed=$((passed + 1)); echo "PASS  $name"
  elif [ $rc = 3 ]; then total=$((total - 1)); echo "SKIP  $name: $(echo "$out" | tail -1 | sed 's/^SKIP [^:]*: //')"
  else echo "FAIL  $name"; echo "$out" | tail -20 | sed 's/^/        /'; failed=1; fi
done
echo "$passed of $total UI checks pass"
[ $failed = 0 ] && echo "OK: every offline test passes." || echo "Some tests failed (above)."
exit $failed
