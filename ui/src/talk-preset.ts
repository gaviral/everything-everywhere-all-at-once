// A view over the existing switches: their saved choices stay untouched beneath Talk.
import { useSyncExternalStore } from "react";

const STORE = "e2a2o.preset";
const browser = typeof window !== "undefined";
function read() {
  try { return localStorage.getItem(STORE) === "talk"; } catch { return false; }
}
let talk = browser && (new URLSearchParams(location.search).get("preset") === "talk" || read());
const watchers = new Set<() => void>();
export const talkOn = () => talk;
export const watchTalk = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
export const useTalk = () => useSyncExternalStore(watchTalk, talkOn, () => false);
function changed() {
  // Leaving a link-opened preset must also survive reload at that address.
  if (browser && !talk) {
    const url = new URL(location.href);
    if (url.searchParams.get("preset") === "talk") {
      url.searchParams.delete("preset");
      history.replaceState(history.state, "", url);
    }
  }
  if (browser) document.documentElement.toggleAttribute("data-talk", talk);
  for (const watcher of watchers) watcher();
}
export function switchTalk(value: boolean) {
  talk = value;
  try { localStorage.setItem(STORE, value ? "talk" : ""); } catch { /* this visit still works */ }
  changed();
}
if (browser) {
  if (talk) switchTalk(true);
  window.addEventListener("storage", (event) => {
    if (event.key === STORE || event.key === null) { talk = read(); changed(); }
  });
}
/** Whole turns only; a sentence about talk mode remains a thought. */
export function talkCommand(text: string): boolean | null {
  const words = text.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  return words === "talk mode" ? true : words === "all features" ? false : null;
}
