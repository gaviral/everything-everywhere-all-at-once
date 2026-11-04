# Exp readiness audit

Compared against `bf5ef53` and an isolated archive of `main` at `fff9a75`. Main's working tree and branch were not changed.

- Merged `r-comments` into `exp`.
- The original guide resize assertion fails identically at `bf5ef53`: reflow hides most of the target behind the dock. The guide now reveals its target again when viewport dimensions change; ordinary scrolling stays under user control. Restored the unconditional arrow-landing assertion.
- Restored the five-second notice minimum. Full-card reading time remains, with the original slow-reader time as a floor for note headings and status.
- Restored removed notice lifecycle coverage: mic revisions, key state, queued stale-key retirement, local answers, correction order, Undo invalidation, reconnects, focus and timeout wiring. FIFO checks explicitly read each preceding answer instead of expecting replacement.
- The three Rust failures do not occur on main. Exp's additional usage handshake message was left unread by three fixtures; they now assert the complete handshake before testing live replies.
- The socket check passes on main. Exp's queue intentionally retains unread split/search answers, so the check reads those before proceeding. A real regression left stale key notices queued after a snapshot; the snapshot now retires that entire group and preserves unrelated unread answers.
- Other script changes since `bf5ef53`: app fixtures seed the new queue without dropping assertions; note/send duration checks include all visible text; persistent unfinished-state fixtures are reset between independent scenes, with reload persistence covered by `phone-walk-check`; held-question coverage is stronger (all forty retained and answered); headless helper options and the rules-only entry point leave full checks intact. Added scripts introduce coverage.
- Removed private transcript material and personal paths from the merged documentation/check, and replaced the transcript-derived placement example with synthetic workshop data. The bridge integration check requires explicit external fixture configuration.

Validation: main passed 633 Rust tests (12 ignored); final exp passed 646 (12 ignored). The TypeScript/production build, full guide check with the original resize assertion, and all 12 targeted checks passed: apps, finish-it focus, held queue, note card, notice, notices page, page speech, phone walk, send card, speech fixes, socket, and usage. Meta-only/counting guards and diff whitespace checks passed. An additional broad sweep passed its first seven checks before being stopped to finish the targeted audit; this is not a claim that the entire UI suite ran. Live ASR, model calls, external bridge replies, and the external usage writer were not exercised; the bridge check reports a skip without configured fixtures.

## R-find merge

- Kept both receipt and notice-control messages; reconnect retains saved text until its receipt while resetting note cards through the existing notice queue. Usage remains in the catch-up sequence.
- Combined Chrome argument overrides with the explicit debug port option.
- Match reveal expands original words outside Stay here, while pending speech still reserves its full text and correction controls. Correction offsets account for original words without an added opening quote.
- Receipted AI text retains its live speech flag. Retrying the same receipt does not repeat a thought or its speech.
- The focus fixture acknowledges and validates receipt IDs while retaining its exact text, single-submission, keyboard-focus, and draft assertions. The search fixture uses synthetic workshop text.

Validation: 648 Rust tests passed (12 ignored), the UI production build passed, and socket, find-again page, waiting-tabs page, full guide, notice, and speech-correction checks passed. No existing assertion was weakened; the original guide resize assertion remains unchanged. Main remains at `fff9a75`; no push.

## Gate check repair

The seven reported failures were stale coverage or fixtures, not evidence of a new application defect. No application behavior was removed to make them pass.

| Gate | Repair and retained coverage |
| --- | --- |
| css-check | Scan nested TypeScript sources too: Talk styles intentionally target classes emitted by the Spine. The unused-class assertion remains, with no class exemptions. |
| feedback-check | Keep the check unchanged. Update the feedback catalog for Talk exit, original-word expansion, Forget it, Stay here, speech cancellation, install handlers, and focus-preserving blur handlers. |
| loud-app-check | Seed the real notice queue before static rendering, as apps-check already does. Keep every card, Keep/Discard, and audio RMS assertion. |
| marks-check | Give the worklet fixture its current postMessage interface and assert a capture message is sent. Keep every track-ending, mic-state, ring, tip, and mark assertion. |
| readme-check | Keep the check unchanged. Document notice-queue.ts, talk-preset.ts, and waiting.ts in the architecture parts list. |
| ui-server-check | Keep the check unchanged. Route page-speech-check through uiServer with an explicit loopback listening port; preserve shared root, disabled watcher, and disabled HMR settings. |
| whyhere-check | Retain source-reset and hidden-card assertions against the queue's incoming source and visible items. Keep every reason, retry, placement, and on-demand wiring assertion. |

The requested PRECHECK_PAGES=0 option was previously unused in this checkout. The shared page readiness helper now honors it; phone-walk, shell-people, and status-words use the same prerequisite skip convention as the other browser checks. Their application assertions are unchanged, and default runs still execute their browser checks. Precheck now prints each actual skip reason instead of calling all skips a missing Chrome installation.

Validation: `PRECHECK_PAGES=0 sh scripts/precheck.sh` exited 0 with no FAIL lines, including all seven reported checks, the UI build, and Rust tests. Separately, `node scripts/page-speech-check.mjs` passed its real-browser/worklet checks using the shared Vite helper. Browser phases were intentionally skipped by the requested gate option; live probes and external integration fixtures were unavailable. Existing release-content warnings remain warnings.

## Main page checks after the experimental merge

All nine reported failures reproduced when run individually on the merged main tree. They were not dismissed as load failures.

