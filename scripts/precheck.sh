#!/bin/sh
# Pre-release security check: run before every push that others will see, and before making the repo public.
#   sh scripts/precheck.sh            # static checks and tests
#   ./run.sh demo & sh scripts/precheck.sh   # with the app running, also probes it live on :4321 (or $PORT)
#   ./run.sh room & sh scripts/precheck.sh   # the same for a room, from this laptop's network address
# FAIL lines stop a release (non-zero exit); WARN lines are known open decisions.
cd "$(dirname "$0")/.." || exit 1
failed=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failed=1; }
warn() { echo "WARN  $1"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
tracked() { git ls-files -z | xargs -0 grep -IlE "$1" -- 2>/dev/null | grep -v '^scripts/precheck.sh$'; }

check ".gitignore covers .env and data/" "grep -qx '.env' .gitignore && grep -qx 'data/' .gitignore"
check "no .env, journal or data files tracked" "! git ls-files | grep -qE '(^|/)\.env$|journal|^data/'"
check "no key-like strings tracked" "[ -z \"\$(tracked '(sk|pk|key)-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,}|MODEL_API_KEY=[A-Za-z0-9_-]{16,}')\" ]"
check "no key-like strings anywhere in git history" "! git log --all -p 2>/dev/null | grep -qE '(sk|pk|key)-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,}|MODEL_API_KEY=[A-Za-z0-9_-]{16,}'"
check "run.sh parses" "sh -n run.sh"
if [ -d ui/node_modules ]; then check "UI builds" "(cd ui && npm run --silent build > /dev/null 2>&1)"; else warn "UI build skipped: run ./run.sh once to install, then precheck builds it"; fi
[ -f LICENSE ] || warn "no LICENSE file yet (User's call; MIT suggested)"
check "no absolute home paths tracked" "[ -z \"\$(tracked '/Users/[A-Za-z]|/home/[A-Za-z]')\" ]"
check "no code or paths from the author's other projects (hackathon rule: new work only)" "[ -z \"\$(tracked '/code/(e2a2o|e2a2o|canvas)|e2a2o-memory|e2a2o|e2a2o (codex|muse|cursor)')\" ]"
check "core listens on 127.0.0.1 unless a room is open" "grep -qF 'if room.is_some() { \"0.0.0.0\" } else { \"127.0.0.1\" }' core/src/main.rs && grep -qF 'TcpListener::bind((address, port))' core/src/main.rs"
check "core refuses other sites (Origin and Host)" "grep -q 'header::ORIGIN' core/src/main.rs && grep -q 'header::HOST' core/src/main.rs && grep -q 'from_fn_with_state(core.clone(), gate)' core/src/main.rs"
check "a room keeps the map behind its code (tested)" "grep -q 'fn a_room_lets_the_other_laptop_in_with_the_code' core/src/main.rs"
check "model calls have a timeout (test fixtures aside)" "python3 -c 'import glob, sys; sys.exit(any(\"reqwest::Client::new()\" in open(f).read().split(\"#[cfg(test)]\")[0] for f in glob.glob(\"core/src/**/*.rs\", recursive=True) if not f.endswith(\"tests.rs\")))'"
check "model guards catch what they should (self-test)" "python3 scripts/model-guards.py self-test > /dev/null"
check "every runtime model is Meta's (hackathon rule): no other SDK, endpoint or model" "python3 scripts/model-guards.py meta-only"
check "every model call counts toward the hourly cap (tested)" "python3 scripts/model-guards.py counted && grep -q 'fn past_the_cap_nothing_is_sent' core/src/model.rs"
check "UI never injects raw HTML" "! grep -rq dangerouslySetInnerHTML ui/src"
check "core tests pass" "(cd core && cargo test --quiet >/dev/null 2>&1)"
# A sample must come with a picture file for every thread, or the Palace is blank for anyone without a key.
samples_have_pictures() {
  for journal in samples/*.jsonl; do
    map=$(basename "$journal" .jsonl)
    [ "$(grep -c '"type":"thread_added"' "$journal")" = "$(grep -c '"type":"thread_picture"' "$journal")" ] || return 1
    for name in $(grep -o '"type":"thread_picture"[^}]*' "$journal" | sed 's|.*"path":"/images/||; s|"$||'); do
      [ -f "samples/images/$map/$name" ] || return 1
    done
  done
}
check "samples: every thread has its picture shipped (no blank Palace without a key)" samples_have_pictures

port=${PORT:-4321}
if curl -s --max-time 2 -o /dev/null http://127.0.0.1:$port/; then
  code() { curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$@"; }
  ws() { code -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$@"; }
  check "live: another site's WebSocket is refused" "[ \"\$(ws -H 'Origin: https://example.com' http://127.0.0.1:$port/ws)\" = 403 ]"
  check "live: a rebinding Host is refused" "[ \"\$(code -H 'Host: example.com' http://127.0.0.1:$port/)\" = 403 ]"
  check "live: the app's own page still connects" "[ \"\$(ws -H 'Origin: http://localhost:$port' http://127.0.0.1:$port/ws)\" = 101 ]"
  # Through this laptop's network address, the way another laptop comes in.
  ip=$( (ipconfig getifaddr en0 || hostname -I) 2>/dev/null | awk 'NR == 1 { print $1 }')
  if [ -z "$ip" ]; then
    warn "no network address found, room probes skipped"
  elif curl -s --max-time 2 http://127.0.0.1:$port/room | grep -q '"room":true'; then
    check "live: in a room, the map needs the code" "[ \"\$(ws http://$ip:$port/ws)\" = 403 ] && [ \"\$(code http://$ip:$port/images/x)\" = 403 ]"
    check "live: in a room, other sites are still refused" "[ \"\$(ws -H 'Origin: https://example.com' http://$ip:$port/ws)\" = 403 ]"
  else
    check "live: alone, the core isn't on the network" "[ \"\$(code http://$ip:$port/)\" = 000 ]"
  fi
else
  warn "app not running on :$port, live probes skipped"
fi

grep -q 'contributor' core/src/main.rs && warn "default placer model is a contributor model (may keep data for training)"
grep -q 'e2a2o' run.sh && warn "run.sh names the developer's Keychain item"
# Placeholders the owner still has to decide on (pitch, cover, ...) must not ship unnoticed.
for marker in $(grep -oE '<!-- [a-z]+: (draft|stand-in)' README.md | awk '{print $2}' | tr -d ':'); do warn "README still has a $marker placeholder for User to decide"; done
# So do numbers in the code marked "stand-in:" until the measurement their comment names replaces them.
for at in $(grep -rn --exclude-dir=target 'stand-in:' core ui/src | cut -d: -f1,2); do warn "stand-in numbers wait for a measurement at $at"; done
grep -q 'timeout' core/src/asr.rs || warn "speech stream has no read timeout"
[ $failed = 0 ] && echo "OK: nothing blocks a release." || echo "Fix the FAIL lines first."
exit $failed
