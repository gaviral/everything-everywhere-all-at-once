// How long a notice stays up. Pure, so scripts/notice-check.mjs can run it without a browser.
import { readMs } from "./attention-core";

/** The shortest time any notice is up: the time it always had, enough for a short answer ("Back to Rent"). */
export const SHORTEST_MS = 5000;

/** Notices that stay until dismissed: each asks for something only the person can do (tap the mic again, allow it,
 *  fix a refused key and restart) or says the core is gone. "No AI key" is not one: the header, the composer's
 *  placeholder, the mic and the tour keep saying it, and kept up it covered the Apps bar and the tour's last step.
 *  "The mic is already off." is not one either: it answers "stop listening" and has nothing to ask. */
const STAYS = /^(The mic stopped|Microphone|Couldn't start the mic|Connection lost|The AI key was refused)/i;

/** What the window says when the mic stops on its own: why, when the core said (the voice service went quiet or the
 *  connection to it broke, or the service's own words), else only that it stopped. Each starts "The mic stopped", so
 *  it stays up until the person taps the mic again. `error` is the core's last voice error since this mic started. */
export function micStopped(error: string): string {
  const reason = error.replace(/^(Voice Transcribe|Speech service error):\s*/, "").trim();
  if (/stopped answering|didn't answer|couldn't reach|connection|reset|closed|timed? ?out|io error/i.test(reason)) {
    return "The mic stopped: the voice service stopped answering. Check the connection, then tap the mic.";
  }
  if (reason) return `The mic stopped: the voice service said “${reason}”. Tap it to try again, or type below.`;
  return "The mic stopped. Tap it to keep talking.";
}

export function staysUp(notice: string): boolean {
  return STAYS.test(notice);
}

/** How long an answer is up: its reading time (238 words a minute, plus a look over), never less than before. */
export function upFor(shown: string): number {
  return Math.max(SHORTEST_MS, readMs(shown));
}
