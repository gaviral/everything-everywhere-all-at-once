# Pen and touch input

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
Run `node scripts/feature-checks/pen-devices-check.mjs` from the repo root with existing UI dependencies and Chrome available.
The check builds only this preview into a fresh temporary artifact directory, runs its browser, closes its listener/browser and retains screenshots/results.
It does not invoke the app, network transport, microphone or a real device.
