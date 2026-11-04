import type { VersionBranch, VersionSnapshot } from './contract';

export interface BranchRelationship { branch: VersionBranch; depth: number; unknownBase: boolean }
function safeParent(branch: VersionBranch, snapshot: VersionSnapshot, byId: Map<string, VersionBranch>): string | null {
  const visited = new Set([branch.id]);
  let parent = branch.parentId;
  while (parent !== snapshot.main.id) {
    if (!parent || !byId.has(parent)) return branch.parentId && byId.has(branch.parentId) ? branch.parentId : null;
    if (visited.has(parent)) return null;
    visited.add(parent);
    parent = byId.get(parent)!.parentId;
  }
  return branch.parentId;
}

/** Flat accessible list with explicit depth; unknown/cyclic ancestry never becomes a main edge. */
export function branchRelationships(snapshot: VersionSnapshot): BranchRelationship[] {
  const byId = new Map(snapshot.branches.map(branch => [branch.id, branch]));
  const parents = new Map(snapshot.branches.map(branch => [branch.id, safeParent(branch, snapshot, byId)]));
  const rows: BranchRelationship[] = [];
  function append(parentId: string, depth: number) {
    snapshot.branches.filter(branch => parents.get(branch.id) === parentId).forEach(branch => {
      rows.push({ branch, depth, unknownBase: false });
      append(branch.id, depth + 1);
    });
  }
  append(snapshot.main.id, 1);
  snapshot.branches.filter(branch => !parents.get(branch.id)).forEach(branch => {
    rows.push({ branch, depth: 0, unknownBase: true });
    append(branch.id, 1);
  });
  return rows;
}
