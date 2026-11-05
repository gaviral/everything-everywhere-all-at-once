import type { AppPart } from "../../app-parts";

export type Data = Record<string, string>;
export type StepStatus = "pending" | "running" | "result" | "error" | "stopped";
export interface StepDefinition {
  id: string;
  partId: AppPart["id"];
  title: string;
  inputs: string[];
  outputs: string[];
}
export interface WorkflowDefinition {
  id: string;
  title: string;
  trigger: { event: string; condition: string };
  steps: readonly [StepDefinition, StepDefinition];
  handoff: { partId: string; from: string; to: string; field: string; reason: string };
}
export interface StepRecord {
  id: string;
  status: StepStatus;
  input: Data;
  output: Data;
  error?: string;
}
export interface WorkflowSnapshot {
  phase: "pending" | "running" | "review" | "result" | "error" | "stopped";
  trigger: string;
  steps: readonly StepRecord[];
  handoff: { status: "pending" | "review" | "approved" | "stopped"; approved: Data | null };
}
export type WorkflowCommand = { type: "run" } | { type: "stop" } | { type: "review"; value: string };

/** The host supplies a permission-checked, workflow-scoped adapter. A resolved request
 * acknowledges delivery only; read()/subscribe() remain the sole execution truth.
 * Stop must report its confirmed state; it must not optimistically claim cancellation.
 * Review must bind to the current run and reject stale or duplicate approvals. */
export interface WorkflowAdapter {
  readonly source: "local-example" | "permitted-runtime";
  read(): WorkflowSnapshot;
  subscribe(listener: () => void): () => void;
  request(command: WorkflowCommand): Promise<void>;
}

export function pendingSnapshot(definition: WorkflowDefinition): WorkflowSnapshot {
  return {
    phase: "pending", trigger: "No trigger received",
    steps: definition.steps.map(step => ({ id: step.id, status: "pending", input: {}, output: {} })),
    handoff: { status: "pending", approved: null },
  };
}
