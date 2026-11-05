# Reload recovery

2026-11-04 14:33 BC

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
  The feature does not start, stop, supervise or restart the producer.
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
