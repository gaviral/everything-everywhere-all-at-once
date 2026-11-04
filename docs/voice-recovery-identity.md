# Finished speech and unfinished recovery

The ASR session now allocates a local source UUID for each speech segment. Partial words, the final turn, the capture receipt and recovery use that UUID. Existing journal records persist the source with its accepted effect and the speech resolution; replay needs no text comparison or schema migration.

Service IDs (numeric or string) become aliases of the source. Speech boundaries and stream audio positions associate anonymous or renamed events with a pending source. Completed sources remain terminal for repeated events at the same identity/position. Older cumulative partials cannot overwrite newer words, and a late final cannot clear another pending source's live words. A later explicit boundary or later audio can create a distinct source, including an intentionally identical utterance.

Unfinished words retain their exact spacing, case and punctuation. With conflicting IDs and no timing, a final does not erase a differently identified pending draft. With neither IDs, boundaries nor audio positions, two final events are indistinguishable from two intentional utterances: both are retained. This conservative ambiguity can leave extra recoverable content; it never uses transcript equality to discard words. Existing primer cleanup and final sentence casing are unchanged.

The implementation uses the existing durable acceptance and recovery paths. A failed append emits no Saved receipt; retry uses the same source. No microphone defaults or UI components changed. The ASR URL override exists only in test builds.

Checks from the repository root:

- `cargo test --manifest-path core/Cargo.toml asr::tests -- --nocapture`
- `npm run build --prefix ui`
- `node scripts/mic-check.mjs`
- `VOICE_IDENTITY_TEST_BINARY=<test executable printed by cargo> SHOTS=data/voice-identity-evidence/after node scripts/voice-recovery-identity-check.mjs`

The JSON event fixture covers absent/changed IDs, interruption, identical utterances, reordered partials, late/repeated finals and restart. These are synthetic hypotheses based on the reported app-facing order, not a recovered upstream trace.

The Chrome check runs the real core socket, ASR relay/handler, journal and built UI on owned ephemeral loopback listeners. ASR replies and placement are deterministic fixtures. Locally generated speech PCM is explicitly paced at 80 ms through the browser capture callback; the fixture checks the complete received PCM byte-for-byte. It does not exercise a physical microphone or claim live ASR recognition. The separate mic check exercises the worklet and capture lifecycle. Screenshots, synthetic journals, audio, events and command receipts remain in ignored local data, outside submission files.

The referenced original live-event artifacts and upstream event IDs were unavailable in this checkout. Their precise upstream sequence and live-service behavior remain unverified; no new external model call was made.
