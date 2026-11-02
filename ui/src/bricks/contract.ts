// The contract between the app and a brick (docs/bricks.md): the one file a brick imports from the app, and
// scripts/bricks-check.mjs holds every brick to that. A brick is a React component that gets three things as props:
// the map as it is now (read-only), the few actions it may take, and `on`, for what passes (a thought landing, the
// mic's loudness). Nothing here runs the app's code, so a brick works the same in the app and in the playground
// (bricks.html), which hands it a sample map instead.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { MiniApp } from "../apps-core";
import type { Action, Note, Suggestion, Thought, Thread } from "../core";
import type { Position } from "../positions-core";

export type { Action, MiniApp, Note, Position, Suggestion, Thought, Thread };

/** Where a brick shows:
 *  - view: another way to see the map; its name joins the Map and Palace switch, and it shows in the map's place
 *  - card: a small card in the dock above the composer, where the unfinished card shows
 *  - input: a new way in (gestures, a pedal); it draws at most a small mark of its own and acts through `actions`
 *  - panel: floats over the page and places itself (the Level meter: bottom left, above the dock) */
export type BrickKind = "view" | "card" | "input" | "panel";

/** A brick's brick.json. */
export interface BrickInfo {
  /** Its folder's name: lowercase letters, digits and dashes. */
  id: string;
  /** What the Catalog calls it: a word or two. */
  name: string;
  /** One line for a person: what it does. The Catalog shows it under the name. */
  does: string;
  kind: BrickKind;
  /** On in every browser until someone switches it off in the Catalog. A new brick starts off. */
  defaultOn: boolean;
  /** Fine to switch on live, in front of people: it works on an empty map and a full one, needs no setup, and asks
   *  for nothing (the camera, the mic) before a click. The Catalog folds the rest away under "Not for the demo". */
  demoSafe: boolean;
  /** Optional: an address flag that switches it on for one visit (`?level` for the Level meter). */
  flag?: string;
}

/** The map as it is now, read-only: a brick changes the map only through `actions`. Each change brings a new one. */
export interface MapSnapshot {
  /** Every thread, oldest first; a branch names its parent (`parent_id`). */
  readonly threads: readonly Thread[];
  /** Every thought in the order it came. A placed one sits on a thread (`thread_id`) as its `point`; the rest are on their way. */
  readonly thoughts: readonly Thought[];
  /** The thread you're on, or null. */
  readonly active: string | null;
  /** The AI's ideas for a next step on a thread (✦), and where each stands. */
  readonly suggestions: readonly Suggestion[];
  /** Reminders and calendar events the AI proposed from what was said (the map's `actions`). */
  readonly reminders: readonly Action[];
  /** The apps people made (a watcher, a prompt, publishers), and whether each is on. */
  readonly apps: readonly MiniApp[];
  /** Why a thought went where it went, by thought id, where the placer said. */
  readonly notes: Readonly<Record<string, Note>>;
  /** How many points each thread's card shows, by thread id: two parts said across a pause count as one. */
  readonly points: ReadonlyMap<string, number>;
  /** Each thread's room color (a thread and its branches share one): `var(--room-<color>)`, `var(--room-<color>-soft)`. */
  readonly rooms: ReadonlyMap<string, string>;
  /** What was placed by hand on a canvas, by id (a thread's card, or a thought's point): where (absolute canvas
   *  coordinates of its top-left), by whom (a person or an AI participant) and when. Only what someone placed is here;
   *  a view lays out the rest itself, and never moves these. */
  readonly positions: Readonly<Record<string, Position>>;
  /** Who is at this window: "you" alone, or the name they joined a room with. A thought's `speaker` is the same. */
  readonly me: string;
  /** Whether the core is there: while it isn't, actions that change the map say so instead. */
  readonly connected: boolean;
}

/** What a brick may do. Each does what its button in the app does, with the same answer on screen. */
export interface BrickActions {
  /** Adds a thought as if typed in the composer: it lands on a thread a few seconds later. False when it couldn't go
   *  (too long, or too many waiting for the core); the window says why. */
  addThought(text: string): boolean;
  /** Shows a thread as a Palace picture does: back to the Map with the thread open, in view and highlighted. Your
   *  place moves there too. */
  openThread(threadId: string): void;
  /** Makes a thread "this", as pointing at its card does: what "rename this" or "expand this" said next acts on.
   *  null lets it go. A view's own elements can skip this: one marked `data-thread={id}` is "this" while pointed at. */
  select(threadId: string | null): void;
  /** Says one short line in the notice lane, up for its reading time. */
  notify(text: string): void;
  /** Puts a thread's card or a thought's point (by id) at x, y on the canvas, its top-left in canvas units, for every
   *  window on the map; it stays there until someone moves it. Both null: back to the view's own layout. Call it as
   *  often as a drag moves: steps go at most once a frame, and your own come back in `positions` (with `by` you). */
  position(id: string, x: number | null, y: number | null): void;
  /** Taps the mic, as its button does: true starts listening, false stops, nothing switches it. Starting takes a click
   *  or a key press in this tab, under way as it's called (the Keys brick's ⌘D), so a brick never turns the mic on by
   *  itself; stopping always works. */
  listen(on?: boolean): void;
}

/** What passes, for `on`. */
export interface BrickEvents {
  /** A thought just landed on a thread: anyone's in a room (`mine` says whether it's yours); never one an Undo brought back. */
  landed: { thoughtId: string; threadId: string; mine: boolean };
  /** The mic's loudness, 0 to 1, every 320 ms while it's on: what the volume apps hear. */
  loudness: number;
}

/** Listens for one kind of event; returns the way to stop. */
export type BrickOn = <K extends keyof BrickEvents>(name: K, listener: (value: BrickEvents[K]) => void) => () => void;

/** The props a brick's index.tsx gets: its default export is a component taking these. */
export interface BrickProps {
  map: MapSnapshot;
  actions: BrickActions;
  on: BrickOn;
  /** Its own brick.json. */
  brick: BrickInfo;
}

/** `on` as a hook: calls `listener` for each `name` event while the brick is on the page. The latest listener, so it
 *  can read fresh props. */
export function useBrickEvent<K extends keyof BrickEvents>(on: BrickOn, name: K, listener: (value: BrickEvents[K]) => void) {
  const latest = useRef(listener);
  useLayoutEffect(() => { latest.current = listener; });
  useEffect(() => on(name, (value) => latest.current(value)), [on, name]);
}
