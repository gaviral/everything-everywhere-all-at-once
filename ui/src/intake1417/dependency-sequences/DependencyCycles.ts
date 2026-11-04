import type { DependencyPart } from "./contracts";

/** Strongly connected groups, including self-dependencies. Members are not a fabricated path. */
export function DependencyCycles(parts: readonly DependencyPart[]): string[][] {
  const byId = new Map(parts.map(part => [part.id, part]));
  const indices = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), groups: string[][] = [];
  let next = 0;
  function visit(id: string) {
    indices.set(id, next); low.set(id, next++); stack.push(id); active.add(id);
    for (const prerequisite of byId.get(id)!.prerequisites) {
      if (!byId.has(prerequisite)) continue;
      if (!indices.has(prerequisite)) { visit(prerequisite); low.set(id, Math.min(low.get(id)!, low.get(prerequisite)!)); }
      else if (active.has(prerequisite)) low.set(id, Math.min(low.get(id)!, indices.get(prerequisite)!));
    }
    if (low.get(id) !== indices.get(id)) return;
    const group: string[] = [];
    let member: string;
    do { member = stack.pop()!; active.delete(member); group.push(member); } while (member !== id);
    if (group.length > 1 || byId.get(id)!.prerequisites.includes(id)) groups.push(group.sort());
  }
  for (const part of parts) if (!indices.has(part.id)) visit(part.id);
  return groups;
}
