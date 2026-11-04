// Where bricks show in the app (docs/bricks.md): each kind in its place, each brick's code loaded only once it's on,
// and each behind a boundary of its own, so a brick that breaks says so in one line, with its switch, while the rest
// of the page carries on. The playground (bricks/playground.tsx) mounts a brick the same way, against a sample map.
import { Component, lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActedBy, BrickActions, BrickEvents, BrickInfo, BrickKind, BrickOn, BrickProps, MapSnapshot } from "./bricks/contract";
import { useBrickRegistry, brickEvents, captureSourcesOf, landingWatcher, senders, snapshotOf, isOn, switchBrick, useBricksOn, type Brick } from "./bricks-core";
import { onReading } from "./apps-audio";
import type { Capture, Thought, UsageSnapshot, World } from "./core";
import { hearFrom, watchPoint } from "./guide-core";
import { placedBy, watchDecided } from "./route";
import { moveToTopic, renameTopic } from "./topics-core";
import { watchSpeaking } from "./talk/call-core";
import { useReadPosition } from "./talk/read";
import { useJobs } from "./work-jobs";
import { builtInOn, useBuiltInsOn } from "./shell/features";
import { PluginStateContext } from "./bricks/contract";
import { savedState } from "./plugin-store";
import { attachStyle, keepStyles, report } from "./plugins-core";
import "./bricks.css";

/** What every brick on the page is handed (contract.ts `BrickProps`, but its own brick.json): the map, `on`, and its
 *  own actions (`actionsFor`), which know which brick asks (a thought it adds lands `by` it; its hint carries its name). */
export type BrickHost = { map: MapSnapshot; on: BrickOn; actionsFor: (info: BrickInfo) => BrickActions; destination?: BrickProps["destination"] };

/** The app's side of the actions (App.tsx, the playground): a brick's own, and for `hint`, the brick's name to show. A
 *  topic's rename or a move goes to the core by itself (topics-core.ts) unless the host answers it (the playground). */
export type HostActions = Omit<BrickActions, "hint" | "renameTopic" | "moveToTopic" | "readThought"> & { hint(text: string, target: string | null, by: string): boolean }
  & Partial<Pick<BrickActions, "renameTopic" | "moveToTopic">> & { recipesEnabled?: () => boolean };

/** How long a landing whose model is still to be told waits for it (its route comes right after its changes, so a few
 *  milliseconds as a rule; this bounds a route lost to a reconnect). */
const MODEL_WAIT_MS = 1000;

/** This window's host: the map from its world (`revision`: the core's snapshot count, so a reconnect's catch-up isn't
 *  taken for landings) with this window's live words (`partial`: a new map with each word heard; the arrays stay the
 *  same, so a brick that works from them redoes nothing) and the helpers' jobs (work-jobs.ts: a new map with each
 *  job that comes), the app's own actions (`act`, the latest each render, behind
 *  actions that keep their identity), and events: landings seen here (with the model that placed each, from its route,
 *  and who added it), your words as they change, the mic's loudness as the core is sent it (apps-audio.ts), what the
 *  guide points at and who has the floor in a call. `emit` is for the window's own events (App.tsx's notices and asks; it says how many heard one); a
 *  brick is handed only map, actions and on (BrickMount). */
