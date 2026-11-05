# Memory

Memory is an optional Rust feature. Set `E2A2O_MEMORY=1` before starting the
core, or turn on **Memory** in Features. It starts off. The environment flag
keeps it on; otherwise it stays on while at least one connected window enables
the feature. Closing the last such window releases its in-RAM state.

The corner card shows live readings from `GET /memory/stats`: `thoughts_indexed`,
`lookup_us`, cumulative `bytes_saved`, `last_bytes_saved`, `context_calls`,
`cache_hits`, and `prefetch_hits`, plus `enabled`. Before the first reading it
shows a clearly labelled example. A lost connection labels the last reading.

The inverted index tracks original words, point text, topic names and hashtags,
including tags attached to a topic. Committed edits, splits, moves and removals
update it. Placement and word explanations select a bounded set using word
overlap, the current topic and recency. Placement keeps its existing continuity
cues and their parent topics. Savings count serialized request bytes omitted
relative to the full request, once per outgoing model call, including race lanes.

Partial transcripts prefetch context without making a model call or starting
audio capture. A matching final transcript consumes it; changed words or edited
context trigger a new lookup. Exact text requests reuse complete answers for
five minutes, with a 128-entry limit. The entire request and endpoint form the
key; edits invalidate answers and outstanding cache writes. Image, streaming,
tool and incomplete responses do not enter this cache. The existing counted
Meta client continues to make every network model request.

Run the focused checks with `sh scripts/memory-check.sh`. The release-mode Rust
benchmark measures common-word, unique-word and hashtag lookups over 10,000
synthetic thoughts and requires p95 below 1 ms. No new dependencies are needed.
