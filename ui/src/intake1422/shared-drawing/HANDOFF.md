# Shared drawing handoff

2026-11-04 14:51 BC

Implemented only the shared-drawing namespace and its explicit opt-in observer.
The default-off `intake1422-shared-drawing` descriptor exports a scoped preview
and a typed `DrawingSessionPort` seam. D75 exchange/destination identities and
point bounds are reused. No global registration or transport is added.

The synthetic host preserves one canonical append-only journal per session.
Receipts identify actual operations; queued strokes remain pending until the
selected destination accepts them. Correction/undo retain original points.
Navigation retains the selected session, and disabling preserves data while
stopping the adapter's subscription and delivery. The host must own this adapter
above navigable views and supply persistence for reload survival.

Verification performed:

- `ui/node_modules/.bin/tsc --noEmit` from `ui`: passed after correcting the
  generator callback's inferred UUID-only type (REAL implementation type error).
- `node scripts/intake1422/shared-drawing-check.mjs`: reported OFF without
  starting a browser/server.
- `node scripts/intake1422/shared-drawing-check.mjs --opt-in`: final run passed
  contract and browser checks. Covered immutable originals, wrong sender and
  invalid point rejection, capacity bounds, failed session reads, failed enable,
  ordered IDs, separate destinations, disconnected pending operations, repeated
  reconnect without duplicates, correction/undo, visit/return, disable/re-enable,
  pointer/touch input, 390px phone layout and 200% text.
- Desktop, phone and enlarged-text screenshots were generated in the observer's
  reported temporary evidence directory and visually inspected.
- The extended browser check initially failed because repeated DevTools
  evaluations redeclared a top-level variable (REAL observer error). A scoped
  destination helper corrected it; the full observer then passed unchanged
  assertions. Observer browser PIDs were confirmed exited.

MISSING integration proof:

- `sh tools/overnight/preflight.sh intake1422-shared-drawing` and
  `sh tools/overnight/recheck.sh intake1422-shared-drawing` both exited 127 because
  those scripts are absent here. This is a REAL checkout tooling gap, not a
  passing overnight gate. No full integration gate was run.
- The local `dev` ref and intake1411 sketch-labels/pen-devices namespace are
  absent. The provided lane branch was preserved, starting at
  `c331290f6204e02b751a96de63712c46c232ab59`; no branch reset or other checkout
  was used. Dev ancestry/landing has no local receipt.
- Production session-port wiring, physical-device delivery, reload persistence
  and film proof remain with their existing owners. The larger canvas reference
  still needs identification by the hub.

The invoking hub owns landing. No push, todev action, deployment, microphone
activation or reserved-port use was performed.
