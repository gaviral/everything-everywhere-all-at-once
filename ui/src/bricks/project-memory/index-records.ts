import type { MemoryCollection, MemoryKind, MemoryRecord, MemorySource } from "./contract";
import { revisionState } from "./revision";

export interface MemoryIndex {
  readonly title: string;
  readonly example: boolean;
  readonly records: readonly MemoryRecord[];
  readonly sources: readonly MemorySource[];
}

/** Fail closed before building relationships or search text. No map, storage or network reads. */
export function indexRecords(collection: MemoryCollection): MemoryIndex {
  if (collection.visibility !== "public") return { title: "Project memory", example: false, records: [], sources: [] };
  const publicSources = collection.sources.filter(source => source.visibility === "public");
  const sourceIds = new Set(publicSources.map(source => source.id));
  const admitted = collection.records.filter(record => record.visibility === "public" && record.sourceIds.length > 0 && record.sourceIds.every(id => sourceIds.has(id)));
  const recordIds = new Set(admitted.map(record => record.id));
  const records = admitted.map(record => ({
    ...record,
    relatedIds: record.relatedIds?.filter(id => recordIds.has(id)),
    supersedes: record.supersedes && recordIds.has(record.supersedes) ? record.supersedes : undefined,
  }));
  const usedSources = new Set(records.flatMap(record => [...record.sourceIds]));
  return { title: collection.title, example: collection.example, records, sources: publicSources.filter(source => usedSources.has(source.id)) };
}

export interface MemoryFilter {
  readonly kind: MemoryKind | "all";
  readonly query: string;
  readonly includeSuperseded: boolean;
}

export function filterRecords(index: MemoryIndex, filter: MemoryFilter): readonly MemoryRecord[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return index.records.filter(record => {
    if (filter.kind !== "all" && record.kind !== filter.kind) return false;
    if (!filter.includeSuperseded && revisionState(record, index.records).state === "superseded") return false;
    const sources = index.sources.filter(source => record.sourceIds.includes(source.id));
    const text = [record.title, record.summary, ...sources.flatMap(source => [source.title, source.locator, source.excerpt])].join(" ");
    return !query || text.toLocaleLowerCase().includes(query);
  });
}
