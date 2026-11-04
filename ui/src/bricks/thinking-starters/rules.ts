export const FIELD_LIMIT = 1000;
export const THOUGHT_LIMIT = 4000;

export const STARTERS = [
  { id: "choice", name: "Work through a choice", labels: ["Question", "Options", "What matters"] },
  { id: "update", name: "Project update", labels: ["Goal", "What changed", "Next step"] },
  { id: "unblock", name: "Unblock me", labels: ["Trying to do", "Stuck because", "Small next move"] },
] as const;

export type StarterId = typeof STARTERS[number]["id"];
export type Fields = [string, string, string];
export const emptyFields = (): Fields => ["", "", ""];

/** Preserve the person's words, including whitespace; the preview is the send payload. */
export function serialize(labels: readonly string[], fields: Fields): string {
  return labels.map((label, i) => `${label}:\n${fields[i]}`).join("\n\n");
}

export function canPreview(labels: readonly string[], fields: Fields): boolean {
  return !!fields[0].trim() && fields.slice(1).some((field) => !!field.trim())
    && fields.every((field) => field.length <= FIELD_LIMIT)
    && serialize(labels, fields).length <= THOUGHT_LIMIT;
}
