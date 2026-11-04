// The model line: which Meta model is doing each step, as the core tells it (`ServerMsg::Step`, sent from where every
// model call goes through, core/src/model.rs), so the name shown is the name asked, never a label kept by hand.
// Pure rules here (scripts/model-line-check.mjs holds them); the store and hook below; ModelLine.tsx shows it.
import { useSyncExternalStore } from "react";

/** `dropped`: the call was cut off unanswered on purpose (the slower of a placement's 2 racing calls, a search past its
 *  patience), not failed: the core says so (model.rs `StepGuard`), so the line never reads it as the model failing. */
export type StepMsg = { type: "step"; id: number; step: string; model: string | null; done: boolean; ok: boolean; ms: number; dropped?: boolean };

/** "muse-spark-1.2-contributor" → "Muse Spark 1.2": the model's public name. Contributor mode is how the key asks,
 *  not another model, so it's left out on screen (the full id stays in the line's tooltip). */
export function modelName(id: string): string {
  return id
    .split("-")
    .filter((part) => part && part !== "contributor")
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/** What each step is called while it runs, in the person's terms. Once its call answers, the line says "answered"
 *  and how long it took, never what the feature then did: the core checks and applies the answer after the call (a
 *  placement can fail its checks and retry, an app request can come back "can't"), so "placed it" could be untrue.
 *  A step the core adds later still shows its model ("working"), so no step goes unnamed. */
const STEPS: Record<string, string> = {
  listen: "listening",
  placer: "placing your thought",
  refiner: "tidying the map",
  picture: "drawing a picture",
  recap: "reading your day",
  "recap draft": "keeping your recap ready",
  topics: "sorting topics into themes",
  app: "building your app",
  "app search": "looking for an app you have",
  "app run": "running your app",
  find: "searching your topics",
  explain: "explaining",
  conversation: "answering",
  "safety net": "checking that",
  import: "reading your chats",
};
const RULES: Record<string, string> = { back: "back to your topic", tune: "played the tune" };

/** Steps you asked for and wait on, "Where was I?" included; the rest (pictures, tidying, an app a watcher woke, a
 *  Recap draft nobody asked for) run behind, so they never cover a placing time. */
const FOREGROUND = new Set(["placer", "recap", "app", "app search", "find", "explain", "safety net", "import", "back", "conversation"]);

const kind = (step: string) => (step.startsWith("import") ? "import" : step);
export function verb(step: string, done: boolean): string {
  return done ? "answered" : STEPS[kind(step)] ?? "working";
}

/** How long a finished step's line stays: reading its 6–8 words at about 3.3 words a second (200 a minute) is ≈ 2.1 s,
 *  plus ≈ 1 s to notice it changed → 3 s. Longer runs into the next line's words: in the demo talk a line comes every
 *  ≈ 6 s and lands ≈ 3.2 s after its words (takes, 2026-11-01), which leaves ≈ 3 s. */
export const HOLD_MS = 3000;

export interface Running { id: number; step: string; model: string; at: number }
export interface Finished { step: string; model: string | null; ok: boolean; ms: number; at: number }
/** `listening` keeps its session's id: a session that ends late (mic off and on quickly) clears only itself. */
export interface LineState { running: Running[]; last: Finished | null; listening: { id: number; model: string } | null }
export const EMPTY_LINE: LineState = { running: [], last: null, listening: null };

/** The state after one step message, at `now`. */
export function stepped(state: LineState, msg: StepMsg, now: number): LineState {
  const running = state.running.filter((r) => r.id !== msg.id);
  if (msg.step === "listen") {
    if (!msg.done) return { ...state, running, listening: msg.model ? { id: msg.id, model: msg.model } : null };
    return { ...state, running, listening: state.listening?.id === msg.id ? null : state.listening };
  }
  if (!msg.done && msg.model) return { ...state, running: [...running, { id: msg.id, step: msg.step, model: msg.model, at: now }] };
  // Dropped: it only stops running. What the line showed stays (a race's winner keeps its time).
  if (msg.dropped) return { ...state, running };
  // A step behind that finishes during a waited-on step's hold leaves that one's time showing (a picture done 0.1 s
  // after a placing never covers it).
  const last = state.last;
  if (last && FOREGROUND.has(kind(last.step)) && !FOREGROUND.has(kind(msg.step)) && now - last.at < HOLD_MS) return { ...state, running };
  return { ...state, running, last: { step: msg.step, model: msg.model, ok: msg.ok, ms: msg.ms, at: now } };
}

export interface Line { model: string | null; id: string | null; text: string }

/** Several models doing one step at once (a placement's racing calls, each lane its own model, core/src/placer.rs
 *  `MODELS`), named once each in the order they started: "Muse Spark 1.3 + 1.2" when only the version differs. */
export function together(ids: string[]): { model: string; id: string } {
  const unique = [...new Set(ids)];
  const names = [...new Set(unique.map(modelName))];
  const words = names.map((name) => name.split(" "));
  const stem = words[0].slice(0, -1).join(" ");
  const sameStem = words.every((w) => w.length === words[0].length && w.slice(0, -1).join(" ") === stem);
  const model = names.length > 1 && sameStem ? `${stem} ${words.map((w) => w.at(-1)).join(" + ")}` : names.join(" + ");
  return { model, id: unique.join(", ") };
}

/** What the line says at `now`: a step you wait on, while it runs; else what just finished, for `HOLD_MS`; else
 *  what runs behind; else the model listening. Nothing when nothing runs, the mic is off and the last step is old. */
export function lineFor(state: LineState, now: number, hearing: boolean): Line | null {
  const latest = (list: Running[]) => list.reduce<Running | null>((a, b) => (!a || b.at >= a.at ? b : a), null);
  const running = (r: Running | null): Line | null => r && { model: modelName(r.model), id: r.model, text: verb(r.step, false) };
  const front = latest(state.running.filter((r) => FOREGROUND.has(kind(r.step))));
  if (front) {
    // A race names every model it asks, not only the lane that started last; its answer names the one that won.
    const racing = state.running.filter((r) => r.step === front.step).map((r) => r.model);
    return { ...together(racing), text: verb(front.step, false) };
  }
  const last = state.last;
  if (last && now - last.at < HOLD_MS) {
    if (!last.model) return { model: null, id: null, text: `${RULES[last.step] ?? last.step} · by rule, no model` };
    const text = last.ok ? `${verb(last.step, true)} · ${(last.ms / 1000).toFixed(1)} s` : "didn't answer";
    return { model: modelName(last.model), id: last.model, text };
  }
  const behind = running(latest(state.running));
  if (behind) return behind;
  if (state.listening) return { model: modelName(state.listening.model), id: state.listening.model, text: hearing ? "hearing you" : "mic on" };
  return null;
}

/** What a screen reader hears: each model once, the first time it does a kind of step in this window (the line itself
 *  is hidden from it, since it changes every few seconds). Null when this pair was said already. */
export function announcement(said: Set<string>, step: string, model: string | null): string | null {
  if (!model) return null;
  const key = `${kind(step)} ${model}`;
  if (said.has(key)) return null;
  said.add(key);
  return `${modelName(model)} is ${verb(step, false)}.`;
}

// The store: one per window, fed by core.ts's socket, read by ModelLine.tsx and the Recap's wait.
let state = EMPTY_LINE;
let said = "";
const spoken = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Takes a step message from the socket; false for any other message. */
export function receiveStep(msg: { type: string }): boolean {
  if (msg.type !== "step") return false;
  const step = msg as StepMsg;
  state = stepped(state, step, Date.now());
  if (!step.done || step.step === "listen") said = announcement(spoken, step.step, step.model) ?? said;
  notify();
  return true;
}

/** This tab stopped capture; a late server step must not leave "mic on" in the composer. */
export function stopListeningStep() {
  if (!state.listening) return;
  state = { ...state, listening: null };
  notify();
}

/** On reconnecting: the core forgets the calls it was making, so the window does too. */
export function resetSteps() {
  state = EMPTY_LINE;
  notify();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let snapshot = { state, said };
const read = () => (snapshot.state === state && snapshot.said === said ? snapshot : (snapshot = { state, said }));
export function useSteps(): { state: LineState; said: string } {
  return useSyncExternalStore(subscribe, read, read);
}

/** The model a running step of these kinds is asked now, by its public name; null when none runs. */
export function runningModel(state: LineState, ...steps: string[]): string | null {
  const r = state.running.filter((r) => steps.includes(r.step)).at(-1);
  return r ? modelName(r.model) : null;
}
