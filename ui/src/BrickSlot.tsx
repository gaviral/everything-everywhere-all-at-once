// Where bricks show in the app (docs/bricks.md): each kind in its place, each brick's code loaded only once it's on,
// and each behind a boundary of its own, so a brick that breaks says so in one line, with its switch, while the rest
// of the page carries on. The playground (bricks/playground.tsx) mounts a brick the same way, against a sample map.
import { Component, lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { ActedBy, BrickActions, BrickEvents, BrickInfo, BrickKind, BrickOn, BrickProps, MapSnapshot } from "./bricks/contract";
import { BRICKS, brickEvents, landingWatcher, senders, snapshotOf, switchBrick, useBricksOn, type Brick } from "./bricks-core";
import { onReading } from "./apps-audio";
import type { Thought, World } from "./core";
import { hearFrom, watchPoint } from "./guide-core";
import { placedBy, watchDecided } from "./route";
import { moveToTopic, renameTopic } from "./topics-core";
import { watchSpeaking } from "./talk/call-core";
import "./bricks.css";

/** What every brick on the page is handed (contract.ts `BrickProps`, but its own brick.json): the map, `on`, and its
 *  own actions (`actionsFor`), which know which brick asks (a thought it adds lands `by` it; its hint carries its name). */
export type BrickHost = { map: MapSnapshot; on: BrickOn; actionsFor: (info: BrickInfo) => BrickActions };

/** The app's side of the actions (App.tsx, the playground): a brick's own, and for `hint`, the brick's name to show. A
 *  topic's rename or a move goes to the core by itself (topics-core.ts) unless the host answers it (the playground). */
export type HostActions = Omit<BrickActions, "hint" | "renameTopic" | "moveToTopic"> & { hint(text: string, target: string | null, by: string): boolean }
  & Partial<Pick<BrickActions, "renameTopic" | "moveToTopic">>;

/** How long a landing whose model is still to be told waits for it (its route comes right after its changes, so a few
 *  milliseconds as a rule; this bounds a route lost to a reconnect). */
const MODEL_WAIT_MS = 1000;

/** This window's host: the map from its world (`revision`: the core's snapshot count, so a reconnect's catch-up isn't
 *  taken for landings) with this window's live words (`partial`: a new map with each word heard; the arrays stay the
 *  same, so a brick that works from them redoes nothing), the app's own actions (`act`, the latest each render, behind
 *  actions that keep their identity), and events: landings seen here (with the model that placed each, from its route,
 *  and who added it), your words as they change, the mic's loudness as the core is sent it (apps-audio.ts), what the
 *  guide points at and who has the floor in a call. `emit` is for the window's own events (App.tsx's notices and asks; it says how many heard one); a
 *  brick is handed only map, actions and on (BrickMount). */
export function useBrickHost(world: World, revision: number, me: string, connected: boolean, rooms: ReadonlyMap<string, string>, partial: string, act: HostActions): BrickHost & Pick<ReturnType<typeof brickEvents>, "emit"> {
  const map = useMemo(() => snapshotOf(world, me, connected, rooms, partial), [world, me, connected, rooms, partial]);
  const latest = useRef(act);
  useLayoutEffect(() => { latest.current = act; });
  const [sends] = useState(senders);
  // Each brick's own actions, made once and kept: the same object for as long as the page runs.
  const made = useRef(new Map<string, BrickActions>());
  const actionsFor = useMemo(() => (info: BrickInfo): BrickActions => {
    let actions = made.current.get(info.id);
    if (!actions) made.current.set(info.id, actions = {
      addThought: (text) => {
        const sent = latest.current.addThought(text);
        if (sent) sends.sent(text, info);
        return sent;
      },
      openThread: (id) => latest.current.openThread(id),
      select: (id) => latest.current.select(id),
      notify: (text) => latest.current.notify(text),
      position: (id, x, y) => latest.current.position(id, x, y),
      listen: (on) => latest.current.listen(on),
      annotate: (thoughtId, quote, text) => latest.current.annotate(thoughtId, quote, text),
      openCatalog: (id) => latest.current.openCatalog(id),
      hint: (text, target) => latest.current.hint(text, target ?? null, info.name),
      renameTopic: (from, to) => (latest.current.renameTopic ?? renameTopic)(from, to),
      moveToTopic: (threadId, topic) => (latest.current.moveToTopic ?? moveToTopic)(threadId, topic),
    });
    return actions;
  }, [sends]);
  const [events] = useState(brickEvents);
  const on = useMemo<BrickOn>(() => (name, listener) => name === "loudness" ? onReading(listener as (level: number) => void) : events.on(name, listener), [events]);
  // The guide hears what the bricks hear (your words: a caption steps back when you talk over it, a held question
  // waits for your pause).
  useEffect(() => hearFrom(on), [on]);

  // Landings, each with who added it and, once its route has said, the model that placed it.
  const [landings] = useState(landingWatcher);
  const thoughtsNow = useRef(world.thoughts);
  thoughtsNow.current = world.thoughts;
  const waiting = useRef(new Map<string, { landing: Omit<BrickEvents["landed"], "model">; timer: number }>());
  useEffect(() => {
    sends.see(world.thoughts, me, Date.now(), revision);
    for (const thought of landings(world.thoughts, revision)) {
      const brick = sends.by(thought.id);
      const by: ActedBy = brick ? { kind: "brick", id: brick.id, name: brick.name } : { kind: "person", name: thought.speaker };
      const landing = { thoughtId: thought.id, threadId: thought.thread_id!, mine: thought.speaker === me, ms: thought.place_ms ?? null, by };
      const placed = placedBy(thought.id);
      if (placed !== "weighing") { events.emit("landed", { ...landing, model: placed?.model ?? null }); continue; }
      const timer = window.setTimeout(() => { waiting.current.delete(thought.id); events.emit("landed", { ...landing, model: null }); }, MODEL_WAIT_MS);
      waiting.current.set(thought.id, { landing, timer });
    }
  }, [world.thoughts, me, revision, landings, events, sends]);
  useEffect(() => {
    const held = waiting.current;
    const stop = watchDecided((thoughtId, model) => {
      const wait = held.get(thoughtId);
      if (!wait) return;
      window.clearTimeout(wait.timer);
      held.delete(thoughtId);
      events.emit("landed", { ...wait.landing, model });
    });
    return () => { stop(); for (const wait of held.values()) window.clearTimeout(wait.timer); held.clear(); };
  }, [events]);

  // Your words, each time they change.
  const wordsSaid = useRef(partial);
  useEffect(() => {
    if (partial === wordsSaid.current) return;
    wordsSaid.current = partial;
    events.emit("words", partial);
  }, [partial, events]);

  // Who has the floor in a call, each time it changes (talk/call-core.ts, as the core says).
  const meNow = useRef(me);
  meNow.current = me;
  useEffect(() => watchSpeaking(({ speaker, on }) => { events.emit("speaking", { speaker, on, mine: speaker === meNow.current }); }), [events]);

  // What the guide points at: a thought or a thread, with a point's thread, as the map holds them now.
  useEffect(() => watchPoint((point) => {
    if (!point) { events.emit("pointing", null); return; }
    const named = point.target.slice(point.target.indexOf(":") + 1);
    const thoughtId = point.target.startsWith("point:") ? named : undefined;
    const threadId = point.target.startsWith("thread:") ? named : thoughtsNow.current.find((t: Thought) => t.id === thoughtId)?.thread_id ?? undefined;
    events.emit("pointing", { target: point.target, by: point.by, ...(thoughtId ? { thoughtId } : {}), ...(threadId ? { threadId } : {}) });
  }), [events]);

  return useMemo(() => ({ map, on, actionsFor, emit: events.emit }), [map, on, actionsFor, events]);
}

const components = new Map<string, LazyExoticComponent<ComponentType<BrickProps>>>();
function componentOf(brick: Brick) {
  let component = components.get(brick.info.id);
  if (!component) components.set(brick.info.id, component = lazy(brick.load));
  return component;
}

/** One brick in its kind's place: a view in the map's (padded clear of the dock, as the Palace is), a card in the
 *  dock (its height counted with the dock's cards, so a thought just shown moves clear of it), a panel or an input
 *  wherever it places itself. Only a new map, a switch or a new action re-renders it, not the page's clock. */
export const BrickMount = memo(function BrickMount({ brick, host }: { brick: Brick; host: BrickHost }) {
  const Shown = componentOf(brick);
  const { info } = brick;
  const inner = <BrickBoundary info={info}><Suspense fallback={null}><Shown map={host.map} actions={host.actionsFor(info)} on={host.on} brick={info} /></Suspense></BrickBoundary>;
  if (info.kind === "view") return <main className="brick-view" aria-label={info.name} data-brick={info.id}>{inner}</main>;
  if (info.kind === "card") return <div className="brick-card" data-brick={info.id} data-dock-card>{inner}</div>;
  return <div className="brick-float" data-brick={info.id}>{inner}</div>;
});

/** Every brick of `kind` that's on, in the Catalog's order. With none on, nothing at all. */
export const BrickSlot = memo(function BrickSlot({ kind, host }: { kind: BrickKind; host: BrickHost }) {
  const on = useBricksOn();
  return <>{BRICKS.filter((brick) => brick.info.kind === kind && on.has(brick.info.id)).map((brick) => <BrickMount key={brick.info.id} brick={brick} host={host} />)}</>;
});

/** A brick that throws shows one quiet line with a way to switch it off, not the page's "Something broke" (Crash.tsx). */
class BrickBoundary extends Component<{ info: BrickInfo; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(`The ${this.props.info.name} brick stopped:`, error);
  }

  render() {
    if (!this.state.broken) return this.props.children;
    const { info } = this.props;
    const floating = info.kind === "panel" || info.kind === "input";
    return <p className={floating ? "brick-broke brick-broke-floating" : "brick-broke"} role="status">
      <span>{info.name} stopped working.</span>
      <button type="button" onClick={() => switchBrick(info.id, false)}>Switch it off</button>
    </p>;
  }
}
