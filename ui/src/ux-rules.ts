// Two small rules from the UX principles audit (2026-11-01), kept pure so scripts/ux-check.mjs can hold them.

/** Whether a click on a card's head opens or folds the card. The whole head is the target (Fitts: a 550 × 38 px head
 *  instead of a 51 × 33 px "Show" at its far end; Jakob: cards open where you click them, as Things' rows do), except
 *  where the click already means something else (a tag, a button, a field) or ends selecting text to copy. */
export function headClickToggles(target: { closest(selector: string): unknown } | null, selected = ""): boolean {
  if (!target || selected.trim()) return false;
  return !target.closest("button, a, input, textarea, select, label, [role='button'], [contenteditable='true']");
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
