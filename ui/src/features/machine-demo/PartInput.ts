import type { DemoPart } from "./contracts";

const factNames = ["host", "os", "installation", "reminders", "automation"];
/** Copy the injected catalog so refreshes cannot mutate a retained choice. */
export function PartInput(input: readonly DemoPart[]): readonly DemoPart[] {
  const ids = new Set<string>();
  return Object.freeze(input.map(part => {
    if (!part.id.trim() || ids.has(part.id) || !part.title.trim()) throw new Error("Demo parts need unique identifiers and titles.");
    ids.add(part.id);
    const requirementIds = new Set<string>();
    const requirements = part.requirements.map(requirement => {
      if (!requirement.id.trim() || requirementIds.has(requirement.id) || !factNames.includes(requirement.fact) ||
          !requirement.label.trim() || !requirement.missing.trim() || !requirement.accepts.length)
        throw new Error("Each prerequisite needs a unique identifier, fact and explanation.");
      requirementIds.add(requirement.id);
      return Object.freeze({ ...requirement, accepts: Object.freeze([...requirement.accepts]),
        setup: requirement.setup ? Object.freeze({ ...requirement.setup, evidence: Object.freeze({ ...requirement.setup.evidence }) }) : undefined });
    });
    return Object.freeze({ ...part, requirements: Object.freeze(requirements) });
  }));
}