export function useBrickHost(world: World, revision: number, me: string, connected: boolean, rooms: ReadonlyMap<string, string>, partial: string, act: HostActions, destination?: BrickProps["destination"], usage: UsageSnapshot | null = null, placingUnavailable = false, captureContext?: { mapKey: string | null; confirmedMapKey?: string | null; captures: readonly Capture[] }): BrickHost & Pick<ReturnType<typeof brickEvents>, "emit"> {
  const jobs = useJobs();
  const builtIns = useBuiltInsOn();
  const conversationSpine = builtIns.has("conversation-spine");
  const reviewTextEdits = builtIns.has("review-text-edits");
  const comparePhoneReading = builtIns.has("compare-phone-reading");
  const terse = builtIns.has("terse");
  const partnerOn = builtIns.has("partner");
  const looseTopics = builtIns.has("loose-topics");
  const rotateCanvas = builtIns.has("rotate-canvas");
  const snapshot = useMemo(() => snapshotOf(world, me, connected, rooms, partial, jobs, usage, reviewTextEdits), [world, me, connected, rooms, partial, jobs, usage, reviewTextEdits]);
  const captureSources = useMemo(() => captureSourcesOf(captureContext?.captures ?? []), [captureContext?.captures]);
  const reading = useReadPosition(snapshot);
  const map = useMemo(() => ({ ...snapshot, mapIdentity: captureContext?.confirmedMapKey ?? null, captureSources, visitKey: JSON.stringify([captureContext?.mapKey ?? revision, me]), readThrough: reading.mark, conversationSpine, comparePhoneReading, terse, partnerOn, looseTopics, rotateCanvas, placingUnavailable, pauses: world.pauses ?? [] }), [snapshot, captureSources, captureContext?.confirmedMapKey, captureContext?.mapKey, revision, me, reading.mark, conversationSpine, comparePhoneReading, terse, partnerOn, looseTopics, rotateCanvas, placingUnavailable, world.pauses]);
  const read = useRef(reading.read);
  read.current = reading.read;
  const latest = useRef(act);
  useLayoutEffect(() => { latest.current = act; });
  const [sends] = useState(senders);
  // Each brick's own actions, made once and kept: the same object for as long as the page runs.
  const made = useRef(new Map<string, BrickActions>());
  const actionsFor = useMemo(() => (info: BrickInfo): BrickActions => {
    let actions = made.current.get(info.id);
    if (!actions) made.current.set(info.id, actions = {
      imageEvidence:request=>info.id==="image-evidence"?latest.current.imageEvidence?.(request)??Promise.resolve({request_id:request.request_id,ok:false,message:"Image evidence unavailable.",data:null}):Promise.resolve({request_id:request.request_id,ok:false,message:"Image evidence unavailable.",data:null}),
      saveChoice: request => info.id === "choice-map" ? latest.current.saveChoice?.(request) ?? Promise.resolve({request_id:request.request_id,ok:false,message:"Choice map unavailable."}) : Promise.resolve({request_id:request.request_id,ok:false,message:"Choice map unavailable."}),
      research: (request) => info.id === "question-research" && isOn(info.id) ? latest.current.research(request) : Promise.resolve({ request_id: request.request_id, ok: false, message: "Research this question is off.", answer: null }),
      cancelResearch: () => { if (info.id === "question-research") latest.current.cancelResearch(); },
      setActionEstimate: (request) => latest.current.setActionEstimate?.(request) ?? Promise.resolve({ request_id: request.request_id, ok: false, message: "Action estimates is unavailable.", estimate: null }),
      exportRecipe: (app) => {
        if (info.id !== "app-recipes" || !(isOn(info.id) || latest.current.recipesEnabled?.())) throw Error("App recipes is off.");
        return latest.current.exportRecipe(app);
      },
      appConnection: request => info.id === "app-connections" && isOn(info.id) && latest.current.appConnection
        ? latest.current.appConnection(request) : Promise.resolve({ request_id: "", plans: [], play: false, message: "App connections is off." }),
      saveRecipe: (save) => info.id === "app-recipes" && (isOn(info.id) || latest.current.recipesEnabled?.()) ? latest.current.saveRecipe(save)
        : Promise.resolve({ request_id: save.request_id, app_id: null, message: "App recipes is off." }),
      saveTextFile: (name, text, mime) => {
        if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(name) || name.includes("..")
          || typeof text !== "string" || new TextEncoder().encode(text).length > 64 * 1024
          || (mime !== "text/plain" && mime !== "text/markdown" && !(info.id === "app-recipes" && (isOn(info.id) || latest.current.recipesEnabled?.()) && mime === "application/json" && name === "app-recipe.json" && new TextEncoder().encode(text).length <= 32 * 1024))) return false;
        try { return latest.current.saveTextFile(name, text, mime); } catch { return false; }
      },
      saveQuestion: (input, receive) => latest.current.saveQuestion(input, receive),
      reviewPoint: (ids, focus) => { if (builtInOn("review-text-edits")) latest.current.reviewPoint(ids, focus); },
      voiceShortcut: request => latest.current.voiceShortcut(request),
      readThought: (id) => read.current(id),
      holdFlowQuestion: (id, ask) => latest.current.holdFlowQuestion?.(id, ask),
      dropFlowQuestion: id => latest.current.dropFlowQuestion?.(id),
      flowPause: () => latest.current.flowPause?.() ?? Infinity,
      resume: (id, keyboard) => latest.current.resume?.(id, keyboard) ?? false,
      addThought: (text) => {
        const sent = latest.current.addThought(text);
        if (sent) sends.sent(text, info);
        return sent;
      },
      openPoint: (thread, thought) => latest.current.openPoint(thread, thought),
      openThread: (id) => latest.current.openThread(id),
      openThought: (id) => latest.current.openThought(id),
      closeView: () => latest.current.closeView(),
      select: (id) => latest.current.select(id),
      notify: (text) => latest.current.notify(text),
      position: (id, x, y) => latest.current.position(id, x, y),
      listen: (on) => latest.current.listen(on),
      annotate: (thoughtId, quote, text, context) => latest.current.annotate(thoughtId, quote, text, context),
      openCatalog: (id) => latest.current.openCatalog(id),
      hint: (text, target) => latest.current.hint(text, target ?? null, info.name),
      renameTopic: (from, to) => (latest.current.renameTopic ?? renameTopic)(from, to),
      moveToTopic: (threadId, topic) => (latest.current.moveToTopic ?? moveToTopic)(threadId, topic),
    });
    return actions;
  }, [sends]);
  const [events] = useState(brickEvents);
  const on = useMemo<BrickOn>(() => (name, listener, consumer) => name === "loudness" ? onReading(listener as (level: number) => void) : events.on(name, listener, consumer), [events]);
  // The guide hears what the bricks hear (your words: a caption steps back when you talk over it, a held question
  // waits for your pause).
  useEffect(() => hearFrom(on), [on]);

  // Landings, each with who added it and, once its route has said, the model that placed it.
  const [landings] = useState(landingWatcher);
  const lastRevision = useRef(revision);
  const thoughtsNow = useRef(world.thoughts);
  thoughtsNow.current = world.thoughts;
  const waiting = useRef(new Map<string, { landing: Omit<BrickEvents["landed"], "model">; timer: number }>());
  useEffect(() => {
    if (lastRevision.current !== revision) { events.clearReplay(); lastRevision.current = revision; }
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

  return useMemo(() => ({ map, on, actionsFor, emit: events.emit, destination }), [map, on, actionsFor, events, destination]);
}

/** One brick in its kind's place: a view in the map's (padded clear of the dock, as the Palace is), a card in the
 *  dock (its height counted with the dock's cards, so a thought just shown moves clear of it), a panel or an input
 *  wherever it places itself. Only a new map, a switch or a new action re-renders it, not the page's clock. */
export const BrickMount = memo(function BrickMount({ brick, host, onReady }: { brick: Brick; host: BrickHost; onReady?(id: string): void }) {
  const detachStyles = useRef<(() => void) | null>(null);
  const Shown = useMemo(() => lazy(async () => {
    const module = await brick.load();
    if (!owned.signal.aborted && module.styles) { keepStyles(brick.info.id, module.styles); detachStyles.current?.(); detachStyles.current = attachStyle(brick.info.id); }
    return module;
  }), [brick]);
  const pluginsOn = useBuiltInsOn().has("plugins");
  const scope = `${location.host}:${host.map.visitKey ?? "local"}:${brick.info.id}`;
  const rawState = useMemo(() => pluginsOn ? savedState(scope) : null, [scope, pluginsOn]);
  const owned = useMemo(() => {
    let controller = new AbortController();
    const cleanups = new Set<() => void>();
    const cleanup = (fn: () => void) => {
      let active = true;
      const release = () => { if (!active) return; active = false; cleanups.delete(release); fn(); };
      if (controller.signal.aborted) release(); else cleanups.add(release);
      return release;
    };
    return { get signal() { return controller.signal; }, cleanup, start() { if (controller.signal.aborted) controller = new AbortController(); }, stop() { controller.abort(); for (const fn of cleanups) { try { fn(); } catch { /* release remaining resources */ } } cleanups.clear(); } };
  }, [brick]);
  const state = useMemo(() => rawState ? { scope: rawState.scope, get: rawState.get, subscribe: rawState.subscribe, set<T>(key: string, value: T) { if (!owned.signal.aborted) rawState.set(key, value); } } : null, [rawState, owned]);
  const actions = useMemo(() => Object.fromEntries(Object.entries(host.actionsFor(brick.info)).map(([key, fn]) => [key, (...args: unknown[]) => !owned.signal.aborted && (fn as (...args: unknown[]) => unknown)(...args)])) as unknown as BrickActions, [host.actionsFor, brick, owned]);
  const on = useMemo<BrickOn>(() => (name, listener, consumer) => {
    if (owned.signal.aborted) return () => {};
    const signal = owned.signal;
    return owned.cleanup(host.on(name, ((value: never) => { if (!signal.aborted) (listener as (value: never) => void)(value); }) as typeof listener, consumer));
  }, [host.on, owned]);
  useLayoutEffect(() => {
    owned.start();
    report(brick.info.id, "Loading");
    detachStyles.current = attachStyle(brick.info.id);
    return () => { report(brick.info.id, "Unloading"); owned.stop(); detachStyles.current?.(); report(brick.info.id, "Unloaded"); };
  }, [brick, owned]);
  const { info } = brick;
  const inner = <PluginStateContext.Provider value={state}><BrickBoundary info={info} failure={() => { owned.stop(); detachStyles.current?.(); }}><Suspense fallback={null}><Loaded id={info.id}><Shown map={host.map} actions={actions} on={on} brick={info} state={state ?? undefined} lifetime={owned} destination={host.destination} /></Loaded>{onReady && <BrickCommitted id={info.id} onReady={onReady} />}</Suspense></BrickBoundary></PluginStateContext.Provider>;
  if (info.kind === "view") return <main className="brick-view" aria-label={info.name} data-brick={info.id}>{inner}</main>;
  if (info.kind === "card") return <div className="brick-card" data-brick={info.id} data-dock-card>{inner}</div>;
  return <div className="brick-float" data-brick={info.id}>{inner}</div>;
});

/** Commit notification lives inside Suspense; a loading fallback cannot emit it.
 *  It renders no DOM, so an empty component cannot satisfy a content assertion. */
function BrickCommitted({ id, onReady }: { id: string; onReady(id: string): void }) {
  useLayoutEffect(() => { onReady(id); }, [id, onReady]);
  return null;
}

function Loaded({ id, children }: { id: string; children: ReactNode }) {
  useEffect(() => { report(id, "Loaded"); }, [id]);
  return children;
}

/** Every brick of `kind` that's on, in the Catalog's order. With none on, nothing at all. */
export const BrickSlot = memo(function BrickSlot({ kind, host }: { kind: BrickKind; host: BrickHost }) {
  const BRICKS = useBrickRegistry();
  const on = useBricksOn();
  return <>{BRICKS.filter((brick) => brick.info.kind === kind && on.has(brick.info.id)).map((brick) => <BrickMount key={brick.info.id} brick={brick} host={host} />)}</>;
});

/** A brick that throws shows one quiet line with a way to switch it off, not the page's "Something broke" (Crash.tsx). */
class BrickBoundary extends Component<{ info: BrickInfo; failure: () => void; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: unknown) {
    this.props.failure();
    report(this.props.info.id, "Failed", String(error));
    console.warn(`The ${this.props.info.name} feature stopped:`, error);
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
