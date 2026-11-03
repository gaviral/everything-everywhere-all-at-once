// Bricks (docs/bricks.md): features that each live in a folder of their own under bricks/, found by reading the
// folders, so adding one is adding a folder and editing nothing else. This is the app's side of it: which bricks
// there are (each brick.json, checked), which are on in this browser, the Catalog being open, and the map, actions
// and events each brick is handed (bricks/contract.ts). BrickSlot.tsx mounts them; Catalog.tsx switches them.
import { useSyncExternalStore, type ComponentType } from "react";
import type { BrickEvents, BrickInfo, BrickKind, BrickOn, BrickProps, MapSnapshot, Speaker } from "./bricks/contract";
import type { Note, Thought, World } from "./core";
import { anchoredThreads } from "./annotate-core";
import { asIdeas } from "./chunks";
import { landedNow } from "./landed";
import { THOUGHT_MAX } from "./limits";
import { CORE_BRICKS } from "./shell/flag";

export const KINDS: readonly BrickKind[] = ["view", "card", "input", "panel"];
/** Address flags the app keeps for itself (room.tsx, main.tsx, the playground), which no brick's `flag` may take. */
const APP_FLAGS = ["room", "recording", "brick", "sample", "shell", "demo"];
/** Ids a view brick can't take: they're the app's own views. */
const APP_VIEWS = ["map", "palace"];

export type BrickModule = { default: ComponentType<BrickProps> };
export type Brick = { info: BrickInfo; load: () => Promise<BrickModule> };

/** What's wrong with a brick.json in `folder` (its folder's name), in words a builder can act on; empty when it's right.
 *  scripts/bricks-check.mjs says the same before a merge; here a broken one is left out of the app. */
export function infoProblems(json: unknown, folder: string): string[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return ["brick.json isn't an object"];
  const info = json as Record<string, unknown>;
  const problems: string[] = [];
  const known = ["id", "name", "does", "kind", "defaultOn", "demoSafe", "flag", "showsLiveWords"];
  for (const key of Object.keys(info)) if (!known.includes(key)) problems.push(`unknown field "${key}" (fields: ${known.join(", ")})`);
  if (info.id !== folder) problems.push(`id is ${JSON.stringify(info.id)}; it must be the folder's name, "${folder}"`);
  const bare = folder.replace(/^_/, "");
  if (!/^[a-z][a-z0-9-]*$/.test(bare)) problems.push(`the folder's name "${folder}" must be lowercase letters, digits and dashes`);
  if (APP_VIEWS.includes(bare)) problems.push(`"${bare}" is the app's own view; pick another name`);
  if (typeof info.name !== "string" || !info.name.trim() || info.name.length > 24) problems.push("name: a word or two, at most 24 characters");
  if (typeof info.does !== "string" || !info.does.trim() || info.does.length > 90 || /\n/.test(info.does)) problems.push("does: one line, at most 90 characters");
  if (!KINDS.includes(info.kind as BrickKind)) problems.push(`kind: one of ${KINDS.join(", ")}`);
  if (typeof info.defaultOn !== "boolean") problems.push("defaultOn: true or false (a new brick starts off: false)");
  if (typeof info.demoSafe !== "boolean") problems.push("demoSafe: true or false");
  if (info.flag !== undefined && (typeof info.flag !== "string" || !/^[a-z][a-z0-9-]*$/.test(info.flag) || APP_FLAGS.includes(info.flag))) {
    problems.push(`flag: a lowercase word for the address (?word), not one of the app's own: ${APP_FLAGS.join(", ")}`);
  }
  if (info.showsLiveWords !== undefined && typeof info.showsLiveWords !== "boolean") problems.push("showsLiveWords: true or false (true: it shows map.partial, so the dock doesn't)");
  return problems;
}

/** The bricks among `infos` (each brick.json, by path) and `modules` (each index.tsx, by path), sorted by kind and
 *  then name; a folder missing either file, or whose brick.json is wrong, is left out with its problems. */
