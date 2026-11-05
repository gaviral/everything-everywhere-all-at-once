# A quieter light default

The default Look now uses warm paper, soft charcoal ink and one peach accent. The chat surface sits a little deeper than the page, with gentle warm shadows and readable secondary labels. Changes are limited to light token values in `ui/src/styles.css`; dark tokens, layout, handlers and optional Looks are unchanged.

| Role | Light |
| --- | --- |
| Paper | `#f7f2eb` |
| Surface | `#fffaf4` |
| Chat surface | `#f5eee5` |
| Ink / secondary ink | `#35302b` / `#51473e` |
| Muted / faint labels | `#71675d` / `#74685d` |
| Peach ink / tint | `#8f523d` / `#f2dfd2` |

[1920 × 1080 comparison](light-better.png): the same labelled example conversation in both system schemes, with microphones off.

Validation: `npm run build` passed, with the existing large-chunk warning. `node scripts/light-better-check.mjs` passed: populated map and chat, tested text/background pairs at least 4.5:1 in both modes, unchanged dark surface/accent values, zero microphone requests, and exact capture dimensions. Earlier focused attempts exposed a faint-label contrast issue and two capture-harness issues (initialization and alpha compositing); all were corrected before the passing run. The capture was visually inspected. `git diff --check` passed. No `preflight.sh` exists in this repository; no broader suites were run.
