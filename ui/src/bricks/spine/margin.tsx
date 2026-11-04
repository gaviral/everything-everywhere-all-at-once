import { usePluginState } from "../contract";
// Margin notes: words picked in a point and answered, by anyone, beside those words (layout.ts places them, nodes.tsx
// draws them). One mechanism with tangents: a note is a tangent anchored to words (contract.ts `Thread.anchor`), a thread
// under the point's thread whose thoughts are the note and its replies, made with `actions.annotate`, so a note made
// here reaches every window the way a tangent does. Picking words: double-click a point's words (a press and drag still
// moves the point), then drag or shift-click to take more; R on a focused point answers all its words.
import { useContext } from "react";
import { DiscussionContext } from "../contract";
import { useEffect, useMemo, useRef, type FormEvent } from "react";
import type { AnchorContext, BrickActions, MapSnapshot, Thread } from "../contract";
import type { MarginInput } from "./layout";

export function anchorOf(thread: Thread) {
  const anchor = thread.anchor;
  return anchor?.thought_id && anchor.quote ? { thoughtId: anchor.thought_id, quote: anchor.quote, ...(anchor.context === undefined ? {} : { context: anchor.context }) } : null;
}

const asks = (text: string) => /\?\s*$/.test(text);

/** The map's margin notes, as the layout takes them; the threads that are notes, not tangents; and the way to add one. */
export function useMargins(map: MapSnapshot, actions: BrickActions) {
  // Worked out again only when the map changes: the layout redoes everything when these do.
  const discussion = useContext(DiscussionContext);
  const controls = !!discussion?.enabled;
  const { margins, anchored } = useMemo(() => {
    const anchored = new Set<string>();
    const margins: MarginInput[] = [];
    const said = new Map<string, MapSnapshot["thoughts"][number][]>();
    for (const t of map.thoughts) if (t.thread_id) said.set(t.thread_id, [...(said.get(t.thread_id) ?? []), t]);
    for (const thread of map.threads) {
      const anchor = anchorOf(thread);
      if (!anchor) continue;
      anchored.add(thread.id);
      const entries = [...(said.get(thread.id) ?? [])].sort((a, b) => a.at_ms - b.at_ms).map((t) => ({ thoughtId: t.id, by: t.speaker || "you", text: (t.point || t.text).trim() }));
      // An unanswered question from someone else folds to "…?" until it's opened; yours never hides from you.
      const theirs = entries[0] && entries[0].by !== map.me && entries[0].by !== "you";
      margins.push({ controls, id: thread.id, thoughtId: anchor.thoughtId, quote: anchor.quote, ...(anchor.context === undefined ? {} : { context: anchor.context }), entries, question: entries.length === 1 && !!theirs && asks(entries[0].text) });
    }
    return { margins, anchored };
  }, [map.threads, map.thoughts, map.me, controls]);

  // For every window, by you: the first note on those words starts their note, a later one answers in it.
  const add = (thoughtId: string, quote: string, text: string, context?: AnchorContext) => actions.annotate(thoughtId, quote, text, context);
  return { margins, anchored, add };
}

/** Where words were picked, and the reply being typed to them. */
export interface Picking {
  /** The point's canvas key, and the thought its words are. */
  key: string;
  thoughtId: string;
  quote: string;
  context?: AnchorContext;
  /** Under the picked words' end, in the frame's pixels. */
  x: number;
  y: number;
  typing: boolean;
}

const short = (quote: string) => (quote.length > 28 ? `${quote.slice(0, 26).trimEnd()}…` : quote);

/** "Reply" under the picked words; then the box to type it in. */
export function Reply({ picking, start, send, cancel, width }: { picking: Picking; start(): void; send(text: string): boolean; cancel(): void; width: number }) {
  const [text, setText] = usePluginState(`reply:${picking.thoughtId}:${picking.quote}`, "");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (picking.typing) field.current?.focus(); }, [picking.typing]);
  const left = Math.max(8, Math.min(picking.x, width - (picking.typing ? 300 : 110)));
  if (!picking.typing) {
    return <button type="button" className="spine-reply-ask" style={{ left, top: picking.y + 6 }}
      // Keeps the words picked while the button is pressed.
      onMouseDown={(event) => event.preventDefault()} onClick={start} aria-label={`Reply to “${picking.quote}”`}>
      Reply<kbd className="spine-key">↵</kbd>
    </button>;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() && send(text.trim())) setText("");
  };
  return <form className="spine-reply" style={{ left, top: picking.y + 6 }} onSubmit={submit}>
    <input ref={field} className="spine-reply-field" value={text} onChange={(event) => setText(event.target.value)} maxLength={500}
      placeholder={`Reply to “${short(picking.quote)}”`} aria-label={`Reply to “${picking.quote}”`}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }} />
    <kbd className="spine-key" aria-hidden="true">↵</kbd>
  </form>;
}
