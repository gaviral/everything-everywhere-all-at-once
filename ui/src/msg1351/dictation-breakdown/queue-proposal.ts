import type { Item, QueueHome, QueueProposal } from "./contract";

const concepts: Readonly<Record<string, readonly string[]>> = {
  appearance: ["color", "colour", "paint", "palette", "contrast", "theme"],
  reminders: ["reminder", "notify", "notification", "alarm", "schedule"],
  access: ["keyboard", "screen reader", "accessibility", "focus"],
};
function matchingConcepts(text: string, home: QueueHome): string[] {
  return home.concepts.filter(concept => (concepts[concept] ?? [concept]).some(term =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)));
}
/** Pure suggestions: caller supplies queue homes; this module has no writer. */
export function proposeQueues(item: Item, homes: readonly QueueHome[]): readonly QueueProposal[] {
  const matches = homes.map(home => ({ home, matches: matchingConcepts(item.what, home) })).filter(row => row.matches.length);
  return Object.freeze(matches.map(({ home, matches: hits }) => Object.freeze({ id: home.id, name: home.name,
    reason: `Related concepts: ${hits.join(", ")}. Human confirmation required.`,
    duplicate: matches.some(other => other.home.id !== home.id && other.matches.some(hit => hits.includes(hit))),
  })));
}
