// How long a notice stays up. Pure, so scripts/notice-check.mjs can run it without a browser.
import { readMs } from "./attention-core";

/** The shortest time any notice is up: the time it always had, enough for a short answer ("Back to Rent"). */
export const SHORTEST_MS = 5000;

/** Notices that stay until dismissed: each asks for something only the person can do (tap the mic again, allow it,
 *  fix a refused key and restart) or says the core is gone. "No AI key" is not one: the header, the composer's
 *  placeholder, the mic and the tour keep saying it, and kept up it covered the Apps bar and the tour's last step.
 *  "The mic is already off." is not one either: it answers "stop listening" and has nothing to ask. */
const STAYS = /^(The mic stopped|Microphone|Couldn't start the mic|Connection lost)|was refused/i;

export function staysUp(notice: string): boolean {
  return STAYS.test(notice);
}

/** How long an answer is up: its reading time (238 words a minute, plus a look over), never less than before. */
export function upFor(shown: string): number {
  return Math.max(SHORTEST_MS, readMs(shown));
}
