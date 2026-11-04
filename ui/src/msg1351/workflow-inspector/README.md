# Workflow inspector

This isolated feature is off by default. It shows a trigger, two named steps,
their inputs/output, and an explicit review and gap-fill handoff between them.
The local example uses invented garden data and deterministic string operations.
It does not execute the referenced canonical parts or call a model.

For a preview, run `node ui/src/msg1351/workflow-inspector/preview-server.mjs`
from the repository root, then open `http://127.0.0.1:4478` at
`/src/msg1351/workflow-inspector/preview.html`. Enable the inspector, choose
Run example, fill Audience, approve, and expand the input/output disclosures.
Choose Unconnected runtime and enable again to inspect a real rejected adapter
request. No server-side workflow is started by that request.

Run `node scripts/msg1351-workflow-inspector-check.mjs` from the repository
root for focused contract and Chrome acceptance. `SHOTS` optionally names a
screenshot directory. The check uses loopback ephemeral ports and an isolated
headless browser. It never opens the microphone or connects to the core.

## Host seam

`workflowInspectorFeature` exports the namespaced descriptor, component and
explicit on/off control. The host creates one inspector for each adapter and
workflow visit, passes `definition`, `inspector`, and `adapter.source` into the
component, and calls `dispose()` when the visit ends. CSS is scoped and imported
only by this feature's component. Registration and host imports are separate.

`WorkflowAdapter` is a provisional lane-local contract because the existing app
protocol provides app composition and enablement commands but no general
workflow run/stop/review API. The host must supply a permission-checked adapter
bound to one workflow. Requests should promptly acknowledge delivery; snapshots
and subscriptions carry execution state, including later failures. A successful
request never implies a successful step. The host must correlate approvals to
the current run and enforce permission, validation and duplicate rejection.
There is no automatic retry. An adapter refusal is distinct from a step error.

Turning inspection off unsubscribes and prevents further requests. It does not
cancel existing work. Turning it back on reads the adapter's current snapshot.
Stop is an explicit request; cancellation appears only after the adapter
confirms it. Inputs/output remain behind native keyboard-accessible disclosures.

Canonical references in the example are `input:thoughts` and `publisher:card`
from `app-parts.ts`. The gap-fill part is local to this namespace. These IDs are
references, not evidence that those parts ran. The host owns resolving actual
definitions, registration, shared schema and runtime wiring. This preview is
neither integrated runtime proof nor evidence of model execution.
