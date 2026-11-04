# Quote occurrence repair

Tested base: `39d3c4ac766d53864d6c3d1f6721b9747dbe5cc6`.
Base tree: `1fa3610f6d78b595a85f5ebdd04f43526d00ed9c`.
[private build note removed]

The existing annotation action now carries an optional context containing the immutable source text, source speaker, and half-open Unicode code-point range. The thought ID remains the source identity; the new thought's speaker remains the reply author. Range and source are validated before saving, and checked again under the commit guard. Exact anchors on different occurrences do not share a tangent. The journal change, snapshot, public brick contract, BrickSlot forwarding, playground and UI mirror retain this context.

New quote-only requests resolve only when the source has exactly one match. Multiple matches produce a visible refusal. Legacy journal changes default the new field and capture the source during replay only when unique; ambiguous legacy anchors remain unresolved, including if a later edit leaves one match. The UI uses the stored range only against its exact source revision. Changed sources show an unresolved status and an accessible original revision instead of relocating the underline.

Selection offsets count only source words, excluding the hidden speaker label. DOM UTF-16 offsets are converted to code points at selection and back at rendering. No model call or runtime dependency was added.

## Verification

- `cargo test --manifest-path core/Cargo.toml annotate --quiet`: 10 passed, including exact second occurrence, distinct first occurrence, source/reply authors, journal restart, Unicode, invalid ranges, legacy defaults and single-match migration.
- `cargo test --manifest-path core/Cargo.toml world::tests:: --quiet`: 24 passed.
- `node scripts/world-mirror-check.mjs`: passed after the final Rust change.
- `node scripts/actions-check.mjs`: passed.
- `npm --prefix ui run build`: passed after the BrickSlot forwarding fix (existing chunk-size warning).
- `PRECHECK_PAGES=1 node scripts/spine-reply-enter-check.mjs`: passed before the final forwarding fix.
- `PRECHECK_PAGES=1 node scripts/anchor-occurrence-check.mjs`: passed on the final build. The built app sends `[54,63)` with the frozen source and separate source speaker, marks the second occurrence after reconnect and reload, visibly refuses the ambiguous quote-only request, and reports unresolved after editing the source, including after reload. This uses the existing `headless.mjs` transport with a protocol-aware mirror; actual Rust journal restart is covered by the annotation tests above, not a claim of a real-server browser restart.
- [Observed outbound request, assertions and loaded asset SHA-256 hashes](anchor-occurrence-evidence/observed.json).
- [Second occurrence before edit](anchor-occurrence-evidence/repeated-before.png) and [unresolved after edit with original revision](anchor-occurrence-evidence/repeated-after.png), visually inspected.
- Loaded asset bytes were independently checked against `ui/dist` after the test. Main was rechecked unchanged after the final browser run.
- `PRECHECK_PAGES=0 node scripts/bricks-check.mjs`: blocked by the pre-existing `tiny-transcript/index.tsx` import of `../../shell/features`, confirmed in the tested main. New Spine imports use the public contract.
- Optional `replay_tests::` broad run was stopped by its owned PID after running over three minutes; it did not pass. Targeted annotation journal tests and world tests completed separately.
- `git diff --check`: passed. Main still matches the tested base.

## Missing task infrastructure

This checkout does not contain `tools/overnight/git-evidence.py`, `tools/overnight/runs/codex-review/acceptance.json`, `fixtures.json`, `ui-observed.json`, the supplied screenshots, review adapter, lane records, or `ctest.sh`. The required two o2 instruction reads returned `read_route_hold` / `Native read failed exit1; no fallback`. No alternate private location was accessed. The committed main inventory and exact base/tree were inspected with Git; the neutral repeated sentence in the brief supplies the local regression. The supplied review adapter and lane ownership could not be verified, so this is not a claim of passing that absent acceptance harness or clearance to land.
