import type { MemoryRecord } from "./contract";

export interface RevisionState {
  readonly state: "current" | "unresolved" | "superseded";
  readonly replacement?: MemoryRecord;
  readonly previous?: MemoryRecord;
}

/** A replacement requires a supplied, source-backed record of the same kind. */
export function revisionState(record: MemoryRecord, records: readonly MemoryRecord[]): RevisionState {
  const replacement = records.find(candidate => candidate.id !== record.id && candidate.kind === record.kind && candidate.supersedes === record.id);
  const previous = records.find(candidate => candidate.id !== record.id && candidate.kind === record.kind && candidate.id === record.supersedes);
  return { state: replacement ? "superseded" : record.state, replacement, previous };
}

export const stateLabels = { current: "Current", unresolved: "Open", superseded: "Superseded" } as const;

export function countStates(records: readonly MemoryRecord[]) {
  const counts = { current: 0, unresolved: 0, superseded: 0 };
  for (const record of records) counts[revisionState(record, records).state]++;
  return counts;
}
