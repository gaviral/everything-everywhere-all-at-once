import { WorkflowInspector } from "./WorkflowInspector";
import { createInspector } from "./runtime";

/** Host-owned registration/imports are deliberately separate from this descriptor. */
export const workflowInspectorFeature = {
  id: "workflow-inspector",
  defaultEnabled: false,
  control: { create: createInspector, setEnabled: (inspector: ReturnType<typeof createInspector>, enabled: boolean) => inspector.setEnabled(enabled) },
  Component: WorkflowInspector,
} as const;
export { WorkflowInspector, createInspector };
export { unavailableRuntime } from "./runtime";
export type * from "./contract";
