// The contract between the app and a brick (docs/bricks.md): the one file a brick imports from the app, and
// scripts/bricks-check.mjs holds every brick to that. A brick is a React component that gets three things as props:
// the map as it is now (read-only), the few actions it may take, and `on`, for what passes (a thought landing, your
// words as they come, the mic's loudness, a notice). Nothing here runs the app's code, so a brick works the same in the
// app and in the playground (bricks.html), which hands it a sample map instead.
import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { MiniApp } from "../apps-core";
import type { Anchor } from "../annotate-core";
import type { Action, Note, Pause, Suggestion, Thought, Thread as MapThread, UsageRow, UsageSnapshot } from "../core";
import type { Position } from "../positions-core";

export type CanvasToolId = "composer" | "features" | "history";
/** Browser presentation only: existing shell bodies, never a second connection or mutation owner. */
export type CanvasToolSlots = Record<CanvasToolId, HTMLElement>;
export type CanvasTools = {
  slots: CanvasToolSlots;
  request: { id: CanvasToolId | null; revision: number };
  focus: (id: CanvasToolId | null) => void;
  exit: () => void;
};
export const CanvasToolsContext = createContext<CanvasTools | null>(null);

/** This browser's optional readable Canvas overview; the playground keeps the default. */
/** A local inspector request; never changes the World or source layout. */
export type FullContentRequest = { threadId: string; thoughtIds?: readonly string[]; displayedPoint?: string; restoreCamera: () => void };
export const FullContentContext = createContext<((request: FullContentRequest, source: HTMLElement) => void) | null>(null);

export const SemanticZoomContext = createContext(false);

/** Optional presentation objects, local to this visit. Never World thoughts or positions. */
export type ShapeSize = { width: number; height: number; radius: number };
export type ShapeDefinition = Readonly<ShapeSize & { id: "rounded-rectangle"; name: "Rounded rectangle" }>;
export type ShapeInstance = Readonly<ShapeSize & { id: string; definitionId: ShapeDefinition["id"]; x: number; y: number }>;
export interface ShapeHost {
  placementPoint(): { x: number; y: number };
}
export interface Shapes {
  readonly enabled: boolean;
  readonly definitions: readonly ShapeDefinition[];
  readonly instances: readonly ShapeInstance[];
  readonly canvasReady: boolean;
  attachCanvas(host: ShapeHost): () => void;
  place(definitionId: ShapeDefinition["id"], size: ShapeSize): string | null;
  update(id: string, patch: Partial<ShapeSize & { x: number; y: number }>): void;
  remove(id: string): void;
}
export const ShapesContext = createContext<Shapes | null>(null);

/** The app's existing speech-correction controls, attached to a thought by a view. */
export const SpeechFixesContext = createContext<((thought: Thought) => ReactNode) | null>(null);

export type { Action, Anchor, MiniApp, Note, Pause, Position, Suggestion, Thought, UsageRow, UsageSnapshot };

/** One thought of a turn: a turn the placer cut in two is one turn of two parts, each its own point on the map. */
export interface Part {
  thoughtId: string;
  /** The words as said (the map shows the point made of them). */
  text: string;
  /** On a thread: a margin note can be tied to its words. */
  placed: boolean;
}

/** Something said, as Talk lists it. */
export interface Turn {
  /** Its first thought's id: the turn's key, and what a read mark names. */
  key: string;
  speaker: string;
  /** When it was said (ms since 1970, the core's clock). */
  at: number;
  parts: Part[];
  /** A margin note: the point's thought and the words it's tied to (a later note on the same words answers it). */
  note?: { threadId: string; thoughtId: string; quote: string };
}

/** The turns, in the order they were said: each thought with words, a split turn's parts together, a margin note as a
 *  turn of its own with the words it's on. `threads` with each note's `anchor`, as a brick's map holds them. */
export function turnsOf(thoughts: readonly Thought[], threads: readonly { id: string; anchor?: Anchor }[]): Turn[] {
  const anchors = new Map<string, Anchor>();
  for (const thread of threads) if (thread.anchor) anchors.set(thread.id, thread.anchor);
  const said = thoughts
    .map((thought, i) => ({ thought, i }))
    .filter(({ thought }) => (thought.text || thought.point).trim())
    .sort((a, b) => a.thought.at_ms - b.thought.at_ms || a.i - b.i);
  const turns: Turn[] = [];
  for (const { thought } of said) {
    const anchor = thought.thread_id ? anchors.get(thought.thread_id) : undefined;
    const part = { thoughtId: thought.id, text: (thought.text || thought.point).trim(), placed: thought.placed && !!thought.thread_id };
    const last = turns.at(-1);
    // The placer's cut keeps the turn's moment: the same speaker, said at the same time.
    if (!anchor && last && !last.note && last.speaker === thought.speaker && last.at === thought.at_ms) {
      last.parts.push(part);
      continue;
    }
    turns.push({
      key: thought.id, speaker: thought.speaker, at: thought.at_ms, parts: [part],
      ...(anchor ? { note: { threadId: thought.thread_id!, thoughtId: anchor.thought_id, quote: anchor.quote } } : {}),
    });
  }
  return turns;
}

