// How long a notice stays up. Pure, so scripts/notice-check.mjs can run it without a browser.
import { readMs } from "./attention-core";

/** The shortest time any notice is up: the time it always had, enough for a short answer ("Back to Rent"). */
export const SHORTEST_MS = 5000;

/** Notices that stay until dismissed: each asks for something only the person can do (tap the mic again, allow it,
 *  fix a refused key and restart) or says the core is gone. "No AI key" is not one: the header, the composer's
 *  placeholder, the mic and the tour keep saying it, and kept up it covered the Apps bar and the tour's last step.
 *  "The mic is already off." is not one either: it answers "stop listening" and has nothing to ask. */
const STAYS = /^(The mic stopped|Microphone|Couldn't start the mic|Connection lost|The AI key was refused)/i;

export function staysUp(notice: string): boolean {
  return STAYS.test(notice);
}

/** How long an answer is up: its reading time (238 words a minute, plus a look over), never less than before. */
export function upFor(shown: string): number {
  return Math.max(SHORTEST_MS, readMs(shown));
}

/** The slow end of silent reading for most adults, non-fiction, words per minute (175–300, mean 238: Brysbaert 2019).
 *  A deadline set at the mean reader would cut off half of readers before they finish. */
export const SLOW_WPM = 175;
/** Deciding to act on what you just read: the Keystroke-Level Model's mental step (Card, Moran & Newell 1980: 1.35 s). */
export const DECIDE_MS = 1350;
/** Reaching the button: a hand from keys or lap to the mouse (0.4 s), then pointing at it (1.1 s), from the same model.
 *  The click itself isn't counted: once the pointer is on the notice, the notice waits (App.tsx). */
export const REACH_MS = 400 + 1100;

/** How long a slow reader takes to find and read `text`: one look over, then its words at `SLOW_WPM`. */
export function slowReadMs(text: string): number {
  return readMs(text, SLOW_WPM);
}

/** How long a notice with Undo is up: long enough to act on, not just read. A slow reader notices it and reads it with
 *  its button ("Undo ⌘Z"), checks the map for what it names (about as many words again), decides, and reaches for the
 *  button. Past this, ⌘Z and "undo that" still take the turn back for as long as the core keeps it correctable. */
export function undoUpFor(shown: string): number {
  return Math.max(upFor(shown), slowReadMs(`${shown} Undo ⌘Z`) + slowReadMs(shown) + DECIDE_MS + REACH_MS);
}

/** Whether a key press is the platform's Undo: ⌘Z on a Mac, Ctrl+Z elsewhere; never with Shift (redo) or Option. */
export function isUndoKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** What a press of the Undo key does: "app" takes back the last turn, "none" swallows it (a held key's repeats, so
 *  holding ⌘Z can't undo the undo), "browser" leaves the field's own undo of typing. The empty composer is the app's
 *  only while nothing was typed there since the last thought went: a draft typed and cleared is the browser's to restore. */
export function undoKeyGoesTo(press: { repeat: boolean; field: boolean; composer: boolean; composerEmpty: boolean; typedSinceSend: boolean }): "app" | "none" | "browser" {
  if (press.field && !(press.composer && press.composerEmpty && !press.typedSinceSend)) return "browser";
  return press.repeat ? "none" : "app";
}

/** The Undo shortcut, as this platform writes it. */
export function undoKeyLabel(mac: boolean): string {
  return mac ? "⌘Z" : "Ctrl+Z";
}
