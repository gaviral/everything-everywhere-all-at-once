# Release branch audit

## Earlier audit

Integrated `exp` through `cf7acd4` on `r-release`; no changes were made to `exp` or `main`.

- Secret scanning still covers every tracked working/index file and all reachable objects. Generic key/token assignments require 16 characters; passwords and secrets retain the shorter threshold. Provider-specific patterns are unchanged. This removes all 17 historical fixture matches without excluding `scripts/start-check.mjs`.
- Seven release-safety tests pass. A temporary repository stages harmless `scripts/start-check.mjs` fixtures, then a working-tree edit plants a synthetic 32-character key at that same path: the scanner rejects it, redacts it, and passes after the temporary file is removed. The fixture repository is cleaned up.
- The full-history scan reports zero findings. Full `bricks-check` passes all 14 bricks, including playground and app; the isolated Spine playground check also passes. Brick code and its check match the integrated `exp`. No remaining bricks product failure was reproduced; an interrupted run exited 143 without assertion output, which is not a product diagnosis. No brick assertions were relaxed.

The complete strict precheck results are recorded below. Its UI build preceded the final integration of `cf7acd4`; page failures therefore also need confirmation with that commit's rebuilt UI before attributing them to the final product.

## Verification after main integration

Main at `2c66c1e` is integrated in the working tree and index; the merge remains uncommitted. The precheck conflict is resolved. Page modes `0`, `only`, and `all` remain available, and `PRECHECK_LOGS` again writes each check's log and status directly in the supplied directory. Selected statuses are cleared before workers start so an interrupted check cannot reuse a prior pass.

- All eight offline release-safety tests pass, including planted-key detection and redaction, page selection, strict release checks, and the direct log/status contract.
- The full scan passes with zero findings across tracked working/index files and all 11,007 reachable Git objects. No paths are exempted from secret detection.
- Full `bricks-check` passes all 14 bricks in playground and app against the rebuilt UI.
- `PRECHECK_PAGES=0` precheck passes all 78 checks, including the UI build and Rust tests. Live probes were skipped because no app was running on the selected test port.

README pitch, hosted, numbers, and trials placeholders and the stand-in number in `core/src/apps.rs:19` still block the release gate. The actual release script, push, and deployment were not run.
