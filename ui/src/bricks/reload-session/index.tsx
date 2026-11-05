import { useEffect, useState, useSyncExternalStore } from "react";
import { createReloadSession, describeReloadState, type DraftValue, type ViewValue, type ReloadEvent } from "../../features/reload-session";
function createWorkspace() {
  const identity = { mapId: "example-garden", sessionId: "wire-recovery", buildId: "example-build" };
  let state = { draft: { text: "Plan a small garden", selectionStart: 0, selectionEnd: 0, selectionDirection: "none" } as DraftValue, view: { viewId: "Garden plan", camera: { x: 0, y: 0, zoom: 1 } } as ViewValue };
  const listeners = new Set<() => void>(), changes = new Set<() => void>(), events = new Set<(event: ReloadEvent<string>) => void>();
  const update = (next: typeof state) => { state = next; listeners.forEach(listener => listener()); };
  const recovery = createReloadSession({ identity, storage: { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) },
    host: { readDraft: () => state.draft, readView: () => state.view, restoreDraft: draft => update({ ...state, draft }), restoreView: view => update({ ...state, view }), applySnapshot: () => {}, subscribeChanges: listener => { changes.add(listener); return () => { changes.delete(listener); }; } },
    source: { subscribe: listener => { events.add(listener); listener({ type: "snapshot", identity, revision: "example-1", payload: "Garden plan" }); return () => { events.delete(listener); }; } } });
  return { recovery, read: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(draft: DraftValue) { update({ ...state, draft }); changes.forEach(listener => listener()); },
    pan() { update({ ...state, view: { ...state.view, camera: { ...state.view.camera, x: state.view.camera.x + 40 } } }); changes.forEach(listener => listener()); },
    signal(kind: "start" | "finish") { const event: ReloadEvent<string> = kind === "start" ? { type: "build-start", identity } : { type: "snapshot", identity, revision: "example-2", payload: "Garden plan" }; events.forEach(listener => listener(event)); } };
}
import type { BrickProps } from "../contract";
import "./example.css";
export default function Example({ actions }: BrickProps) {
const [workspace] = useState(createWorkspace);
const snapshot = useSyncExternalStore(workspace.subscribe, workspace.read, workspace.read);
const [recovery, setRecovery] = useState(() => workspace.recovery.state.get());
useEffect(() => workspace.recovery.state.subscribe(setRecovery), [workspace]);
useEffect(() => { workspace.recovery.setEnabled(true); return () => workspace.recovery.setEnabled(false); }, [workspace]);
const [open, setOpen] = useState(true);
return <>{!open && <button className="reload-session-reopen" type="button" onClick={() => setOpen(true)}>Open Reload recovery</button>}
<section hidden={!open} className="reload-session-example" aria-label="Reload recovery example" data-guide="reload-session">
<div><strong>Reload recovery · local example</strong><span><button type="button" onClick={() => actions.openCatalog("reload-session")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<p>Edit this local draft, move its place, then simulate a rebuild. Reloading this page restores the example checkpoint while this feature is enabled.</p>
<label>Example draft<textarea value={snapshot.draft.text} onChange={event => { const field = event.currentTarget; workspace.edit({ text: field.value, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd, selectionDirection: field.selectionDirection }); }} onSelect={event => { const field = event.currentTarget; workspace.edit({ ...snapshot.draft, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd, selectionDirection: field.selectionDirection }); }} /></label>
<p>Garden place: {snapshot.view.camera.x}</p><div><button onClick={workspace.pan}>Move garden right</button> <button onClick={() => workspace.signal("start")}>Simulate rebuild</button> <button onClick={() => workspace.signal("finish")}>Deliver rebuilt view</button></div><p role="status">{describeReloadState(recovery)} · Checkpoint: {recovery.checkpoint}</p>
</section></>;
}
