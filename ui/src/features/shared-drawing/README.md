# Shared drawing

`drawingFeature` exports the default-off `intake1422-shared-drawing` switch.
`SharedDrawingView` composes the destination, input and actual operation receipts.
Create one `SketchSessionAdapter` above navigable views and call `dispose()` when
its owning session ends. Returning to the view retains its selected session and
the injected canonical document. Disabling cancels input and subscriptions; it
retains originals and queued operations. Re-enable explicitly to resume.

The injected `DrawingSessionPort` adapts the existing D75 exchange ID, destination
session identity and 1000 × 600 point contract. It must reference the existing
canonical document rather than create a second sketch. It owns authenticated
delivery, durable storage, reconnect deduplication and destination receipts.
The UI never owns transport, device presence, listener authority or audio.
Correction and undo append operations; every original mark remains in history.
The bounded journal accepts 128 operations and 2048 original/correction points.
History is session-lifetime in the fixture; browser reload persistence needs the
production host. No host registry, route or canonical schema is changed here.

## Explicit synthetic preview

From `ui`, run `npm run dev -- --host 127.0.0.1 --port 4482 --strictPort`, then open
`/src/features/shared-drawing/preview.html`. Enable Shared drawing and choose
Explanation board. Draw using pointer, pen or touch, or add an example box using
the keyboard. Only that board accepts those stroke IDs. Disconnect the board,
draw pending marks, and reconnect to see them accepted once. Correct/undo a mark,
inspect preserved originals, jump to notes and return, then turn the switch off.

`PreviewSessionHost` is a deterministic in-memory host, with one
`PreviewDocument` per session. Target views only see accepted operations.
`node scripts/feature-checks/shared-drawing-check.mjs --opt-in` runs the isolated
observer with synthetic marks and screenshots. Without `--opt-in` it does not
start a server or browser. Set `SHOTS` to retain screenshots at a chosen path;
otherwise the observer prints its temporary evidence directory. It uses an OS
allocated HTTP port and its own browser profile, leaving artifacts for inspection.
