# Feature map

Open `?everything`, or enable **Feature map** in Features. It starts off.

The first screen puts every registered feature on one canvas under six verbs: Talk, Draw, Build, Understand, Remember and Share. At phone width the six verbs remain visible; opening one reveals its full branches. Click a verb, or say its exact word while already listening. Ordinary sentences do not navigate. This feature makes no model calls or capture requests.

Click a feature to try the real feature on the current map. **Esc** or **Back to feature map** returns to the same cluster, scroll position and focused feature. A previously off trial turns off on return unless **Keep on** was chosen; already enabled features stay enabled. Esc from a cluster returns to all six verbs; Esc again closes the map.

The parts have one job each:

- `groups.ts` assigns every current feature id to one verb. Unknown future ids remain visible under Build.
- `catalog.ts` reads BRICKS and BUILT_INS and switches their existing flags. These host imports are required by this feature's brief; no shared file changes are needed.
- `Map.tsx` draws the overview and readable branches.
- `Surface.tsx` owns the dialog and focus boundary.
- `navigation.ts` waits for the host's Show control and destination when a feature owns a view.
- `useVisit.ts` retains the map visit and reading position.
- `useCommands.ts` handles existing word events and Escape without starting listening.
- `index.tsx` coordinates browsing, trials and returns.

Focused check: `node ui/src/bricks/catalog-canvas/checks/check.mjs`.

The final run passed scoped TypeScript, a production build, all 120 registered feature mappings, TV fit, phone word bounds, empty-map content, panel/view/built-in trials, keep/restore, scroll/focus restoration, voice deduplication and zero microphone requests. Screenshots and build output remain ignored in `.check-artifacts/`.

The host currently excludes the existing `speech-review` manifest: its description has 91 characters, beyond the 90-character limit. That unrelated feature was left untouched. No `preflight.sh` exists in this checkout; the hub owns landing and its preflight. No push was performed.
