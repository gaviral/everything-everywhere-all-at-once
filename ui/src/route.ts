// Live routing: the map shows a placement deciding, as the core tells it (`ServerMsg::Route`, core/src/placer.rs).
// While the calls race, the threads the prompt names light up (the model reads every thread; these are the ones the
// prompt singles out, so nothing here guesses the answer). Once the thought is on the map, the path to it settles:
// a branch's top thread first, then the branch, with the reason it went there or the rule that put it there.
// Pure rules here (scripts/route-check.mjs holds them); the store and hooks below; App.tsx draws them on the cards.
import { useSyncExternalStore } from "react";
import { modelName } from "./model-line";

/** A thread the prompt names, and why: "active", "said just before", "left unfinished", "just asked". */
export type Candidate = { thread_id: string; why: string };
export type Weighing = { stage: "weighing"; thought_id: string; candidates: Candidate[]; lanes: number };
export type Decided = {
  stage: "decided"; thought_id: string; path: string[]; new: boolean; skipped: boolean;
  pick: { action: string; thread_id: string }; rule: string | null; why: string; lane: number; lanes: number; ms: number;
  /** The model the winning lane asked (each lane may ask its own, core/src/placer.rs `MODELS`); absent from an older core. */
  model?: string;
};
export type RouteMsg = { type: "route"; route: Weighing | Decided };

export interface RouteState { weighing: Weighing | null; landed: { decided: Decided; until: number } | null }
export const EMPTY_ROUTE: RouteState = { weighing: null, landed: null };

/** Reading speed: 200 words a minute (≈ 3.3 a second, as the model line's hold, model-line.ts `HOLD_MS`). */
export const READ_MS_PER_WORD = 300;
/** Time to notice something changed before reading it (the model line's hold uses the same second). */
export const NOTICE_MS = 1000;
/** A branch's card settles one fixation after its top thread's (a fixation is ≈ 200–250 ms), so the eye follows the
 *  path down; the thought's own flight (a spring of ≈ 0.4 s) is still moving then, so the path adds no wait. */
export const LEVEL_MS = 200;

/** How long the landing's tag stays: the time to notice it and read it. A newer thought's landing replaces it sooner;
 *  a newer thought's weighing doesn't (a turn said in two parts weighs the second 0 ms after the first lands). */
