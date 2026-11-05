import type { Item, QueueHome, Review, WorkflowExport } from "./contract";
import { proposedBoundaries, type SpeakerProfile } from "./boundary-strategy";
import { assertCoverage, characters, sourceSpan } from "./source-span";
import { extractItem } from "./item-extraction";
import { proposeQueues } from "./queue-proposal";

function review(source: string, items: readonly Item[]): Review {
  assertCoverage(source, items);
  return Object.freeze({ source, items: Object.freeze([...items]) });
}
export function startReview(source: string, profile: SpeakerProfile): Review {
  if (!source.trim()) throw new Error("Add a transcript first.");
  const cuts = [0, ...proposedBoundaries(source, profile), characters(source).length];
  return review(source, cuts.slice(0, -1).map((start, i) => extractItem(sourceSpan(source, start, cuts[i + 1]))));
}
function itemIndex(state: Review, id: string): number {
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error("Item no longer exists. Choose it again.");
  return index;
}
export function splitItem(state: Review, id: string, offset: number): Review {
  const index = itemIndex(state, id), item = state.items[index];
  if (!Number.isInteger(offset) || offset <= item.source.start || offset >= item.source.end) throw new Error("Split inside this source range.");
  const pieces = [sourceSpan(state.source, item.source.start, offset), sourceSpan(state.source, offset, item.source.end)];
  if (pieces.some(piece => !piece.text.trim())) throw new Error("Both items need text.");
  return review(state.source, [...state.items.slice(0, index), ...pieces.map(extractItem), ...state.items.slice(index + 1)]);
}
export function rejoinItem(state: Review, id: string): Review {
  const index = itemIndex(state, id);
  if (!index) throw new Error("There is no previous item.");
  const joined = extractItem(sourceSpan(state.source, state.items[index - 1].source.start, state.items[index].source.end));
  return review(state.source, [...state.items.slice(0, index - 1), joined, ...state.items.slice(index + 1)]);
}
export function correctItem(state: Review, id: string, patch: Partial<Pick<Item, "what" | "why" | "kind" | "reviewedBy">>): Review {
  const index = itemIndex(state, id), old = state.items[index];
  const contentChanged = patch.what !== undefined || patch.why !== undefined || patch.kind !== undefined;
  const corrected = Object.freeze({ ...old, ...patch,
    ...(contentChanged ? { reviewedBy: "unreviewed" as const } : {}),
    ...(patch.why !== undefined ? { reasonOrigin: "corrected" as const } : {}) });
  return review(state.source, state.items.map((item, i) => i === index ? corrected : item));
}
export function exportWorkflow(state: Review, homes: readonly QueueHome[]): WorkflowExport {
  assertCoverage(state.source, state.items);
  return Object.freeze({ schema: "dictation-breakdown/v1", offsetUnit: "unicode-scalar", source: state.source,
    items: Object.freeze(state.items.map(item => Object.freeze({ ...item, queueProposals: proposeQueues(item, homes) }))),
  });
}
