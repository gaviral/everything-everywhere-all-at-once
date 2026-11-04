import type { DependencyPart, DependencySnapshot } from "./contracts";

export type ValidatedInput = { ok: true; snapshot: DependencySnapshot } | { ok: false; errors: string[] };
const stableId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);

function validScope(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 240 || /[\\\s:?\[\]{}\u0000-\u001f]/.test(value)) return false;
  const path = value.endsWith("/**") ? value.slice(0, -3) : value;
  return !path.includes("*") && path.split("/").every(segment => !!segment && segment !== "." && segment !== "..");
}

function validatePart(value: unknown, index: number, ids: Set<string>): string[] {
  const prefix = `Part ${index + 1}`;
  if (!record(value)) return [`${prefix}: expected a part record.`];
  const errors: string[] = [];
  if (typeof value.id !== "string" || !stableId.test(value.id)) errors.push(`${prefix}: a stable ID is required.`);
  else if (ids.has(value.id)) errors.push(`${prefix}: duplicate ID ${value.id}.`);
  else ids.add(value.id);
  if (!text(value.name)) errors.push(`${prefix}: a readable name is required.`);
  if (!text(value.owner)) errors.push(`${prefix}: an owner is required.`);
  if (!Array.isArray(value.fileScopes) || value.fileScopes.length > 100 || !value.fileScopes.every(validScope)) errors.push(`${prefix}: scopes must be relative exact files or directory/** paths.`);
  if (!Array.isArray(value.prerequisites) || value.prerequisites.length > 100 || !value.prerequisites.every(id => typeof id === "string" && stableId.test(id))) errors.push(`${prefix}: prerequisites must be stable IDs.`);
  if (typeof value.evidence !== "string" || !["complete", "pending", "unknown"].includes(value.evidence)) errors.push(`${prefix}: evidence must be complete, pending or unknown.`);
  return errors;
}

/** Reject malformed snapshots atomically. Missing referenced IDs remain explicit graph unknowns. */
export function DependencyInput(value: unknown): ValidatedInput {
  if (!record(value) || !text(value.revision) || !Array.isArray(value.parts) || value.parts.length > 100) return { ok: false, errors: ["Expected a revision and at most 100 supplied parts."] };
  const ids = new Set<string>();
  const errors = value.parts.flatMap((part, index) => validatePart(part, index, ids));
  if (errors.length) return { ok: false, errors };
  // Copy the boundary so an adapter mutating its records cannot change a validated view.
  const parts = (value.parts as unknown as DependencyPart[]).map(part => ({ ...part, fileScopes: [...new Set(part.fileScopes)], prerequisites: [...new Set(part.prerequisites)] }));
  return { ok: true, snapshot: { revision: value.revision, parts } };
}