export function discover(infos: Record<string, unknown>, modules: Record<string, () => Promise<BrickModule>>) {
  const folderOf = (path: string) => path.split("/").at(-2) ?? "";
  const bricks: Brick[] = [];
  const problems: Record<string, string[]> = {};
  const loaders = new Map(Object.entries(modules).map(([path, load]) => [folderOf(path), load]));
  const folders = new Set([...Object.keys(infos).map(folderOf), ...loaders.keys()]);
  for (const folder of folders) {
    const path = Object.keys(infos).find((p) => folderOf(p) === folder);
    const wrong = path ? infoProblems(infos[path], folder) : ["no brick.json"];
    const load = loaders.get(folder);
    if (!load) wrong.push("no index.tsx");
    if (wrong.length || !load) { problems[folder] = wrong; continue; }
    bricks.push({ info: infos[path!] as BrickInfo, load });
  }
  const flags = new Map<string, string>();
  for (const { info } of bricks) {
    if (!info.flag) continue;
    if (flags.has(info.flag)) (problems[info.id] ??= []).push(`flag ?${info.flag} is ${flags.get(info.flag)}'s too`);
    else flags.set(info.flag, info.id);
  }
  bricks.sort((a, b) => KINDS.indexOf(a.info.kind) - KINDS.indexOf(b.info.kind) || a.info.name.localeCompare(b.info.name));
  return { bricks: bricks.filter((b) => !problems[b.info.id]), problems };
}

// The app's bricks: every folder under bricks/ but those starting with "_" (the template), which are copied, not run.
// Each brick.json is read now (they're small); a brick's code loads only once it's switched on.
const found = discover(
  import.meta.glob(["./bricks/*/brick.json", "!./bricks/_*/brick.json"], { eager: true, import: "default" }),
  import.meta.glob<BrickModule>(["./bricks/*/index.tsx", "!./bricks/_*/index.tsx"]),
);
for (const [folder, wrong] of Object.entries(found.problems)) console.warn(`Brick "${folder}" left out: ${wrong.join("; ")} (docs/bricks.md)`);
export const BRICKS: readonly Brick[] = found.bricks;

// Which bricks are on, in this browser: only what was switched in the Catalog is kept (by id); every other brick
// follows its brick.json's defaultOn. A brick whose flag is in the address is on for this visit until it's switched.
const STORE = "e2a2o.bricks";
type Switches = Record<string, boolean>;

function readSwitches(): Switches {
  try {
    const kept = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
    // Only a real on or off counts: anything else kept there leaves that brick at its default.
    return Object.fromEntries(Object.entries(kept).filter(([, value]) => typeof value === "boolean")) as Switches;
  } catch { return {}; }
}

/** The ids on, given what was switched (`switches`), what the address turned on for this visit (`flagged`) and the
 *  shell's core (`core`, shell/flag.ts): on with no switch, unless one broke and was switched off this visit (`off`). */
export function onIds(bricks: readonly Brick[], switches: Switches, flagged: ReadonlySet<string>, core: readonly string[] = [], off: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  return new Set(bricks.filter(({ info }) => (core.includes(info.id) && !off.has(info.id)) || flagged.has(info.id) || (switches[info.id] ?? info.defaultOn)).map(({ info }) => info.id));
}

/** A feature the shell is built around (shell/flag.ts `CORE_BRICKS`): the Catalog shows it on, with no switch. */
export const isCore = (id: string) => CORE_BRICKS.includes(id);

const browser = typeof window !== "undefined";
const params = browser ? new URLSearchParams(location.search) : new URLSearchParams();
let switches: Switches = browser ? readSwitches() : {};
const flagged = new Set(BRICKS.filter(({ info }) => info.flag && params.has(info.flag)).map(({ info }) => info.id));
// A core brick that broke and was switched off from its "stopped working" line: off for this visit only.
const coreOff = new Set<string>();
let on = onIds(BRICKS, switches, flagged, CORE_BRICKS, coreOff);
const watchers = new Set<() => void>();
const changed = () => { on = onIds(BRICKS, switches, flagged, CORE_BRICKS, coreOff); for (const watcher of watchers) watcher(); };
const watch = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
// Switched in another window of this browser: this one follows.
if (browser) window.addEventListener("storage", (event) => { if (event.key === STORE) { switches = readSwitches(); changed(); } });

