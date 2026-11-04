# Train gate repair — 2026-11-04

Decisions:
- Preserve all feature code and behavior; the only runtime-source edit clarifies a comment.
- Keep Full content's React Flow wrapper styling. The CSS check recognizes the library-owned class only while React Flow is rendered in source.
- Catalog Inspect here and Full content actions, and track Find's capture-phase blur handler without reverting its focus behavior.
- Supply detached tool hosts in the server-render fixture and the sample-seeding helper in the launch fixture.
- Stub the separately tested tree boundary only inside the release-safety fixture that isolates strict UI selection.
- Declare the projection check's browser dependency directly so offline precheck defers it; preserve its pure assertions and successor session checks.
- List the five missing modules in the architecture inventory.

Verification:
- Passed: release-safety-test.py (9 tests), css-check.mjs, feedback-check.mjs, map-render-check.mjs, readme-check.mjs, spine-conversation-projection-check.mjs, start-check.mjs.
- Projection included the real session browser assertions: stable cards and anchor, persistence, reduced motion, phone layout and feature-off restoration.
- Passed: UI build (TypeScript and both Vite outputs); Vite retained its bundle-size warning.
- Passed: exact precheck selection function in offline, page-only and all modes; scoped wording guard; final whitespace diff check.
- Full precheck and the broader merge gate were not rerun. No commit or push.

## c10-estimates / c10-phone / f7-drafts train

- Keep estimates, Spatial/Inline phone reading, and draft behavior. Pass partner and rotation switches through the brick contract; share the mounted tool slot through that contract and scope Canvas styles to its frame.
- Use neutral reading-mode identifiers and Tangent labels; retain the existing claims, privacy and credential guards unchanged.
- Restore older topics' quoted words while retaining the exact recorded-source requirement for Resume. Exercise recorded pauses in the return fixture; pointer returns keep focus, and bare Enter on an empty return focuses the composer.
- Match browser fixtures to native Enter activation, voice availability/events, the default email handshake and current Stop reply/Stop conversation controls. Wait for portal focus to settle before the next action.
- Catalog coverage distinguishes built-ins from folder bricks and preserves the core Canvas tab order. Grouped column growth may move a later whole topic downward; its column and internal geometry must remain unchanged. Guide coverage accepts the documented exact ring when no clear arrow route exists.
- Keep theme headings clear during follow and fit the Canvas to the available width when a side lane opens while following.
- Verification is limited to the gate's named checks, their build prerequisites, and the unchanged secrets/privacy/claims guards. Full precheck, publication, commit and push are outside this repair.

Verification of this train:
- The 37 named script checks were selected from the complete gate report: 35 passed, including the isolated real-core/bridge Comment check. The final brick, guide, Canvas tools, return-focus, rotation, phone-walk and Work spine reruns passed against the final UI build.
- The remaining two scripts report unavailable live-service evidence: notices speech requires the model credential; page speech's browser fixtures pass but its required real-service trace is unavailable. Neither requirement was removed or downgraded.
- Core tests: 725 passed, 15 ignored, zero failures. UI and core builds passed; UI retained the existing bundle-size warning.
- Unchanged privacy and claims guards passed. The unchanged credential scan reported four redacted findings in reachable historical objects, with no working/index findings reported. History was not rewritten.
- Final whitespace diff check passed. No full precheck or merge-gate rerun, commit, or push. Disposable Comment core/listener processes were stopped by their own PIDs; reserved ports were not used.

## ux-fold staging refusal

- `git merge hub-base` fast-forwarded `ux-fold` from `8ec1890c` to `23b67ba4` without conflicts. The supplied base already contains the original UI commit as a merge parent, preserving both the UI changes and the other integrated work.
- The refusal reported unfinished work in the integration host's `e2a2o-staging` checkout after all ten reported checks passed. That checkout is absent from this workspace and its Git worktree list. No staging changes were discarded or claimed to be resolved. The integration host must preserve and resolve that work before retrying its merge.
- No application or guard change is justified by the supplied refusal. This commit records the merged base and local verification; it does not clear the integration host's staging prerequisite.
- Local verification: the TypeScript build and both Vite outputs passed. `ux-fold-check.mjs` passed at 1440×900, 390×844, 320×844 and 3840×2160, covering labels, image defaults, routing, zoom, native full screen and saved typing. The wording and home-path checks passed.
- The tree guard, names, links, dates, Meta-only model and call-count guards, and shell syntax checks for `run.sh` and `scripts/trial.sh` also passed. The full integration gate was not rerun here.
