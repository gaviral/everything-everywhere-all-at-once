import { useSyncExternalStore, type ReactNode } from "react";
import type { MachineSession } from "./MachineRefresh";
import { DemoAvailability } from "./DemoAvailability";
import "./machine-demo.css";

export const machineDemoFeature = Object.freeze({ id: "intake1417-machine-demo", label: "Machine demo availability", defaultEnabled: false });
/** Keep children mounted: disabling restores the host's existing state and focusable controls. */
export function MachineDemo({ session, children }: { session: MachineSession; children: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return <><div hidden={state.enabled}>{children}</div>{state.enabled && <DemoAvailability state={state} session={session} />}</>;
}
export { createMachineSession } from "./MachineRefresh";
export { MachineInput } from "./MachineInput";
export { CapabilityMatch } from "./CapabilityMatch";
export type { MachineSession } from "./MachineRefresh";
export type * from "./contracts";