/** The ids of the bricks on now; a new set only when one is switched. */
export function useBricksOn(): ReadonlySet<string> {
  return useSyncExternalStore(watch, () => on, () => on);
}

/** Switches a brick on or off in this browser, at once, and keeps it so. */
export function switchBrick(id: string, value: boolean) {
  if (isCore(id)) {
    if (value) coreOff.delete(id); else coreOff.add(id);
    changed();
    return;
  }
  flagged.delete(id);
  switches = { ...switches, [id]: value };
  try { localStorage.setItem(STORE, JSON.stringify(switches)); } catch { /* private mode: on for this visit only */ }
  changed();
}

// The Catalog sheet: opened from the Apps panel or by a brick (`openCatalog`, at its row when it names one), closed by
// itself (Catalog.tsx).
let catalogOpen = false;
let catalogAt: { id: string; n: number } | null = null;
let asks = 0;
const catalogWatchers = new Set<() => void>();
const setCatalog = (value: boolean, at: string | null = null) => {
  catalogOpen = value;
  catalogAt = value && at ? { id: at, n: ++asks } : null;
  for (const watcher of catalogWatchers) watcher();
};
const watchCatalog = (watcher: () => void) => { catalogWatchers.add(watcher); return () => { catalogWatchers.delete(watcher); }; };
export const openCatalog = () => setCatalog(true);
/** Opens the Catalog at brick `id`'s row (none: at its top), as a brick's `openCatalog(id)` asks; again, a new ask. */
export const openCatalogAt = (id: string | null) => setCatalog(true, id);
export const closeCatalog = () => setCatalog(false);
export function useCatalogOpen(): boolean {
  return useSyncExternalStore(watchCatalog, () => catalogOpen, () => false);
}
/** The row the Catalog was asked to show, and which ask (`n`), while it's open. */
export function useCatalogAt(): { id: string; n: number } | null {
  return useSyncExternalStore(watchCatalog, () => catalogAt, () => null);
}

/** Nothing placed by hand, the same object each time. */
const UNPLACED = Object.freeze({});

/** Everyone on the map (contract.ts `speakers`): each speaker of a thought, then each AI participant that hasn't spoken
 *  yet; a new map only when the thoughts or the AI participants change, so it doesn't change per word heard. */
function speakersOf() {
  let last: { thoughts: readonly Thought[]; ai: readonly string[] | undefined; out: ReadonlyMap<string, Speaker> } | null = null;
  return (thoughts: readonly Thought[], ai: readonly string[] | undefined): ReadonlyMap<string, Speaker> => {
    if (last && last.thoughts === thoughts && last.ai === ai) return last.out;
    const out = new Map<string, Speaker>();
    for (const thought of thoughts) if (thought.speaker && !out.has(thought.speaker)) out.set(thought.speaker, { ai: !!ai?.includes(thought.speaker) });
    for (const name of ai ?? []) out.set(name, { ai: true });
    last = { thoughts, ai, out };
    return out;
  };
}
const threadsWithAnchors = anchoredThreads();
const speakersNow = speakersOf();

/** The map a brick is handed (contract.ts `MapSnapshot`), from the window's world: the same arrays, read-only (a
 *  margin note's thread with its `anchor`), and `partial`, this tab's live words (core.ts `partial`: the core sends them
 *  to the speaker's windows alone, and a tab takes them only while its own mic is on). */
export function snapshotOf(world: World, me: string, connected: boolean, rooms: ReadonlyMap<string, string>, partial: string): MapSnapshot {
  const notes = world.notes ?? {};
  return {
    threads: threadsWithAnchors(world.threads, world.anchors),
    thoughts: world.thoughts,
    active: world.active_by[me] ?? world.active,
    suggestions: world.suggestions,
    reminders: world.actions,
    apps: world.apps,
    notes,
    points: pointCounts(world.thoughts, notes),
    rooms,
    positions: world.positions ?? UNPLACED,
    speakers: speakersNow(world.thoughts, world.ai),
    me,
    partial,
    connected,
  };
}

