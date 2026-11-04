import type { Action, ActionEstimate } from "../contract";

export function durationError(minutes: string, reason: string): string | null {
  if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440) return "Enter 1–1440 whole minutes.";
  if ([...reason].length > 160) return "Keep the reason to 160 characters.";
  return null;
}

export function sourceMatches(estimate: Readonly<ActionEstimate>, action: Readonly<Action>): boolean {
  return estimate.action_id === action.id && estimate.source_title === action.title && estimate.source_thread_id === action.thread_id;
}

export function selectedEffort(actions: readonly Action[], estimates: readonly Readonly<ActionEstimate>[], owner: string, selected: ReadonlySet<string>) {
  const included = actions.flatMap(action => {
    const estimate = estimates.find(e => e.owner === owner && sourceMatches(e, action));
    return selected.has(action.id) && estimate?.minutes != null ? [estimate.minutes] : [];
  });
  return { count: included.length, minutes: included.reduce((sum, minutes) => sum + minutes, 0) };
}

export function actionState(status: Action["status"]): string {
  return status === "new" ? "Proposed" : status === "kept" ? "Kept" : "Handled";
}
