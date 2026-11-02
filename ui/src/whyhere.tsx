import { createContext, useContext, useEffect, useRef } from "react";
import type { Note, WhyAnswer } from "./core";
import { useNote } from "./chunks";
import "./whyhere.css";

/** Answers to "Why here?" this window asked for, and how to ask (core.ts `askWhy`). */
export type WhyAsk = { whys: Record<string, WhyAnswer>; ask: (thoughtId: string) => void };
export const WhyContext = createContext<WhyAsk>({ whys: {}, ask: () => {} });

export type WhyLine = { text: string; pending?: boolean; failed?: boolean };

/** How a thought's reason reads, or null while there's none to show. The placer's own reason is "Why here"; one
 *  asked for afterwards is a reading, not what decided it, so it says "Likely why". An answer the map gave (a move of
 *  yours, the thought that started its thread) comes back as words only. */
export function whyLine(note: Note | undefined, answer: WhyAnswer | undefined): WhyLine | null {
  if (note?.why) return { text: `${note.later ? "Likely why" : "Why here"}: ${note.why}` };
  if (!answer) return null;
  if (answer.pending) return { text: "Why here: …", pending: true };
  if (answer.failed) return { text: answer.text, failed: true };
  return { text: `Why here: ${answer.text}` };
}

/** Answers kept after a change: one is about where the thought sat when asked, so its move (or that move's Undo)
 *  drops it; the core says what holds now when asked again. A snapshot keeps only asks still out. */
export function whysAfter(whys: Record<string, WhyAnswer>, msg: { type: "snapshot" } | { type: "change"; change: { type: string; thought_id?: string } }): Record<string, WhyAnswer> {
  if (msg.type === "snapshot") {
    const out = Object.entries(whys).filter(([, a]) => a.pending);
    return out.length === Object.keys(whys).length ? whys : Object.fromEntries(out);
  }
  const id = msg.change.type === "thought_moved" ? msg.change.thought_id : undefined;
  if (!id || !(id in whys)) return whys;
  const { [id]: _, ...rest } = whys;
  return rest;
}

/** A point's hover card: its words said, then its reason when one is known (C225: "the reason in the hover card"). */
export function hoverTitle(words: string, line: WhyLine | null): string {
  return line && !line.pending && !line.failed ? (words ? `${words}\n${line.text}` : line.text) : words;
}

/** A thought's reason, on demand: its line when known, else a quiet "Why here?" that asks. `auto`: opening this was
 *  the ask (a "While you were away" row's Why?), so it asks at once. Answers arrive in a polite live region, and the
 *  ask's own button hands focus to that line rather than vanishing from under the keyboard. */
export function WhyHere({ thoughtId, auto = false }: { thoughtId: string; auto?: boolean }) {
  const { whys, ask } = useContext(WhyContext);
  const note = useNote(thoughtId);
  const line = whyLine(note, whys[thoughtId]);
  const box = useRef<HTMLSpanElement>(null);
  const known = !!line;
  useEffect(() => { if (auto && !known) ask(thoughtId); }, [auto, thoughtId]);
  const asking = () => { ask(thoughtId); box.current?.focus({ preventScroll: true }); };
  return (
    <span ref={box} className="why" tabIndex={-1} aria-live="polite" aria-busy={line?.pending || undefined}>
      {!line && <button type="button" className="why-ask" onClick={asking}>Why here?</button>}
      {line && <span className={line.failed ? "why-failed" : undefined}>{line.text}</span>}
      {line?.failed && <> <button type="button" className="why-ask" onClick={asking}>Try again</button></>}
    </span>
  );
}
