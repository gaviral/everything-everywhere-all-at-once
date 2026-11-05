# Machine demo availability

2026-11-04 14:49 BC

## Host contract

`index.tsx` exports `machineDemoFeature`, `MachineDemo`, `createMachineSession` and the injected contract types.
The switch is `intake1417-machine-demo`, default **off**. The shared host owner wires it; this preview does not establish integrated availability.

Keep one session per host visit. Supply catalog-owned `DemoPart` identifiers and prerequisite descriptors, a synchronous read-only `MachineAdapter`, and optionally the host's existing selected part ID. The feature inspects choices; the demo owner decides what to run.

```tsx
const session = createMachineSession(parts, adapter, selectedPartId);
// The host's persisted switch controls session.setEnabled(enabled).
// A fresh profile must leave the session disabled.
return <MachineDemo session={session}>{hostView}</MachineDemo>;
```

The adapter provides `read()`, optional `subscribe(changed)` returning its own cleanup, and `now()` as a UTC ISO timestamp. Each fact has a value, source, UTC evidence date and kind. Machine observations must use `host` or `synthetic`; general platform research cannot prove a particular machine's state. Unsupported, missing, invalid or future-dated evidence is unknown. `user-agent` evidence is rejected. Evidence age remains visible; the platform owner must decide any freshness policy.

Supported fact values: host `local/hosted`; OS `macos/linux/windows/other`; installation `ready/missing`; Reminders `installed/missing`; Automation permission `granted/denied`. `ready` means the supplier verified the installation needed by the supplied part, rather than inferring readiness from its browser. Setup instructions need their own valid dated evidence. Missing instructions remain explicitly unverified.

An unmet requirement makes a part unavailable; otherwise missing evidence makes it unknown. A portable fixture with no native prerequisites remains available. This is prerequisite matching, not an execution guarantee. Never pass a native part without all of its actual prerequisites from the catalog/platform owner.

Construction and the disabled state perform no adapter reads or subscriptions. Enable reads and subscribes once; disable releases only that subscription. Old callbacks are ignored. Refresh retains the selected ID even when it becomes unavailable. The host child remains mounted but hidden while the feature is on, preserving its local choices when restored. The host must continue to control any pre-existing host effects. Dispose the session when the host visit ends.

## Parts and decisions

- `MachineInput` validates facts and evidence dates.
- `CapabilityMatch` matches each prerequisite and combines the results.
- `RequirementGuide` renders reasons, dated evidence and verified setup steps.
- `DemoAvailability` retains all choices and shows the selected part's details.
- `MachineRefresh` owns the enabled lifecycle and selected part.
- `PartInput` takes an immutable copy of the injected catalog.

All choices remain selectable for inspection, including unavailable choices. This keeps the reason one selection away. A filtered list would conceal alternatives and risk losing the selected part on refresh. Status words, pressed states, standard controls and visible focus communicate state without relying on color. There is no launch or permission button.

## Evidence boundary

The snapshot's connector implementation requires a local macOS host and handles the Automation denial with System Settings → Privacy & Security → Automation guidance. The fixture's permission-guide date is that snapshot commit's timestamp, `2026-11-04T18:59:53Z`. This is repository guidance, not a fresh OS certification. The README records local setup prerequisites and untested non-Mac routes; this feature does not turn those into current machine guarantees.

D116 has not supplied verified minimum OS versions, hardware recommendations or this machine's native installation/permission observations. Those remain evidence gaps. No native probes, containers, device automation, sends or microphone actions were used. Runtime code has no model dependency.

## Verification

The scoped preview is `preview.html` in this directory. Run `node scripts/machine-demo-check.mjs`; an optional `MACHINE_DEMO_MODULES` environment variable points to an existing UI dependency directory. The check uses a random local port, a new isolated headless browser and synthetic profiles. It retains its temporary artifacts and reports the browser PID and shutdown.

First focused run: scoped TypeScript and supplied-fact tests passed; the visible check found a REAL 320px enlarged-text overflow. Preview control sizing was corrected without weakening the assertion. The next focused run passed all checks, and desktop/narrow screenshots were inspected. Review then found that parent-only font enlargement missed the feature's rem text; the check now enlarges the document root.

Full gate and integrated app verification belong to the shared integration owner. No main promotion, deploy, publication or submission occurred.
