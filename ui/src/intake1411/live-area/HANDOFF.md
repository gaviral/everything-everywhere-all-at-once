# Live development area

Updated 2026-11-04 14:31 BC

Branch: `intake1411-live-area`. Base revision: `1af6ef1351f6225e20faf39983d9cdecfd157591`. Changes are uncommitted; no integration or dev receipt exists.

Switch: `intake1411-live-area`, `defaultEnabled: false`. `index.ts` exports the feature descriptor, component and typed source contracts. Host wiring is pending. The host supplies a controlled `enabled` value, `onEnabledChange`, stable `adapters`, and optional `selected` run/branch/build identity. There are no sibling lane imports, producers, network adapters or runtime model dependencies.

## Parts and behavior

`ActivitySource` observes the external feed owner's permitted redacted events through `StatusSource<ActivityEvent>`. `BuildStatusSlot` and `VersionStatusSlot` receive exact matching records. `StatusJoin` joins immutable run/branch/build identities, keeping agents separate. `SelectedStatus` also presents build/version status before matching activity arrives. `LiveArea` composes the view, source summary and off control.

Each injected source must announce its connection state and return an unsubscribe function that releases its resources. Sequence numbers increase per record over reconnects, including replay; new runs use new run IDs. Lower/equal sequence numbers and regressing timestamps cannot replace accepted records. Connection epochs keep retained identities stale until newer matching records arrive. Records older than 30 seconds display as stale; an idle source also becomes stale. Missing adapters or matching references display unavailable. Source text and identifiers must already be redacted for display; worktree references are labels, never local paths.

Turning off releases the three observers and freshness timer. Late callbacks cannot update the consumer. Accepted records remain in memory while the component stays mounted; each source ledger is bounded to 200 records. No user data or producer files are written or erased. Replacing the adapter object creates a new consumer, so hosts should keep adapters stable.

## Focused verification

- `sh tools/overnight/preflight.sh intake1411-live-area`: exit 0, all ten checks passed on the committed base. This archives the branch revision and therefore does not cover the uncommitted lane files.
- `ui/node_modules/.bin/tsc --noEmit` from `ui`: exit 0 including the new lane.
- `node scripts/intake1411/live-area-check.mjs`: exit 0. Synthetic two-agent/two-branch routing, exact build identity, selected status before activity, missing reload/version data, disconnect/reconnect, stale and older-event rejection, keyboard switching, 320px width, doubled app text, zero subscriptions after off, retained records after reenable, late-callback rejection, and source errors passed.
- Actual desktop, reconnect-stale, narrow and enlarged-text screenshots were inspected. The preview heading wraps at enlarged text. The enlarged-text assertion checks the app's computed text size and the actual 320px document width.
- The check starts an isolated Vite server on port 4417 and its own headless Chrome, closes both, and retains temporary artifacts. It prints its artifact directory and recorded Chrome PID. No microphone or external feed is used.
- No automated check failures remained; no failed-check recheck was required. No full gate was run; the host owner serializes that gate.

The preview entry is `ui/src/intake1411/live-area/preview.html` through the app's Vite server. It starts off and marks all events synthetic. It is intentionally independent of the host shell.

## Evidence gaps

Verified committed-main snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`. Base revision was verified as a commit and its ancestry check against main returned exit 0. Snapshot discovery found the existing worklog check and no external job-feed presentation adapter. The separate read for `ui/src/asks-live-job-feed/index.tsx` returned MISSING. The existing job-store evidence is not a substitute for the permitted external stream.

MISSING: permitted redacted external event stream and separate actual-feed/reconnect receipt; canonical reload-session/worktree-map adapter compatibility; host catalog/shell wiring; committed lane revision and preflight covering it; full host gate; dev receipt. This delivery is synthetic implementation proof only. No commit, push, publication, deployment or `todev.sh` action was performed.

## Exact owned files

- `scripts/intake1411/live-area-check.mjs`
- `ui/src/intake1411/live-area/ActivityRow.tsx`
- `ui/src/intake1411/live-area/ActivitySource.ts`
- `ui/src/intake1411/live-area/BuildStatusSlot.tsx`
- `ui/src/intake1411/live-area/FreshnessLabel.tsx`
- `ui/src/intake1411/live-area/HANDOFF.md`
- `ui/src/intake1411/live-area/LiveArea.tsx`
- `ui/src/intake1411/live-area/LiveAreaStore.ts`
- `ui/src/intake1411/live-area/SelectedStatus.tsx`
- `ui/src/intake1411/live-area/SourceSubscription.ts`
- `ui/src/intake1411/live-area/StatusJoin.ts`
- `ui/src/intake1411/live-area/SyntheticSource.ts`
- `ui/src/intake1411/live-area/VersionStatusSlot.tsx`
- `ui/src/intake1411/live-area/contracts.ts`
- `ui/src/intake1411/live-area/index.ts`
- `ui/src/intake1411/live-area/live-area.css`
- `ui/src/intake1411/live-area/preview.css`
- `ui/src/intake1411/live-area/preview.html`
- `ui/src/intake1411/live-area/preview.tsx`
