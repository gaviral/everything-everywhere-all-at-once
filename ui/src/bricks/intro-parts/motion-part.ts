import { measureHomePart, type HomePart } from "./home-part";

export const INTRO_PART_MS = 2050;
const PART_EASE = "cubic-bezier(.22,.8,.24,1)";
type PartMotion = { element: HTMLElement; frames: Keyframe[] };

function transformPart(xPart: number, yPart: number, scalePart: number): string {
  return `translate(${xPart}px, ${yPart}px) scale(${scalePart})`;
}

function wordMotionPart(wordPart: HTMLElement, compactPart: HTMLElement, homePart: HomePart | null, measurePart: DOMRect): PartMotion {
  const leadPart = wordPart.querySelector<HTMLElement>(".intro-parts-lead")!;
  const fromPart = leadPart.getBoundingClientRect();
  const toPart = compactPart.getBoundingClientRect();
  const originPart = wordPart.getBoundingClientRect();
  const alignPart = (xPart: number, yPart: number, scalePart: number) => transformPart(
    xPart - originPart.x - (fromPart.x - originPart.x) * scalePart,
    yPart - originPart.y - (fromPart.y - originPart.y) * scalePart, scalePart,
  );
  const fontPart = parseFloat(getComputedStyle(leadPart).fontSize);
  const compactFontPart = parseFloat(getComputedStyle(compactPart).fontSize);
  const centerPart = alignPart(toPart.x, toPart.y, compactFontPart / fontPart);
  const homeScalePart = (homePart?.fontSize ?? compactFontPart) / compactFontPart;
  const landingPart = homePart ? alignPart(
    homePart.x + (toPart.x - measurePart.x) * homeScalePart,
    homePart.y, homePart.fontSize / fontPart,
  ) : centerPart;
  return { element: wordPart, frames: [
    { transform: "none", offset: 0 },
    { transform: "none", offset: .25, easing: PART_EASE },
    { transform: centerPart, offset: .54 },
    { transform: centerPart, offset: .64, easing: PART_EASE },
    { transform: landingPart, opacity: 1, offset: .95 },
    { transform: landingPart, opacity: 0, offset: 1 },
  ] };
}

function fadePart(elementPart: HTMLElement, incomingPart: boolean): PartMotion {
  return { element: elementPart, frames: [
    { opacity: incomingPart ? 0 : 1, offset: 0 },
    { opacity: incomingPart ? 0 : 1, offset: .25 },
    { opacity: incomingPart ? 1 : 0, offset: .49 },
    { opacity: incomingPart ? 1 : 0, offset: 1 },
  ] };
}

/** Measurement is its own part: read all positions before any animation writes. */
function planMotionPart(rootPart: HTMLElement): PartMotion[] {
  const homePart = measureHomePart();
  const measurePart = rootPart.querySelector<HTMLElement>(".intro-parts-measure")!;
  const boundsPart = measurePart.getBoundingClientRect();
  const lettersPart = [...measurePart.children] as HTMLElement[];
  const wordsPart = [...rootPart.querySelectorAll<HTMLElement>(".intro-parts-word")];
  const motionParts = wordsPart.map((part, index) => wordMotionPart(part, lettersPart[index], homePart, boundsPart));
  rootPart.querySelectorAll<HTMLElement>(".intro-parts-tail, .intro-parts-original").forEach(part => motionParts.push(fadePart(part, false)));
  rootPart.querySelectorAll<HTMLElement>(".intro-parts-number").forEach(part => motionParts.push(fadePart(part, true)));
  rootPart.querySelectorAll<HTMLElement>(".intro-parts-paper, .intro-parts-hint").forEach(part => motionParts.push({ element: part, frames: [
    { opacity: 1, offset: 0 }, { opacity: 1, offset: .25 }, { opacity: 0, offset: .64 }, { opacity: 0, offset: 1 },
  ] }));
  return motionParts;
}

/** The motion part owns only its own animations, and resolves when the last part lands. */
export function playMotionPart(rootPart: HTMLElement, finishPart: () => void): () => void {
  const animationsPart = planMotionPart(rootPart).map(part => part.element.animate(part.frames, { duration: INTRO_PART_MS, fill: "both" }));
  let cancelledPart = false;
  Promise.all(animationsPart.map(part => part.finished)).then(() => { if (!cancelledPart) finishPart(); }).catch(() => {});
  return () => { cancelledPart = true; animationsPart.forEach(part => part.cancel()); };
}
