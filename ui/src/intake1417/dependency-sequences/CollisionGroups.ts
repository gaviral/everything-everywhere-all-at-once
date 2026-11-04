import type { DependencyPart, OrderedPart } from "./contracts";

export interface ScopeCollision { left: string; right: string; scopes: string[] }
function contains(directory: string, path: string) {
  return directory.endsWith("/**") && (path === directory.slice(0, -3) || path.startsWith(directory.slice(0, -2)));
}
function overlaps(left: string, right: string) { return left === right || contains(left, right) || contains(right, left); }

/** Ownership is separate from prerequisite order, even when owners have the same name. */
export function CollisionGroups(parts: readonly DependencyPart[]): ScopeCollision[] {
  const collisions: ScopeCollision[] = [];
  for (let left = 0; left < parts.length; left++) for (let right = left + 1; right < parts.length; right++) {
    const scopes = parts[left].fileScopes.flatMap(a => parts[right].fileScopes.filter(b => overlaps(a, b)).map(b => a === b ? a : `${a} ↔ ${b}`));
    if (scopes.length) collisions.push({ left: parts[left].id, right: parts[right].id, scopes });
  }
  return collisions;
}

export function ParallelComparison(selected: OrderedPart, rows: readonly OrderedPart[], collisions: readonly ScopeCollision[]): { id: string; compatible: boolean; reason: string }[] {
  return rows.filter(row => row.part.id !== selected.part.id).map(row => {
    const collision = collisions.find(pair => [pair.left, pair.right].includes(selected.part.id) && [pair.left, pair.right].includes(row.part.id));
    if (collision) return { id: row.part.id, compatible: false, reason: `File ownership overlap: ${collision.scopes.join(", ")}. No parallel recommendation.` };
    if (selected.status !== "ready" || row.status !== "ready") return { id: row.part.id, compatible: false, reason: `Both parts must be ready (${selected.part.id}: ${selected.status}; ${row.part.id}: ${row.status}).` };
    if (!selected.part.fileScopes.length || !row.part.fileScopes.length) return { id: row.part.id, compatible: false, reason: "File ownership is undeclared. Parallel eligibility is unknown." };
    return { id: row.part.id, compatible: true, reason: "Can run together: prerequisites satisfied and declared file scopes do not overlap." };
  });
}
