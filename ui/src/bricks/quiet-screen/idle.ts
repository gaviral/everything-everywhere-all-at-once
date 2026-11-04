/** One idle clock for the shell and an optional playground mount. No map or capture actions. */
export const IDLE_MS = 2000;
let mounts = 0;
let release: (() => void) | undefined;

function observeActivity() {
  const root = document.documentElement;
  const keys = new Set<string>();
  const pointers = new Set<number>();
  let composing = false;
  let timer: number | undefined;
  const clearTimer = () => window.clearTimeout(timer);
  const arm = () => {
    clearTimer();
    if (composing || keys.size || pointers.size || document.hidden) return;
    timer = window.setTimeout(() => root.classList.add("quiet-screen-idle"), IDLE_MS);
  };
  const wake = () => { root.classList.remove("quiet-screen-idle"); arm(); };
  const keyDown = (event: KeyboardEvent) => { keys.add(event.code || event.key); wake(); };
  const keyUp = (event: KeyboardEvent) => { keys.delete(event.code || event.key); wake(); };
  const pointerDown = (event: PointerEvent) => { pointers.add(event.pointerId); wake(); };
  const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); wake(); };
  const compositionStart = () => { composing = true; wake(); };
  const compositionEnd = () => { composing = false; wake(); };
  const reset = () => { keys.clear(); pointers.clear(); composing = false; wake(); };
  const windowBlur = (event: FocusEvent) => { if (event.target === window) reset(); };
  const events: [string, EventListener][] = [
    ["pointermove", wake], ["pointerdown", pointerDown as EventListener],
    ["pointerup", pointerUp as EventListener], ["pointercancel", pointerUp as EventListener],
    ["keydown", keyDown as EventListener], ["keyup", keyUp as EventListener],
    ["touchstart", wake], ["touchmove", wake], ["touchend", wake],
    ["input", wake], ["focusin", wake], ["focusout", wake],
    ["compositionstart", compositionStart], ["compositionend", compositionEnd],
    ["blur", windowBlur as EventListener], ["focus", wake], ["visibilitychange", reset],
  ];
  // Capture sees activity even when a map, menu or editor handles the event itself.
  for (const [name, handler] of events) window.addEventListener(name, handler, { capture: true, passive: true });
  root.classList.add("quiet-screen");
  wake();
  return () => {
    clearTimer();
    for (const [name, handler] of events) window.removeEventListener(name, handler, true);
    root.classList.remove("quiet-screen", "quiet-screen-idle");
  };
}

export function attachQuietScreen() {
  if (mounts++ === 0) release = observeActivity();
  return () => { if (--mounts === 0) { release?.(); release = undefined; } };
}
