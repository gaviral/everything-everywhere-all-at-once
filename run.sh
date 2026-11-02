#!/bin/sh
# Builds the UI and serves everything from the core at http://localhost:4321 (PORT=4400 ./run.sh ... uses another port).
# `./run.sh demo` keeps a separate journal (data/demo) so real work stays clean.
# `./run.sh room` opens a room on its own journal (data/room): a second laptop on the same
# network joins the same map at the address the core prints. ROOM_CODE sets the code; else it's new each run.
# The Meta Model API key comes from MODEL_API_KEY, a .env file, or (on a Mac) the login Keychain item
# "e2a2o" (KEYCHAIN_SERVICE and KEYCHAIN_ACCOUNT name another).
set -e
cd "$(dirname "$0")"
case "${1:-}" in -h|--help|help)
  echo "Usage: ./run.sh [sample [founder] | demo | room | NAME]"
  echo "  sample [founder]  a ready-made map, no key needed"
  echo "  demo              a map for the scripted talk (needs a key)"
  echo "  room              a map shared with a second laptop (needs a key)"
  echo "  NAME              your own map, kept in data/NAME (no name: data/)"
  echo "  PORT=4400 ./run.sh ...   uses another port (default 4321)"
  exit 0 ;;
esac
case "${1:-}" in
  -*) echo "Unknown option: $1 (try ./run.sh --help)" >&2; exit 2 ;;
esac
command -v node >/dev/null 2>&1 || { echo "Node.js 22.12 or newer is needed: https://nodejs.org" >&2; exit 1; }
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' ||
  { echo "Node.js 22.12 or newer is needed; this is $(node -v)." >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Rust is needed: https://rustup.rs (install it, open a new terminal, run this again)." >&2; exit 1; }
if [ -z "$MODEL_API_KEY" ] && [ ! -f .env ] && command -v security >/dev/null 2>&1; then
  MODEL_API_KEY="$(security find-generic-password -s "${KEYCHAIN_SERVICE:-e2a2o}" -a "${KEYCHAIN_ACCOUNT:-e2a2o}" -w 2>/dev/null || true)"
  export MODEL_API_KEY
fi
# demo and room do nothing without a key: say so now, not after a few minutes of building.
case "${1:-}" in demo|room)
  if [ -z "$(printf %s "$MODEL_API_KEY" | tr -d '[:space:]')" ] && ! grep -qE '^[[:space:]]*MODEL_API_KEY=[^[:space:]#]' .env 2>/dev/null; then
    [ -f .env ] || copy="cp .env.example .env, then "
    echo "./run.sh $1 needs a Meta Model API key: ${copy:-}paste the key after MODEL_API_KEY= in .env." >&2
    echo "No key? ./run.sh sample opens a ready-made map without one." >&2
    exit 1
  fi ;;
esac
port="${PORT:-4321}"
# A busy port shows up before the build, with the same command on the next port.
node -e 'const s = require("net").createServer(); s.once("error", () => process.exit(1)); s.listen(+process.argv[1], "127.0.0.1", () => s.close(() => process.exit(0)))' "$port" ||
  { echo "Port $port is in use. Stop the other app, or use another port: PORT=$((port + 1)) ./run.sh $*" >&2; exit 1; }
if [ "$1" = room ] && [ -z "$ROOM_CODE" ]; then
  # 8 letters and digits, without look-alikes (0/o, 1/l/i): easy to type, too many to guess.
  ROOM_CODE="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 8)"
  export ROOM_CODE
fi
# Rooms opt into HTTPS; ROOM_HTTPS=0 keeps the old HTTP room mode (guest mic unavailable).
if [ "$1" = room ]; then
  export ROOM_HTTPS="${ROOM_HTTPS:-1}"
fi
# `./run.sh sample [founder]` opens a ready-made map to explore without a key or a mic (a student's week,
# or a founder's day); it starts fresh from samples/ each time. Its pictures were drawn once, by the app's
# own picture pipeline, and the sample's journal names them: they go where the core serves /images from
# (pictures left from the other sample are never named, so they do no harm).
if [ "$1" = "sample" ]; then
  case "${2:-}" in founder) map=founder-day ;; "") map=student-week ;; *) echo "Unknown sample: $2 (try ./run.sh sample founder)" >&2; exit 2 ;; esac
  mkdir -p data/sample/images
  cp "samples/$map.jsonl" data/sample/journal.jsonl
  cp "samples/images/$map"/* data/sample/images/
fi
if [ -n "$1" ]; then
  export E2A2O_DATA="../data/$1"
fi
[ -d ui/node_modules ] || (cd ui && npm install --no-audit --no-fund --no-update-notifier)
if ! out="$(cd ui && npm run build 2>&1)"; then
  echo "$out" >&2
  echo "The UI build failed (see above)." >&2
  exit 1
fi
case "${1:-}" in
  demo) echo "When it says \"E2A2O core on\", open http://localhost:$port, then in a second terminal run: node scripts/demo.mjs scripts/demo-talk.jsonl --port $port" ;;
  room) echo "On this laptop open http://localhost:$port. The link for the second laptop is printed below." ;;
  ""|sample) ;;
  # Any other name is a map of its own; say so, or a mistyped `sample` just looks like an empty sample.
  *) [ -d "data/$1" ] || echo "New empty map \"$1\" (kept in data/$1). For the ready-made sample map: ./run.sh sample" ;;
esac
cd core && exec cargo run --release
