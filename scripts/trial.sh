#!/bin/sh
# A friend tries E2A2O from their own laptop, anywhere: a fresh map of their own, on a core and port of its own,
# behind an HTTPS link, so their browser allows the mic and they install nothing.
#   sh scripts/trial.sh NAME     prints the link to send NAME; Ctrl-C ends the trial (their map stays on disk)
# The link is a Cloudflare quick tunnel: no account, a new random name each run (brew install cloudflared).
# Each run starts a new folder, data/trials/NAME-<time>: it never opens an existing map. The core listens on
# 127.0.0.1 only and lets in just the tunnel, with the room code; no one is the host, so nothing reaches this
# laptop's Reminders, Calendar or chat imports, and this laptop's own localhost is refused as well.
# Watch along by opening the same link and joining under another name.
# PORT picks the port (default: the first free one from 4410).
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)

name=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z')
case "$name" in
  ""|-h|--help|help) echo "Usage: sh scripts/trial.sh NAME [--no-key]   (NAME: letters, digits and dashes)"
    echo "  --no-key   open the link without a model key, to check it and the mic prompt (nothing is heard or placed)"
    [ -n "$name" ] && exit 0; exit 2 ;;
  *[!a-z0-9-]*) echo "NAME takes letters, digits and dashes only: $1" >&2; exit 2 ;;
esac
keyless=""
case "${2:-}" in --no-key) keyless=1 ;; "") ;; *) echo "Unknown option: $2" >&2; exit 2 ;; esac

command -v cloudflared >/dev/null 2>&1 || { echo "cloudflared is needed for the link: brew install cloudflared (no account)" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Rust is needed: https://rustup.rs" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 22.12 or newer is needed: https://nodejs.org" >&2; exit 1; }

# The friend's words go through this laptop's key: the same sources as run.sh (the core reads .env itself).
# --no-key means no key at all: an empty MODEL_API_KEY also stops the core from loading one from .env.
if [ -n "$keyless" ]; then
  MODEL_API_KEY=""
  export MODEL_API_KEY
elif [ -z "${MODEL_API_KEY:-}" ] && ! grep -q '^MODEL_API_KEY=.' .env 2>/dev/null && command -v security >/dev/null 2>&1; then
  MODEL_API_KEY=$(security find-generic-password -s "${KEYCHAIN_SERVICE:-e2a2o}" -a "${KEYCHAIN_ACCOUNT:-e2a2o}" -w 2>/dev/null || true)
  export MODEL_API_KEY
fi
if [ -z "${MODEL_API_KEY:-}" ] && ! grep -q '^MODEL_API_KEY=.' .env 2>/dev/null && [ -z "$keyless" ]; then
  echo "No model key, so $name's words would go nowhere. Run: security add-generic-password -s e2a2o -a e2a2o -w" >&2
  echo "(or check the link alone: sh scripts/trial.sh $name --no-key)" >&2
  exit 1
fi

data="$root/data/trials/$name-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$root/data/trials"
mkdir "$data" || { echo "$data already exists; try again in a second" >&2; exit 1; }
# 12 letters and digits without look-alikes: the link travels the internet, so far more than a room's 8.
code=$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 12)

echo "Building..."
[ -d ui/node_modules ] || (cd ui && npm install)
(cd ui && npm run --silent build >/dev/null) || { echo "The UI build failed: cd ui && npm run build" >&2; exit 1; }
(cd core && cargo build --release --quiet) || { echo "The core build failed: cd core && cargo build --release" >&2; exit 1; }
bin="${CARGO_TARGET_DIR:-$root/core/target}/release/e2a2o-core"

# A port nothing listens on and no other trial has claimed: two launched together would otherwise pick the same
# one before either core is up. A claim (a link naming its launcher) is made in one step; a dead launcher's is free again.
free() {
  claim="$root/data/trials/.port-$1"
  ! nc -z 127.0.0.1 "$1" 2>/dev/null || return 1
  ln -s "$$" "$claim" 2>/dev/null && return 0
  holder=$(readlink "$claim")
  [ "$holder" = "$$" ] && return 0
  ! kill -0 "$holder" 2>/dev/null || return 1
  ln -sfn "$$" "$claim" && [ "$(readlink "$claim")" = "$$" ]
}
if [ -n "${PORT:-}" ]; then
  port=$PORT
  free "$port" || { echo "port $port is already in use" >&2; exit 1; }
else
  port=4410
  while ! free "$port"; do port=$((port + 1)); [ "$port" -le 4499 ] || { echo "no free port in 4410-4499" >&2; exit 1; }; done
fi

core_pid=""; tunnel_pid=""
stop() {
  trap - EXIT INT TERM
  set +e
  if [ -n "$core_pid" ]; then kill "$core_pid" 2>/dev/null; fi
  # cloudflared waits up to 30 s for open requests after one TERM; a second ends it now.
  if [ -n "$tunnel_pid" ]; then kill "$tunnel_pid" 2>/dev/null; sleep 1; kill "$tunnel_pid" 2>/dev/null; fi
  wait 2>/dev/null
  echo "Trial ended. $name's map: $data"
}
trap stop EXIT
trap 'exit 130' INT TERM

cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$port" >"$data/tunnel.log" 2>&1 &
tunnel_pid=$!
url=""
for _ in $(seq 60); do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$data/tunnel.log" | head -n 1 || true)
  [ -n "$url" ] && break
  kill -0 "$tunnel_pid" 2>/dev/null || break
  sleep 0.5
done
[ -n "$url" ] || { echo "cloudflared gave no link; see $data/tunnel.log" >&2; exit 1; }

# A private model (not Contributor mode), whatever .env says: the friend's words aren't kept for training.
# The key, if any, comes as exported above (Keychain, or empty for --no-key) or from .env, which the core reads.
(cd core && exec env PUBLIC_URL="$url" ROOM_CODE="$code" PORT="$port" E2A2O_DATA="$data" PLACER_MODEL=muse-spark-1.2 \
  "$bin") >"$data/core.log" 2>&1 &
core_pid=$!
link="$url/?room=$code"
printf '%s\n' "$link" >"$data/link.txt"

# The link works once the core is up and the tunnel's new name resolves (here, up to about a minute).
ok=""; started=$(date +%s); deadline=$((started + 90))
while [ "$(date +%s)" -lt "$deadline" ]; do
  kill -0 "$core_pid" 2>/dev/null || { echo "The core stopped; see $data/core.log" >&2; exit 1; }
  if curl -s --max-time 3 "$url/room" | grep -q '"tunnel":true'; then ok="$(( $(date +%s) - started )) s"; break; fi
  sleep 1
done
echo
echo "Trial for $name is open (core on port $port, map in $data${ok:+; the link answered after $ok})."
[ -z "$keyless" ] || echo "No model key: the page and the mic prompt work, but nothing is heard or placed."
[ -n "$ok" ] || echo "The link didn't answer here within 90 s (this Mac may have cached the new name as missing); try it in a minute."
echo "  Send $name: $link"
echo "  Watch: open the same link and join under another name."
echo "  Check it: PUBLIC_URL=$url PORT=$port sh scripts/precheck.sh"
echo "Ctrl-C ends the trial."
wait "$core_pid"
