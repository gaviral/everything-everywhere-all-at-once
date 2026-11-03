// History (the rail's tab): what happened in this window, newest first, each AI act with what takes it back. Fed by
// the events the features hear (`on("landed")`, `on("notice")`, bricks/contract.ts) and the AI's map changes with their
// Undo (core.ts `mapChange`): the Notice timeline's list, with Undo on every line that can still be taken back.
//  - a thought the AI placed (yours): Undo takes it off the map; the notice that answers brings it back with its Undo
//  - an AI rename, merge or correction: Undo puts each back as it was (untidy, restore), as its note's Undo does
//  - a turn the core answered: its Undo while it's still your newest turn (the core keeps one per person, catalog.rs)
import { useEffect, useRef, useState } from "react";
import type { BrickOn } from "../bricks/contract";
import type { World } from "../core";
import { keyWords } from "../site";
import type { TidyNote, TidyUndo } from "../tidy-core";

export type Undo =
  | { kind: "turn"; id: number }
  | { kind: "change"; undo: TidyUndo[]; restore: string[] }
  | { kind: "remove"; thoughtId: string };

export type Entry = {
  n: number;
  at: number;
  kind: "landing" | "notice" | "error" | "change";
  /** The AI did it (✦). */
  ai: boolean;
  text: string;
  /** Under the words, quieter: which model put it where, and how fast. */
  detail?: string;
  threadId?: string;
  undo?: Undo;
  undone?: boolean;
};

/** The most kept: the newest. */
const KEPT = 80;
const MISSING_KEY = [keyWords(false, false, "notice"), keyWords(true, false, "notice")];

/** "muse-spark-1.3-contributor" → "Muse Spark 1.3"; a name already spelled out stays. */
export function modelWords(model: string): string {
  return model.includes(" ") ? model : model.split("-").filter((part) => part && part !== "contributor")
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1))).join(" ");
}

export function seconds(ms: number | null | undefined): string {
  return typeof ms === "number" && ms > 0 ? `${(ms / 1000).toFixed(1)} s` : "";
}

/** The history of this window, from the moment it opened. `undoId`: the core's Undo for your newest turn, if any. */
export function useHistory(on: BrickOn, world: World, mapChange: (TidyNote & { id: number }) | null, undoId: number | null) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const count = useRef(0);
  const missingKeyEntry = useRef<number | null>(null);
  const latestNotice = useRef<number | null>(null);
  const worldNow = useRef(world);
  worldNow.current = world;
  const add = (entry: Omit<Entry, "n">, replaceLast?: (last: Entry) => boolean) => {
    const next = { ...entry, n: ++count.current };
    setEntries((was) => {
      if (replaceLast && was[0] && replaceLast(was[0])) return [next, ...was.slice(1)];
      return [next, ...was].slice(0, KEPT);
    });
    return next.n;
  };

  // A thought landing: who placed it and how fast. Yours can be taken back; another person's is theirs to.
  useEffect(() => on("landed", (landed) => {
    const thought = worldNow.current.thoughts.find((t) => t.id === landed.thoughtId);
    const thread = worldNow.current.threads.find((t) => t.id === landed.threadId);
    if (!thought) return;
    const words = thought.point || thought.text;
    const who = landed.mine ? "" : `${thought.speaker}: `;
    add({
      at: Date.now(), kind: "landing", ai: !!landed.model,
      text: `${who}“${words}”${thread ? ` → ${thread.title}` : ""}`,
      // Which model and how fast, as a line's facts: the map's own landing note says it in a sentence.
      detail: landed.model ? [modelWords(landed.model), seconds(landed.ms)].filter(Boolean).join(" · ") : undefined,
      threadId: landed.threadId,
      undo: landed.mine ? { kind: "remove", thoughtId: landed.thoughtId } : undefined,
    });
  }), [on]);

  // Notices as they came up, in the words the window showed. A map update comes with its Undo below instead.
  useEffect(() => on("notice", (notice) => {
    if (notice.kind === "map-change" || !notice.text.trim()) return;
    // Only History keeps this once per window, even across other activity or after its row ages out.
    // Match the displayed words exactly: a refused key and the daily limit are different events.
    const missingKey = MISSING_KEY.includes(notice.text);
    if (missingKey && missingKeyEntry.current !== null) {
      latestNotice.current = missingKeyEntry.current;
      return;
    }
    latestNotice.current = add({ at: notice.time, kind: notice.kind === "error" ? "error" : "notice", ai: false, text: notice.text });
    if (missingKey) missingKeyEntry.current = latestNotice.current;
  }), [on]);

  // An AI rename, merge or correction, with its Undo. A refiner's pass arrives one change at a time, each note joining
  // the one before (tidy-core.ts `joinNotes`): one line for the pass, as one note.
  const lastChange = useRef(0);
  useEffect(() => {
    if (!mapChange || mapChange.id === lastChange.current) return;
    const joined = !!(mapChange.renamed && mapChange.renamed.length > 1) || !!(mapChange.refined && mapChange.refined.length > 1);
    lastChange.current = mapChange.id;
    const undo = mapChange.undo?.length || mapChange.restore?.length ? { kind: "change" as const, undo: mapChange.undo ?? [], restore: mapChange.restore ?? [] } : undefined;
    add({ at: Date.now(), kind: "change", ai: mapChange.ai, text: mapChange.text, undo }, joined ? (last) => last.kind === "change" && !last.undone : undefined);
  }, [mapChange]);

  // The core's Undo follows the notice it answers, including a missing-key repeat coalesced into an older row.
  useEffect(() => {
    if (undoId == null) return;
    const n = latestNotice.current;
    const coalesced = n === missingKeyEntry.current;
    setEntries((was) => {
      const entry = was.find((e) => e.n === n);
      if (!entry || (entry.undo && (!coalesced || entry.undo.kind !== "turn"))) return was;
      return was.map((e) => (e.n === n ? { ...e, undo: { kind: "turn", id: undoId }, undone: undefined } : e));
    });
  }, [undoId]);

  const markUndone = (n: number) => setEntries((was) => was.map((e) => (e.n === n ? { ...e, undone: true } : e)));
  return { entries, markUndone };
}

/** Whether an entry's Undo can still act: a turn's only while it's your newest (`undoId`). */
export function canUndo(entry: Entry, undoId: number | null): boolean {
  if (!entry.undo || entry.undone) return false;
  return entry.undo.kind !== "turn" || entry.undo.id === undoId;
}
