#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo test --locked --release --manifest-path core/Cargo.toml memory:: -- --nocapture
node ui/src/bricks/memory/check.mjs
ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