export function holdMs(text: string): number {
  return NOTICE_MS + READ_MS_PER_WORD * text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The landing's tag: where it went, and the rule when one put it somewhere other than the model's pick. The model's
 *  own reason is the point's "Why here" already (its note), so the tag stays one short line on a card's edge. */
export function landTag(d: Decided): string {
  const where = d.new ? (d.path.length > 1 ? "new tangent" : "new topic") : "here";
  return d.rule ? `${where} · rule: ${d.rule}` : where;
}

/** The tag's tooltip and screen-reader words: the model's reason, then the race (how many calls went, which model gave
 *  the first good answer, how long it took). */
export function raceLine(d: Decided): string {
  const secs = `${(d.ms / 1000).toFixed(1)} s`;
  const by = d.model ? ` (${modelName(d.model)})` : "";
  const race = d.lanes > 1 ? `First good answer of ${d.lanes} calls${by}, in ${secs}` : `Answered${by} in ${secs}`;
  return d.why ? `${d.why[0].toUpperCase()}${d.why.slice(1)}. ${race}` : race;
}

/** The state after a route message, at `now`. A newer thought's weighing lights its candidates while the last landing's
 *  tag stays until read; its landing takes over from it. */
export function routed(state: RouteState, route: Weighing | Decided, now: number): RouteState {
  if (route.stage === "weighing") return { weighing: route, landed: state.landed };
  const weighing = state.weighing?.thought_id === route.thought_id ? null : state.weighing;
  if (route.skipped || route.path.length === 0) return { weighing, landed: null };
  return { weighing, landed: { decided: route, until: now + holdMs(landTag(route)) } };
}

/** The core's `placing`: a weighing whose thought is no longer the one being placed (it failed a try and waits, or
 *  the line stopped) lights nothing. */
export function placingNow(state: RouteState, now: string | null): RouteState {
  return state.weighing && state.weighing.thought_id !== now ? { ...state, weighing: null } : state;
}

/** What a card shows: `candidate` (the prompt names it while the calls race), `here` (the thought just landed on it),
 *  `via` (the top thread of the branch it landed on); `deep` when `here` is a branch, so it settles after `via`. */
export type Mark = { kind: "candidate" | "here" | "via"; tag: string | null; title: string | null; deep: boolean };

/** `own`: the window's own active thread (`active_by[me] ?? active`). */
export function markFor(state: RouteState, threadId: string, now: number, own: string | null = null): Mark | null {
  const landed = state.landed && now < state.landed.until ? state.landed : null;
  const path = landed?.decided.path ?? [];
  // The landing's tag stays until read, though the next thought already weighs this card (it's the active one now).
  if (landed && path.at(-1) === threadId) return { kind: "here", tag: landTag(landed.decided), title: raceLine(landed.decided), deep: path.length > 1 };
  const c = state.weighing?.candidates.find((c) => c.thread_id === threadId);
  // Your own active needs no tag: the card's chip says it. In a room another speaker's active has no chip here.
  if (c) return { kind: "candidate", tag: c.why === "active" && threadId === own ? null : c.why, title: null, deep: false };
  if (path.length > 1 && path[0] === threadId) return { kind: "via", tag: null, title: null, deep: false };
  return null;
}

/** The lanes racing for this thought, while they run; 0 when none is. */
export function lanesFor(state: RouteState, thoughtId: string): number {
  return state.weighing?.thought_id === thoughtId ? state.weighing.lanes : 0;
}

// The store: one per window, fed by core.ts's socket, read by the cards and the pending pill.
let state = EMPTY_ROUTE;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function set(next: RouteState) {
  if (next === state) return;
  state = next;
  clearTimeout(timer);
  // The landing's tag gives way once read.
  if (state.landed) timer = setTimeout(notify, Math.max(0, state.landed.until - Date.now()) + 20);
  notify();
}

// What placed each thought lately, for the bricks' `landed` (BrickSlot.tsx): the model whose answer placed it, by
// thought id, and the thoughts whose calls went (a decided route follows each, sent once its changes are on the map).
// The newest only: a landing asks within a moment of its route.
const KEPT = 200;
const models = new Map<string, string | null>();
const weighed = new Set<string>();
const decidedWatchers = new Set<(thoughtId: string, model: string | null) => void>();
const keep = <T>(kept: Map<string, T> | Set<string>) => { if (kept.size > KEPT) kept.delete(kept.keys().next().value!); };

/** What placed thought `id`: its model's name ("Muse Spark 1.3"; null when the core didn't say), "weighing" while its
 *  calls run and its decided route hasn't come, or null when no route was heard (a rule placed it, or it came before
 *  this window connected). */
export function placedBy(id: string): { model: string | null } | "weighing" | null {
  if (models.has(id)) return { model: models.get(id) ?? null };
  return weighed.has(id) ? "weighing" : null;
}

/** Calls `listener` with each thought's decided route as it comes; returns the way to stop. */
export function watchDecided(listener: (thoughtId: string, model: string | null) => void) {
  decidedWatchers.add(listener);
  return () => { decidedWatchers.delete(listener); };
}

/** Takes a route message from the socket; false for any other message. */
export function receiveRoute(msg: { type: string }): boolean {
  if (msg.type !== "route") return false;
  const route = (msg as RouteMsg).route;
  if (route.stage === "weighing") { weighed.add(route.thought_id); keep(weighed); }
  else {
    const model = route.model ? modelName(route.model) : null;
    weighed.delete(route.thought_id);
    models.set(route.thought_id, model);
    keep(models);
    for (const watcher of decidedWatchers) watcher(route.thought_id, model);
  }
  set(routed(state, route, Date.now()));
  return true;
}

/** The core's `placing` message (core.ts reads it too). */
export function routePlacing(now: string | null) {
  set(placingNow(state, now));
}

/** On reconnecting: the window clears its own route state (lit cards, landing tag). The core keeps placing; its
 *  landing still arrives, but the candidates it named before the reconnect stay dark (they're sent once, as the calls go). */
export function resetRoute() {
  set(EMPTY_ROUTE);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const key = (m: Mark | null) => (m ? JSON.stringify(m) : "");

/** A card's mark, as a string that changes only when the mark does (so only the cards it touches render again). `own`:
 *  the window's own active thread. */
export function useRouteMark(threadId: string, own: string | null): Mark | null {
  const read = () => key(markFor(state, threadId, Date.now(), own));
  const text = useSyncExternalStore(subscribe, read, read);
  return text ? (JSON.parse(text) as Mark) : null;
}

export function useLanes(thoughtId: string): number {
  const read = () => lanesFor(state, thoughtId);
  return useSyncExternalStore(subscribe, read, read);
}
