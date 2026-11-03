// Margin notes as the window holds them (core/src/annotate.rs): a note is a tangent anchored to words, a thread under
// the point's thread whose thoughts are the note and its replies, with the words it's tied to in `World.anchors`
// (by the note's thread id). Pure, so scripts/world-mirror-check.mjs holds `applyAnchored` to the core's, and the
// playground (bricks/playground.tsx) answers a brick's `annotate` with the changes the core would send.
import type { Thread, Thought, World } from "./core";
import { THOUGHT_MAX } from "./limits";

/** The words a note is tied to: a point's thought, and the words picked in it as they read then. */
export interface Anchor {
  thought_id: string;
  quote: string;
}

/** A note's thread tied to words (world.rs `Change::Anchored`). */
export type AnchoredChange = { type: "anchored"; thread_id: string; thought_id: string; quote: string };

/** As the core's `World::apply`: only for a thread on the map; kept after it leaves, so an Undo brings the note back. */
export function applyAnchored<W extends World>(world: W, c: AnchoredChange): W {
  if (!world.threads.some((t) => t.id === c.thread_id)) return world;
  return { ...world, anchors: { ...world.anchors, [c.thread_id]: { thought_id: c.thought_id, quote: c.quote } } };
}

/** One line, as a quote shows (the core's `one_line`). */
export const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

/** A note as the window sends it (protocol.rs `ClientMsg::Annotate`), or why it can't go: the same bounds as the core's
 *  (a thought's 6,000 characters for each), so a note the core would refuse never leaves. */
export function annotateMessage(thoughtId: string, quote: string, text: string): { message: string } | { refused: string } {
  const words = oneLine(quote), said = text.trim();
  if (!words || !said) return { refused: "A note needs words, and the words it's about." };
  if ([...words].length > THOUGHT_MAX || [...said].length > THOUGHT_MAX) return { refused: "Too long for one note: 6,000 characters at most." };
  return { message: JSON.stringify({ type: "annotate", thought_id: thoughtId, quote: words, text: said }) };
}

/** The threads a brick is handed (contract.ts `Thread`): each margin note's with its `anchor`. The same array while
 *  neither changes, so work kept on `map.threads` isn't redone per word heard. */
export function anchoredThreads(): (threads: Thread[], anchors: Record<string, Anchor> | undefined) => (Thread & { anchor?: Anchor })[] {
  let last: { threads: Thread[]; anchors: Record<string, Anchor> | undefined; out: (Thread & { anchor?: Anchor })[] } | null = null;
  return (threads, anchors) => {
    if (last && last.threads === threads && last.anchors === anchors) return last.out;
    const out = !anchors || !threads.some((t) => anchors[t.id]) ? threads : threads.map((t) => (anchors[t.id] ? { ...t, anchor: anchors[t.id] } : t));
    last = { threads, anchors, out };
    return out;
  };
}

/** The note thread already on these words, if one is on the map (the core's `tangent`). */
export function noteOn(world: Pick<World, "threads" | "anchors">, thoughtId: string, quote: string): string | null {
  return world.threads.find((t) => world.anchors?.[t.id]?.thought_id === thoughtId && world.anchors[t.id].quote === quote)?.id ?? null;
}

/** The changes the core makes for a note by `speaker` (annotate.rs `note`), for the playground, which has no core: a
 *  new thread and its anchor for the first note on those words, then the note itself, placed as written. Null when the
 *  core would refuse it (the point isn't placed on a thread on the map). `ids` makes the new ids. */
export function noteChanges(world: World, speaker: string, thoughtId: string, quote: string, text: string, now: number,
  ids: { thread: () => string; thought: () => string }): object[] | null {
  const point = world.thoughts.find((t) => t.id === thoughtId && t.placed);
  const home = point?.thread_id && world.threads.find((t) => t.id === (world.merged[point.thread_id!] ?? point.thread_id));
  const words = oneLine(quote), said = text.trim();
  if (!home || !words || !said) return null;
  const found = noteOn(world, thoughtId, words);
  const thread = found ?? ids.thread();
  const changes: object[] = [];
  if (!found) {
    const title = words.split(" ").slice(0, 6).join(" ");
    const made: Thread = { id: thread, title: `${title.charAt(0).toUpperCase()}${title.slice(1)}${words.split(" ").length > 6 ? "…" : ""}`, parent_id: home.id,
      status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" };
    changes.push({ type: "thread_added", thread: made }, { type: "anchored", thread_id: thread, thought_id: thoughtId, quote: words });
  }
  const thought: Thought = { id: ids.thought(), speaker, text: said, point: "", thread_id: thread, placed: false, unclear: "", complete: true, at_ms: now, place_ms: null };
  changes.push({ type: "thought_added", thought },
    { type: "thought_placed", thought_id: thought.id, thread_id: thread, point: said, unclear: "", complete: true, place_ms: 0 },
    { type: "thread_touched", thread_id: thread, last_point: said, at_ms: now });
  return changes;
}
