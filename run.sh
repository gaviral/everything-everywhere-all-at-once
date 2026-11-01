#!/bin/sh
# Builds the UI and serves everything from the core at http://localhost:4321.
# `./run.sh demo` keeps a separate journal (data/demo) so real work stays clean.
# `./run.sh room` opens a room on its own journal (data/room): a second laptop on the same
# network joins the same map at the address the core prints. ROOM_CODE sets the code; else it's new each run.
# Rooms opt into HTTPS; ROOM_HTTPS=0 keeps the old HTTP room mode (guest mic unavailable).
# The Meta Model API key comes from MODEL_API_KEY, a .env file, or (on User's Mac)
# the login Keychain item the e2a2o app saved.
set -e
cd "$(dirname "$0")"
if [ -z "$MODEL_API_KEY" ] && [ ! -f .env ] && command -v security >/dev/null 2>&1; then
  MODEL_API_KEY="$(security find-generic-password -s "${KEYCHAIN_SERVICE:-e2a2o}" -a "${e2a2o}" -w 2>/dev/null || true)"
  export MODEL_API_KEY
fi
if [ "$1" = room ] && [ -z "$ROOM_CODE" ]; then
  # 8 letters and digits, without look-alikes (0/o, 1/l/i): easy to type, too many to guess.
  ROOM_CODE="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 8)"
  export ROOM_CODE
fi
if [ "$1" = room ]; then
  export ROOM_HTTPS="${ROOM_HTTPS:-1}"
fi
# `./run.sh sample [founder]` opens a ready-made map to explore without a key or a mic (a student's week,
# or a founder's day); it starts fresh from samples/ each time.
if [ "$1" = "sample" ]; then
  case "${2:-}" in founder) map=founder-day ;; *) map=student-week ;; esac
  mkdir -p data/sample && cp "samples/$map.jsonl" data/sample/journal.jsonl
fi
if [ -n "$1" ]; then
  export E2A2O_DATA="../data/$1"
fi
[ -d ui/node_modules ] || (cd ui && npm install)
(cd ui && npm run build >/dev/null)
cd core && exec cargo run --release
