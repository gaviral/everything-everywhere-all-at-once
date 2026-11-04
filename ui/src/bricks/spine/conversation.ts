// A browser-only projection: routing and the journal stay untouched. Classification changes links, never the turns'
// order or positions. In particular, an unplaced turn already has its place before its topics are known.
import { turnsOf } from "../contract";
import { G, SPINE_LOOK, whoIs, type Item, type Layout, type LayoutInput } from "./layout";
import { wrap } from "./measure";

export const CONVERSATION = "conversation:all";
export const C = { speaker: 22, status: 22, links: 44, gap: 16, topicX: 348, topicW: 256, member: 60, pad: 12 } as const;

export function conversationLayout(input: LayoutInput): Layout {
  const turns = turnsOf(input.thoughts, input.threads);
  const thoughtById = new Map(input.thoughts.map((thought) => [thought.id, thought]));
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread]));
  const items: Item[] = [];
  const links: Layout["links"] = [];
  const tips = new Map<string, string>();
  const head: Item = { key: CONVERSATION, id: CONVERSATION, kind: "conversation", thread: "", topic: CONVERSATION,
    box: { x: 0, y: 0, w: G.colW, h: 64 }, pinned: false, depth: 0, count: turns.length, title: "Conversation" };
  items.push(head);
  let y = head.box.h + G.headGap;
  let previous = { key: head.key, dx: G.lineX, dy: head.box.h };
  const pointForThought = new Map<string, string>();
  for (const turn of turns) for (const part of turn.parts) pointForThought.set(part.thoughtId, `p:${turn.key}`);
  const members = new Map<string, Item[]>();
  for (const turn of turns) {
    const parts = turn.parts.map((part) => thoughtById.get(part.thoughtId)!);
    const text = turn.parts.map((part) => part.text).join(" ");
    const lines = wrap(text, "point", G.textW, Infinity);
    const memberships = [...new Set(parts.filter((part) => part.placed).map((part) => part.thread_id))]
      .flatMap((id) => { const thread = id && threadById.get(id); return thread ? [{ thread: thread.id, title: thread.title }] : []; });
    const pauseHeight = parts.reduce((height, part) => height + (input.paused?.get(part.id) ?? 0), 0) * 44;
    const h = C.speaker + lines.length * G.pointLine + C.status + C.links + pauseHeight;
    let offset = 0;
    const fixes = parts.flatMap((thought) => {
      const at = thought.unclear ? thought.text.trim().toLocaleLowerCase().indexOf(thought.unclear.toLocaleLowerCase()) : -1;
      const found = at >= 0 ? [{ thought, start: offset + at }] : [];
      offset += (thought.text || thought.point).trim().length + 1;
      return found;
    });
    const item: Item = { key: `p:${turn.key}`, id: turn.key, kind: "point", conversation: true, thread: memberships[0]?.thread ?? "",
      topic: CONVERSATION, box: { x: 0, y, w: G.colW, h }, pinned: false, depth: 0, text, shown: text, lines, look: SPINE_LOOK,
      thoughts: parts.map((part) => part.id), at: turn.at, who: whoIs(turn.speaker, input.me ?? "you", input.speakers), fixes,
      decided: parts.some((part) => part.decided), left: parts.at(-1)!.placed && !parts.at(-1)!.complete, memberships,
      replyTo: turn.note ? pointForThought.get(turn.note.thoughtId) : undefined };
    items.push(item);
    links.push({ key: `chronology:${turn.key}`, kind: "spine", from: previous,
      to: { key: item.key, dx: G.lineX, dy: C.speaker + G.dotY }, topic: CONVERSATION });
    previous = { key: item.key, dx: G.lineX, dy: C.speaker + G.dotY };
    for (const { thread } of memberships) {
      members.set(thread, [...(members.get(thread) ?? []), item]);
      tips.set(thread, item.key);
    }
    tips.set(CONVERSATION, item.key);
    y += h + C.gap;
  }
  // Topic branches grow in their own column. Opening one or receiving a new topic never shifts a conversation row.
  let bottom = 0;
  const topics = [...input.threads].sort((a, b) => (members.get(a.id)?.[0]?.box.y ?? Infinity) - (members.get(b.id)?.[0]?.box.y ?? Infinity));
  for (const thread of topics) {
    const rows = members.get(thread.id) ?? [];
    const parent = thread.parent_id ? threadById.get(thread.parent_id) : undefined;
    const open = input.open === thread.id;
    const base = 88 + (parent ? C.links : 0);
    const h = base + (open ? rows.length * C.member + C.pad : 0);
    const item: Item = { key: `t:${thread.id}`, id: thread.id, thread: thread.id, kind: "topic", topic: CONVERSATION, depth: 0,
      box: { x: C.topicX, y: Math.max(rows[0]?.box.y ?? 80, bottom), w: C.topicW, h }, pinned: false,
      title: thread.title, count: rows.length, open, room: input.rooms.get(thread.id),
      parentTopic: parent ? { thread: parent.id, title: parent.title } : undefined,
      members: rows.map((row) => ({ key: row.key, text: row.text!, speaker: row.who!.ai ? "AI helper" : row.who!.name })) };
    items.push(item);
    if (!tips.has(thread.id)) tips.set(thread.id, item.key);
    for (const row of rows) links.push({ key: `membership:${row.id}:${thread.id}`, kind: "branch",
      from: { key: row.key, dx: G.colW, dy: C.speaker + G.dotY }, to: { key: item.key, dx: 0, dy: 32 }, topic: CONVERSATION });
    bottom = item.box.y + h + G.stack;
  }
  if (!tips.has(CONVERSATION)) tips.set(CONVERSATION, head.key);
  return { items, links, byKey: new Map(items.map((item) => [item.key, item])), tips, slots: new Map(), shelf: [], lanes: [], groups: [] };
}
