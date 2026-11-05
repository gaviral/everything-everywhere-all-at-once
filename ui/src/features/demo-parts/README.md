# Demo candidates

2026-11-04 14:35 BC

Switch: `intake1411-demo-parts`, default `false`. Both the descriptor and component default are off. An off view performs no catalog reads or subscriptions. Disabling unsubscribes and cancels proof deadlines, leaving selection in the supplied store.

## Host contract

Import `demoPartsFeature` and the `DemoPartsAdapter` type from `index.ts`. The host owns switch persistence, catalog/receipt production, target build/device identity, and selection storage. Supply stable, immutable snapshots and atomic selection updates; notify subscribers after updates. Reuse the selection adapter across navigation and disable/enable. A host that needs choices after application reload must provide durable storage. The synthetic adapter retains choices only for its mounted preview session, including feature disable/enable.

Catalog subscriptions must be read-only. The interface exposes no job, merge, recording, or capture actions. Candidate switches report the supplied switch state; selecting a candidate does not enable that candidate's feature. No other feature or existing host source is imported or edited.

Each candidate supplies duties, a switch, prerequisites and named steps. Each step displays one action and one expected result. Every proof requirement refers to a typed receipt and may link to its requirement. Receipts display source links, scope, dates, build and device. Evidence links use HTTPS without credentials; they are opened only by the reader, never fetched by this feature.

Live availability requires current live receipts for both reload and device, every additional prerequisite, an enabled candidate switch, named steps, a connected source and matching target identity. Synthetic, absent, expired, future-dated, conflicting, mismatched or disconnected proof cannot qualify. Proof expiry updates at its deadline without polling. Selection remains independent of readiness.

The catalog and separate inspect view keep long receipts readable on a narrow screen. Inline expansion would retain scroll position but lengthen every catalog card. Returning from inspection restores focus to its inspect control; removal of an open candidate returns to an available alternative and retains the saved choice. A descriptor returning later does not reopen itself.

The existing director retains final story and recording ownership. The existing variant owner retains branch/merge execution. This feature supplies review candidates only.

## Preview and focused verification

With the repository's existing UI dependencies installed, open `/src/features/demo-parts/preview.html` on an isolated UI development server using an available port. The preview starts off and uses two synthetic candidates. Do not use a user browser session or enable media permissions for checks.

Run `node scripts/feature-checks/demo-parts-check.mjs` from the app root. It builds an isolated preview with existing dependencies and serves it on a system-assigned loopback port. It starts one isolated headless Chrome through a protocol pipe, denies microphone/camera permissions, and closes only that owned browser. Temporary bundles, profiles, screenshots and its recorded PID are retained in the printed artifact directory. No host app, Rust service or job producer is started by the focused script.

Actual results:

Earlier REAL harness failures were repaired: invalid Chrome permission descriptor names; missing Enter character input; and development hot-reload connections contaminating the no-network assertion. The final browser check uses a built preview and retains the original zero-network assertion.
