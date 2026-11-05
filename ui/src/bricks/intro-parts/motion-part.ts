import { measureHomePart } from "./home-part";

export const INTRO_PART_MS = 2050;
const PART_EASE = "cubic-bezier(.22,.8,.24,1)";
type PartMotion = { element: HTMLElement; frames: Keyframe[] };

/** The full words gather at the icon; no letter mark is left behind. */
function wordMotionPart(word: HTMLElement, icon: DOMRect): PartMotion {
  const from = word.getBoundingClientRect();
  const x = icon.x + icon.width / 2 - (from.x + from.width / 2);
  const y = icon.y + icon.height / 2 - (from.y + from.height / 2);
  return { element: word, frames: [
    { transform: "none", opacity: 1, offset: 0 },
    { transform: "none", opacity: 1, offset: .25, easing: PART_EASE },
    { transform: `translate(${x}px, ${y}px) scale(.08)`, opacity: 0, offset: .54 },
    { opacity: 0, offset: 1 },
  ] };
}

function iconMotionPart(icon: HTMLElement): PartMotion {
  const bounds = icon.getBoundingClientRect();
  const home = measureHomePart();
  const landing = home ? `translate(${home.x - bounds.x}px, ${home.y - bounds.y}px) scale(${home.size / bounds.width})` : "none";
  return { element: icon, frames: [
    { opacity: 0, transform: "scale(.75)", offset: 0 },
    { opacity: 0, transform: "scale(.75)", offset: .40, easing: PART_EASE },
    { opacity: 1, transform: "none", offset: .54 },
    { opacity: 1, transform: "none", offset: .64, easing: PART_EASE },
    { opacity: 1, transform: landing, offset: .95 },
    { opacity: 0, transform: landing, offset: 1 },
  ] };
}

/** Read the geometry before starting any animation. */
function planMotionPart(root: HTMLElement): PartMotion[] {
  const icon = root.querySelector<HTMLElement>(".intro-parts-icon")!;
  const bounds = icon.getBoundingClientRect();
  const words = [...root.querySelectorAll<HTMLElement>(".intro-parts-word")];
  const scenery = [...root.querySelectorAll<HTMLElement>(".intro-parts-paper, .intro-parts-hint")];
  return [
    ...words.map(word => wordMotionPart(word, bounds)), iconMotionPart(icon),
    ...scenery.map(element => ({ element, frames: [
      { opacity: 1, offset: 0 }, { opacity: 1, offset: .25 }, { opacity: 0, offset: .64 }, { opacity: 0, offset: 1 },
    ] })),
  ];
}

/** Own only these animations; finish when the icon lands. */
export function playMotionPart(root: HTMLElement, finish: () => void): () => void {
  const animations = planMotionPart(root).map(part => part.element.animate(part.frames, { duration: INTRO_PART_MS, fill: "both" }));
  let cancelled = false;
  Promise.all(animations.map(part => part.finished)).then(() => { if (!cancelled) finish(); }).catch(() => {});
  return () => { cancelled = true; animations.forEach(part => part.cancel()); };
}
