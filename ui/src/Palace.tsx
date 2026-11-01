import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { capitalized, firstLetter, type Thread } from "./core";
import { leftBy, useMe } from "./room";
import { roomColors, roomStyle } from "./rooms";
import "./palace.css";

type Room = { root: Thread; members: Thread[] };

// The core writes a 512 px copy beside the map's 128 px one, named alike, so tiles stay sharp at Palace size.
const palaceCopy = (picture: string) => picture.replace(/-small\.webp$/, "-palace.webp");

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
  const me = useMe();
  const rooms = useMemo(() => makeRooms(threads), [threads]);
  const colors = useMemo(() => roomColors(threads), [threads]);
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  const container = useRef<HTMLElement>(null);
  // Before the first paint, the Palace opens at its own top, right under the map tools, as a page of its own would.
  // Left where the map was, the apps above pushed its last row under the dock (map at its top, 1440×900), or a
  // scrolled map hid its heading under the tools.
  useLayoutEffect(() => {
    const palace = container.current;
    if (!palace) return;
    const tools = document.querySelector<HTMLElement>(".map-tools");
    const toolsBottom = tools ? parseFloat(getComputedStyle(tools).top) + tools.offsetHeight : 0;
    window.scrollTo({ top: window.scrollY + palace.getBoundingClientRect().top - toolsBottom, behavior: "instant" });
    palace.querySelector<HTMLButtonElement>(".palace-tile")?.focus();
  }, []);
  // A thread that gets its first branch (or loses its last) moves to another section, so React mounts a new tile
  // for it and focus falls to the page: the new tile takes it back, so the arrow keys and Enter keep working.
  const focused = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const was = focused.current;
    if (!was || was.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
    const now = Array.from(container.current?.querySelectorAll<HTMLButtonElement>(".palace-tile") ?? []).find((tile) => tile.dataset.thread === was.dataset.thread);
    now?.focus({ preventScroll: true });
    now?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rooms]);

  // Where a tile's picture sits: a square as wide as the tile, at its top. Pictures in a row are level whatever the
  // captions under them, so a taller neighbour never counts as above or below. Taken from the tile, not the picture's
  // own box, which hover and focus lift by 3 px.
  const spot = (tile: HTMLElement) => {
    const rect = tile.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.width / 2 };
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const { x, y } = spot(event.currentTarget);
    const candidates = Array.from(container.current?.querySelectorAll<HTMLButtonElement>(".palace-tile") ?? []);
    let best: HTMLButtonElement | undefined;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate === event.currentTarget) continue;
      const at = spot(candidate);
      const dx = at.x - x;
      const dy = at.y - y;
      const forward = dx * direction[0] + dy * direction[1];
      if (forward <= 1) continue;
      const sideways = Math.abs(dx * direction[1] - dy * direction[0]);
      const score = forward + sideways * 2;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    best?.focus();
    best?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const tile = (thread: Thread, root: Thread) => {
    const isActive = active === thread.id;
    const parent = thread.id !== root.id && thread.parent_id ? byId.get(thread.parent_id) : undefined;
    // The room's heading already names its root, so only a branch of a branch says where it hangs.
    const under = parent && parent.id !== root.id ? parent : undefined;
    return <button className={`palace-tile${isActive ? " is-active" : ""}`} key={thread.id} data-thread={thread.id} style={roomStyle(colors.get(root.id))} onClick={() => onOpen(thread)} onKeyDown={navigate} onFocus={(event) => { focused.current = event.currentTarget; }} aria-describedby={thread.last_point ? `palace-point-${thread.id}` : undefined}>
      <span className="palace-art">
        {thread.picture ? <img src={palaceCopy(thread.picture)} alt="" loading="lazy" onError={(event) => {
          // A map that has no Palace copy (a shipped sample's older pictures) shows the map's copy instead.
          const img = event.currentTarget;
          if (img.dataset.small) img.hidden = true; else { img.dataset.small = "1"; img.src = thread.picture!; }
        }} /> : null}
        <span className="palace-placeholder" aria-hidden="true"><span>{firstLetter(thread.title)}</span></span>
        <span className="palace-badges">{isActive && <span className="palace-badge active">Active</span>}{thread.status === "dropped" && <span className="palace-badge unfinished">{leftBy(thread, me) ? `${leftBy(thread, me)} left off` : "Left off"}</span>}</span>
      </span>
      <span className="palace-title">{thread.title}</span>
      {/* Under the title, never over the picture; read as the tile's description, not its name. */}
      {thread.last_point && <span className="palace-point" id={`palace-point-${thread.id}`} aria-hidden="true">{capitalized(thread.last_point)}</span>}
      {under && <span className="palace-parent">Branch of {under.title}</span>}
    </button>;
  };
  // Rooms with branches come first; threads on their own share one grid under their own heading after them,
  // so a lone tile never reads as one more place in the room above it.
  const branched = rooms.filter((room) => room.members.length > 1);
  const alone = rooms.filter((room) => room.members.length === 1);

  return (
    <main className="palace" ref={container} aria-label="Palace of threads">
      <div className="palace-intro">
        <div><span className="palace-eyebrow">A picture for every thread</span><h1>Your palace</h1></div>
        <p>Open a picture to return to its thread.</p>
      </div>
      <div className="palace-rooms">
        {branched.map(({ root, members }) => (
          <section className="palace-room" key={root.id} aria-label={`Room: ${root.title}`} style={roomStyle(colors.get(root.id))}>
            <div className="palace-room-heading"><span>{root.title}</span><span className="palace-room-rule" /><span>{members.length} threads</span></div>
            <div className="palace-grid">{members.map((thread) => tile(thread, root))}</div>
          </section>
        ))}
        {alone.length > 0 && (
          <section className="palace-room" aria-label="Threads on their own">
            {/* The heading sets them apart from the rooms above; with no rooms, it would say nothing. */}
            {branched.length > 0 && <div className="palace-room-heading"><span>On their own</span><span className="palace-room-rule" /><span>{alone.length} {alone.length === 1 ? "thread" : "threads"}</span></div>}
            <div className="palace-grid">{alone.map(({ root }) => tile(root, root))}</div>
          </section>
        )}
      </div>
    </main>
  );
}