/** Each thread's points as its card counts them (chunks.tsx `asIdeas`: parts said across a pause are one point). */
export function pointCounts(thoughts: readonly Thought[], notes: Record<string, Note>): Map<string, number> {
  const byThread = new Map<string, Thought[]>();
  for (const thought of thoughts) if (thought.placed && thought.thread_id) {
    const group = byThread.get(thought.thread_id) ?? [];
    group.push(thought);
    byThread.set(thought.thread_id, group);
  }
  return new Map([...byThread].map(([id, group]) => [id, asIdeas(group.sort((a, b) => a.at_ms - b.at_ms), notes).length]));
}

/** Thoughts that just landed, for `on("landed")`: each call takes the thoughts as they are now and returns those placed
 *  since the last call (landed.ts's rule: a point an Undo brings back isn't one). A new `revision` (the core's
 *  snapshot count: the first map, or a reconnect's catch-up) is only learned, as the map's own follow does (App.tsx). */
export function landingWatcher() {
  let seen: { revision: number; placed: Set<string> } | null = null;
  const ever = new Set<string>();
  return (thoughts: readonly Thought[], revision: number): Thought[] => {
    const placed = thoughts.filter((thought) => thought.placed && thought.thread_id);
    const fresh = landedNow(placed, seen?.placed ?? new Set(), ever);
    const same = seen?.revision === revision;
    seen = { revision, placed: new Set(placed.map((thought) => thought.id)) };
    return same ? fresh : [];
  };
}

/** Which brick added each thought of yours (`landed`'s `by`): a brick's `addThought` is told here (`sent`), and the
 *  thought that comes back with those words, yours and new, is its (one too long for a thought, sent in parts
 *  (limits.ts `splitThought`): each part; the rest of one the placer cut in two: its first part's brick). Asks older
 *  than `FOR_MS` are dropped: the core answers at once, so a thought that comes later is something else, typed while
 *  it waited offline. */
export function senders(FOR_MS = 60_000) {
  const asks: { words: string; brick: BrickInfo; at: number }[] = [];
  const claimed = new Map<string, BrickInfo>();
  const seen = new Set<string>();
  let revision = -1;
  const words = (text: string) => text.trim().split(/\s+/).join(" ");
  return {
    sent(text: string, brick: BrickInfo, now = Date.now()) {
      asks.push({ words: words(text), brick, at: now });
      if (asks.length > 20) asks.shift();
    },
    /** Takes the thoughts as they are now: each new one of `me`'s claimed by the ask it answers. A new `revision` (a
     *  snapshot) is only learned. */
    see(thoughts: readonly Thought[], me: string, now = Date.now(), snapshot = revision) {
      const learning = snapshot !== revision;
      revision = snapshot;
      for (let i = 0; i < thoughts.length; i++) {
        const thought = thoughts[i];
        if (seen.has(thought.id)) continue;
        seen.add(thought.id);
        if (learning || thought.speaker !== me) continue;
        const said = words(thought.text);
        const at = asks.findIndex((ask) => now - ask.at <= FOR_MS && !!said && (ask.words === said || (ask.words.length > THOUGHT_MAX && ask.words.includes(said))));
        if (at >= 0) {
          claimed.set(thought.id, asks[at].brick);
          if (asks[at].words === said) asks.splice(at, 1);
          continue;
        }
        // The rest of a turn the placer cut in two comes right after its first part, said at the same moment.
        const before = thoughts[i - 1];
        const brick = before && before.speaker === me && before.at_ms === thought.at_ms ? claimed.get(before.id) : undefined;
        if (brick) claimed.set(thought.id, brick);
      }
    },
    by: (thoughtId: string) => claimed.get(thoughtId),
  };
}

/** Listeners by event name, for `on`; `emit` calls each, and says how many heard it. */
export function brickEvents() {
  const listeners = new Map<keyof BrickEvents, Set<(value: never) => void>>();
  const on: BrickOn = (name, listener) => {
    const set = listeners.get(name) ?? new Set();
    listeners.set(name, set);
    set.add(listener as (value: never) => void);
    return () => { set.delete(listener as (value: never) => void); };
  };
  const emit = <K extends keyof BrickEvents>(name: K, value: BrickEvents[K]): number => {
    const heard = [...(listeners.get(name) ?? [])];
    for (const listener of heard) (listener as (value: BrickEvents[K]) => void)(value);
    return heard.length;
  };
  return { on, emit };
}
