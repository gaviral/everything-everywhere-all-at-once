import { useEffect } from "react";
import type { BrickProps } from "../contract";
import "./brick-chip.css";

// A small chip on each point that came while this brick is on, anyone's, naming the brick: at the head of the point's
// own Delete and Move, so it shows when they do (pointing at the point, or tapping it on a phone). Which brick acted on
// a thought isn't in the contract (`landed` says nothing of who sent it), so for now the chip names only this one.
// Kept for the visit: switched off, every chip goes.
export default function BrickChip({ on, brick }: BrickProps) {
  useEffect(() => {
    const came = new Set<string>();
    const chips = new Map<HTMLElement, HTMLElement>();
    /** A chip on every point that came while it's on, none on any other: the points are the app's, so they're found
     *  again whenever the page changes (a card folded and opened, the map redrawn, a point joined to the next). */
    const sync = () => {
      const wanted = new Set<HTMLElement>();
      if (came.size) for (const point of document.querySelectorAll<HTMLElement>('.points li[id^="point-"]')) {
        // A point joined across a pause has its earlier parts in data-heads.
        const ids = [point.id.slice("point-".length), ...(point.dataset.heads?.split(" ") ?? [])];
        const tools = point.querySelector(":scope > .move-point");
        if (!tools || !ids.some((id) => came.has(id))) continue;
        wanted.add(point);
        let chip = chips.get(point);
        if (!chip) {
          chip = Object.assign(document.createElement("span"), { className: "brick-chip", textContent: brick.name, title: `Came while ${brick.name} was on` });
          chip.setAttribute("aria-hidden", "true");
          chips.set(point, chip);
        }
        // Only what changed: each change is one more the observer below hears.
        if (tools.firstChild !== chip) tools.prepend(chip);
      }
      for (const [point, chip] of chips) if (!wanted.has(point)) { chip.remove(); chips.delete(point); }
    };
    const stop = on("landed", ({ thoughtId }) => { came.add(thoughtId); sync(); });
    const watch = new MutationObserver(sync);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-heads"] });
    return () => {
      stop();
      watch.disconnect();
      for (const chip of chips.values()) chip.remove();
    };
  }, [on, brick.name]);
  return null;
}
