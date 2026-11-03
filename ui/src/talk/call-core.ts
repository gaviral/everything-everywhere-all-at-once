// The call as the core tells it (core/src/call.rs): who is on the map now and since when, who has the floor, how far
// each person has read the turns, and how far the Friend may interrupt. room.tsx hands this every message its socket
// hears (`heard`: a glance at its start, so nothing else is parsed twice) and sends what Talk says back (a read mark,
// the level). Alone the core never sends a call, so nothing here shows. Pure helpers below the store, so
// scripts/call-check.mjs runs them without a browser.
import { useSyncExternalStore } from "react";

/** How far the Friend may interrupt, least first (call.rs `Level`). */
export type Level = "glance" | "hand" | "note" | "speak" | "stop";

/** Someone in the call (call.rs `Person`). */
export interface Person {
  /** The name their thoughts carry. */
  name: string;
  ai: boolean;
  /** When they first joined in this run of the core (ms since 1970). */
  joined_ms: number;
  here: boolean;
  /** When their last window closed, while they're away. */
  left_ms: number | null;
  mic: boolean;
  /** Their mic hears words and the turn isn't over. Never the words, which come with the turn's thought. */
  speaking: boolean;
  /** The newest turn they've read, a thought's id. */
  read: string | null;
  /** A Remote (core/src/call.rs): a phone's page for the AI helpers' work, joined with `?remote`. A window, not a
   *  person: it is listed (`remotesHere`) and left out of everything that counts or names people. Absent from a core
   *  that doesn't know Remotes, which is false. */
  remote?: boolean;
}

/** The call (protocol.rs `ServerMsg::Call`). */
export interface Call {
  /** When two were first here at once; 0 until then, while a Remote is the only reason there is a message at all. */
  started_ms: number;
  /** In the order they first joined. */
  people: Person[];
  level: Level;
  /** Who set the level last; "" for the default. */
  level_by: string;
}

/** The levels, least first, with what each lets the Friend do, as the meter at the foot of Talk says it. */
export const LEVELS: readonly { id: Level; name: string; says: string }[] = [
  { id: "glance", name: "Glance", says: "It only marks what it noticed. Nothing pops up." },
  { id: "hand", name: "Hand", says: "It holds its questions until you pause." },
  { id: "note", name: "Note", says: "It may leave a note beside your words." },
  { id: "speak", name: "Speak", says: "It speaks only at a pause. Talk over it to stop it." },
  { id: "stop", name: "Stop", says: "It may stop you mid-sentence, after your last few words." },
];

/** Something a participant said or showed through the guide (a caption: Speak; a point with words: Glance), as this
 *  window heard it (core/src/guide.rs relays them, never journaled): Talk keeps an AI participant's as turns once
 *  they're down, so the call reads in order, even what came while Talk was closed. */
export type Said = { text: string; by: string; at: number; level: "Speak" | "Glance" };

/** The newest this window keeps. */
const SAID_MAX = 50;

// ---- The store: the call this window was last told, or none, and what was said through the guide.

let call: Call | null = null;
let said: Said[] = [];
// A connection just opened: its catch-up sends the call before the world, so a world with no call before it means the
// call this window showed is over (a restarted core, or everyone else gone for good).
let fresh = false;
const watchers = new Set<() => void>();
const floorWatchers = new Set<(change: { speaker: string; on: boolean }) => void>();

function set(next: Call | null) {
  const before = new Set(call?.people.filter((p) => p.speaking).map((p) => p.name));
  const after = new Set(next?.people.filter((p) => p.speaking).map((p) => p.name));
  call = next;
  for (const watcher of watchers) watcher();
  const changes = [...[...before].filter((name) => !after.has(name)).map((speaker) => ({ speaker, on: false })),
    ...[...after].filter((name) => !before.has(name)).map((speaker) => ({ speaker, on: true }))];
  for (const change of changes) for (const listener of floorWatchers) listener(change);
}

/** A message this window's socket heard, as it came (room.tsx): the call's own, a guide's caption or point, or the
 *  world that ends a catch-up. */
export function heard(data: unknown) {
  if (typeof data !== "string") return;
  if (data.startsWith('{"type":"guide"')) {
    try {
      const { kind, text, by, at_ms } = JSON.parse(data) as { kind: string; text: string; by: string; at_ms: number };
      if (!text || !by) return;
      said = [...said, { text, by, at: at_ms || Date.now(), level: kind === "caption" ? "Speak" as const : "Glance" as const }].slice(-SAID_MAX);
      for (const watcher of watchers) watcher();
    } catch { /* not a guide message after all */ }
    return;
  }
  if (data.startsWith('{"type":"call"')) {
    fresh = false;
    try {
      const { started_ms, people, level, level_by } = JSON.parse(data) as Call;
      set({ started_ms, people, level, level_by });
    } catch { /* not a call after all */ }
  } else if (fresh && data.startsWith('{"type":"snapshot"')) {
    fresh = false;
    set(null);
  }
}

