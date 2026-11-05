import type { OriginalStroke, StrokePoint } from "./contracts";

export function acceptsPointer(event: PointerEvent) {
  return event.isPrimary && (event.pointerType === "mouse" || event.pointerType === "pen") && event.button === 0;
}

export function normalizePointer(event: PointerEvent, surface: OriginalStroke["surface"]): StrokePoint {
  return Object.freeze({ x: (event.clientX - surface.left) / surface.width,
    y: (event.clientY - surface.top) / surface.height, clientX: event.clientX, clientY: event.clientY,
    timeStamp: event.timeStamp, pressure: event.pressure });
}

export function pointerSamples(event: PointerEvent, surface: OriginalStroke["surface"]) {
  const coalesced = event.getCoalescedEvents?.() ?? [];
  return (coalesced.length ? coalesced : [event]).map(sample => normalizePointer(sample, surface));
}
