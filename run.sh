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
core="$(node scripts/start.mjs --bundled-core)" || exit 1
if [ -z "$core" ]; then
  command -v cargo >/dev/null 2>&1 || { echo "Rust is needed: https://rustup.rs (install it, open a new terminal, run this again)." >&2; exit 1; }
fi
if [ -z "$MODEL_API_KEY" ] && [ ! -f .env ] && command -v security >/dev/null 2>&1; then
  MODEL_API_KEY="$(security find-generic-password -s "${KEYCHAIN_SERVICE:-e2a2o}" -a "${KEYCHAIN_ACCOUNT:-e2a2o}" -w 2>/dev/null || true)"
  export MODEL_API_KEY
fi
if [ "$1" = room ] && [ -z "$ROOM_CODE" ]; then
  # 8 letters and digits, without look-alikes (0/o, 1/l/i): easy to type, too many to guess.
  ROOM_CODE="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 8)"
  export ROOM_CODE
fi
# Rooms opt into HTTPS; ROOM_HTTPS=0 keeps the old HTTP room mode (guest mic unavailable).
if [ "$1" = room ]; then
  export ROOM_HTTPS="${ROOM_HTTPS:-1}"
fi
# Before the build, as the core will see it (environment, then .env): demo and room stop without a key, and a busy
# port (on every address this mode opens) is reported with the same command on the next port. Prints the port.
port="$(node scripts/start.mjs --selected-core "$core" "$@")" || exit 1
url="$(node scripts/start.mjs --open-url "$port" "${1:-}")"
# `./run.sh sample [founder]` opens a ready-made map to explore without a key or a mic (a student's week,
# or a founder's day); it starts fresh from samples/ each time. Its pictures were drawn once, by the app's
# own picture pipeline, and the sample's journal names them: they go where the core serves /images from
# (pictures left from the other sample are never named, so they do no harm).
if [ "$1" = "sample" ]; then
  case "${2:-}" in founder) map=founder-day ;; "") map=student-week ;; *) echo "Unknown sample: $2 (try ./run.sh sample founder)" >&2; exit 2 ;; esac
  mkdir -p data/sample/images
  node scripts/sample-seed.mjs "samples/$map.jsonl" data/sample/journal.jsonl
  cp "samples/images/$map"/* data/sample/images/
fi
if [ -n "$1" ]; then
  export E2A2O_DATA="../data/$1"
fi
if [ ! -d ui/node_modules ]; then
  echo "Installing UI dependencies..."
  if ! (cd ui && npm install --no-audit --no-fund --no-update-notifier); then
    echo "The UI dependency install failed (see above). Fix the npm error, then run this again." >&2
    exit 1
  fi
fi
echo "Building UI..."
if ! out="$(cd ui && npm run build 2>&1)"; then
  echo "$out" >&2
  echo "The UI build failed (see above)." >&2
  exit 1
fi
echo "UI build complete."
case "${1:-}" in
  demo) echo "When it says \"E2A2O core on\", open http://localhost:$port, then in a second terminal run: node scripts/demo.mjs scripts/demo-talk.jsonl --port $port" ;;
  room) echo "On this laptop open http://localhost:$port. The link for the second laptop is printed below." ;;
  sample) echo "After the core starts, open the sample fixture (no key or mic): $url" ;;
  "") ;;
  # Any other name is a map of its own; say so, or a mistyped `sample` just looks like an empty sample.
  *) [ -d "data/$1" ] || echo "New empty map \"$1\" (kept in data/$1). For the ready-made sample map: ./run.sh sample" ;;
esac
cd core
if [ -n "$core" ]; then
  echo "Starting bundled core..."
  exec "$core"
fi
echo "Building and starting Rust core (cold source build: about 4 min)..."
exec cargo run --release
