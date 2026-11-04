import type { ConnectionPlan } from "../contract";

export function canConfirm(plan: ConnectionPlan, step: number): boolean {
  return plan.steps[step]?.state === "proposed" && plan.steps.slice(0, step).every(s => s.state === "done");
}
