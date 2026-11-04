import type { MapSnapshot } from "../contract";

export type Source = {
  id: string; text: string; speaker: string; at: number; topicId: string; topic: string;
};
type RecordBase = {
  id: string; question: string; reason: string; source: Source; context: Source[];
  actor: string; at: number;
};
export type Review = RecordBase & { kind: "review" };
export type Decision = RecordBase & {
  kind: "decision"; outcome: string; condition: string; supersedes?: string; reviewId?: string;
};
export type Entry = Review | Decision;
export type Ledger = { version: 1; entries: Entry[] };
export const emptyLedger = (): Ledger => ({ version: 1, entries: [] });

export function sourcesOf(map: MapSnapshot): Source[] {
  return map.thoughts.flatMap(thought => {
    const topic = map.threads.find(thread => thread.id === thought.thread_id);
    return thought.placed && topic && thought.text.trim() ? [{
      id: thought.id, text: thought.text, speaker: thought.speaker, at: thought.at_ms,
      topicId: topic.id, topic: topic.title,
    }] : [];
  });
}

export const replacementOf = (entry: Entry, ledger: Ledger) => ledger.entries.find(
  (item): item is Decision => item.kind === "decision" && item.supersedes === entry.id,
);
export const decisionFor = (review: Entry, ledger: Ledger) => ledger.entries.find(
  (item): item is Decision => item.kind === "decision" && item.reviewId === review.id,
);
export function sourceState(source: Source, live: Source[]) {
  const current = live.find(item => item.id === source.id);
  return !current ? "missing" : current.text !== source.text || current.speaker !== source.speaker || current.at !== source.at ? "changed" : "available";
}

function sourceIsValid(value: unknown): value is Source {
  if (!value || typeof value !== "object") return false;
  const source = value as Source;
  return [source.id, source.text, source.speaker, source.topicId, source.topic].every(item => typeof item === "string")
    && Number.isFinite(source.at);
}

/** Reject unknown or broken saved data rather than replace it with an empty notebook. */
export function readLedger(raw: string | null): Ledger {
  if (raw === null) return emptyLedger();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || (value as Ledger).version !== 1 || !Array.isArray((value as Ledger).entries)) throw new Error("Unknown notebook format");
  const ledger = value as Ledger;
  const preceding = new Map<string, Entry>();
  const replaced = new Set<string>();
  const resolved = new Set<string>();
  for (const entry of ledger.entries) {
    if (!entry || !["review", "decision"].includes(entry.kind)
      || ![entry.id, entry.question, entry.reason, entry.actor].every(item => typeof item === "string" && item.trim())
      || !Number.isFinite(entry.at) || !sourceIsValid(entry.source)
      || !Array.isArray(entry.context) || !entry.context.every(sourceIsValid) || preceding.has(entry.id)) throw new Error("Invalid notebook record");
    if (entry.kind === "decision") {
      if (![entry.outcome, entry.condition].every(item => typeof item === "string" && item.trim())) throw new Error("Incomplete decision");
      if (entry.supersedes !== undefined) {
        if (preceding.get(entry.supersedes)?.kind !== "decision" || replaced.has(entry.supersedes)) throw new Error("Invalid decision history");
        replaced.add(entry.supersedes);
      }
      if (entry.reviewId !== undefined) {
        if (preceding.get(entry.reviewId)?.kind !== "review" || resolved.has(entry.reviewId)) throw new Error("Invalid review reference");
        resolved.add(entry.reviewId);
      }
    }
    preceding.set(entry.id, entry);
  }
  return ledger;
}
