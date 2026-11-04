import type { BrickActions } from "../contract";
import type { Feature } from "./catalog";
import { closeCatalog } from "../../bricks-core";

/** The host owns view navigation. Use its existing Show control after its row arrives. */
export function revealFeature(feature: Feature, actions: BrickActions, unavailable: () => void): () => void {
  const needsView = feature.source === "brick" ? feature.kind === "view" && feature.id !== "spine" : ["cards", "pictures", "saved-answers"].includes(feature.id);
  if (!needsView) { closeCatalog(); return () => {}; }
  let stopped = false;
  let opened = false;
  const stop = () => { stopped = true; observer.disconnect(); window.clearTimeout(timeout); };
  const reveal = () => {
    if (stopped) return;
    const escaped = CSS.escape(feature.id);
    if (opened) {
      const content = document.querySelector<HTMLElement>(`main[data-brick="${escaped}"]`);
      if (!content?.textContent?.trim()) return;
      content.scrollIntoView({ block: "start", behavior: "instant" });
      stop();
      return;
    }
    const row = document.querySelector(`[data-detail="${escaped}"]`) ?? document.querySelector(`[data-row="${escaped}"]`);
    const show = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(button => button.textContent?.trim() === "Show");
    const classic = document.querySelector<HTMLButtonElement>(`[data-guide="view:${escaped}"]`);
    if (!show && !classic) return;
    opened = true;
    (show ?? classic)?.click(); closeCatalog();
    if (feature.source === "built-in") stop();
  };
  const observer = new MutationObserver(reveal);
  const timeout = window.setTimeout(() => { if (!stopped) { stop(); unavailable(); } }, 5000);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  actions.openCatalog(feature.id); reveal();
  return stop;
}
