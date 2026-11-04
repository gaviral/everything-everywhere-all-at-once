#!/bin/sh
# Explicit opt-in, an empty temporary map, and no runtime model requirement.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
data=$(mktemp -d "${TMPDIR:-/tmp}/e2a2o-code-canvas.XXXXXX")
data=$(CDPATH= cd -- "$data" && pwd -P)
export E2A2O_DATA="$data" E2A2O_CODE_CANVAS=1 E2A2O_UI="$root/ui/dist" PORT=4459
export MODEL_API_KEY=''
printf 'Code canvas: http://localhost:4459/?canvas=code\n'
cd "$root/core"
exec ./target/debug/e2a2o-core
