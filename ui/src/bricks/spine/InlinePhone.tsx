// A presentation of the current spatial Items, never a second thought store.
import { useLayoutEffect, useRef } from "react";
import type { BrickProps } from "../contract";
import { phoneParents, type Layout } from "./layout";
import { InlinePoint, type ItemData } from "./nodes";
import type { Area } from "./camera";
import "./inline-phone.css";

export function InlinePhone({ map, destination, layout, data, area, visit }: {
  map: BrickProps["map"]; destination: BrickProps["destination"]; layout: Layout;
  data: ReadonlyMap<string, ItemData>; area: Area; visit(thread: string, thought: string | null): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const parents = phoneParents(map.threads, map.thoughts);
  const points = layout.items.filter(i => i.kind === "point");
  const reached = useRef<BrickProps["destination"]>(null);
  useLayoutEffect(() => {
    if (!destination || reached.current === destination) return;
    const target = destination.thoughtId
      ? list.current?.querySelector<HTMLElement>(`[data-heads~="${CSS.escape(destination.thoughtId)}"] .inline-words`)
      : list.current?.querySelector<HTMLElement>(`[data-inline-thread="${CSS.escape(destination.threadId)}"] > h2 > button`);
    if (target) reached.current = destination;
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    target?.focus({ preventScroll: true });
  }, [destination, layout]);
  const seen = new Set<string>();
  const thread = (id: string, depth: number): React.ReactNode => {
    if (seen.has(id)) return null;
    seen.add(id);
    const t = map.threads.find(t => t.id === id)!;
    const parent = parents.get(id);
    const own = points.filter(i => i.thread === id).sort((a,b) => (a.at ?? 0) - (b.at ?? 0));
    const children = map.threads.filter(t => parents.get(t.id)?.threadId === id);
    const childrenAt = (point: string | null) => children.filter(t => {
      const source = parents.get(t.id)?.thoughtId;
      return point ? own.find(i => i.thoughts?.includes(source ?? ""))?.id === point : !source || !own.some(i => i.thoughts?.includes(source));
    }).map(t => thread(t.id, depth + 1));
    return <section key={id} className="inline-thread" data-inline-thread={id} style={{ marginLeft: depth > 0 && depth <= 2 ? 16 : 0 }}>
      <h2><button type="button" onClick={() => visit(id, own[0]?.thoughts?.[0] ?? null)}>{t.title}</button></h2>
      {parent?.label && (depth > 2 || !parent.thoughtId) && <p className="inline-parent">{depth > 2 ? `Parent: ${parent.label}` : parent.label}</p>}
      {childrenAt(null)}
      {own.map(item => <div key={item.key} className="inline-step"><InlinePoint data={data.get(item.key)!} />{childrenAt(item.id)}</div>)}
    </section>;
  };
  const roots = map.threads.filter(t => !parents.get(t.id)?.threadId);
  const content = roots.map(t => thread(t.id, 0));
  // A damaged cycle remains readable once, with no fabricated source.
  const remaining = map.threads.filter(t => !seen.has(t.id)).map(t => thread(t.id, 0));
  return <div ref={list} className="inline-phone" role="region" aria-label="Inline phone reading" tabIndex={-1}
    style={{ left: area.x0, top: area.y0, width: Math.max(0, area.x1-area.x0), height: Math.max(0, area.y1-area.y0) }}>
    {content}{remaining}
  </div>;
}