/** A new connection opened: its catch-up says whether there's a call. */
export function opened() {
  fresh = true;
}

/** The connection dropped: who has the floor isn't known any more (the rest stays shown until the core says again). */
export function closed() {
  if (call?.people.some((p) => p.speaking)) set({ ...call, people: call.people.map((p) => ({ ...p, speaking: false })) });
}

const subscribe = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
const now = () => call;

/** The call, or null when there's none (alone, or not told yet). */
export function useCall(): Call | null {
  return useSyncExternalStore(subscribe, now, now);
}

const saidNow = () => said;
/** What participants said or showed through the guide in this window, oldest first (the newest 50). */
export function useSaid(): readonly Said[] {
  return useSyncExternalStore(subscribe, saidNow, saidNow);
}

/** Calls `listener` each time someone takes or gives back the floor (the bricks' `speaking`, BrickSlot.tsx); returns
 *  the way to stop. */
export function watchSpeaking(listener: (change: { speaker: string; on: boolean }) => void) {
  floorWatchers.add(listener);
  return () => { floorWatchers.delete(listener); };
}

// ---- Pure helpers.

/** Who is here now, you first, then people in the order they joined, then AI participants. */
export function hereNow(c: Call | null, me: string): Person[] {
  return ordered(c, me).filter((p) => p.here);
}

/** The people and AI participants in the call: a Remote is a window of the room, not one of them. */
function persons(c: Call | null): Person[] {
  return (c?.people ?? []).filter((p) => !p.remote);
}

/** Everyone in the call, here or gone, in the order the people row shows them. */
export function ordered(c: Call | null, me: string): Person[] {
  const people = persons(c);
  return [...people.filter((p) => p.name === me), ...people.filter((p) => p.name !== me && !p.ai), ...people.filter((p) => p.name !== me && p.ai)];
}

/** A call is on while two are here at once (a person and an AI participant count; a Remote doesn't). */
export function inCall(c: Call | null): boolean {
  return persons(c).filter((p) => p.here).length >= 2;
}

/** How many people (not AI participants, not Remotes) are here. */
export function peopleHere(c: Call | null): number {
  return persons(c).filter((p) => p.here && !p.ai).length;
}

/** The Remotes open now, in the order they joined: the room menu lists them, as devices, and nothing else does. */
export function remotesHere(c: Call | null): Person[] {
  return (c?.people ?? []).filter((p) => p.remote && p.here);
}

/** The letter on someone's avatar: their name's first, as a capital; ✦ for an AI participant. */
export function initialOf(name: string, ai = false): string {
  if (ai) return "✦";
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** How a name reads in a sentence: an AI participant named Friend is "the Friend". */
export function named(person: Pick<Person, "name" | "ai">): string {
  return person.ai && person.name === "Friend" ? "the Friend" : person.name;
}

/** A time of day as the Talk tab shows it: "7:37", no seconds and no AM or PM. */
export function clock(ms: number): string {
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(ms));
  return parts.filter((part) => part.type !== "dayPeriod").map((part) => part.value).join("").trim();
}

/** What someone is doing now, in a word or two: speaking, mic on, here, or when they left. */
export function stateWord(person: Person, captioning = false): string {
  if (person.speaking || captioning) return "speaking";
  if (!person.here) return person.left_ms ? `left ${clock(person.left_ms)}` : "left";
  if (person.mic) return "mic on";
  return "here";
}

/** Who hears you, for the status line: "Maya and the Friend hear you"; "" alone. */
export function heardBy(c: Call | null, me: string): string {
  const others = hereNow(c, me).filter((p) => p.name !== me).map(named);
  if (!others.length) return "";
  const list = others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
  return `${list} ${others.length === 1 ? "hears" : "hear"} you`;
}

/** A join code as people read it out: capitals in groups of four (or three, for six), "K7M2 X9QP". */
export function shownCode(code: string): string {
  const plain = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const size = plain.length === 6 || plain.length === 9 ? 3 : 4;
  return plain.match(new RegExp(`.{1,${size}}`, "g"))?.join(" ") ?? "";
}
