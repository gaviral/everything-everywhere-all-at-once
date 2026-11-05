#!/bin/sh
# Builds the UI and serves everything from the core at http://localhost:4321 (PORT=4400 ./run.sh ... uses another port).
# `./run.sh demo` selects the external demo map unless E2A2O_DATA explicitly selects a complete map.
# `./run.sh room` selects the external room map: a second laptop on the same
# network joins the same map at the address the core prints. ROOM_CODE sets the code; else it's new each run.
# The Meta Model API key comes from MODEL_API_KEY, a .env file, or (on a Mac) the login Keychain item
# "e2a2o" (KEYCHAIN_SERVICE and KEYCHAIN_ACCOUNT name another).
set -e
E2A2O_CALLER_CWD="$(pwd -P)"
export E2A2O_CALLER_CWD
cd "$(dirname "$0")"
case "${1:-}" in -h|--help|help)
  echo "Usage: ./run.sh [sample [developer | student | founder] | demo | room | NAME]"
  echo "  sample [developer | student | founder]  a ready-made map (default: developer), no key needed"
  echo "  demo              a map for the scripted talk (needs a key)"
  echo "  room              a map shared with a second laptop (needs a key)"
  echo "  NAME              your own map in external app storage (see docs/storage.md)"
  echo "  PORT=4400 ./run.sh ...   uses another port (default 4321)"
  exit 0 ;;
esac
case "${1:-}" in
  -*) echo "Unknown option: $1 (try ./run.sh --help)" >&2; exit 2 ;;
esac
if [ "${1:-}" = sample ]; then
  case "${2:-}" in developer|"") map=developer-day ;; student) map=student-week ;; founder) map=founder-day ;; *) echo "Unknown sample: $2 (try ./run.sh sample developer, student or founder)" >&2; exit 2 ;; esac
fi
E2A2O_MODE="${1:-}"
export E2A2O_MODE
command -v node >/dev/null 2>&1 || { echo "Node.js 22.12 or newer is needed: https://nodejs.org" >&2; exit 1; }
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' ||
  { echo "Node.js 22.12 or newer is needed; this is $(node -v)." >&2; exit 1; }
core="$(node scripts/start.mjs --bundled-core)" || exit 1
if [ -z "$core" ]; then
  command -v git >/dev/null 2>&1 || { echo "Git is needed for Crew: https://git-scm.com/downloads (install it, then run this again)." >&2; exit 1; }
  command -v cargo >/dev/null 2>&1 || { echo "Rust is needed: https://rustup.rs (install it, open a new terminal, run this again)." >&2; exit 1; }
  echo "Checking map storage (first source build can take several minutes)..."
fi
# Rust is authoritative; validate before keys, network checks or any runtime writes.
data="$(node scripts/start.mjs --data-path "$core" "${1:-}")" || exit 1
E2A2O_DATA="$data"
export E2A2O_DATA
if [ "${1:-}" != sample ] && [ -z "$MODEL_API_KEY" ] && [ ! -f .env ] && command -v security >/dev/null 2>&1; then
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
# Only a matching synthetic sample identity may reset. Rust holds the core lock and preserves backups.
if [ "${1:-}" = sample ]; then
  node scripts/start.mjs --seed-sample "$core" "$map" || exit 1
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
  *) echo "Map kept in $data. For the ready-made sample map: ./run.sh sample" ;;
esac
cd core
if [ -n "$core" ]; then
  echo "Starting bundled core..."
  exec "$core"
fi
echo "Building and starting Rust core (cold source build: about 4 min)..."
exec cargo run --release
