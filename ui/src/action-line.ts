import type { Action } from "./core";

/** What an action's row says at each step of "Add to Reminders" (App.tsx `ActionRow`), so what shows on camera is
 *  what happened on the Mac: the button while it waits (or "Try again" after a failure, with why under it),
 *  "Adding to Reminders…" while Apple's side runs, and "Added to Reminders · 1.2 s" only once it answered success
 *  (core/src/apple.rs). */
export function actionLine(action: Action, app: string): { button?: string; label?: string; status?: string; failed?: string } {
  if (action.status === "new") {
    return action.failed
      ? { button: "Try again", label: `Try adding ${action.title} to ${app} again`, failed: action.failed }
      : { button: `Add to ${app}`, label: `Add ${action.title} to ${app}` };
  }
  if (action.status === "kept") return { status: `Adding to ${app}…` };
  if (action.status === "done") return { status: action.done_ms == null ? `Added to ${app}` : `Added to ${app} · ${(action.done_ms / 1000).toFixed(1)} s` };
  return {};
}
