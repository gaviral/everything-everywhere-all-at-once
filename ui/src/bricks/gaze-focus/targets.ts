import type { Thread } from "../contract";
import type { Target } from "./estimate";

export function visibleTargets(threads: readonly Thread[]): Target[] {
  const titles = new Map(threads.map(t => [t.id, t.title]));
  const found = new Map<string, Target>();
  for (const node of document.querySelectorAll<HTMLElement>("[data-thread], [data-gaze-example]")) {
    const example = node.hasAttribute("data-gaze-example");
    if (!example && node.closest(".gaze-focus")) continue;
    const id = (example ? node.dataset.gazeExample : node.dataset.thread) ?? "";
    const title = example ? node.textContent?.trim() : titles.get(id);
    const r = node.getBoundingClientRect();
    if (!title || r.width < 20 || r.height < 20 || r.bottom < 0 || r.right < 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const candidate = { id, title, example, box: { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y } };
    const previous = found.get(id);
    if (!previous || candidate.box.width * candidate.box.height > previous.box.width * previous.box.height) found.set(id, candidate);
  }
  const all = [...found.values()];
  return all.some(t => !t.example) ? all.filter(t => !t.example) : all;
}
