import { createContext, useContext, useMemo } from "react";
import type { Note, Thought, World } from "./core";
import { resolveMerged } from "./merges";
import "./chunks.css";

/** Each thought's note from the placer (core chunks.rs), by thought id; the map's cards read it from here. */
export const NotesContext = createContext<Record<string, Note>>({});

const NO_HEADS: Thought[] = [];

/** One point on a card: a thought, and the words before a pause it carries on (`heads`, oldest first). */
export type Idea = { thought: Thought; heads: Thought[] };

/** A card's thoughts as ideas: one carried on by a later one (the same idea, cut by a pause) shows inside it, at
 *  the later one's place, so the halves read as one point. Only within the card: a link to a thought elsewhere is
 *  ignored, and a head whose carrier left the card shows on its own again. Taken apart ("keep apart"), both show
 *  again as said. */
export function asIdeas(thoughts: Thought[], notes: Record<string, Note>): Idea[] {
  // A head is always said before what carries it on (the core checks), so only an earlier point counts: a bad
  // journal can't make a loop that hides both.
  const at = new Map(thoughts.map((t, i) => [t.id, i]));
  const headOf = (t: Thought) => {
    const id = notes[t.id]?.continues;
    const i = id ? at.get(id) : undefined;
    return i !== undefined && i < at.get(t.id)! ? thoughts[i] : undefined;
  };
  // A head carried on twice (rare: two turns both read as finishing it) stays with the first.
  const carried = new Map<string, string>();
  for (const t of thoughts) {
    const head = headOf(t);
    if (head && !carried.has(head.id)) carried.set(head.id, t.id);
  }
  const ideas: Idea[] = [];
  for (const t of thoughts) {
    if (carried.has(t.id)) continue;
    const heads: Thought[] = [];
    for (let head = headOf(t); head && carried.get(head.id) === (heads[0] ?? t).id; head = headOf(head)) heads.unshift(head);
    ideas.push({ thought: t, heads: heads.length ? heads : NO_HEADS });
  }
  return ideas;
}

/** The thoughts that show inside a later one (`asIdeas`), card by card (`card`: a thought's card), so a count of
 *  thoughts can count ideas, as the cards do. */
export function carriedIds(thoughts: Thought[], notes: Record<string, Note>, card: (t: Thought) => string | null): Set<string> {
  const byCard = new Map<string, Thought[]>();
  for (const t of thoughts) {
    const id = card(t);
    if (id !== null && notes[t.id]?.continues) byCard.set(id, []);
  }
  if (!byCard.size) return new Set();
  for (const t of thoughts) byCard.get(card(t) ?? "")?.push(t);
  return new Set([...byCard.values()].flatMap((list) => asIdeas(list, notes).flatMap((idea) => idea.heads.map((h) => h.id))));
}

/** Thoughts and threads said from `since` through `until` (ms), counted as the cards show them: a part said before a
 *  pause and the one carrying it on are one thought. The header and Recap both count with this, so they agree. */
export function ideaCounts(world: Pick<World, "thoughts" | "threads" | "merged" | "notes">, since: number, until: number) {
  const threadIds = new Set(world.threads.map((thread) => thread.id));
  const card = (thought: Thought) => thought.thread_id && resolveMerged(world, thought.thread_id);
  const carried = carriedIds(world.thoughts, world.notes ?? {}, card);
  const threads = new Set<string>();
  let thoughts = 0;
  for (const thought of world.thoughts) {
    if (!thought.placed || !thought.thread_id || thought.at_ms < since || thought.at_ms > until || carried.has(thought.id)) continue;
    const id = card(thought)!;
    if (threadIds.has(id)) { thoughts++; threads.add(id); }
  }
  return { thoughts, threads: threads.size };
}

/** A card's ideas, recomputed only when its thoughts or the notes change. */
export function useIdeas(thoughts: Thought[]): Idea[] {
  const notes = useContext(NotesContext);
  return useMemo(() => asIdeas(thoughts, notes), [thoughts, notes]);
}

export function useNote(id: string): Note | undefined {
  return useContext(NotesContext)[id];
}

/** The words behind a point, each part as said, a pause between: “I never finish my” … “Sentences.” */
export function wordsSaid(heads: Thought[], thought: Thought): string {
  return [...heads, thought].map((t) => `“${t.text.trim()}”`).join(" … ");
}

export const CHUNK_TIPS = {
  joined: "Joined to what you said before the pause, as one idea. Tap to keep them apart.",
  assumed: "How the AI read your words, and why this point is here. Wrong place? Move it.",
};

/** What the placer read into a point, beside it: "✦ joined" when two parts said across a pause became one idea
 *  (one tap takes them apart), and "✦ assumed …" when a reading the words left open moved it from where you were. */
export function PointNote({ thought, heads, unlink }: { thought: Thought; heads: Thought[]; unlink: (thoughtId: string) => void }) {
  const note = useNote(thought.id);
  if (!note) return null;
  const head = heads.at(-1);
  return (
    <>
      {head && (
        // As "✦ fixed": quiet until you look; hover or focus says what a tap does.
        // The button goes with the link: focus moves to the point first, which stays, so the keyboard isn't left at
        // the top of the page.
        <button type="button" className="chunk-mark" data-tip={CHUNK_TIPS.joined} title=""
          onClick={(event) => { event.currentTarget.closest<HTMLElement>("li[tabindex]")?.focus(); unlink(thought.id); }}
          aria-label={`Joined across a pause; keep apart: “${head.text.trim()}” as its own point`}>
          <span aria-hidden="true" data-tip={CHUNK_TIPS.joined}>✦</span> <span>joined</span><span>keep apart</span>
        </button>
      )}
      {note.assumed && (
        // Focusable, so the keyboard reaches its tip as a pointer does (Tips.tsx shows it on focus).
        <span className="assumed" data-tip={CHUNK_TIPS.assumed} title="" tabIndex={0}>
          <span aria-hidden="true" data-tip={CHUNK_TIPS.assumed}>✦</span> Assumed {note.assumed}
        </span>
      )}
    </>
  );
}
