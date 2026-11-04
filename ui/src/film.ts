// Filming is opt-in. Coordinates for the pointer are browser pixels; camera x/y are React Flow viewport offsets.
import { FILM, driveFilmCamera, type Camera } from "./bricks/spine/film";
import { filmStage } from "./film-stage";
export { FILM } from "./bricks/spine/film";

declare global {
  interface Window {
    e2a2oFilm?: {
      camera: Camera;
      stage: ReturnType<typeof filmStage>["stage"];
      card: ReturnType<typeof filmStage>["card"];
      list: ReturnType<typeof filmStage>["list"];
      cursor(point: { x: number; y: number; press?: boolean }): void;
      caption(text: string): void;
      clear(): void;
    };
  }
}

export function startFilm() {
  if (!FILM) return;
  document.documentElement.classList.add("film");
  const layer = document.createElement("div");
  layer.className = "film-layer";
  layer.setAttribute("aria-hidden", "true");
  const pointer = document.createElement("div");
  pointer.className = "film-pointer";
  pointer.hidden = true;
  const ripple = document.createElement("div");
  ripple.className = "film-ripple";
  ripple.hidden = true;
  const caption = document.createElement("div");
  caption.className = "film-caption";
  caption.hidden = true;
  layer.append(ripple, pointer, caption);
  document.body.append(layer);
  const presentation = filmStage(document.getElementById("root")!, layer);
  let frame = 0;
  window.e2a2oFilm = {
    camera: driveFilmCamera,
    stage: presentation.stage,
    card: presentation.card,
    list: presentation.list,
    cursor({ x, y, press = false }) {
      pointer.hidden = false;
      pointer.style.transform = `translate(${x}px, ${y}px) scale(${press ? 0.85 : 1})`;
      if (!press) return;
      cancelAnimationFrame(frame);
      const start = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / 500);
        ripple.hidden = t === 1;
        ripple.style.transform = `translate(${x}px, ${y}px) scale(${0.6 + t * 2})`;
        ripple.style.opacity = String((1 - t) * 0.6);
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      tick();
    },
    caption(text) {
      caption.textContent = text.replace(/\s+/g, " ").trim();
      caption.hidden = !caption.textContent;
    },
    clear() {
      presentation.clear();
      cancelAnimationFrame(frame);
      pointer.hidden = ripple.hidden = caption.hidden = true;
      caption.textContent = "";
      void driveFilmCamera(null);
    },
  };
  // CSS hides app tips; removing title also suppresses the browser's native hover tips, including later nodes.
  const strip = (node: Element) => {
    node.removeAttribute("title");
    node.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title"));
  };
  strip(document.documentElement);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") (record.target as Element).removeAttribute("title");
      for (const node of record.addedNodes) if (node instanceof Element) strip(node);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
}
