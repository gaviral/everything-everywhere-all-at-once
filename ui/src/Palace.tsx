import { useMemo, useRef, type KeyboardEvent } from "react";
import type { Thread } from "./core";
import "./palace.css";

type Room = { root: Thread; members: Thread[] };

// Keep each family together, including malformed or temporarily orphaned data.
function makeRooms(threads: Thread[]): Room[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const children = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (thread.parent_id && byId.has(thread.parent_id) && thread.parent_id !== thread.id) {
      const group = children.get(thread.parent_id) ?? [];
      group.push(thread);
      children.set(thread.parent_id, group);
    }
  }
  const seen = new Set<string>();
  const rooms: Room[] = [];
  const addRoom = (root: Thread) => {
    if (seen.has(root.id)) return;
    const members: Thread[] = [];
    const visit = (thread: Thread) => {
      if (seen.has(thread.id)) return;
      seen.add(thread.id);
      members.push(thread);
      (children.get(thread.id) ?? []).forEach(visit);
    };
    visit(root);
    rooms.push({ root, members });
  };
  threads.filter((thread) => !thread.parent_id || !byId.has(thread.parent_id) || thread.parent_id === thread.id).forEach(addRoom);
  threads.forEach(addRoom);
  return rooms;
}

export function Palace({ threads, active, onOpen }: { threads: Thread[]; active: string | null; onOpen: (thread: Thread) => void }) {
  const rooms = useMemo(() => makeRooms(threads), [threads]);
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  const container = useRef<HTMLElement>(null);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const origin = event.currentTarget.getBoundingClientRect();
    const x = origin.left + origin.width / 2;
    const y = origin.top + origin.height / 2;
    const candidates = Array.from(container.current?.querySelectorAll<HTMLButtonElement>(".palace-tile") ?? []);
    let best: HTMLButtonElement | undefined;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate === event.currentTarget) continue;
      const rect = candidate.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - x;
      const dy = rect.top + rect.height / 2 - y;
      const forward = dx * direction[0] + dy * direction[1];
      if (forward <= 1) continue;
      const sideways = Math.abs(dx * direction[1] - dy * direction[0]);
      const score = forward + sideways * 2;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    best?.focus();
    best?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <main className="palace" ref={container} aria-label="Palace of threads">
      <div className="palace-intro">
        <div><span className="palace-eyebrow">A place for every thought</span><h1>Your palace</h1></div>
        <p>Explore by picture. Open a place to return to its thread.</p>
      </div>
      <p className="palace-keyboard">Use arrow keys to move between places · Enter to open</p>
      <div className="palace-rooms">
        {rooms.map(({ root, members }) => (
          <section className="palace-room" key={root.id} aria-label={`Room: ${root.title}`}>
            <div className="palace-room-heading"><span>{root.title}</span><span className="palace-room-rule" /><span>{members.length} {members.length === 1 ? "place" : "places"}</span></div>
            <div className="palace-grid">
              {members.map((thread) => {
                const isActive = active === thread.id;
                const parent = thread.id !== root.id && thread.parent_id ? byId.get(thread.parent_id) : undefined;
                return <button className={`palace-tile${isActive ? " is-active" : ""}`} key={thread.id} onClick={() => onOpen(thread)} onKeyDown={navigate} aria-describedby={`palace-point-${thread.id}`}>
                  <span className="palace-art">
                    {thread.picture ? <img src={thread.picture} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
                    <span className="palace-placeholder" aria-hidden="true"><span>✦</span></span>
                    <span className="palace-badges">{isActive && <span className="palace-badge active">Active</span>}{thread.status === "dropped" && <span className="palace-badge unfinished">Left off</span>}</span>
                    <span className="palace-point" id={`palace-point-${thread.id}`}><span>Last thought</span>{thread.last_point || "No point yet"}</span>
                  </span>
                  <span className="palace-title">{thread.title}</span>
                  <span className="palace-parent">{parent ? `Branch of ${parent.title}` : "Room"}</span>
                </button>;
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
