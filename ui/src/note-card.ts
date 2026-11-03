// The note card (core/src/notes.rs), as the window shows it: the note's title and points as Notes gets them, what
// happened to it (saving, saved, a dry run, refused), and Open in Notes once it's there. The core alone writes; the
// window only asks it to open a note it wrote. Plain functions, so scripts/note-card-check.mjs checks them without a page.
import { readingTime, slowReadMs, DECIDE_MS, REACH_MS } from "./notice-rules";

export type NoteState = "saving" | "saved" | "dry_run" | "failed";
export type NotePoint = { text: string; who: string; decided: boolean; unfinished: boolean };
export type NoteSection = { title: string; points: NotePoint[] };

/** The core's `note_card` message. */
export type NoteCardMsg = { type: "note_card"; id: number; title: string; sections: NoteSection[]; state: NoteState; live: boolean; message: string };

/** The card shown. */
export type NoteCard = Omit<NoteCardMsg, "type">;

/** The card after the core's message: a newer note replaces the one up; a late word on an older one leaves the newer. */
export function received(shown: NoteCard | null, msg: NoteCardMsg): NoteCard | null {
  if (shown && msg.id < shown.id) return shown;
  const { type: _type, ...card } = msg;
  return card;
}

/** Whether the card answers a save just asked for (saving, or a dry run's one card): it comes before Recap, which
 *  closes so the card isn't left behind it, as a message counting down does (send-card.ts `comesFirst`). A card's end
 *  never closes it: Recap opened after asking stays. */
export function comesFirst(card: { state: NoteState } | null): boolean {
  return card?.state === "saving" || card?.state === "dry_run";
}

/** The card's class for its state: whole words, so the stylesheet check can see each one used. */
export const STATE_CLASS: Record<NoteState, string> = { saving: "is-saving", saved: "is-saved", dry_run: "is-dry-run", failed: "is-failed" };

/** The card's heading, its status line, and whether it offers Open in Notes (only a note Notes has). */
export function cardWords(card: NoteCard): { heading: string; status: string; open: boolean } {
  const heading = card.live ? "Note in Notes" : "Note in Notes · dry run";
  switch (card.state) {
    case "saving": return { heading, status: card.message || "Saving to Notes…", open: false };
    case "saved": return { heading, status: card.message || "Saved to Notes", open: true };
    case "dry_run": return { heading, status: card.message || "Dry run: nothing written", open: false };
    case "failed": return { heading, status: card.message || "Not saved", open: false };
  }
}

/** How many points the note has, across its sections. */
export function pointCount(card: NoteCard): number {
  return card.sections.reduce((n, s) => n + s.points.length, 0);
}

/** A point as the card writes it: who said it in a room, then its words. Its marks are drawn beside it. */
export function pointWords(point: NotePoint): string {
  return point.who ? `${point.who}: ${point.text}` : point.text;
}

/** What a screen reader hears, once per state: the note's name and size, then how it went. */
export function announcement(card: NoteCard): string {
  const n = pointCount(card);
  return `Note “${card.title}”, ${n} ${n === 1 ? "point" : "points"}. ${cardWords(card).status}`;
}

/** How long an ended card stays up: a slow reader finds the card and reads the whole card, decides, and reaches for Open in Notes (notice-rules.ts). While it saves it
 *  stays; the pointer on it or focus in it holds it (NoteCard.tsx), and × closes it sooner. */
export function lingerMs(card: NoteCard): number {
  if (card.state === "saving") return 0;
  const { heading, status } = cardWords(card);
  return Math.max(slowReadMs(`${heading} ${card.title} ${status}`) + DECIDE_MS + REACH_MS,
    readingTime([heading, card.title, status, ...card.sections.flatMap((s) =>
    [s.title, ...s.points.map((p) => `${pointWords(p)} ${p.decided ? "Decided" : ""} ${p.unfinished ? "unfinished" : ""}`)]),
    ...(cardWords(card).open ? ["Open in Notes"] : [])].join(" ")));
}
