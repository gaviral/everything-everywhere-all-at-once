# Worktree map

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

## Verification and remaining integration

`node scripts/feature-checks/worktree-map-check.mjs`: PASS after final code changes.
It strictly typechecks the isolated namespace, builds the actual synthetic preview with existing dependencies,
and checks Chrome-rendered main/parent identity, two distinct worktrees/builds, native Enter selection,
detail focus/return, stable selection after reordered updates, unknown/missing/invalid data and recovery,
off-by-default behavior, unsubscribe/no reads while off, and selection after re-enable.
It checks 320px width, touch target heights and enlarged text; desktop/narrow/enlarged screenshots were inspected.
No app core, model, microphone or real profile is exercised. Temporary build/browser/screenshot artifacts are retained.
Recorded browser PIDs were checked after completion; none remained.
