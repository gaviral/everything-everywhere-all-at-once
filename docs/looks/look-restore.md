# Warm ink restoration

Compared `1af6ef13` with the starting dev revision `c6a45c6e`. The shell's shared palette and Talk stylesheet were already blue/purple at the older revision; those files did not change between these revisions. Today's additions include explicit light-theme palettes. The screenshots compare starting dev with this restoration, not a reconstructed older app.

| Part | Starting dev | Restored default |
| --- | --- | --- |
| Dark sheet | Cool charcoal `#0e1013` | Warm charcoal `#171613` |
| Light sheet | Cream `#f5f1e8` | Warm paper `#f4efe5` |
| Active/input accent | Blue `#83b0ff` / `#2b4a94` | Gold `#d2b779` / `#80601f` |
| AI accent | Purple | Same quiet gold, identified by ✦ |
| Chat and controls | Cool dark surfaces, blue active cues | Warm neutral surfaces, gold active cues |
| Light Look | Warm paper by default, with blue actions | Warm paper by default, with gold actions |

Cool studio and High contrast retain their palettes and remain selectable. Topic identity colours remain. The mirrored icon, handwriting, arrows, spacing, layouts and features are untouched. The Agent work link now follows the page palette in both themes. The symbol legend and colour checks reflect the shared accent.

All captures are 1920 × 1080, with labelled synthetic example content and the microphone off:

| Theme | Before | After |
| --- | --- | --- |
| Dark | [Before](look-restore-before.png) | [Restored](look-restore.png) |
| Light | [Before](look-restore-before-light.png) | [Restored](look-restore-light.png) |

Validation: `npm run build` passed (existing large-chunk warning). `node scripts/look-restore-check.mjs --before` captured the baseline after correcting a nonexistent button selector to the T shortcut. `node scripts/look-restore-check.mjs` passed: visible example and chat, warm rendered colours, at least 4.5:1 text/accent contrast, Warm paper default, and all light Look options. Captures were visually inspected. `git diff --check` passed. The updated shell/guide suites were not run; only the focused check was run. No `preflight.sh` exists in this repository.

New check runs write screenshots to a temporary directory and print its path. Set `LOOK_RESTORE_SHOTS` to choose an output directory; the retained comparison images above are not overwritten by default.
