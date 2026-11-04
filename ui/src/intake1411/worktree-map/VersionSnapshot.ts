import type { VersionBranch, VersionSnapshot as Snapshot } from './contract';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) throw new Error('Invalid identity');
  return value;
}
function optionalText(value: unknown): string | null {
  return value == null ? null : text(value);
}
function identity(value: unknown): VersionBranch['lane'] {
  if (value == null) return null;
  const item = record(value);
  return Object.freeze({ id: text(item.id), label: text(item.label) });
}
function buildIdentity(value: unknown): VersionBranch['build'] {
  if (value == null) return null;
  const item = record(value);
  // Partial build data must never imply a known build revision.
  if (item.id == null || item.revision == null) return null;
  return Object.freeze({ id: text(item.id), revision: text(item.revision) });
}
function branch(value: unknown): VersionBranch {
  const item = record(value);
  return Object.freeze({
    id: text(item.id), name: text(item.name), parentId: optionalText(item.parentId), head: optionalText(item.head),
    lane: identity(item.lane), worktree: identity(item.worktree), build: buildIdentity(item.build),
  });
}
function uniqueBranches(values: unknown[], mainId: string): readonly VersionBranch[] {
  const seen = new Set([mainId]);
  return Object.freeze(values.map(value => {
    const item = branch(value);
    if (seen.has(item.id)) throw new Error('Duplicate Git branch identity');
    seen.add(item.id);
    return item;
  }));
}

/** Copy and freeze the owner's data; missing ancestry is kept unknown, never guessed. */
export function validateVersionSnapshot(value: unknown): Snapshot {
  const item = record(value), main = record(item.main);
  if (item.schemaVersion !== 1 || !Array.isArray(item.branches) || item.branches.length > 500) throw new Error('Unsupported snapshot');
  if (item.freshness !== 'current' && item.freshness !== 'stale') throw new Error('Unknown snapshot freshness');
  const observedAt = text(item.observedAt);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation time');
  const root = Object.freeze({ id: text(main.id), name: text(main.name), revision: text(main.revision) });
  return Object.freeze({
    schemaVersion: 1, revision: text(item.revision), observedAt, freshness: item.freshness,
    main: root, branches: uniqueBranches(item.branches, root.id),
  });
}
