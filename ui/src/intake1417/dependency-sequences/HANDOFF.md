# Dependency sequences

Updated 2026-11-04 14:44 BC

Implemented on `intake1417-dependency-sequences`, based on revision `8460e58ba9cc539682e21e07ba8f282b2346d34c`. Implementation files remain uncommitted. Owned paths are this directory and `scripts/intake1417-dependency-sequences-check.mjs`; no shared wiring was changed.

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

Synthetic-only preview: `preview.html` in this directory. With an existing UI development server, open `/src/intake1417/dependency-sequences/preview.html`; this lane did not start a server. The focused check independently builds the preview into a temporary directory and serves assets through a private Chrome debugging pipe, with no listening port.

Ran `node scripts/intake1417-dependency-sequences-check.mjs`: **PASS** scoped TypeScript, graph validation/ordering, unknown propagation including a dense graph, cycles, ownership boundaries, and rendered A→B with independent C. Visible checks also pass collision refusal without an edge, unknown/cycle explanations, keyboard and touch, B detail/return/refresh/reload retention, evidence updates, unavailable/invalid/empty snapshots, missing selection recovery, pending-read exit cleanup, rejection of queued subscription callbacks after exit, default-off zero activity, 320px layout and 200% text. Desktop, mobile, enlarged-text, collision and host-return screenshots were inspected. The runner prints its temporary artifact location.

Ran the required preflight on the starting branch snapshot: ten checks **PASS**. The prescribed lane recheck stopped before reaching the focused check: **REAL environment prerequisite**, `FAIL UI build`, `tsc: command not found`, because this worktree has no installed UI dependencies. The focused runner uses the existing dependency installation located through Git's common directory without changing manifests or shared files. Initial harness and type errors were corrected; the final focused run exits 0. No full gate was run; integration owns its serialized gate.

## Delivery gaps

- No dev receipt: `todev.sh` was not run because there is no committed implementation to merge. A commit of these owned files is its prerequisite; no commit was requested, and none was made.
- Host imports, catalog/switch wiring, live snapshot adapter and integrated-app availability remain with their existing owners. Synthetic verification does not establish live data or integrated availability.
- Pinned main evidence tree: `5d077daca802c43913a2fc1ee10895d8aa8a2da0`. `git-evidence.py` reports this feature's `index.tsx` **MISSING** from that snapshot. Main commit evidence was separately resolved as `1af6ef1351f6225e20faf39983d9cdecfd157591`, verified as a commit, with ancestry predicate exit 0. There is no main-delivery claim for this implementation.
- The full integration gate and shared build in a provisioned worktree remain unverified. No promotion, deployment, publication or push occurred.
