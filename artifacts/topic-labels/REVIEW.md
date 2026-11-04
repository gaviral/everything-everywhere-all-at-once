Historical topic destination label review

Recorded branch: conv-topic-labels. The review used commit 5b02f2d5c261a00405f80e0838e9c0bcb9d520f7, a verified ancestor of main. Its isolated worktree was clean before the repair; no landing was performed during that review.

Decision: stack conversation membership shortcuts at full text-column width. Preserve their title, aria-label, native button behavior, focus ring, and visit destinations. Measure each wrapped label with the existing canvas font helper and reserve its full height plus gaps in conversationLayout. Reply shortcuts and pause controls share that reservation. The ordinary map, Features default, routing, and thought data are unchanged.

Changed production files: ui/src/bricks/spine/{conversation.ts,nodes.tsx,spine.css}. The nodes/CSS edits affect only conversation shortcut rendering. Reconcile these small hunks with the shared-file landing owner.

Checks already completed:
- npm run build (ui): exit 0, TypeScript plus app and bricks production bundles. Existing large-chunk warnings remain.
- PRECHECK_PAGES=1 node scripts/spine-conversation-projection-check.mjs: exit 0. Pure projection/session invariants, session lenses, Off-state identity, phone geometry, ordinary/reduced motion passed.
- PRECHECK_PAGES=1 node scripts/conversation-spine-check.mjs: exit 0. 12 turns, five comments, original words, held pan and resumed follow passed.
- git diff --check: exit 0.

Mounted acceptance: scripts/turn-topic-labels-check.mjs serves ui/dist with a synthetic stand-in core. It exercises Features On/Off, a single split turn with three topics, exact trailing-space draft retention, original IDs and Off geometry, all three click/touch destinations, Tab focus, keyboard Rent, long title wrapping, and phone reduced motion. Completed with exit 0: all four cases passed (desktop 1440×900 and touch-emulated phone 390×844; normal and long titles). results.json records label bounds, full accessible names, destinations, original IDs, draft retention, and Off identity. All four saved screenshots were visually inspected.

Evidence gaps: reference screenshots and a separate ownership registry were unavailable. The checks recorded here do not establish live-service or physical-device behavior.

Limitations: Chrome emulation rather than a physical phone; synthetic offline core rather than a live Rust service. Lens changes retain the existing camera anchor, so the harness uses the existing See all action before revisiting the turn. The canvas can pan under its floating controls; camera behavior was not changed. Earlier harness calibration captures are retained in calibration/ (destination subtitle assertion, retained lens camera, native CDP Enter without text).

Screenshots (actual built UI):
- desktop-conversation.png — 1440×900, three names and keyboard focus.
- phone-conversation.png — 390×844, three names, touch and reduced motion.
- desktop-long-conversation.png — 1440×900, complete wrapped long title.
- phone-long-conversation.png — 390×844, complete wrapped long title, touch and reduced motion.

State at the end of that review: the tested base remained 5b02f2d5c261a00405f80e0838e9c0bcb9d520f7; no landing, push, or deployment had been performed. Later integrations require fresh verification. No new runtime dependency was introduced.
