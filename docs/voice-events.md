# Truthful, stoppable spoken exchange

Built on the existing opt-in conversation partner. Runtime stays on its existing Meta services and installed browser speech voice; no GPT runtime dependency.

Happy path: enable Conversation partner in Features, tap the mic, allow capture, and ask a question. Permission pending says Starting; an open mic awaiting transcription says Mic open · connecting speech. Listening requires capture plus the service's listening event. Placement remains visible independently. Reply preparation/playback pauses outgoing capture and says so. Stop reply cancels local audio immediately and rejects that reply ID if it arrives late. The mic continues to mean start/stop capture. Stop conversation aborts capture (including a pending permission request), stops audio, and turns the partner off. It requires a deliberate mic tap to capture again.

Recognized interim words are inspectable Draft text. Stop, disconnect, permission denial and audio failure retain words; Copy to editor appends to the current draft. Final turns use the existing spine/journal path, with actual speaker names and stable initials/AI marks. Replies remain readable if audio fails, and Retry audio uses the retained text. Configuration diagnostics stay under Details.

The existing post-reply capture behavior is unchanged. This does not choose a new restart policy or certify hands-free interruption.

Checks from the repository root:

- `npm run build --prefix ui`
- `node scripts/mic-check.mjs`
- `PRECHECK_PAGES=1 node scripts/conversation-spine-check.mjs`
- `PRECHECK_PAGES=1 node scripts/page-speech-check.mjs --fixture` (rendering/event evidence only)
- `cargo test --manifest-path core/Cargo.toml conversation::tests`

The named `PRECHECK_PAGES=1 node scripts/page-speech-check.mjs` runs fixtures but exits 3 because real-service audio evidence is unavailable. `--real-service` reports that unavailable gate directly. A fixture does not establish recognized onset, acoustic echo rejection, device permission behavior or human comprehension. The page fixture saves synthetic screenshots and timestamped events to the system temporary directory (override with SHOTS).

The happy-path fixture covers permission/start, independent placement/capture, queued/started/failed playback, keyboard Stop reply, late answers/callbacks, a second utterance, retained Draft, Stop conversation, disconnect/reconnect, permission refusal and unobscured phone controls. Existing worklet tests exercise 24/44.1/48 kHz audio. No new restart behavior is implemented.

Verified: both UI builds, mic checks, mic-state regression, conversation-spine checks, and browser speech/worklet/page fixtures passed. The named page-speech check returned 3 for the unavailable live-service gate. Focused Rust conversation tests passed 14/14, with one live-service test ignored, using the test executable built with `cargo rustc --manifest-path core/Cargo.toml --tests -- -C debuginfo=0`.
