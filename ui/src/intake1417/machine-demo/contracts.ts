export type Availability = "available" | "unavailable" | "unknown";
export type FactKey = "host" | "os" | "installation" | "reminders" | "automation";
export type EvidenceKind = "host" | "platform-research" | "synthetic";

export interface Evidence {
  readonly source: string;
  readonly observedAt: string;
  readonly kind: EvidenceKind;
}
export interface MachineFact {
  readonly value: string;
  readonly evidence: Evidence;
}
export interface MachineProfile {
  readonly label: string;
  readonly facts: Readonly<Partial<Record<FactKey, MachineFact>>>;
  readonly gaps: readonly string[];
}
export interface SetupStep {
  readonly instruction: string;
  readonly evidence: Evidence;
}
export interface PartRequirement {
  readonly id: string;
  readonly label: string;
  readonly fact: FactKey;
  readonly accepts: readonly string[];
  readonly missing: string;
  readonly setup?: SetupStep;
}
/** The catalog owner supplies identifiers and requirements; this feature never starts a demo. */
export interface DemoPart {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: readonly PartRequirement[];
}
export interface RequirementMatch {
  readonly requirement: PartRequirement;
  readonly status: Availability;
  readonly fact?: MachineFact;
}
export interface PartMatch {
  readonly part: DemoPart;
  readonly status: Availability;
  readonly requirements: readonly RequirementMatch[];
}
/** Read-only supplied facts. No detection, commands, permissions or native actions belong here. */
export interface MachineAdapter {
  read(): unknown;
  subscribe?(changed: () => void): () => void;
  now(): string;
}
export interface MachineState {
  readonly enabled: boolean;
  readonly selectedId: string | null;
  readonly profile: MachineProfile;
  readonly matches: readonly PartMatch[];
}
