import type { InputDevice, OriginalStroke } from "./contracts";
import { acceptsPointer, pointerSamples } from "./PointerCapture";
import { acceptsTouch } from "./TouchCapture";

interface CaptureOptions {
  device: InputDevice; sessionId: string;
  draft: (stroke: OriginalStroke | null) => void;
  complete: (stroke: OriginalStroke) => void;
  cancel: () => void;
}

/** One gesture owns one frozen destination and coordinate frame. Unmount discards only the unfinished gesture. */
export function captureStroke(surface: HTMLElement, options: CaptureOptions) {
  let active: OriginalStroke | null = null;
  const release = (pointerId: number) => {
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
  };
  const cancel = () => {
    if (!active) return;
    const pointerId = active.pointerId;
    active = null;
    release(pointerId);
    options.draft(null);
    options.cancel();
  };
  const down = (event: PointerEvent) => {
    const accepts = options.device === "touch" ? acceptsTouch : acceptsPointer;
    if (active || !accepts(event)) return;
    const { left, top, width, height } = surface.getBoundingClientRect();
    if (!width || !height) return;
    event.preventDefault();
    const frame = Object.freeze({ left, top, width, height });
    active = Object.freeze({ id: crypto.randomUUID(), sessionId: options.sessionId, device: options.device,
      pointerType: event.pointerType, pointerId: event.pointerId, timeOrigin: performance.timeOrigin,
      surface: frame, points: Object.freeze(pointerSamples(event, frame)) });
    surface.setPointerCapture(event.pointerId);
    options.draft(active);
  };
  const append = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    active = Object.freeze({ ...active, points: Object.freeze([...active.points, ...pointerSamples(event, active.surface)]) });
    options.draft(active);
  };
  const up = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    append(event);
    const stroke = active!;
    active = null;
    release(event.pointerId);
    options.draft(null);
    options.complete(stroke);
  };
  const canceled = (event: PointerEvent) => { if (active?.pointerId === event.pointerId) cancel(); };
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", append);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", canceled);
  surface.addEventListener("lostpointercapture", canceled);
  window.addEventListener("blur", cancel);
  return () => {
    surface.removeEventListener("pointerdown", down);
    surface.removeEventListener("pointermove", append);
    surface.removeEventListener("pointerup", up);
    surface.removeEventListener("pointercancel", canceled);
    surface.removeEventListener("lostpointercapture", canceled);
    window.removeEventListener("blur", cancel);
    cancel();
  };
}
