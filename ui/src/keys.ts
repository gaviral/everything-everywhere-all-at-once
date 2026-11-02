// Keys the page answers that the README, the tour and the ? list promise (scripts/a11y-check.mjs).

/** The composer's input: the skip link, the page's first Tab stop, goes straight to it (it took 46 Tabs). */
export const COMPOSER_ID = "type-a-thought";

/** "Press ? for everything you can say" (the tour): ? opens or closes the list from anywhere but a field, where it's
 *  a character, and never with ⌘, Ctrl or Option, which belong to the browser. */
export function opensHelp({ key, field, modified }: { key: string; field: boolean; modified: boolean }) {
  return key === "?" && !field && !modified;
}

/** "Tab to it and press Enter" (README): Enter or Space on a focused point opens or closes its words, as a click
 *  does. Only on the point itself: its own buttons (Words said, Move, Delete) keep their keys. A key already taken
 *  (Enter asking to explain words selected in it, Explain.tsx) leaves the words open, as a click does with a selection. */
export function togglesPoint({ key, onPoint, taken = false }: { key: string; onPoint: boolean; taken?: boolean }) {
  return onPoint && !taken && (key === "Enter" || key === " ");
}
