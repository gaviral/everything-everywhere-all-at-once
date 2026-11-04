# Demo candidates

2026-11-04 14:35 BC

Branch: `intake1411-demo-parts`. Base/HEAD: `1af6ef1351f6225e20faf39983d9cdecfd157591`. Implementation is uncommitted; no implementation commit or dev integration receipt exists.

Switch: `intake1411-demo-parts`, default `false`. Both the descriptor and component default are off. An off view performs no catalog reads or subscriptions. Disabling unsubscribes and cancels proof deadlines, leaving selection in the supplied store.

## Host contract

Import `demoPartsFeature` and the `DemoPartsAdapter` type from `index.ts`. The host owns switch persistence, catalog/receipt production, target build/device identity, and selection storage. Supply stable, immutable snapshots and atomic selection updates; notify subscribers after updates. Reuse the selection adapter across navigation and disable/enable. A host that needs choices after application reload must provide durable storage. The synthetic adapter retains choices only for its mounted preview session, including feature disable/enable.

Catalog subscriptions must be read-only. The interface exposes no job, merge, recording, or capture actions. Candidate switches report the supplied switch state; selecting a candidate does not enable that candidate's feature. No sibling lane or existing host source is imported or edited.

Each candidate supplies duties, a switch, prerequisites and named steps. Each step displays one action and one expected result. Every proof requirement refers to a typed receipt and may link to its requirement. Receipts display source links, scope, dates, build and device. Evidence links use HTTPS without credentials; they are opened only by the reader, never fetched by this feature.

Live availability requires current live receipts for both reload and device, every additional prerequisite, an enabled candidate switch, named steps, a connected source and matching target identity. Synthetic, absent, expired, future-dated, conflicting, mismatched or disconnected proof cannot qualify. Proof expiry updates at its deadline without polling. Selection remains independent of readiness.

The catalog and separate inspect view keep long receipts readable on a narrow screen. Inline expansion would retain scroll position but lengthen every catalog card. Returning from inspection restores focus to its inspect control; removal of an open candidate returns to an available alternative and retains the saved choice. A descriptor returning later does not reopen itself.

The existing director retains final story and recording ownership. The existing variant owner retains branch/merge execution. This lane supplies review candidates only.

## Preview and focused verification

With the repository's existing UI dependencies installed, open `/src/intake1411/demo-parts/preview.html` on an isolated UI development server using an available port. The preview starts off and uses two synthetic candidates. Do not use a user browser session or enable media permissions for checks.

Run `node scripts/intake1411/demo-parts-check.mjs` from the app root. It builds an isolated preview with existing dependencies and serves it on a system-assigned loopback port. It starts one isolated headless Chrome through a protocol pipe, denies microphone/camera permissions, and closes only that owned browser. Temporary bundles, profiles, screenshots and its recorded PID are retained in the printed artifact directory. No host app, Rust service or job producer is started by the focused script.

Actual results:

- Baseline `sh tools/overnight/preflight.sh intake1411-demo-parts`: exit 0, all ten checks passed. This archives the branch's committed base; it does **not** verify the uncommitted implementation.
- TypeScript `tsc --noEmit --project ui/tsconfig.json`: exit 0 on the final implementation.
- Required `recheck.sh intake1411/demo-parts-check`: exit 1 after UI and core builds completed. REAL tooling limitation: the wrapper tries to write a nested log path without creating its parent directory. The check did not run through that wrapper. Shared tooling remains unchanged.
- Underlying check runner, `precheck.py --check scripts/intake1411/demo-parts-check.mjs`: exit 0 on the final candidate-recovery revision. Catalog, named steps, select/return/deselect, all alternatives retained, missing reload/device receipts, stale/disconnected/current proof, source removal/recovery, save failure, disable/restore and proof expiry passed.
- Real keyboard Tab/Enter/Space/Shift-Tab navigation and return focus passed. Layout assertions passed at 320 pixels and 200% text, with reachable touch-sized controls and no horizontal overflow. Desktop and narrow screenshots were rendered and inspected.
- The focused preview recorded zero capture requests, zero runtime network requests and zero uncaught browser errors. Positive readiness used injected synthetic test data labelled as live by the test; it is not real device or service evidence.

Earlier REAL harness failures were repaired: invalid Chrome permission descriptor names; missing Enter character input; and development hot-reload connections contaminating the no-network assertion. The final browser check uses a built preview and retains the original zero-network assertion.

## Owned files

Only these implementation and handoff paths belong to this lane:

```text
ui/src/intake1411/demo-parts/CandidateCatalog.tsx
ui/src/intake1411/demo-parts/CandidatePreview.tsx
ui/src/intake1411/demo-parts/DemoParts.tsx
ui/src/intake1411/demo-parts/DemoSelection.tsx
ui/src/intake1411/demo-parts/DemoStep.tsx
ui/src/intake1411/demo-parts/ReadinessReceipt.tsx
ui/src/intake1411/demo-parts/SyntheticPreview.tsx
ui/src/intake1411/demo-parts/contracts.ts
ui/src/intake1411/demo-parts/demo-parts.css
ui/src/intake1411/demo-parts/index.ts
ui/src/intake1411/demo-parts/preview-entry.tsx
ui/src/intake1411/demo-parts/preview.html
ui/src/intake1411/demo-parts/readiness.ts
ui/src/intake1411/demo-parts/synthetic.ts
ui/src/intake1411/demo-parts/useCandidateVisit.ts
ui/src/intake1411/demo-parts/useReceiptClock.ts
ui/src/intake1411/demo-parts/HANDOFF.md
scripts/intake1411/demo-parts-check.mjs
```

## Evidence and remaining work

Main evidence was read using the single-path evidence reader. Pinned snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`; existing UI manifest and TypeScript settings were read successfully. `ui/src/intake1411/demo-parts/index.ts` was MISSING from that snapshot, as expected for this new allocation. Base commit was independently resolved, verified as a commit and checked with the ancestry predicate using `check=False`: exit 0. The tree was not used as a commit.

MISSING: actual cross-lane adapters and host switch/import wiring; genuine live reload/device receipts; human or hardware demonstration; final director story selection; implementation commit; implementation preflight; dev receipt; serialized full gate. No commit was authorized, so no commit, `todev.sh`, push, publication or deployment was performed. Host integration and the full gate remain with their serialized owner.
