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

## w11-c10-research staging refusal

- `git merge hub-base` fast-forwarded `w11-c10-research` from `8735da90` to `687aa617` without conflicts. The base already includes the research commit as a merge parent, preserving the research changes and the other integrated work.
- Both reported rounds of ten checks passed. The refusal concerns unfinished work in the integration host's `e2a2o-staging` checkout. That checkout is absent locally, including from the Git worktree list, so its unfinished work could not be inspected or resolved here. No staging work was discarded.
- The integration host must preserve and resolve that checkout's unfinished work before retrying. This record does not clear that prerequisite; the refusal provides no application or guard failure to repair on this branch.
- Local verification: the TypeScript build and both Vite outputs passed with the existing bundle-size warning. `c10-research-reopen-check.mjs` passed, covering explicit research and attachment, reopening the original quote and citation, draft preservation, reload, desktop and phone layouts, changed and missing sources, offline reading, removal and undo, cancellation, and no media or external requests. This uses a synthetic host and local preview persistence, without live model or core persistence evidence.
- The tree guard, names, links, dates, Meta-only model and call-count guards, wording and home-path checks, and shell syntax checks for `run.sh` and `scripts/trial.sh` passed. The full integration gate was not rerun here.

## parity-topic-views dev refusal

- `git merge hub-base` merged base `00095e2d` into `parity-topic-views` as `92430774` without conflicts. The topic views feature and the base's replay feature and core comment correction are preserved.
- For the 15:38:46 refusal of `6c6308c3`, another `git merge hub-base` fast-forwarded this branch to `e34436aa` without conflicts. That base already includes `6c6308c3` as a merge parent, preserving topic views alongside the integrated concurrent work, place drafts and presentation changes.
- Both reported rounds of ten checks passed. The refusal concerns unfinished work in the integration host's staging checkout. Neither that checkout nor its local username equivalent exists here, and neither staging nor dev appears in the Git worktree list. No Git remote is configured here, and the refusal text is absent from the repository's executable scripts. Its unfinished work cannot be inspected or resolved from this workspace; no integration work was discarded.
- The integration host must preserve and resolve that checkout's unfinished work before retrying. This record does not clear that prerequisite, and the refusal identifies no application or guard failure to repair on this branch.
- Local verification was repeated after merging `e34436aa`: the TypeScript check and both Vite builds passed, retaining the existing bundle-size warning. The focused topic views check passed, covering the example and live projections, original source links, independent notes, jump-return selection and filters, reconnect and rename, map isolation, changed and missing sources, chronological conversation, keyboard activation, and desktop and phone layouts. This is isolated browser evidence, without live model or core persistence evidence.
- The tree guard, names, links, dates, Meta-only model and call-count guards, wording and home-path checks, and shell syntax checks for `run.sh` and `scripts/trial.sh` passed. The full integration gate was not rerun here.
