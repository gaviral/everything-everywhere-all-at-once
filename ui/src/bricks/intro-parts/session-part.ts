const SESSION_PART_KEY = "e2a2o.intro-parts.seen";
let seenPart = false;

/** The session part remembers even when browser storage is unavailable. */
export function hasSeenIntroPart(): boolean {
  try { return seenPart || sessionStorage.getItem(SESSION_PART_KEY) === "1"; }
  catch { return seenPart; }
}

export function rememberIntroPart(): void {
  seenPart = true;
  try { sessionStorage.setItem(SESSION_PART_KEY, "1"); } catch { /* The memory part still holds. */ }
}

export function reducedMotionPart(): MediaQueryList {
  return matchMedia("(prefers-reduced-motion: reduce)");
}

export function shouldShowIntroPart(): boolean {
  return !reducedMotionPart().matches && !hasSeenIntroPart();
}