| Check | Classification and repair |
| --- | --- |
| bricks | Stale Titles expectation: Titles now keeps names readable instead of fitting every node. Assert label size; retain whole-map assertions for Pictures and See all. The namespace guard now distinguishes JSX declarations from CSS selectors, with a selector regression case and all forbidden declarations still checked. |
| dock-slivers | Stale simultaneous-notice fixture. Read the unfinished card, then its queued notice, checking bottom clearance for both and retaining the gap, Palace, and editor checks. |
| edge-chips-clear | Product bug: resizing a held view fitted the whole map and marked unread arrivals seen. Preserve its center and zoom; the original chip assertions remain. |
| first-landing | Product bug: fly-in searched the now-empty stage instead of the actual input box and immediately removed the bubble. Use the named composer; align the fixture's origin with that same visible element. Frame coverage, timing, and slow-view assertions remain. |
| history-key-once | Product bug: hidden key notices blocked visible answers. Retire those cards when the status line represents them; keep the latest turn's Undo independently of the current queue card for History. The fixture reads ordinary answers and marks the unrelated install hint already seen; retention, coalescing, and Undo assertions remain. |
| lane | Stale stack fixture. Check each queued long card's geometry, controls and body, then verify focus holds a note while later cards wait and each subsequent card expires in turn. |
| live-page | Product bugs: removing or reflowing the Stop button could leave focus/hover state stale and reading time paused, and offline Stop feedback waited invisibly behind its own card. Recheck focus and hover when controls disappear and show the pending Stop on the current card. A later independent review found that the added waits wrongly excluded valid overlapping counts; see the correction below. |
| phone | Stale three-simultaneous-notices fixture. Check each queue turn at the same sizes, scroll offsets and open panels; retain a notice during point-control checks. The long/short message geometry uses updates to one card, since a new queued request no longer replaces an unread card. |
| unfinished-quote-place | Stale fixture isolation: shell and legacy scenes reused saved dismissals on the same synthetic map. Reset only those fixture choices between scenes, mark the unrelated Tiny Transcript first-use hint already seen, and remeasure the hovered card after its height changes; retain all quote, move, Undo and reading-time assertions. Persistence remains covered by phone-walk. |

Validation at 7443c69: all nine revised checks passed whole, with no case splitting and no reduced timing bounds. The full bricks run covered all 14 features; first-landing covered six runs; History and dock covered all four page configurations. The intermittent live-card path passed three consecutive whole runs after reconciling hover from the actual pointer target. The final unfinished-card run covered both renderers, sizes, and themes. Build, socket, notice, and send-card checks also passed.

No original failure was classified as load-only: each reproduced in isolation. Earlier externally terminated verification attempts were not counted as passes; the affected checks were rerun to successful completion.

Gate at 7443c69: `PRECHECK_PAGES=0 sh scripts/precheck.sh` exited 0 with no FAIL lines after the whole page runs. The gate's build, Rust tests, static checks, and source-level UI checks passed. Its browser phases were deliberately skipped because each of the nine requested page checks had been run separately and whole. Existing release-content warnings remain unchanged. No C0 feature cuts are included in this repair.


## Overlapping-countdown review correction

The prior live-page wait was wrong: another valid countdown can arrive while an older completion is unread. The old test case reproduced Import remaining modal and hiding Stop. The earlier revised-check passes did not prove that case.

Active send countdowns now interrupt the reading queue. The latest count stays in front of ordinary cards; its completion keeps that turn, then preserved unread cards resume in order. A superseded active count is retired. Import also closes if opened while a count is already active. Explicit per-kind notice preferences remain unchanged.

Removed both waits that hid the overlap from live-page-check. The original overlap is asserted directly, with extra checks that the old completion is still present before the new count arrives and that Stop receives input. The completed-card expiry regression is tested separately, after the overlap cases. Queue, notice-page, lane, and phone checks require active-count priority while retaining ordinary-card order, geometry, reading, focus, and preference coverage.

Targeted validation for this correction: the original unmodified overlap replay first failed at Import closing, then passed with countdown priority. The strengthened whole live-page check, notice priority rules, notices-page, lane, and phone checks passed. After concurrent main advanced to `2c66c1e` (i-partner), the UI build, whole live-page check, notice rules, and unchanged find-page recheck passed again. The broader gate began at `f670282` and encountered one Chrome-startup failure before find-page assertions; its unchanged recheck passed. The gate was still building the concurrently updated core when this correction was committed, so it is not recorded as a clean single-snapshot gate here. Other workers' changes were preserved.


## Conversation-spine gate repair

Integrated main at `6b0dbc5` without conflicts, preserving the conversation projection and main's notice and view changes. The merge is left uncommitted.

The first gate reproduced `demo-jobs-check` receiving a null child exit status under its three-second CLI deadline. Allow 30 seconds for process startup and report child-process errors explicitly; keep every exit-code, validation, no-connection, payload, pacing and shutdown assertion. No runtime behavior changed.

Validation: 670 Rust tests passed (13 ignored); the reported core failure did not reproduce. Both UI build modes, the projection invariants, and the whole projection, conversation-spine and all-threads Chrome checks passed. Brick contract rules passed. Live model calls were not exercised.

Final `PRECHECK_PAGES=0 sh scripts/precheck.sh` passed: all 54 enabled Node checks, core tests, builds and static guards. Browser phases ran separately as listed above. Existing release-content warnings remain; no running app was available for live probes. No commit or push.
