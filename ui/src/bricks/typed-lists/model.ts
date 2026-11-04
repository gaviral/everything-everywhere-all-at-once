import type { Thought, ThoughtSource } from "../contract";

export type Field = { id: string; name: string; kind: "text" | "date" | "choice"; options: string[] };
export type Schema = { name: string; fields: Field[] };
export type RecordCard = { source: ThoughtSource; title: string; values: Record<string, string> };
export type Workspace = { schema: Schema; records: RecordCard[]; view: "list" | "board"; example: boolean };

export const initialSchema: Schema = { name: "Launch plan", fields: [
  { id: "stage", name: "Stage", kind: "choice", options: ["Next", "In motion", "Done"] },
  { id: "owner", name: "Owner", kind: "text", options: [] },
  { id: "due", name: "Due", kind: "date", options: [] },
] };

export const exampleCards: RecordCard[] = [
  { source: { id: "example-story", text: "We should open with one clear story: a thought becomes a plan, and every card can take us back to what was actually said.", speaker: "Example teammate", threadId: "example", at: 0 }, title: "Lead with one clear story", values: { stage: "Next", owner: "Story team", due: "" } },
  { source: { id: "example-demo", text: "Let's rehearse the whole demo once with the board on the big screen. Keep the original words one click away.", speaker: "Example teammate", threadId: "example", at: 0 }, title: "Rehearse on the big screen", values: { stage: "In motion", owner: "Demo team", due: "" } },
  { source: { id: "example-source", text: "The source links are ready. Changing a card's status should leave those original words exactly as they were.", speaker: "Example teammate", threadId: "example", at: 0 }, title: "Keep the words connected", values: { stage: "Done", owner: "Build team", due: "" } },
];

export function sourceOf(thought: Thought): ThoughtSource {
  return { id: thought.id, text: thought.text, threadId: thought.thread_id ?? "", speaker: thought.speaker, at: thought.at_ms };
}

export function schemaProblem(schema: Schema, previous: Schema): string {
  if (!schema.name.trim() || schema.name.trim().length > 40) return "Give the list a name of up to 40 characters.";
  if (schema.fields.length < 1 || schema.fields.length > 3) return "Use one to three fields.";
  if (new Set(schema.fields.map(f => f.name.trim().toLowerCase())).size !== schema.fields.length) return "Give each field a different name.";
  for (const field of schema.fields) {
    if (!field.name.trim() || field.name.trim().length > 30) return "Give every field a name of up to 30 characters.";
    if (field.kind === "choice" && (field.options.length < 2 || field.options.length > 6 || field.options.some(o => !o.trim() || o.trim().length > 30) || new Set(field.options.map(o => o.trim().toLowerCase())).size !== field.options.length)) return "A choice field needs two to six distinct options, up to 30 characters each.";
    const old = previous.fields.find(f => f.id === field.id);
    if (old && (old.kind !== field.kind || old.options.some(o => !field.options.includes(o)))) return "Keep existing field types and options so every card keeps its values.";
  }
  if (previous.fields.some(f => !schema.fields.some(next => next.id === f.id))) return "Keep existing fields so every card keeps its values.";
  return "";
}

export function recordProblem(title: string, fields: Field[], values: Record<string, string>): string {
  if (!title.trim() || title.trim().length > 120) return "Give the card a title of up to 120 characters.";
  for (const field of fields) {
    const value = values[field.id] ?? "";
    if (value.length > 160) return `${field.name}: use up to 160 characters.`;
    if (value && field.kind === "choice" && !field.options.includes(value)) return `${field.name}: choose one of the options.`;
    if (value && field.kind === "date") {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value.startsWith("0000")) return `${field.name}: enter a real calendar date.`;
    }
  }
  return "";
}

export function boardGroups(records: RecordCard[], field: Field) {
  return [...field.options, ""].map(value => ({ value, records: records.filter(record => (record.values[field.id] ?? "") === value) }));
}
