# Sketch exchange

Off by default. `sketchExchangeFeature` describes the feature; `SketchExchange` renders one host-authenticated session. Each view has an explicit checkbox; the transport also enforces `setEnabled(boolean)`.

## Scoped preview

Run `npm run dev -- --host 127.0.0.1 --port 4478` in `ui`, then open `/src/msg1351/sketch-exchange/preview.html`. Enable the tablet and Main display, draw or Add box, choose Main display and Send sketch. On Main display draw a reply and Return visual reply. Second display stays empty, even when enabled. The preview uses a browser BroadcastChannel; it does not demonstrate LAN delivery. Content is transient and remains only until the page closes.

## Host contract

Supply a stable `HostAdapter` with authenticated `self`, uniquely labeled live `targets`, a targeted `send` and subscription. `send` only queues: receipt must come from the destination after accepting its drawing. Sessions sharing a person still require distinct IDs. Recreate the adapter when the live session inventory changes. The UI never automatically selects a destination. Unavailable targets produce no receipt; there is no automatic replay. Disable suspends subscriptions and sends while preserving sketches. Re-enable does not replay missed messages.

The existing room WebSocket is the intended LAN adapter, but its current remote message schema does not carry these envelopes. Integration must add a dedicated typed message and use the Rust relay under the authenticated connection identity. Do not put drawings in gesture strings. The unregistered Rust module is dependency-free and enforces opt-in, bounds, sender identity, destination and reply correlation. The host must retain one Relay for its active session set, call disconnect, and serialize the types at its protocol boundary. Routing authorization alone is not a receipt.

UI and relay accept up to 128 strokes / 2048 points per drawing and 32 exchanges per session. Original strokes are copied on send and receive; replies never replace them. Failed queues keep the original and report the connection gap. A reply is sent once; failed delivery needs a new exchange. No durable storage, photo import, model service, microphone, registry changes, routes or deployment are included. Image capability is unavailable until separately validated.

Run `node scripts/msg1351-sketch-exchange-check.mjs` for synthetic routing, browser drawing, reply, off/on, keyboard, narrow layout and interruption checks. Set `SHOTS` to a directory to retain screenshots.
