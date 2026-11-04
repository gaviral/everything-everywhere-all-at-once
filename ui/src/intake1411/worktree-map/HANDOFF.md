# Worktree map

Updated 2026-11-04 13:30 PT

Branch: `intake1411-worktree-map`. Base revision: `1af6ef1351f6225e20faf39983d9cdecfd157591`.
Changes are uncommitted; no delivery revision or dev receipt exists.

The exported `worktreeMapFeature` descriptor names switch `intake1411-worktree-map`, default off.
`WorktreeMap` defaults to the supplied host view without reading or subscribing to the adapter.
Disabling unmounts its reader and unsubscribes. The selection survives while the wrapper remains mounted.
For a host route that unmounts the wrapper, retain `createMapSelection()` above that visit boundary and inject it on return.
The host owns switch persistence and the `onRequestClose` action that turns the switch off.

`WorktreeMapAdapter` supplies synchronous `getSnapshot()` and `subscribe(listener)` with cleanup.
The code-canvas owner translates its read-only snapshot into this local contract; it must supply display-safe identities,
snapshot observation time/freshness, stable branch IDs, explicit main reference, and actual build revision separately from branch head.
No producer, canonical schema, git service, host import, catalog, global style or dependency changes are included.

Validation copies/freezes inputs, rejects duplicate IDs and unsupported shapes, and bounds snapshots to 500 branches.
Missing ancestry is explicitly unknown; cycles never become invented edges. Known child links below an unknown base are retained.
Missing/partial builds are unknown. Invalid input hides the invalid map; stale input is labeled stale.
Absent selected branches remain selected by stable ID and show unavailable until restored or another branch is chosen.
The map uses ordinary pressed buttons with visible selected text, a separate detail action, and focus restoration on return.
Narrow layouts stack the identity fields to keep enlarged text readable.

## Exact owned files

- `scripts/intake1411/worktree-map-check.mjs`
- `ui/src/intake1411/worktree-map/BranchTree.tsx`
- `ui/src/intake1411/worktree-map/HANDOFF.md`
- `ui/src/intake1411/worktree-map/LaneIdentity.tsx`
- `ui/src/intake1411/worktree-map/MapSelection.ts`
- `ui/src/intake1411/worktree-map/VersionSnapshot.ts`
- `ui/src/intake1411/worktree-map/WorktreeMap.tsx`
- `ui/src/intake1411/worktree-map/branchRelationships.ts`
- `ui/src/intake1411/worktree-map/contract.ts`
- `ui/src/intake1411/worktree-map/index.ts`
- `ui/src/intake1411/worktree-map/preview.css`
- `ui/src/intake1411/worktree-map/preview.html`
- `ui/src/intake1411/worktree-map/preview.tsx`
- `ui/src/intake1411/worktree-map/syntheticSnapshot.ts`
- `ui/src/intake1411/worktree-map/useVersionSnapshot.ts`
- `ui/src/intake1411/worktree-map/worktree-map.css`

## Verification and remaining integration

Initial `preflight.sh intake1411-worktree-map`: PASS, all ten checks, on the committed base before implementation.
This command archives a branch, so it does not cover the new uncommitted files.

`node scripts/intake1411/worktree-map-check.mjs`: PASS after final code changes.
It strictly typechecks the isolated namespace, builds the actual synthetic preview with existing dependencies,
and checks Chrome-rendered main/parent identity, two distinct worktrees/builds, native Enter selection,
detail focus/return, stable selection after reordered updates, unknown/missing/invalid data and recovery,
off-by-default behavior, unsubscribe/no reads while off, and selection after re-enable.
It checks 320px width, touch target heights and enlarged text; desktop/narrow/enlarged screenshots were inspected.
No app core, model, microphone or real profile is exercised. Temporary build/browser/screenshot artifacts are retained.
Recorded browser PIDs were checked after completion; none remained.

Two REAL harness failures were repaired without changing the acceptance assertions: missing Vite CSS types in the
standalone typecheck, and incomplete synthetic Enter dispatch (plus enabling page diagnostics).
No initial preflight check failed, so no preflight recheck was needed. The focused check was rerun directly after those repairs.
The existing recheck wrapper targets integrated top-level checks; host registration and the serialized full gate remain pending.

Evidence snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`, pinned throughout source reads.
Base object type was verified as commit and `merge-base --is-ancestor` against main returned exit 0.
Successful single-path evidence reads covered `ui/package.json`, `ui/tsconfig.json`, and browser-check helpers.
`ui/src/code-canvas`: MISSING from that main snapshot; no off-main producer was substituted.
Actual owner live data, canonical graph registration, host switch wiring, integration gate, delivery commit and dev receipt: MISSING.
No commit, push, publication, deployment or `todev.sh` was run.
