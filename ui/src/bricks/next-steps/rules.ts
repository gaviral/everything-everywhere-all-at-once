import type { Action } from "../contract";

export const GROUPS = ["Overdue", "Today", "Later", "No date", "Handled"] as const;
export type Group = typeof GROUPS[number];

/** Calendar validation, without interpreting a proposed day as a UTC instant. */
export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function localDay(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function untilMidnight(now: Date): number {
  const midnight = new Date(now.getTime());
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
}

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function agenda(actions: readonly Action[], today: string, showDismissed: boolean): Record<Group, Action[]> {
  const groups: Record<Group, Action[]> = { Overdue: [], Today: [], Later: [], "No date": [], Handled: [] };
  for (const action of actions) {
    if (action.status === "dismissed" && !showDismissed) continue;
    const group: Group = action.status === "done" || action.status === "dismissed" ? "Handled"
      : !validDay(action.when) ? "No date"
      : action.when < today ? "Overdue" : action.when === today ? "Today" : "Later";
    groups[group].push(action);
  }
  for (const group of GROUPS) groups[group].sort((a, b) =>
    (group === "No date" || group === "Handled" ? 0 : order(a.when, b.when)) || order(a.id, b.id));
  return groups;
}

export function statusLabel(action: Action): string {
  return action.status === "new" ? "Proposed" : action.status === "kept" ? "Kept on this map"
    : action.status === "done" ? "Handled by E2A2O" : "Dismissed";
}
