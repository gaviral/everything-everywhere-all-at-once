import type { Action } from "./core";

/** What an action's row says at each step of "Add to Reminders" (App.tsx `ActionRow`), so what shows on camera is
 *  what happened on the Mac: the button while it waits (or "Try again" after a failure, with why under it),
 *  "Adding to Reminders…" while Apple's side runs, and "Added to Reminders · 1.2 s" only once it answered success
 *  (core/src/apple.rs). */
export function actionLine(action: Action, app: string, file = false): { button?: string; label?: string; status?: string; failed?: string } {
  // Off a Mac, or hosted (site.ts), a dated item saves as a calendar file in the browser; one with no day has none,
  // so only its × stays.
  if (file) {
    if (action.status === "new") return dated(action.when) ? { button: "Download .ics", label: `Download ${action.title} as a calendar file` } : {};
    return action.status === "done" ? { status: action.done_ms == null ? "Saved as .ics" : `Added to ${app}` } : {};
  }
  if (action.status === "new") {
    return action.failed
      ? { button: "Try again", label: `Try adding ${action.title} to ${app} again`, failed: action.failed }
      : { button: `Add to ${app}`, label: `Add ${action.title} to ${app}` };
  }
  if (action.status === "kept") return { status: `Adding to ${app}…` };
  if (action.status === "done") return { status: action.done_ms == null ? `Added to ${app}` : `Added to ${app} · ${(action.done_ms / 1000).toFixed(1)} s` };
  return {};
}

/** A real YYYY-MM-DD day, as the core checks it (apps.rs `valid_date`): only then is there a calendar file. */
export function dated(text: string): boolean {
  const when = text.trim();
  const [y, m, d] = when.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return /^\d{4}-\d{2}-\d{2}$/.test(when) && y >= 2000 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A failed "Add to …" said where you'll see it. Its row says why (`actionLine`), but the row isn't always on screen:
 *  "add it to Reminders" said in the Palace (which has no action rows), or with the row scrolled or folded away. Then,
 *  or while the spoken "Adding “…”…" notice is still up and would go on claiming it's being added, the notice says it
 *  instead, naming the item, since it shows away from the row. Null when the row in view says it alone. */
export function failureNotice(title: string, message: string, rowInView: boolean, shown: string): string | null {
  if (rowInView && shown !== `Adding “${title}”…`) return null;
  return message.replace(/^Not added:/, `Couldn't add “${title}”:`);
}
