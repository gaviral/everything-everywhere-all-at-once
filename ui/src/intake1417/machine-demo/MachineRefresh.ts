import type { DemoPart, MachineAdapter, MachineState } from "./contracts";
import { MachineInput } from "./MachineInput";
import { CapabilityMatch } from "./CapabilityMatch";
import { PartInput } from "./PartInput";

/** Retain one session per host visit. Disabled means no adapter reads or subscriptions. */
export function createMachineSession(input: readonly DemoPart[], adapter: MachineAdapter, initialSelectedId?: string) {
  const parts = PartInput(input);
  if (initialSelectedId && !parts.some(part => part.id === initialSelectedId)) throw new Error("Unknown initial demo part.");
  let state: MachineState = Object.freeze({ enabled: false, selectedId: initialSelectedId ?? parts[0]?.id ?? null,
    profile: MachineInput(null, ""), matches: Object.freeze([]) });
  let disconnect: (() => void) | undefined;
  let generation = 0;
  let evidenceNow = "";
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MachineState>) => {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach(listener => listener());
  };
  const refresh = () => {
    if (!state.enabled) return;
    let supplied: unknown;
    try { evidenceNow = adapter.now(); supplied = adapter.read(); } catch { supplied = null; evidenceNow = ""; }
    const profile = MachineInput(supplied, evidenceNow);
    publish({ profile, matches: Object.freeze(parts.map(part => CapabilityMatch(part, profile))) });
  };
  function setEnabled(enabled: boolean) {
    if (enabled === state.enabled) return;
    const ownGeneration = ++generation;
    if (!enabled) {
      publish({ enabled: false });
      const owned = disconnect; disconnect = undefined;
      owned?.();
      return;
    }
    publish({ enabled: true });
    refresh();
    try {
      disconnect = adapter.subscribe?.(() => {
        if (state.enabled && generation === ownGeneration) refresh();
      });
      // Read after subscribing too: an update between the first read and subscription is not lost.
      refresh();
    } catch {
      publish({ profile: MachineInput(null, ""), matches: Object.freeze(parts.map(part => CapabilityMatch(part, MachineInput(null, "")))) });
    }
  }
  return Object.freeze({ parts, getSnapshot: () => state, getEvidenceNow: () => evidenceNow,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled, refresh,
    select(id: string) {
      if (!state.enabled) return;
      if (!parts.some(part => part.id === id)) throw new Error("Unknown demo part.");
      publish({ selectedId: id });
    },
    dispose() { setEnabled(false); listeners.clear(); },
  });
}
export type MachineSession = ReturnType<typeof createMachineSession>;
