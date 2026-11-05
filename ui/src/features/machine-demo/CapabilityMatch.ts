import type { Availability, DemoPart, MachineProfile, PartMatch, PartRequirement, RequirementMatch } from "./contracts";

function matchRequirement(requirement: PartRequirement, profile: MachineProfile): RequirementMatch {
  const fact = profile.facts[requirement.fact];
  const status: Availability = !fact ? "unknown" : requirement.accepts.includes(fact.value) ? "available" : "unavailable";
  return Object.freeze({ requirement, status, fact });
}
function combinedStatus(requirements: readonly RequirementMatch[]): Availability {
  if (requirements.some(item => item.status === "unavailable")) return "unavailable";
  return requirements.some(item => item.status === "unknown") ? "unknown" : "available";
}
export function CapabilityMatch(part: DemoPart, profile: MachineProfile): PartMatch {
  const requirements = Object.freeze(part.requirements.map(requirement => matchRequirement(requirement, profile)));
  return Object.freeze({ part, status: combinedStatus(requirements), requirements });
}
