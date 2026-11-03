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
