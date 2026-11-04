import { pendingSnapshot, type WorkflowAdapter, type WorkflowCommand, type WorkflowDefinition, type WorkflowSnapshot } from "./contract";

/** Existing app commands have no general workflow run/stop/review seam. Fail closed. */
export function unavailableRuntime(definition: WorkflowDefinition): WorkflowAdapter {
  const snapshot = pendingSnapshot(definition);
  return {
    source: "permitted-runtime",
    read: () => snapshot,
    subscribe: () => () => {},
    request: async () => { throw new Error("No permitted workflow adapter is connected. No run was started."); },
  };
}

export interface InspectorState {
  enabled: boolean;
  busy: boolean;
  requestError: string;
  snapshot: WorkflowSnapshot;
}

function permitted(snapshot: WorkflowSnapshot, command: WorkflowCommand): boolean {
  if (command.type === "run") return ["pending", "result", "error", "stopped"].includes(snapshot.phase);
  if (command.type === "stop") return ["running", "review"].includes(snapshot.phase);
  return snapshot.phase === "review" && !!command.value.trim();
}

/** Owns inspection and request delivery, never invents execution state. */
export function createInspector(adapter: WorkflowAdapter) {
  let state: InspectorState = { enabled: false, busy: false, requestError: "", snapshot: adapter.read() };
  const listeners = new Set<() => void>();
  let disconnect: (() => void) | undefined;
  const publish = (patch: Partial<InspectorState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const receive = () => publish({ snapshot: adapter.read() });
  return {
    read: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(enabled: boolean) {
      if (state.enabled === enabled) return;
      disconnect?.(); disconnect = undefined;
      publish({ enabled, requestError: "", snapshot: adapter.read() });
      if (enabled) { disconnect = adapter.subscribe(receive); receive(); }
    },
    async request(command: WorkflowCommand) {
      if (!state.enabled || state.busy || !permitted(state.snapshot, command)) return;
      publish({ busy: true, requestError: "" });
      try { await adapter.request(command); }
      catch (error) { publish({ requestError: error instanceof Error ? error.message : "The adapter request failed." }); }
      finally { publish({ busy: false, snapshot: adapter.read() }); }
    },
    dispose() { disconnect?.(); disconnect = undefined; listeners.clear(); },
  };
}
export type Inspector = ReturnType<typeof createInspector>;
