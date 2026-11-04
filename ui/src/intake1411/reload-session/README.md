# Reload recovery

2026-11-04 14:33 BC

Branch: `intake1411-reload-session`. Base/HEAD: `1af6ef1351f6225e20faf39983d9cdecfd157591`.
Implementation is uncommitted. No integration mutation, push, publication or deployment was performed.

The descriptor exported by `index.ts` has ID `intake1411-reload-session` and `defaultEnabled: false`.
The host owns its feature preference. The synthetic preview remembers an explicit opt-in in session storage;
a fresh browser profile starts off. Disabling invalidates the current driver, cancels both subscriptions,
does no recovery writes, and retains stored checkpoints. Disposal has the same cancellation behavior.

## Host contract

`createReloadSession` composes the identity guard, checkpoint store, state and switch. All runtime imports
stay in this namespace. The typed ports are in `contracts.ts`; there is no model or network dependency.

- Supply the selected map/session/build identity. Dispose and create a new instance when that selection changes.
  A checkpoint or event must match all three fields exactly. The snapshot revision is the last healthy content
  revision, separate from the selected build identity. Other identities are ignored, including their errors.
- Supply actual owner-driver events through `ReloadSource`. Subscription must replay the current snapshot or
  report its actual disconnected/building/failed condition. A connection alone never establishes readiness.
  The lane does not start, stop, supervise or restart the producer.
- Supply a `RecoveryHost` scoped to that selection. Change notifications mean user draft/selection/view changes.
  `applySnapshot` updates content atomically and keeps local draft/view state. Restoration must remain passive:
  no sends, focus changes, media requests or microphone starts. Resolve any unsupported view IDs in the host.
- Supply synchronous `RecoveryStorage` (for example, a browser storage adapter). One versioned record contains
  draft, selection direction/range, view ID and camera. Invalid records are retained and reported unavailable;
  storage errors do not turn a healthy build into a failed build. Explicit new edits can replace a checkpoint.
- Subscribe to `state` and call `setEnabled` with the host preference. `describeReloadState` supplies truthful
  ready/rebuilding/failed/disconnected text. A matching healthy snapshot unlocks one restore per recovery cycle.
  Repeated snapshots do not restore again. New user edits made while awaiting a snapshot take precedence.

No shell/catalog/global style/Rust/schema/manifest integration is included. The host owner provides that wiring.
Styles are scoped to `reload-session-*` classes. `preview.html` is a standalone Vite entry under this namespace.

## Verification receipt

- `sh tools/overnight/preflight.sh intake1411-reload-session` in the design repository: exit 0, all ten checks
  passed. This archives the branch's committed base; it does not include the uncommitted lane implementation.
- `tools/overnight/recheck.sh intake1411/reload-session-check`, with `FINAL_TREE` selecting this worktree:
  exit 0 after UI build, core build and the focused check. The helper assumes flat log names. A temporary
  caller-local `mktemp` wrapper prepared its nested `intake1411` log directory; shared tooling was not edited.
- Focused injected acceptance passed: fresh default off, exact identity isolation, once-per-cycle restoration,
  draft/selection/view/camera preservation, disconnected edits, unavailable/corrupt storage, reentrant disable,
  late callbacks, listener cancellation, preserved stored data and no automatic sends/microphone calls.
- Focused headless browser acceptance passed: real native page reload with backward text selection, nondefault
  view and panned/zoomed camera; connection without readiness; all three snapshot identity mismatches; separate
  session isolation; failed build retaining the last healthy scene; recovery; disable with unchanged storage;
  off across reload; re-enable; keyboard Space; 320px and enlarged text without horizontal page overflow.
- Desktop failed-build, phone and enlarged-text screenshots were inspected. Controls remain reachable, status
  remains visible and the intentionally panned scene clips inside its viewport. The check retains screenshots
  and its temporary browser/cache artifacts outside the repository, and reports the artifact directory.
  Its owned Chrome PID was 35741; process exit was awaited and absence confirmed afterward.
- Initial REAL failures in event-union narrowing and the test's browser text extractor were repaired.
  The standalone compiler invocation also needed the existing Vite CSS declaration; recheck's full UI build
  includes that declaration and passed. Initial recheck attempts reached a REAL nested-log-path error before
  the focused test could launch; the final receipt above includes the executed check.

Run the isolated acceptance from the app worktree with installed existing UI dependencies:

```sh
node scripts/intake1411/reload-session-check.mjs
```

The check uses ephemeral loopback listeners and a fresh owned headless browser profile. It closes its server,
stops only that recorded browser process and waits for process exit. It does not use the protected host ports.

## Evidence gaps and integration receipt

Pinned main tree: `5d077daca802c43913a2fc1ee10895d8aa8a2da0`.
Separately resolved main commit: `1af6ef1351f6225e20faf39983d9cdecfd157591`;
`git cat-file -t` returned `commit`, and `git merge-base --is-ancestor HASH main` ran with `check=False`, exit 0.
Separate single-path `git-evidence.py` reads returned MISSING for `scripts/dev-watch.mjs` and
`scripts/i-reload-check.mjs` on that pinned tree. Historical receipts were not used as current implementation.

Real source-edit/restart demonstration: **MISSING**, awaiting the recovered owner driver.
Host integration and dev receipt: **MISSING**. No commit was authorized, so `todev.sh` was not run.
One serialized full gate remains with the host owner; this lane did not run it.

## Exact owned files

All paths below except the check are relative to `ui/src/intake1411/reload-session/`:

- `README.md`
- `contracts.ts`
- `ReloadIdentity.ts`
- `DraftCheckpoint.ts`
- `ViewCheckpoint.ts`
- `CheckpointStore.ts`
- `ReloadDriver.ts`
- `ReloadState.ts`
- `RecoverySwitch.ts`
- `index.ts`
- `preview.html`
- `preview.ts`
- `preview-layout.ts`
- `preview-driver.ts`
- `preview-storage.ts`
- `preview-host.ts`
- `preview-controls.ts`
- `preview.css`
- `scripts/intake1411/reload-session-check.mjs` (relative to the app root)
