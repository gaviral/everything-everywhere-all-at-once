// Two small rules from the UX principles audit (2026-11-01), kept pure so scripts/ux-check.mjs can hold them.

/** Whether a click on a card's head opens or folds the card. The whole head is the target (Fitts: a 550 × 38 px head
 *  instead of a 51 × 33 px "Show" at its far end; Jakob: cards open where you click them, as Things' rows do), except
 *  where the click already means something else (a tag, a button, a field, a ✦ or dot whose tap shows its tip, as
 *  the point-click handler already skips) or ends selecting text to copy. */
export function headClickToggles(target: { closest(selector: string): unknown } | null, selected = ""): boolean {
  if (!target || selected.trim()) return false;
  return !target.closest("button, a, input, textarea, select, label, [role='button'], [contenteditable='true'], [data-tip]");
}

/** Whether the dock shows its live line. Words always show; with none yet, the map shows "Listening…" to hold the
 *  line's place (the dock doesn't jump when words start). The Palace leaves it out: the header's dot and the
 *  composer's "Listening… or type" already say it, and the dock is then only the composer, so it covers less of the
 *  pictures' captions (at 1440 × 900 the line sat on the second row's captions in the demo's last frame). */
export function showsLiveLine(state: { words: boolean; pending: number; listening: boolean; starting: boolean; view: "map" | "palace" }): boolean {
  if (state.words) return true;
  if (state.pending > 0) return false;
  if (state.starting) return true;
  return state.listening && state.view === "map";
}

/** How long a touch on a title is held to rename it: iOS's own long press (UILongPressGestureRecognizer's
 *  minimumPressDuration, 0.5 s), so it feels like every other long press on the phone. */
export const LONG_PRESS_MS = 500;

/** What a press on a card's title does. A tap opens or folds the card, as the rest of the head does: on a phone the
 *  title is the biggest target in a folded head, and tap = open is the convention (Things on iPhone opens a to-do on
 *  tap and edits its title inside). A click, Enter or Space (`detail` 0), a long press or a double tap renames; so does
 *  "rename this to …". `pointerType` is the press's ("" when none was seen), `heldMs` how long it was held. */
export function titleTap(pointerType: string, detail: number, heldMs: number): "open" | "rename" {
  const touch = pointerType === "touch" || pointerType === "pen";
  return touch && detail === 1 && heldMs < LONG_PRESS_MS ? "open" : "rename";
}
