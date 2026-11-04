# Voice relay backlog and restart recovery

The relay used to send a 4.8-second synthetic endpointing primer in one burst, immediately followed by microphone frames captured during connection. That could exceed Voice Transcribe's five-second unprocessed-audio limit before playback began. The [provider's streaming contract](https://dev.meta.ai/docs/speech-to-text) requires paced audio and processing-progress tracking.

The relay now allows at most 1.6 seconds beyond acknowledged `audioProcessedMs`, including the primer. It splits queued input into at most 80 ms chunks and preserves byte order. Missing acknowledgements stop the session through the existing timeout; a closed progress channel cannot strand the writer. Progress only advances, even if an older event arrives later.

Live partials also receive private journal checkpoints, using the same source identity as the eventual final transcript. Checkpoints do not display recovery cards while speaking. A process restart exposes an unfinished entry; accepting it once keeps an unfinished thought. A final receipt resolves its checkpoint.

## Candidate acceptance

Fresh Rust release and UI builds, with synthetic Samantha speech routed through native WebAudio, the actual microphone worklet, the app socket, real Meta ASR and real Muse placement. No transcription or placement fixtures were used in these live runs. No email or message was sent.

The unmodified batch4 binary reproduced `Audio processing backlog too large`: 14 silent 80 ms microphone frames, error 309 ms before synthetic playback. No phrase recognition is attributed to that baseline.

Two fixed live runs passed. The final run measured:

| Observation | Time |
| --- | --- |
| Spoken phrase duration | 2.659 s |
| First words visibly on screen, from playback start | 0.879 s |
| Placement event, from speech end | 2.871 s |
| Thought visibly on canvas, from speech end | 3.511 s |
| Microphone frame cadence, median / maximum | 80.0 / 87.1 ms |
| Spoken “Stop listening” to mic off, from command end | 0.474 s |

The five-second gate is measured from the end of spoken input to visible canvas placement. The previous run measured 3.470 s. A process termination during the next phrase's partial, before a final or stream-close handler, restored exactly one unfinished entry. Clicking “Keep in this map” produced one unfinished thought and placed it. The keyword command then stopped a fresh listening session.

The opt-in `scripts/voice-live.mjs` harness generates its own speech with macOS `say`, starts only its own core and Chrome, preserves synthetic reports/screenshots, and records binary/source hashes. It requires an existing `MODEL_API_KEY` in the environment and a fresh binary selected by `VOICE_CORE_BINARY`; credentials stay in the core environment. It is deliberately outside the automatic `*-check.mjs` suite because it makes real ASR/placement calls. `baseline` expects the original backlog error; `accept` checks placement, restart recovery, and the spoken stop command.

Verification: fresh UI and release builds passed; the focused ASR suite passed 32 tests, zero failures, with one opt-in Chrome fixture ignored (the live harness above supplied the real-service acceptance).

Focused Rust regressions cover a cold connection with buffered input, withheld/stale processing acknowledgements, complete ordered delivery, a closed progress channel, and partial recovery before any close callback. Existing ASR identity and session tests remain applicable. Physical microphone, acoustic echo and phone capture are not covered by this synthetic acceptance.

The full-tree guard still reports an authorization-pattern finding in unchanged batch4 `core/src/apps/tests.rs:884`. The seven staged voice files pass the same content/path rules. This candidate does not claim a clean full-repository gate.
