#!/bin/sh
# Pre-release security check: run before every push that others will see, and before making the repo public.
#   sh scripts/precheck.sh            # static checks and tests
#   ./run.sh demo & sh scripts/precheck.sh   # with the app running, also probes it live on :4321 (or $PORT)
#   ./run.sh room & sh scripts/precheck.sh   # the same for a room, from this laptop's network address
#   PUBLIC_URL=https://….trycloudflare.com PORT=4410 sh scripts/precheck.sh   # a trial's core (scripts/trial.sh prints it)
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
# Every demo beat has an offline check (scripts/*-check.mjs); a broken beat fails here, so it can't merge.
# composer-check needs a live core and real model calls, so it isn't one of them.
if [ -d ui/node_modules ]; then
  for c in scripts/*-check.mjs; do
    case "$c" in *composer-check.mjs) continue ;; esac
    check "$(basename "$c" .mjs) passes" "node $c > /dev/null 2>&1"
  done
else warn "UI checks skipped: run ./run.sh once to install"; fi
[ -f LICENSE ] || warn "no LICENSE file yet (User's call; MIT suggested)"
check "no absolute home paths tracked" "[ -z \"\$(tracked '/Users/[A-Za-z]|/home/[A-Za-z]')\" ]"
check "no code or paths from the author's other projects (hackathon rule: new work only)" "[ -z \"\$(tracked '/code/(e2a2o|e2a2o|canvas)|e2a2o-memory|e2a2o|e2a2o (codex|muse|cursor)')\" ]"
check "core listens on 127.0.0.1 unless a room is open" "grep -qF 'if room.is_some() { \"0.0.0.0\" } else { \"127.0.0.1\" }' core/src/main.rs && grep -qF 'TcpListener::bind((address, port))' core/src/main.rs"
check "core refuses other sites (Origin and Host)" "grep -q 'header::ORIGIN' core/src/main.rs && grep -q 'header::HOST' core/src/main.rs && grep -q 'from_fn_with_state(core.clone(), gate)' core/src/main.rs"
check "a room keeps the map behind its code (tested)" "grep -q 'fn a_room_lets_the_other_laptop_in_with_the_code' core/src/main.rs"
check "a tunnel lets in only its own name, with the code, and no one as host (tested)" "grep -q 'fn tunnel_mode_refuses_every_other_way_in' core/src/tunnel.rs && grep -q 'fn through_the_tunnel_a_friend_joins_as_a_guest_never_the_host' core/src/main.rs"
check "trial.sh parses and never opens an existing map" "sh -n scripts/trial.sh && grep -q 'mkdir \"\$data\"' scripts/trial.sh"
check "model calls have a timeout (test fixtures aside)" "python3 -c 'import glob, sys; sys.exit(any(\"reqwest::Client::new()\" in open(f).read().split(\"#[cfg(test)]\")[0] for f in glob.glob(\"core/src/**/*.rs\", recursive=True) if not f.endswith(\"tests.rs\")))'"
check "model guards catch what they should (self-test)" "python3 scripts/model-guards.py self-test > /dev/null"
check "every runtime model is Meta's (hackathon rule): no other SDK, endpoint or model" "python3 scripts/model-guards.py meta-only"
check "every model call counts toward the hourly cap (tested)" "python3 scripts/model-guards.py counted && grep -q 'fn past_the_cap_nothing_is_sent' core/src/model.rs"
check "UI never injects raw HTML" "! grep -rq dangerouslySetInnerHTML ui/src"
# Claims stay modest and non-medical: the app helps people keep their threads; it doesn't diagnose or treat anything,
# so nothing a judge or user reads may say or suggest it (README, docs, UI copy, sample maps, demo talk, prompts).
# Allowed: "treat ... as" (model output is treated as data) and a refusal ("never give medical advice", Explain's guard).
medical_wording() {
  git ls-files -z -- README.md CHANGELOG.md 'docs/*.md' ui/src ui/index.html 'samples/*.jsonl' 'scripts/*.jsonl' core/src |
    xargs -0 perl -nle 'BEGIN { $re = qr/\b(adhd|neurodivergent|mental health|diagnos(e|es|ed|is|ing)|treat(s|ed|ing|ments?)?|therap(y|ies|ist|ists|eutic)|cur(e|es|ed|ing)|medical(ly)?|symptoms?|clinical(ly)?)\b/i }
      ($l = $_) =~ s/\btreat(s|ed|ing)?\b[^.]{0,60}?\bas\b//gi; $l =~ s/\b(never|not|no)(\s+\S+){0,3}?\s+medical\b//gi; print "$ARGV:$.: " . substr($_, 0, 140) if $l =~ $re; close ARGV if eof'
}
claims=$(medical_wording)
if [ -z "$claims" ]; then pass "no medical or diagnosis wording in README, docs, UI copy or samples"
else fail "medical or diagnosis wording (modest, non-medical claims only):"; echo "$claims" | sed 's/^/        /'; fi
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
# Local room probes accept our self-signed certificate; this does not install trust anywhere.
code() { curl -ks --max-time 2 -o /dev/null -w '%{http_code}' "$@"; }
ws() { code -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$@"; }
ip=$( (ipconfig getifaddr en0 || hostname -I) 2>/dev/null | awk 'NR == 1 { print $1 }')
if [ "$(code http://127.0.0.1:$port/)" = 403 ] && [ -n "${PUBLIC_URL:-}" ]; then
  # A trial's core: requests come as cloudflared hands them over (from this machine, the tunnel's Host, the visitor's address).
  th=${PUBLIC_URL#https://}; th=${th%/}; via="-H Host:$th -H cf-connecting-ip:203.0.113.7"
  check "live tunnel: the page opens through the tunnel" "[ \"\$(code $via http://127.0.0.1:$port/)\" = 200 ]"
  check "live tunnel: the map needs the code" "[ \"\$(ws $via -H 'Origin: https://$th' http://127.0.0.1:$port/ws)\" = 403 ] && [ \"\$(code $via http://127.0.0.1:$port/images/x)\" = 403 ]"
  check "live tunnel: another site's WebSocket is refused" "[ \"\$(ws $via -H 'Origin: https://example.com' http://127.0.0.1:$port/ws)\" = 403 ]"
  check "live tunnel: a rebinding Host is refused" "[ \"\$(code -H 'Host: example.com' -H 'cf-connecting-ip: 203.0.113.7' http://127.0.0.1:$port/)\" = 403 ]"
  check "live tunnel: no visitor address, or this machine's, is refused" "[ \"\$(code -H 'Host: $th' http://127.0.0.1:$port/)\" = 403 ] && [ \"\$(code -H 'Host: $th' -H 'cf-connecting-ip: 127.0.0.1' http://127.0.0.1:$port/)\" = 403 ]"
  check "live tunnel: this laptop's localhost is refused (no one is the host)" "[ \"\$(ws -H 'Origin: http://localhost:$port' http://127.0.0.1:$port/ws)\" = 403 ]"
  [ -z "$ip" ] || check "live tunnel: the core isn't on the network" "[ \"\$(code http://$ip:$port/)\" = 000 ]"
  check "live tunnel: the public link answers" "curl -s --max-time 5 $PUBLIC_URL/room | grep -q '\"tunnel\":true'"
elif [ "$(code http://127.0.0.1:$port/)" = 403 ]; then
  warn "the core on :$port refuses this laptop (a trial's?): run again with PUBLIC_URL set to probe it"
elif curl -s --max-time 2 -o /dev/null http://127.0.0.1:$port/; then
  check "live: another site's WebSocket is refused" "[ \"\$(ws -H 'Origin: https://example.com' http://127.0.0.1:$port/ws)\" = 403 ]"
  check "live: a rebinding Host is refused" "[ \"\$(code -H 'Host: example.com' http://127.0.0.1:$port/)\" = 403 ]"
  check "live: the app's own page still connects" "[ \"\$(ws -H 'Origin: http://localhost:$port' http://127.0.0.1:$port/ws)\" = 101 ]"
  # Through this laptop's network address, the way another laptop comes in.
  if [ -z "$ip" ]; then
    warn "no network address found, room probes skipped"
  elif curl -s --max-time 2 http://127.0.0.1:$port/room | grep -q '"room":true'; then
    room_url="http://$ip:$port"
    [ "$(code "https://$ip:$port/")" = 200 ] && room_url="https://$ip:$port"
    check "live: in a room, the map needs the code" "[ \"\$(ws $room_url/ws)\" = 403 ] && [ \"\$(code $room_url/images/x)\" = 403 ]"
    check "live: in a room, other sites are still refused" "[ \"\$(ws -H 'Origin: https://example.com' $room_url/ws)\" = 403 ]"
  else
    check "live: alone, the core isn't on the network" "[ \"\$(code http://$ip:$port/)\" = 000 ]"
  fi
else
  warn "app not running on :$port, live probes skipped"
fi

grep -q '"muse-spark-1.2-contributor"' core/src/main.rs && warn "default placer model is a contributor model (may keep data for training)"
check "run.sh names no other project's Keychain item" "! grep -q 'e2a2o' run.sh"
# Placeholders the owner still has to decide on (pitch, cover, ...) must not ship unnoticed.
for marker in $(grep -oE '<!-- [a-z]+: (draft|stand-in)' README.md | awk '{print $2}' | tr -d ':'); do warn "README still has a $marker placeholder for User to decide"; done
# So do numbers in the code marked "stand-in:" until the measurement their comment names replaces them.
for at in $(grep -rn --exclude-dir=target 'stand-in:' core ui/src | cut -d: -f1,2); do warn "stand-in numbers wait for a measurement at $at"; done
grep -q 'timeout' core/src/asr.rs || warn "speech stream has no read timeout"
# Commit messages go public with the repo; scripts/release.sh lists each one and blocks on it.
n=$(git log --format=%B HEAD | grep -cE '/Users/[A-Za-z]|/home/[A-Za-z]|/private/(tmp|var)|/var/folders')
[ "$n" = 0 ] || warn "commit messages name local paths on $n lines: scripts/release.sh lists the commits"
[ $failed = 0 ] && echo "OK: nothing blocks a release." || echo "Fix the FAIL lines first."
exit $failed
