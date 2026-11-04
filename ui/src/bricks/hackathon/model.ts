import content from "./content.json";

export { content };
export const states = ["pending", "working", "ready"] as const;
export type ItemState = typeof states[number];
export const stateLabels: Record<ItemState, string> = { pending: "To prepare", working: "In progress", ready: "Ready" };
export type Deliverable = typeof content.deliverables[number];
export type Draft = typeof content.drafts[number];
export type SavedItem = { source: string; state: ItemState };
export type SavedDraft = { source: string; text: string; reviewed: boolean };

/** A new brief invalidates confirmations made against the old words. */
export function itemState(item: Deliverable, saved?: SavedItem): ItemState {
  if (saved?.source === JSON.stringify(item) && states.includes(saved.state)) return saved.state;
  return states.includes(item.state as ItemState) ? item.state as ItemState : "pending";
}

export function draftValue(draft: Draft, saved?: SavedDraft): SavedDraft {
  return saved?.source === draft.answer ? saved : { source: draft.answer, text: draft.answer, reviewed: false };
}

export function timeRemaining(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return {
    closed: seconds === 0,
    hours: String(Math.floor(seconds / 3600)).padStart(2, "0"),
    minutes: String(Math.floor(seconds / 60) % 60).padStart(2, "0"),
    seconds: String(seconds % 60).padStart(2, "0"),
  };
}