/** A thread. A margin note (`actions.annotate`) is one too, a tangent anchored to words: under the point's thread, its
 *  thoughts the note and its replies, and `anchor` the words it's tied to. A view shows it beside those words; the
 *  map shows it as a branch. `topic`: the theme it's under, by name (`MapSnapshot.topics`), a branch its top thread's;
 *  none until the AI sorts it. */
export type Thread = MapThread & { readonly anchor?: Anchor; readonly topic?: string };

/** A theme: a few top threads (threads with no parent: a spine each) that belong together, named by the AI in two or
 *  three plain words, or by a person; `threads` is how many top threads it holds. On screen it's a "theme" (people call
 *  one thread a topic); in code it stays `topic`. */
export interface Topic {
  readonly name: string;
  readonly threads: number;
}

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
  /** Optional: true when it shows your live words (`map.partial`) itself. While it's on, the dock leaves out its live
   *  line, so the words never show twice. */
  showsLiveWords?: boolean;
}

/** Someone on the map: whether they're an AI participant (the Friend over its bridge), whose words show ✦. */
export interface Speaker {
  readonly ai: boolean;
}

/** Where a helper's job stands: at work, finished, stopped short, or held up on a question for you. */
export type JobStatus = "running" | "done" | "failed" | "waiting";

/** One piece of work an AI helper reports (the core relays it as it comes: core/src/guide.rs `Job`). The same `id` again
 *  is the same job in a new state, and the last state wins. It lives only as long as the core runs, never on the map. */
export interface Job {
  readonly id: string;
  /** What it is, one line (80 characters at most). */
  readonly title: string;
  readonly status: JobStatus;
  /** A relayed job has one line (160 characters at most); in-core thinking helpers can carry up to 120 words.
   *  What a done job found, why a failed one stopped, the question a waiting one asks (a
   *  waiting job whose side job is the one waiting has a summary here instead: the side job asks). */
  readonly result?: string;
  /** The job this is a side job of; a parent that isn't here (yet) leaves it standing alone. */
  readonly parent?: string;
  /** A prepared, simulated job, not real work: whatever shows it says so. */
  readonly demo: boolean;
  /** Who sent it, by the name their thoughts would carry (`map.speakers`). */
  readonly by: string;
  /** When its state last changed, as the core stamped it (ms since 1970). */
  readonly at_ms: number;
  /** Execution start from the core for thinking helpers; otherwise when this window first saw it running.
   *  The end is the core's state-change time. Replayed helpers retain their execution duration. */
  readonly started_ms?: number;
  readonly ended_ms?: number;
}

