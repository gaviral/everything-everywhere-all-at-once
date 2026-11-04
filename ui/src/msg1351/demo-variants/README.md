# Demo choices

`demoVariantsFeature` is namespaced `demo-variants` with `defaultEnabled: false`.
Import `DemoVariants` and `createVariantSession` from `index.tsx`. Create one session
per owner context, outside the mounted view, and retain it across visits. Comparison
choices and merge feedback also survive view unmounts through this session. Supply
original IDs and structured feature lists from the canvas owner. References are
copied and frozen; input objects and original branches are never mutated.

The host calls `setEnabled(boolean)` or uses the visible checkbox, subscribes to
the session, and applies only `getSnapshot().activeId` (null when off). Selecting a
choice replaces the previous choice; disabling it clears selection. Turning the
feature off retains selection but clears the effective active ID. Selection is
in memory only. No host feature set changes until the host consumes this contract.

The comparison shows supplied feature descriptions, including shared, changed,
and exclusive features. It does not compare source trees. D52/D91 reference,
source-compare and owner-merge adapters are MISSING from the inspected main
snapshot. No existing host file is imported or modified by this lane.

An optional `MergeAdapter.request` receives an immutable request with a unique ID
and original reference. It resolves only with the owner's terminal result and a
correlated request ID, nonempty receipt and detail. Pending remains pending until
resolution; switching or leaving the view cannot relabel the request. Failure or
an invalid result is unconfirmed and blocks repeat requests for that session;
the owner must reconcile it before creating a new session. Adapter output is
trusted owner data and must be safe for display. No adapter means merge disabled.
The lane executes no git commands, model calls, microphone actions or agents at
runtime. A merged result is a report from the adapter, not independent verification.

Run `node scripts/msg1351-demo-variants-check.mjs` for the scoped browser check.
It uses installed UI dependencies and a dedicated headless browser, with no core.
For manual preview, run Vite from `ui` on an available port, then visit
`/src/msg1351/demo-variants/preview.html`. It starts off. Enable, choose Gallery,
compare with Timeline, disable/re-enable, and request a merge. The sample owner
buttons explicitly resolve or reject that request. `?missing` omits the adapter.
This preview does not execute a real merge. Chief owns host admission and wiring.
