# Shared session devices

Default-off, synthetic session/device part. No app routes, catalog entries, room registration, speech files, manifests or shared styles are changed. No audio, device enumeration or permissions API is invoked.

## Opt-in proof and preview

From the repository root, with the existing UI dependencies, Rust and Chrome available:

```sh
node scripts/intake1422/session-devices-check.mjs --enable-session-devices
node scripts/intake1422/session-devices-check.mjs --enable-session-devices --preview
```

The first command runs state checks, standalone Rust tests and three rendered synthetic client views. It retains a phone-width screenshot and its isolated Chrome profile in a temporary proof directory printed by the command. It closes its own Chrome process. No artifacts are deleted. The second command serves a standalone, in-memory preview on an OS-assigned loopback port and prints its PID and explicit opt-in URL. Stop that PID to close it. Opening the URL without its feature query leaves the feature off. Invoking the check without its feature flag exits with an OFF notice.

The visible scenario connects Phone, Tablet and Desktop through injected presence events, shows count 3, isolates a second session, disconnects Desktop to show count 2, reconnects and deduplicates ordered document changes. Remote input choice stays requested until simulated confirmation on the target panel, then waits separately for a synthetic lease grant. Competing confirmed requests produce one listener; denial, stop, lease expiry, presence expiry, disconnect and switching off cannot restart it. A controller changing targets invalidates its previous ungranted confirmation.

## Parts and host contract

- `DeviceIdentity` uses injected profile storage and opaque random IDs with explicit labels. The fixture uses synthetic IDs only.
- `SessionRoster` accepts host-issued, per-endpoint/session increasing revisions and authoritative expiry times. It derives counts from connected, unexpired rows; stale and disconnected rows stay visible. A reconnect must have a newer revision than its preceding disconnect.
- `SessionSync` applies a contiguous, exact-session log. Versions and IDs deduplicate replay; gaps wait for missing events; conflicting duplicates are rejected. A schema-1 snapshot stores both applied events and its cursor. Pending gaps replay from the last applied cursor.
- `TransportSubscription` owns only subscribe/unsubscribe and cursor resume. The host translates its existing local/room or hosted events through `TransportAdapter`. No endpoint registration or cross-lane imports are owned here.
- `ListenerAuthority` is the atomic grant/release boundary. `SyntheticListenerAuthority` is only an in-memory fixture. The fixture-compilable Rust module in `core/src/intake1422_session_devices/` serializes competing claims under one mutex and fences stale claims and stops. One shared host instance is required; browser replicas cannot provide global authority.
- `InputDeviceRequest` separates requested, locally confirmed, active, denied and stopped states. Each controller's new selection supersedes its earlier ungranted request. Another controller may make an independent claim. Confirmation is bound to the target endpoint, request ID, request deadline and observed lease fence. A busy or changed authority rejects the claim. Stopped and denied requests require a new request, never an automatic retry.
- `DevicePanel` composes named session-choice, roster, document, listener and request-action views. The caller owns the selected session and its visit lifetime. A return to a session reads that session's retained state. Simulated confirmation controls appear only when the caller explicitly supplies `synthetic`.

`sessionDevicesFeature` in `index.ts` exports the switch ID `intake1422-session-devices`, `defaultEnabled: false`, prerequisites and a factory. The factory starts disabled. `SessionDevices` accepts the transport, authority, synthetic capture-status sink and monotonic clock. Enable with `setEnabled(true)`; disable with `setEnabled(false)`. Disabled runtimes unsubscribe, stop pending/confirmed/active requests, release their leases and emit stopped status while retaining roster and document data in memory. Re-enabling resumes versioned cursors and grants no listener automatically. The host owns durable storage beyond this runtime's lifetime.

Before mounting a host view, select/create its session with `runtime.sync(sessionId)`. Request input with `runtime.request(sessionId, targetEndpointId, controllerEndpointId)`. The trusted target's local handler alone may call `confirm(requestId, localEndpointId, allowed)`; neither a document event nor remote selection calls it. `activate(requestId)` then asks the injected authority for a grant. The preview's callbacks record synthetic status only.

The host must tick the runtime on its expiry scheduler while enabled, including while panels are unmounted. Actual capture policy must independently honor authority expiry and fences. Browser status callbacks do not start or authorize physical capture. The authority adapter must use one authoritative monotonic clock and authenticated connection/confirmation evidence; its synchronous fixture interface is not a network RPC implementation. An asynchronous hosted route needs a host-owned bridge for authoritative results. The Rust module similarly relies on trusted handlers for connection state and local endpoint identity. The host owns module/route registration, its room protocol mapping, durable authority epoch across server restarts, transport loss handling and D38 capture/release policy.

## Acceptance limits

MISSING: integrated host/catalog wiring, real network/physical devices, physical local listener confirmation, and selected-build/film acceptance. The fixture and standalone preview prove none of those. No microphone is started.

This checkout lacks `tools/overnight/preflight.sh` and `tools/overnight/recheck.sh`; both attempts exited 127 (REAL setup gap: missing scripts). The full integration gate and dev landing remain with the hub. No push, deployment or todev step is performed in this lane.

## Verified handoff

2026-11-04 15:35 BC

- `./ui/node_modules/.bin/tsc --noEmit -p ui`: exit 0.
- Opt-in focused check above: exit 0; state checks, 3 standalone Rust tests, and three rendered browser views passed. The browser also races two locally confirmed grants, verifies exactly one active request, then stops it. Zero microphone API calls; no browser errors.
- Without opt-in: exit 0, OFF notice, no feature started.
- Opt-in standalone preview: HTTP 200; its recorded PID stopped with SIGTERM and confirmed absent. Focused-check Chrome processes also confirmed absent.
- `git diff --cached --check`: exit 0 before commit.
- Overnight preflight/recheck: exit 127, missing scripts (REAL setup gap). Full gate not run; dev receipt MISSING, hub landing pending. This supplied branch has no local `dev` ref for an independent ancestry comparison.

Only the lane's exclusive UI namespace, core namespace and focused check are included. The requested branch commit is the handoff artifact; no push, dev mutation or public deployment.
