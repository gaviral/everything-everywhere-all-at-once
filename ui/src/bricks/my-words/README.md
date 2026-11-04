# My words

Features → My words → Prepare next session. Starts off. Add an exact name or term and an optional explanation, then **Save for next session**. Invented examples are labelled and never saved automatically. Edit, remove and undo removal work on a draft until Save. Escape closes the editor and restores focus.

Saves append to `my-words.jsonl` beside the map journal, acknowledged after syncing the file and its directory. Terms belong to this map and speaker. Conflicting windows require reviewing the current saved list; disconnected saves are never replayed. Unreadable logs are preserved and block writes. This sidecar leaves the World and existing protocol unchanged.

The brick owns a gated `/ws/my-words` connection. Enabling explicitly opts that speaker in while at least one of their My words connections remains open. Switching off closes it; saved terms remain for reopening. New listening sessions snapshot the saved terms at startup. A running session keeps its snapshot. This is shared across that speaker’s windows on the same map, not across people. Existing transcripts are never rewritten.

Only exact terms join the existing Meta Voice Transcribe keywords; explanations stay in saved vocabulary. Keywords are hints, not a spelling guarantee. The feature never starts capture or calls a model. The standalone brick playground is an explicitly labelled example editor without saving or recognition.

Small shared hooks: `main.rs` mounts the gated endpoint and snapshots terms; `asr.rs` adds those terms to the existing handshake. App.tsx, core.ts, contract and protocol files are unchanged. The existing Vite `/ws` proxy also carries the feature connection.

Focused checks: `cargo test --manifest-path core/Cargo.toml glossary` covers storage, scope, revisions, bounds, failure preservation and the recognizer message. After `npm --prefix ui run build`, `PRECHECK_PAGES=1 node scripts/c10-glossary-check.mjs` exercises the built UI with synthetic server replies and desktop/phone screenshots. Neither check enables a microphone or certifies live recognition accuracy.
