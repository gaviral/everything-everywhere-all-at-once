// Both lenses move the same complete turn cards. Topic destinations remain the map's own destinations.
import { turnsOf } from "../contract";
import { C, CONVERSATION, conversationLayout } from "./conversation";
import { G, layout as topicLayout, type Item, type Layout, type LayoutInput } from "./layout";
import { sessions, sessionLabel } from "./sessions";

export type Lens = "time" | "topics";
export function lensLayout(input: LayoutInput, lens: Lens): Layout {
  const source = conversationLayout(input);
  const cards = source.items.filter(item => item.kind === "point");
  const items: Item[] = [];
  const links: Layout["links"] = [];
  const tips = new Map<string, string>();
  const append = (head: Item, rows: Item[]) => {
    items.push(head);
    let y = head.box.y + head.box.h + G.headGap;
    let previous = { key: head.key, dx: G.lineX, dy: head.box.h };
    for (const row of rows) {
      const item = { ...row, topic: head.key, box: { ...row.box, x: head.box.x, y } };
      items.push(item);
      links.push({ key: `spine:${head.key}:${row.key}`, kind: "spine", from: previous,
        to: { key: row.key, dx: G.lineX, dy: C.speaker + G.dotY }, topic: head.key });
      previous = { key: row.key, dx: G.lineX, dy: C.speaker + G.dotY };
      for (const member of row.memberships ?? []) tips.set(member.thread, row.key);
      y += row.box.h + C.gap;
    }
    return y;
  };
  if (lens === "time") {
    const groups = sessions(turnsOf(input.thoughts, input.threads));
    for (const [i, session] of groups.entries()) {
      const { when, duration } = sessionLabel(session.start, session.end);
      const ids = new Set(session.turns.map(turn => `p:${turn.key}`));
      append({ key: session.key, id: session.key, kind: "conversation", thread: "", topic: session.key,
        box: { x: i * (G.colW + G.laneGap), y: 0, w: G.colW, h: 64 }, pinned: false, depth: 0,
        title: when, subtitle: duration, count: session.turns.length, session: true }, cards.filter(card => ids.has(card.key)));
    }
  } else {
    // Use today's map for the topic columns and ordering, including hand-placed topic heads.
    // Full turns need more height than summaries: only push later heads down if their words would overlap.
    const places = topicLayout(input);
    const heads = input.threads.map(thread => ({ thread, box: places.byKey.get(`t:${thread.id}`)?.box }))
      .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0));
    const occupied: { x: number; y: number }[] = [];
    const assigned = new Set<string>();
    for (const { thread, box } of heads) {
      const rows = cards.filter(card => card.thread === thread.id);
      rows.forEach(card => assigned.add(card.key));
      const x = box?.x ?? 0;
      const y = Math.max(box?.y ?? 0, ...occupied.filter(p => Math.abs(p.x - x) < G.colW + 16).map(p => p.y + G.rowGap));
      const bottom = append({ key: `t:${thread.id}`, id: thread.id, kind: "conversation", thread: thread.id, topic: thread.id,
        box: { x, y, w: G.colW, h: 64 }, pinned: false, depth: 0, title: thread.title,
        subtitle: `${rows.length} ${rows.length === 1 ? "turn" : "turns"}`, count: rows.length }, rows);
      occupied.push({ x, y: bottom });
    }
    const waiting = cards.filter(card => !assigned.has(card.key));
    if (waiting.length) append({ key: "topics:waiting", id: "topics:waiting", kind: "conversation", thread: "", topic: "topics:waiting",
      box: { x: Math.max(0, ...occupied.map(p => p.x + G.colW + G.laneGap)), y: 0, w: G.colW, h: 64 }, pinned: false, depth: 0,
      title: "Awaiting topic", subtitle: `${waiting.length} turns` }, waiting);
  }
  if (cards.length) tips.set(CONVERSATION, cards.at(-1)!.key);
  return { ...source, items, links, tips, byKey: new Map(items.map(item => [item.key, item])) };
}

/** Shift the origin with the lens: the watched card keeps its exact world and screen position. */
export function shiftLayout(layout: Layout, offset: { x: number; y: number }): Layout {
  const items = layout.items.map(item => ({ ...item, box: { ...item.box, x: item.box.x + offset.x, y: item.box.y + offset.y } }));
  return { ...layout, items, byKey: new Map(items.map(item => [item.key, item])) };
}
