## Host contract

`index.tsx` exports `dependencySequencesFeature` and `DependencySequences`. Switch ID: `intake1417-dependency-sequences`; `defaultEnabled: false`. Pass controlled `enabled`, a `DependencyAdapter`, optional persistent `SelectionStore`, and `onDisable`. The host must turn its switch off and restore its return destination in `onDisable`. Omitted `enabled` means off.

The adapter accepts a visit-owned abort signal and supplies a typed snapshot with a revision, stable part IDs, names, owners, repository-relative file scopes, prerequisite IDs and evidence (`pending`, `complete`, `unknown`). Optional subscription returns its own cleanup. It has no launch or external-action method. IDs are retained verbatim for joins with identity and topology views; this feature owns neither canonical identity nor branch topology.

`analysis.ts` exports pure input validation, ordering and collision analysis. Scopes support exact files and `directory/**`, with segment boundaries; arbitrary globs and absolute/traversal paths are rejected. Empty scopes permit dependency analysis but prevent a parallel recommendation. Unknown references and unknown evidence stay blocked, including downstream dependents. Cycles and their downstream blockers are explicit. Completion requires supplied completion evidence and verified prerequisites. Malformed/unavailable refreshes hide eligibility until recovery.

## Parts and decisions

| Part | Input → output |
| --- | --- |
| DependencyInput | Supplied snapshot → copied valid snapshot or explicit validation errors |
| DependencyCycles | Valid parts → strongly connected cyclic groups |
| DependencyOrder | Valid snapshot → ready, blocked, unknown, cyclic and complete rows with immediate causes |
| CollisionGroups | Declared scopes → overlapping part pairs and scopes |
| ParallelComparison | Selected row, rows and collisions → pair eligibility and explanation |
| DependencySnapshotState | Enabled adapter → latest verified snapshot, loading/errors, refresh and owned cleanup |
| DependencySelection | Enabled visit and selection store → retained stable ID and selection action |
| SequenceView | Analysis and selection → overview, prerequisite inspection and return navigation |

Inline detail replaces the overview rather than opening an overlay, leaving controls reachable on narrow screens. Selection is independent of detail navigation and survives return, refresh, reload, missing IDs, errors and switch-off. Return restores the selected button's keyboard focus; detail focuses its heading. Unknown explanations name the immediate prerequisite rather than expanding a dense graph recursively. Collision explanations are separate from prerequisite status. Pair comparisons describe eligibility, not operational batches or scheduling.

## Preview and verification

Synthetic-only preview: `preview.html` in this directory. With an existing UI development server, open `/src/features/dependency-sequences/preview.html`; this feature did not start a server. The focused check independently builds the preview into a temporary directory and serves assets through a private Chrome debugging pipe, with no listening port.

Ran `node scripts/dependency-sequences-check.mjs`: **PASS** scoped TypeScript, graph validation/ordering, unknown propagation including a dense graph, cycles, ownership boundaries, and rendered A→B with independent C. Visible checks also pass collision refusal without an edge, unknown/cycle explanations, keyboard and touch, B detail/return/refresh/reload retention, evidence updates, unavailable/invalid/empty snapshots, missing selection recovery, pending-read exit cleanup, rejection of queued subscription callbacks after exit, default-off zero activity, 320px layout and 200% text. Desktop, mobile, enlarged-text, collision and host-return screenshots were inspected. The runner prints its temporary artifact location.
