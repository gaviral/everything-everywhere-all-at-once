import type { DependencySnapshot, OrderedPart } from "./contracts";
import { DependencyCycles } from "./DependencyCycles";

/** Eligibility is evidence-based, never an instruction to launch a part. */
export function DependencyOrder(snapshot: DependencySnapshot): { rows: OrderedPart[]; cycles: string[][] } {
  const byId = new Map(snapshot.parts.map(part => [part.id, part]));
  const cycles = DependencyCycles(snapshot.parts);
  const cycleById = new Map(cycles.flatMap(group => group.map(id => [id, group] as const)));
  const resolved = new Map<string, OrderedPart>();
  function resolve(id: string): OrderedPart {
    if (resolved.has(id)) return resolved.get(id)!;
    const part = byId.get(id)!;
    const group = cycleById.get(id);
    const missing = part.prerequisites.filter(prerequisite => !byId.has(prerequisite));
    let row: OrderedPart;
    if (group) row = { part, status: "cyclic", reasons: [`Cycle among ${group.join(", ")}; no valid prerequisite order exists.`] };
    else if (missing.length) row = { part, status: "unknown", reasons: missing.map(prerequisite => `Unknown prerequisite ${prerequisite}; completion cannot be verified.`) };
    else if (part.evidence === "unknown") row = { part, status: "unknown", reasons: ["This part's evidence is unknown; eligibility cannot be verified."] };
    else {
      const prerequisites = part.prerequisites.map(resolve);
      const unknown = prerequisites.filter(row => row.status === "unknown");
      const unfinished = prerequisites.filter(row => row.status !== "complete");
      if (unknown.length) row = { part, status: "unknown", reasons: unknown.map(row => `Prerequisite ${row.part.id} has unknown dependencies or evidence. Inspect ${row.part.id} for the cause.`) };
      else if (unfinished.length) row = { part, status: "blocked", reasons: unfinished.map(row => `Waiting for prerequisite ${row.part.id} (${row.part.name}) to complete (currently ${row.status}).`) };
      else if (part.evidence === "complete") row = { part, status: "complete", reasons: ["Supplied evidence marks this part complete."] };
      else row = { part, status: "ready", reasons: [part.prerequisites.length ? "All prerequisites have completion evidence." : "No prerequisites; independently eligible."] };
    }
    resolved.set(id, row);
    return row;
  }
  return { rows: snapshot.parts.map(part => resolve(part.id)), cycles };
}
