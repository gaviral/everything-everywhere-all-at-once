import type { Evidence, FactKey, MachineFact, MachineProfile } from "./contracts";

const values: Record<FactKey, readonly string[]> = {
  host: ["local", "hosted"], os: ["macos", "linux", "windows", "other"],
  installation: ["ready", "missing"], reminders: ["installed", "missing"],
  automation: ["granted", "denied"],
};
export const record = (input: unknown): Record<string, unknown> | null =>
  input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");

export function readEvidence(input: unknown, now: string): Evidence | undefined {
  const item = record(input);
  if (!item || typeof item.source !== "string" || !item.source.trim() || !timestamp(now) ||
      !timestamp(item.observedAt) || Date.parse(item.observedAt as string) > Date.parse(now) ||
      !["host", "platform-research", "synthetic"].includes(String(item.kind))) return;
  return Object.freeze({ source: item.source.trim(), observedAt: item.observedAt as string,
    kind: item.kind as Evidence["kind"] });
}

/** Invalid, undated, future or browser-agent facts remain unknown. Never infer native support. */
export function MachineInput(input: unknown, now: string): MachineProfile {
  const profile = record(input), supplied = record(profile?.facts);
  const facts: Partial<Record<FactKey, MachineFact>> = {};
  const gaps: string[] = [];
  for (const key of Object.keys(values) as FactKey[]) {
    const fact = record(supplied?.[key]);
    const evidence = readEvidence(fact?.evidence, now);
    if (!fact || !evidence || !values[key].includes(String(fact.value)) ||
        evidence.kind === "platform-research") {
      gaps.push(key); continue;
    }
    facts[key] = Object.freeze({ value: fact.value as string, evidence });
  }
  return Object.freeze({ label: typeof profile?.label === "string" && profile.label.trim() ? profile.label : "Unverified machine",
    facts: Object.freeze(facts), gaps: Object.freeze(gaps) });
}
