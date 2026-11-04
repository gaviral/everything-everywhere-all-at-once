import type { FilmOptions } from "./bricks/spine/film";

export type StagePose = { rotateX: number; rotateY: number; rotateZ: number; scale: number; x: number; y: number };
export type FilmCard = { bg?: string; words: string | string[]; each?: number; hold?: number };
export type FilmList = { bg?: string; items: string[]; each?: number };
const flat: StagePose = { rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, x: 0, y: 0 };
const easing = (ease: FilmOptions["ease"]) => typeof ease === "function" ? ease : (t: number) => {
  if (ease === "linear") return t;
  if (ease === "ease-in") return t * t * t;
  if (ease === "ease-out") return 1 - (1 - t) ** 3;
  return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

// Called only by ?film. Keep live DOM at the capture device's pixel density, never a bitmap of the app.
export function filmStage(root: HTMLElement, layer: HTMLElement) {
  let scene: HTMLDivElement | null = null;
  let pose = { ...flat };
  let originalTransform = "";
  let stageFrame = 0;
  let stageDone: ((completed: boolean) => void) | undefined;
  const paint = () => {
    root.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotateX(${pose.rotateX}deg) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg) scale(${pose.scale})`;
  };
  const stage = (target: Partial<StagePose> | null, { duration = 3200, ease }: FilmOptions = {}): Promise<boolean> => {
    cancelAnimationFrame(stageFrame);
    stageDone?.(false);
    stageDone = undefined;
    if (target === null) {
      if (scene) {
        scene.before(root);
        scene.remove();
        scene = null;
        root.classList.remove("film-window");
        root.style.transform = originalTransform;
      }
      pose = { ...flat };
      return Promise.resolve(true);
    }
    if (!scene) {
      originalTransform = root.style.transform;
      scene = document.createElement("div");
      scene.className = "film-stage";
      root.before(scene);
      scene.append(root);
      root.classList.add("film-window");
    }
    const from = { ...pose }, to = { ...flat, scale: .82, ...target };
    const start = Date.now(), curve = easing(ease);
    return new Promise((resolve) => {
      stageDone = resolve;
      const tick = () => {
        const t = duration <= 0 ? 1 : Math.min(1, (Date.now() - start) / duration);
        const progress = curve(t);
        for (const key of Object.keys(flat) as (keyof StagePose)[]) pose[key] = from[key] + (to[key] - from[key]) * progress;
        paint();
        if (t < 1) stageFrame = requestAnimationFrame(tick);
        else { stageDone = undefined; resolve(true); }
      };
      tick();
    });
  };

  const title = document.createElement("div");
  title.className = "film-title";
  title.hidden = true;
  layer.append(title);
  let titleFrame = 0;
  let titleDone: ((completed: boolean) => void) | undefined;
  const clearTitle = () => {
    cancelAnimationFrame(titleFrame);
    titleDone?.(false);
    titleDone = undefined;
    title.hidden = true;
    title.textContent = "";
  };
  const sequence = (items: string[], bg: string, each: number, hold: number): Promise<boolean> => {
    clearTitle();
    if (!items.length) return Promise.resolve(true);
    title.style.background = bg === "brand" ? "var(--accent)" : bg;
    title.hidden = false;
    const start = Date.now();
    return new Promise((resolve) => {
      titleDone = resolve;
      const tick = () => {
        const elapsed = Date.now() - start;
        if (elapsed >= items.length * each + hold) {
          titleDone = undefined;
          title.hidden = true;
          title.textContent = "";
          resolve(true);
          return;
        }
        // One live text node; replacement on the cut, with no fade, blur or moving type.
        title.textContent = items[Math.min(items.length - 1, Math.floor(elapsed / each))];
        titleFrame = requestAnimationFrame(tick);
      };
      tick();
    });
  };
  return {
    stage,
    card: ({ bg = "#000", words, each = 700, hold = 1000 }: FilmCard) =>
      sequence(typeof words === "string" ? words.trim().split(/\s+/).filter(Boolean) : words, bg, each, hold),
    list: ({ bg = "brand", items, each = 350 }: FilmList) => sequence(items, bg, each, 0),
    clear: () => { clearTitle(); void stage(null); },
  };
}
