import type { CatalogRow } from "../Shell";

export const TASKS: ReadonlyArray<{ name: string; ids: readonly string[] }> = [
  { name: "Capture words", ids: ["listening", "tiny-transcript", "bubble-flight", "import"] },
  { name: "Read and find", ids: ["spine", "cards", "pictures", "terse", "semantic-zoom", "full-content", "bring-here", "related-thoughts", "live-outline"] },
  { name: "Converse and understand", ids: ["preset-talk", "partner", "recap", "topic-brief"] },
  { name: "Return and review", ids: ["notice-timeline", "read-progress", "session-focus", "work-list", "decisions"] },
  { name: "Plan next steps", ids: ["countdown", "next-steps", "helpers", "work-spine"] },
  { name: "Make and inspect apps", ids: [] },
  { name: "Take work out", ids: ["export", "email"] },
  { name: "Set up workspace", ids: ["canvas-tools", "rotate-canvas", "shapes", "view-instances", "keys", "level", "brick-chip", "usage", "conversation-spine"] },
];
export const OTHER = "Other features";
export function taskOf(row: CatalogRow): string {
  return TASKS.find((task) => task.ids.includes(row.id))?.name
    ?? (row.kind === "app" ? "Make and inspect apps" : OTHER);
}
export function canonicalRows(rows: readonly CatalogRow[]): CatalogRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}
export function matchingRows(rows: readonly CatalogRow[], query: string): CatalogRow[] {
  const needle = query.toLocaleLowerCase().trim();
  const canonical = canonicalRows(rows);
  const exact = canonical.filter((row) => [row.name, row.aka].some((name) => name?.toLocaleLowerCase() === needle));
  if (needle && exact.length) return exact;
  const words = needle.split(/\s+/);
  return canonical.filter((row) => {
    const text = [row.name, row.aka, row.does, row.lives, taskOf(row)].join(" ").toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
export function contextIds(view: string): readonly string[] {
  const id = view === "map" ? "spine" : view === "palace" ? "pictures" : view;
  return [id, "bring-here", "full-content", "read-progress"];
}
