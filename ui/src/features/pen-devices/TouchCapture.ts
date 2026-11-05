/** Only the active drawing surface owns touch gestures; controls and page navigation stay ordinary. */
export function acceptsTouch(event: PointerEvent) {
  return event.isPrimary && event.pointerType === "touch" && event.button === 0;
}
