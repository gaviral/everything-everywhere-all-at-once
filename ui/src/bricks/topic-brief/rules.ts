import type { MapSnapshot, Thought } from "../contract";

export const BRIEF_LIMIT = 24 * 1024;
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Source text stays literal Markdown; external addresses and access parameters aren't portable references. */
export function literal(text: string): string {
  return text.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, "[external address omitted]")
    .replace(/(?:[?&#]|\b)(?:room|invite|code|token)=[^\s&#]*/gi, "[access parameter omitted]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[\\`*_{}\[\]()#+\-.!|>~<]/g, "\\$&");
}
const localId = (id: string) => literal(/^[A-Za-z0-9_.-]{1,120}$/.test(id) ? id : "(invalid local ID)");
const time = (ms: number) => Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000 ? new Date(ms).toISOString() : "Time unavailable";

export function buildBrief(map: MapSnapshot, tangents: boolean, generated: number): string | null {
  const active = map.threads.find((topic) => topic.id === map.active);
  if (!active) return null;
  const scope = new Set([active.id]);
  if (tangents) {
    const children = new Map<string, string[]>();
    for (const topic of map.threads) if (topic.parent_id) children.set(topic.parent_id, [...(children.get(topic.parent_id) ?? []), topic.id]);
    const pending = [active.id];
    while (pending.length) for (const id of children.get(pending.pop()!) ?? []) if (!scope.has(id)) { scope.add(id); pending.push(id); }
  }
  const thoughts = map.thoughts.filter((thought) => thought.placed && thought.thread_id && scope.has(thought.thread_id))
    .map((thought, order) => ({ thought, order })).sort((a, b) => a.thought.at_ms - b.thought.at_ms || a.order - b.order).map(({ thought }) => thought);
  const thoughtRecord = (thought: Thought) => {
    const speaker = `${literal(thought.speaker)}${map.speakers.get(thought.speaker)?.ai ? " (AI speaker)" : " (person)"}`;
    return `- Source: ${localId(thought.id)}; topic: ${localId(thought.thread_id!)}; speaker: ${speaker}; timestamp: ${time(thought.at_ms)}\n  Point: ${literal(thought.point)}\n${thought.text !== thought.point ? `  Original words:\n${literal(thought.text).split("\n").map((line) => `  > ${line}`).join("\n")}\n` : ""}\n`;
  };
  const sections = [
    { name: "Recorded decisions", total: thoughts.filter((thought) => thought.decided === true).length, records: thoughts.filter((thought) => thought.decided === true).map(thoughtRecord) },
    { name: "Proposed next steps", total: 0, records: [
      ...map.suggestions.filter((item) => scope.has(item.thread_id) && item.status === "new").map((item) => `- AI proposal; source: ${localId(item.id)}; topic: ${localId(item.thread_id)}\n  ${literal(item.text)}\n\n`),
      ...map.reminders.filter((item) => scope.has(item.thread_id) && item.status === "new").map((item) => `- AI proposal (${item.kind}); source: ${localId(item.id)}; topic: ${localId(item.thread_id)}\n  ${literal(item.title)}${item.when ? `; when: ${literal(item.when)}` : ""}\n\n`),
    ] },
    { name: "Latest placed thoughts", total: thoughts.length, records: thoughts.slice(-10).map(thoughtRecord) },
  ];
  sections[1].total = sections[1].records.length;
  const title = literal(active.title);
  const titleOmitted = bytes(title) > 1024;
  const head = `# Topic brief: ${titleOmitted ? "(title exceeds brief limit)" : title}\n\nTopic ID: ${localId(active.id)}\nGenerated at: ${time(generated)}\nScope: ${tangents ? "Active topic and descendant tangents" : "Active topic only"}; ${scope.size} topic(s).\n\nRecorded map excerpts, not a generated summary or a guarantee of truth. Decisions use only the map's recorded decision marker; no agreement or completion is inferred. Only pending AI proposals are included; kept, dismissed and handled items are excluded. Latest thoughts select at most ten, oldest to newest within that selection. External addresses and access parameters are omitted.\n\n`;
  // Reserve enough for coverage and section headings before admitting any whole record. No byte slicing.
  let remaining = BRIEF_LIMIT - bytes(head) - 2048;
  const selected = sections.map((section) => {
    const kept: string[] = [];
    for (const record of section.records) if (bytes(record) <= remaining) { kept.push(record); remaining -= bytes(record); }
    return kept;
  });
  const coverage = `Coverage: ${sections.map((section, i) => `${section.name}: ${selected[i].length}/${section.total} included, ${section.total - selected[i].length} omitted (${section.records.length - selected[i].length} by size cap${i === 2 ? `; ${Math.max(0, section.total - 10)} outside latest ten` : ""})`).join("; ")}. Title omitted: ${titleOmitted ? 1 : 0}. Limit: 24 KiB UTF-8.\n\n`;
  return head + coverage + sections.map((section, i) => `## ${section.name}\n\n${selected[i].join("") || (section.total ? "No whole records fit within the brief limit.\n\n" : "None recorded in this scope.\n\n")}`).join("");
}
