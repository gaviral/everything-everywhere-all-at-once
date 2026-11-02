// Margin notes: words picked in a point and answered, by anyone, beside those words (layout.ts places them, nodes.tsx
// draws them). One mechanism with tangents (a note is a tangent anchored to words), so a note made here reaches every
// window the way a tangent does. Picking words: double-click a point's words (a press and drag still moves the point),
// then drag or shift-click to take more; R on a focused point answers all its words.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BrickActions, MapSnapshot, Thread } from "../contract";
import type { MarginInput } from "./layout";

// contract: a margin note comes back in the map as an anchored tangent: a thread whose parent is the point's thread,
// with `anchor: { thought_id, quote }`, and the note and its replies as its thoughts (one mechanism for asides,
// questions and replies). The host makes one with `actions.annotate(thoughtId, quote, text)`; neither is in
// contract.ts yet.
type Anchored = Thread & { anchor?: { thought_id?: string; quote?: string } };
type Annotate = (thoughtId: string, quote: string, text: string) => void;
export const annotateOf = (actions: BrickActions) => (actions as BrickActions & { annotate?: Annotate }).annotate;

export function anchorOf(thread: Thread) {
  const anchor = (thread as Anchored).anchor;
  return anchor?.thought_id && anchor.quote ? { thoughtId: anchor.thought_id, quote: anchor.quote } : null;
}

/** A note kept in this browser while the host can't keep it: the shape the map would bring. */
interface Kept { id: string; thoughtId: string; quote: string; entries: { by: string; text: string; at: number }[] }

const asks = (text: string) => /\?\s*$/.test(text);

/** The map's margin notes and this browser's stand-ins, as the layout takes them; the threads that are notes, not
 *  tangents; and the way to add one. */
export function useMargins(map: MapSnapshot, actions: BrickActions) {
  const first = map.thoughts.reduce((at, t) => Math.min(at, t.at_ms), Infinity);
  const key = Number.isFinite(first) ? `e2a2o.spine.notes:${location.host}:${first}` : null;
  const read = (k: string | null): Kept[] => {
    if (!k) return [];
    try {
      const kept = JSON.parse(localStorage.getItem(k) ?? "[]");
      return Array.isArray(kept) ? kept.filter((n) => n && typeof n.id === "string" && typeof n.thoughtId === "string" && Array.isArray(n.entries)) : [];
    } catch { return []; }
  };
  const [held, setHeld] = useState(() => ({ key, notes: read(key) }));
  const kept = held.key === key ? held.notes : read(key);
  const told = useRef(false);

  const anchored = new Set<string>();
  const margins: MarginInput[] = [];
  const said = new Map<string, MapSnapshot["thoughts"][number][]>();
  for (const t of map.thoughts) if (t.thread_id) said.set(t.thread_id, [...(said.get(t.thread_id) ?? []), t]);
  for (const thread of map.threads) {
    const anchor = anchorOf(thread);
    if (!anchor) continue;
    anchored.add(thread.id);
    const entries = [...(said.get(thread.id) ?? [])].sort((a, b) => a.at_ms - b.at_ms).map((t) => ({ by: t.speaker || "you", text: (t.point || t.text).trim() }));
    // An unanswered question from someone else folds to "…?" until it's opened; yours never hides from you.
    const theirs = entries[0] && entries[0].by !== map.me && entries[0].by !== "you";
    margins.push({ id: thread.id, thoughtId: anchor.thoughtId, quote: anchor.quote, entries, question: entries.length === 1 && !!theirs && asks(entries[0].text) });
  }
  for (const note of kept) margins.push({ id: note.id, thoughtId: note.thoughtId, quote: note.quote, entries: note.entries, question: false });

  const add = (thoughtId: string, quote: string, text: string) => {
    const annotate = annotateOf(actions);
    if (annotate) { annotate(thoughtId, quote, text); return; }
    // Until the host keeps notes, this browser does, and says so once: others don't see them yet.
    const was = kept.find((n) => n.thoughtId === thoughtId && n.quote === quote);
    const entry = { by: map.me, text, at: Date.now() };
    const next = was ? kept.map((n) => (n === was ? { ...n, entries: [...n.entries, entry] } : n))
      : [...kept, { id: `note-${thoughtId}-${Date.now().toString(36)}`, thoughtId, quote, entries: [entry] }];
    try { if (key) localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode: for this visit */ }
    setHeld({ key, notes: next });
    if (!told.current) { told.current = true; actions.notify("Note kept in this browser for now: others will see notes once the map keeps them."); }
  };
  return { margins, anchored, add };
}

/** Where words were picked, and the reply being typed to them. */
export interface Picking {
  /** The point's canvas key, and the thought its words are. */
  key: string;
  thoughtId: string;
  quote: string;
  /** Under the picked words' end, in the frame's pixels. */
  x: number;
  y: number;
  typing: boolean;
}

const short = (quote: string) => (quote.length > 28 ? `${quote.slice(0, 26).trimEnd()}…` : quote);

/** "Reply" under the picked words; then the box to type it in. */
export function Reply({ picking, start, send, cancel, width }: { picking: Picking; start(): void; send(text: string): void; cancel(): void; width: number }) {
  const [text, setText] = useState("");
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
    if (text.trim()) send(text.trim());
  };
  return <form className="spine-reply" style={{ left, top: picking.y + 6 }} onSubmit={submit}>
    <input ref={field} className="spine-reply-field" value={text} onChange={(event) => setText(event.target.value)} maxLength={500}
      placeholder={`Reply to “${short(picking.quote)}”`} aria-label={`Reply to “${picking.quote}”`}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }} />
    <kbd className="spine-key" aria-hidden="true">↵</kbd>
  </form>;
}
