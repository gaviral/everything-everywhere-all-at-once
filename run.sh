#!/bin/sh
# Builds the UI and serves everything from the core at http://localhost:4321.
# `./run.sh demo` keeps a separate journal (data/demo) so real work stays clean.
# The Meta Model API key comes from MODEL_API_KEY, a .env file, or (on User's Mac)
# the login Keychain item the e2a2o app saved.
set -e
cd "$(dirname "$0")"
if [ -z "$MODEL_API_KEY" ] && [ ! -f .env ] && command -v security >/dev/null 2>&1; then
  MODEL_API_KEY="$(security find-generic-password -s "${KEYCHAIN_SERVICE:-e2a2o}" -a "${e2a2o}" -w 2>/dev/null || true)"
  export MODEL_API_KEY
fi
# `./run.sh sample` opens a ready-made map to explore without a key or a mic; it starts fresh from samples/ each time.
if [ "$1" = "sample" ]; then
  mkdir -p data/sample && cp samples/student-week.jsonl data/sample/journal.jsonl
fi
if [ -n "$1" ]; then
  export E2A2O_DATA="../data/$1"
fi
[ -d ui/node_modules ] || (cd ui && npm install)
(cd ui && npm run build >/dev/null)
cd core && exec cargo run --release