/** The map as it is now, read-only: a brick changes the map only through `actions`. Each change brings a new one. */
export interface MapSnapshot {
  /** Optional browser presentation: chronological turns with linked topics. Missing/off keeps the current Canvas. */
  readonly conversationSpine?: boolean;
  /** Optional presentation only; never enabled by a sample or recording preset. */
  readonly comparePhoneReading?: boolean;
  readonly terse?: boolean;
  /** Allowances from USAGE_FILE and the core's rolling-hour model budget; null with no readable file or connection. */
  readonly usage: UsageSnapshot | null;
  /** The helpers' jobs, in the order each first came (the oldest first, the newest last), each in its latest state; the
   *  newest 60. The core replays them to a window that joins, so a brick switched on late still has them all. */
  readonly jobs: readonly Job[];
  /** Every thread, oldest first; a branch names its parent (`parent_id`), a margin note its words (`anchor`). */
  readonly threads: readonly Thread[];
  /** Every thought in the order it came. A placed one sits on a thread (`thread_id`) as its `point`; the rest are on
   *  their way. One the room agreed on lists who agreed in `agreed_by` (✓ Agreed): none yet, until the core says who. */
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
  /** Every theme on the map, in the order they first come among the threads. The AI names them (6 at most) once the map
   *  has 4 top threads, and sorts each new top thread within a minute; a person renames one or moves a thread
   *  (`renameTopic`, `moveToTopic`), and the AI never undoes it. A thread's own is its `topic`. A view that colors by
   *  theme takes a theme's place here as its color, so every view agrees. Empty until the AI sorts the map (or with no
   *  key). */
  readonly topics: readonly Topic[];
  /** What was placed by hand on a canvas, by id (a thread's card, or a thought's point): where (absolute canvas
   *  coordinates of its top-left), by whom (a person or an AI participant) and when. Only what someone placed is here;
   *  a view lays out the rest itself, and never moves these. */
  readonly positions: Readonly<Record<string, Position>>;
  /** Everyone on the map, by the name their thoughts carry (`speaker`): each who said something, and each AI
   *  participant that joined, with `ai` true for an AI's (it joined with `?ai`, as the Friend's bridge does). */
  readonly speakers: ReadonlyMap<string, Speaker>;
  /** Who is at this window: "you" alone, or the name they joined a room with. A thought's `speaker` is the same. */
  readonly me: string;
  /** The newest turn you've read, shared by Talk and canvas views; absent until one has been read. */
  readonly readThrough?: string | null;
  /** Your words as they're heard, not yet final: what the dock's live line shows while you talk, growing as you go,
   *  "" once the turn ends (it then comes as a thought) or while you're quiet. Only yours, and only in the tab whose
   *  mic is on: in a room the other person's words never reach this window, nor do your other tabs'. */
  readonly partial: string;
  /** Whether the core is there: while it isn't, actions that change the map say so instead. */
  readonly connected: boolean;
  readonly placingUnavailable?: boolean;
  readonly pauses?: readonly Pause[];
}

/** What a brick may do. Each does what its button in the app does, with the same answer on screen. */
export interface BrickActions {
  /** Explicitly hands a plain text file to the browser, not proof it reached disk. Host bounds: plain filename
   *  up to 80 characters, text/plain or text/markdown, and at most 64 KiB UTF-8. False on refusal or failure. */
  saveTextFile(name: string, text: string, mime: string): boolean;
  /** Counts a visible thought as read, advancing the shared Talk/canvas position (never moving it back). */
  readThought(thoughtId: string): void;
  /** Adds a thought as if typed in the composer: it lands on a thread a few seconds later, and its `landed` says this
   *  brick added it (`by`). False when it couldn't go (too long, or too many waiting for the core); the window says why. */
  addThought(text: string): boolean;
  resume?(pauseId: string, keyboard?: boolean): boolean;
  /** Inspect an exact live destination without changing the routing or the draft. */
  openPoint(threadId: string, thoughtId: string | null): void;
  /** Shows a thread as a Palace picture does: back to the Map with the thread open, in view and highlighted. Your
   *  place moves there too. */
  openThread(threadId: string): void;
  /** Opens this exact live placed thought through the shared jump path. False, with a notice, if it is gone. */
  openThought(thoughtId: string): boolean;
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
  /** A margin note: `text` beside `quote`, words picked in thought `thoughtId`'s point, for every window on the map,
   *  by you. The first note on those words starts their tangent (a thread under the point's thread, `anchor` those
   *  words), a later one answers in it; each comes back in `map.threads` and `map.thoughts`, as any thought does,
   *  placed as written (no model reads it). False when it couldn't go (no words, more than 6,000 characters, or the
   *  core away); the window says why, and so does the core if the point has left the map. */
  annotate(thoughtId: string, quote: string, text: string): boolean;
  /** Opens the Catalog (the app's list of features, each with its switch), at brick `id`'s row when given: shown and
   *  marked, its switch focused. As its button in Apps does. */
  openCatalog(id?: string): void;
  /** Shows a one-line hint, 140 characters at most: beside the part named `target` with an arrow at it, as another
   *  participant's point shows (a `data-guide` name: the app's, docs/guide.md, or one the brick gives its own part,
   *  starting with its id), else in the corner where captions show. Of the moment and this window's only: Esc or a
   *  click takes a pointed hint down, a corner one goes once read; the newest replaces it. Your brick's name is on it.
   *  False when nothing showed: no words, more than a line, or a target that isn't a name. */
  hint(text: string, target?: string): boolean;
  /** Renames theme `from` to `to` for every window (40 characters at most, spaces as one): every thread under it goes
   *  with it, and a name already there (in any case) makes the two one. False when it couldn't go (no name, the same
   *  name, the core away); the core says why if the theme has left the map. */
  renameTopic(from: string, to: string): boolean;
  /** Moves thread `threadId` under theme `topic` for every window: its top thread goes, with its branches, and stays
   *  there whatever the AI says. A name already there (in any case) is that theme. False when it couldn't go. */
  moveToTopic(threadId: string, topic: string): boolean;
}

