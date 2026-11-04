# Pen and touch input

Updated 2026-11-04 13:33 PT

Branch: `intake1411-pen-devices`. Base revision: `1af6ef1351f6225e20faf39983d9cdecfd157591`.
Implementation is new, uncommitted work. No lane commit, push, integration, publication or deployment performed.

Switch: `intake1411-pen-devices`, off by default. `InputSurface` also defaults `enabled` to false.
Disabling removes capture, aborts pending deliveries, unsubscribes from the adapter and retains receipts and destination data.
Re-enabling requires Start drawing again. Incomplete gestures cancel on device/session change, disconnect, blur or pointer cancellation.

## Host boundary

Import `InputSurface`, `penDevicesFeature` and the types from `index.ts`. The host owns its switch preference and adapter lifetime.
Inject a `PenDevicesAdapter` that bridges the existing transport to the sketch destination; no sibling source imports are needed.
Its methods must be callable without a receiver, and `getSnapshot()` must retain object identity until state changes.
Provide open sessions with stable IDs and current connection status. Touch availability describes the existing adapter, not detected hardware.
Forward `OriginalStroke` unchanged: UUID, explicit destination, raw client coordinates, normalized coordinates, pressure,
browser event timestamps, time origin and the coordinate frame frozen at stroke start.
Resolve `sendStroke` only after the intended destination acknowledges that stroke ID and session ID. Honor its abort signal.
The destination owns durable storage and duplicate prevention. This part never retries, creates a server, assigns annotation meanings or deletes marks.
Receipts remain in memory while the part is mounted; durable data remains the host's responsibility.

`preview.html` and `preview.tsx` compose the isolated, synthetic two-session preview. Its adapter is an in-memory fixture only.
Run `node scripts/intake1411/pen-devices-check.mjs` from the repo root with existing UI dependencies and Chrome available.
The check builds only this preview into a fresh temporary artifact directory, runs its browser, closes its listener/browser and retains screenshots/results.
It does not invoke the app, network transport, microphone or a real device.

## Actual checks

- Branch preflight: all ten checks passed. Preflight archives the committed branch, so this proves the base revision, not these uncommitted additions.
- App TypeScript check: passed after initial implementation. Final focused TypeScript and isolated preview build: passed.
- Focused browser acceptance: ten checks passed, including explicit two-session routing and matching IDs; original samples;
  delayed and mismatched receipts; touch isolation and cancellation; a browser touch gesture without page scrolling;
  360px and 200% text layout; keyboard control access; switch-off cancellation and subscription cleanup;
  session changes during a gesture; disconnect cancellation and no reconnect replay.
- Required recheck: UI build, Rust build and `pen-devices-check` passed. The nested check argument initially failed before execution
  because the shared wrapper constructs flat log paths. A temporary view with a flat symlink to the exact owned check corrected the caller;
  shared tooling and assertions were unchanged. Final artifacts: temporary directory `pen-devices-check-37o5MW`.
- REAL failures repaired: isolated TypeScript environment setup and destination-card overflow at 200% text. Screenshots inspected:
  desktop, destination marks, mobile, disconnection and enlarged-text keyboard focus.
- Full gate: not run; reserved for serialized host integration.

## Evidence and gaps

Verified main commit type and ancestry: base revision is a commit; `merge-base --is-ancestor` exited 0.
Pinned main snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`.
Single-path evidence reads found the existing remote channel; it provides gesture/selection messages rather than this stroke acknowledgment API.
MISSING in that snapshot: `ui/src/intake1411/sketch-labels/contracts.ts` and `ui/src/sketch-exchange/contracts.ts`.
The injected contract is a lane boundary awaiting the owners' bridge, not evidence that an owner transport has been delivered.

MISSING: physical pen/Wacom observation, physical phone observation, physical iPad observation, real owner-transport delivery,
host feature wiring, serialized full gate and dev receipt. Simulated pen/touch/browser events are not hardware proof.
No `todev.sh` invocation: a committed lane revision has not been authorized or produced.

## Exact owned files

All UI paths below are relative to `ui/src/intake1411/pen-devices/`:

- `contracts.ts`, `index.ts`
- `PointerCapture.ts`, `TouchCapture.ts`, `capture-stroke.ts`
- `DrawingSurface.tsx`, `DeviceChoice.tsx`, `SessionTarget.tsx`, `capture-readiness.ts`
- `adapter-snapshot.ts`, `StrokeDelivery.ts`, `StrokeReceipts.tsx`, `InputSurface.tsx`
- `pen-devices.css`
- `preview-adapter.ts`, `preview.tsx`, `preview.html`, `preview.css`
- `HANDOFF.md`

Focused check: `scripts/intake1411/pen-devices-check.mjs`.
No tracked file outside these allocations was changed.
