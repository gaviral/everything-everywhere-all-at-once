#!/bin/sh
set -eu

seed_sample_once() {
    if [ ! -f "$E2A2O_DATA/journal.jsonl" ]; then
        e2a2o-core --seed-sample student-week
    fi
}

seed_sample_once
exec e2a2o-core