/** Who acted: the brick that did (its id and name, as the Catalog lists it), or a person (by the name their thoughts
 *  carry; an AI participant is one too, `map.speakers` says which). */
export type ActedBy = { kind: "brick"; id: string; name: string } | { kind: "person"; name: string };

/** What passes, for `on`. */
export interface BrickEvents {
  /** A thought just landed on a thread: anyone's in a room (`mine` says whether it's yours); never one an Undo brought
   *  back. `model`: the model whose answer placed it ("Muse Spark 1.3", as the model line names it), or null when a rule
   *  did (a filing, a margin note) or this window never heard which. `ms`: how long placing it took, from said to
   *  landed, as the point's own time says, or null when unknown. `by`: the brick that added it in this window, else
   *  the person who said or typed it. */
  landed: { thoughtId: string; threadId: string; mine: boolean; model: string | null; ms: number | null; by: ActedBy };
  /** Your words as they're heard, each time they change (what `map.partial` then says): growing as you talk, "" once
   *  the turn ends (its thought comes next) or the mic stops. Only yours, only in the tab whose mic is on. */
  words: string;
  /** The mic's loudness, 0 to 1, every 320 ms while it's on: what the volume apps hear. */
  loudness: number;
  /** A notice or a map update, in the words this window shows it, as it comes up: the same words again too. `time` is
   *  when (ms since 1970). */
  notice: { text: string; kind: "notice" | "error" | "map-change"; time: number };
  /** What the guide's arrow points at now (another participant's point, or a brick's hint), so a view can dim the
   *  rest once: `target` is the part's `data-guide` name, with the thought or thread it names (a point's thread too),
   *  and `by` who points. null once it's taken down. */
  pointing: { target: string; by: string; thoughtId?: string; threadId?: string } | null;
  /** Something you asked for by voice or typing that a brick answers, said only to your windows: `notices` is "what
   *  just happened?" (the Notice timeline opens its list). It never lands on the map. */
  asked: { what: "notices" };
  /** In a call, someone took the floor (`on`: their mic hears words and the turn isn't over) or gave it back: anyone's,
   *  yours too (`mine`), the core's word from their live words (core/src/call.rs). Never the words themselves: those
   *  come with the turn's thought, as it ends. Alone, never. */
  speaking: { speaker: string; on: boolean; mine: boolean };
}

/** Listens for one kind of event; returns the way to stop. */
// A named landed consumer may receive the newest event once, within five seconds of a late mount.
export type BrickOn = <K extends keyof BrickEvents>(name: K, listener: (value: BrickEvents[K]) => void, consumer?: string) => () => void;

/** A live navigation request, kept while a view's code loads; a repeated destination has a new revision. */
export type ViewDestination = { threadId: string; thoughtId: string | null; revision: number };

/** The props a brick's index.tsx gets: its default export is a component taking these. */
export interface BrickProps {
  map: MapSnapshot;
  actions: BrickActions;
  on: BrickOn;
  /** Its own brick.json. */
  brick: BrickInfo;
  /** A private Find or return request: a view aims here even while its camera's follow is held. */
  destination?: ViewDestination | null;
}

/** The page's regions, each an element marked `data-slot="<name>"` while it's on screen (docs/bricks.md says where each
 *  is today and which are still to come), so a brick finds one by name wherever the layout puts it: to draw in it
 *  (`document.querySelector('[data-slot="status"]')`) or keep clear of it.
 *  - top-left, top-right, bottom-left, bottom-right: the corners (bottom-right holds the shelf, the held stack above it)
 *  - stage: bottom center, where you type and talk; status: the status line; rail: the panel at the right
 *  - shelf: what you keep at hand; held: questions waiting for your pause
 *  - slot:<thought id>: where a thought on its way will land, marked by the view that shows it; a flight aims there */
export type SlotName = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "stage" | "status" | "rail" | "shelf" | "held" | `slot:${string}`;

/** The fixed names, in docs/bricks.md's order. */
export const SLOTS = ["top-left", "top-right", "bottom-left", "bottom-right", "stage", "status", "rail", "shelf", "held"] as const satisfies readonly SlotName[];

/** `on` as a hook: calls `listener` for each `name` event while the brick is on the page. The latest listener, so it
 *  can read fresh props. */
export function useBrickEvent<K extends keyof BrickEvents>(on: BrickOn, name: K, listener: (value: BrickEvents[K]) => void, consumer?: string) {
  const latest = useRef(listener);
  useLayoutEffect(() => { latest.current = listener; });
  useEffect(() => on(name, (value) => latest.current(value), consumer), [on, name, consumer]);
}
