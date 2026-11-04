import { useState } from "react";
import type { Layout, Link } from "./layout";

/** Hover and keyboard focus independently reveal their own thread; leaving one keeps the other. */
export function useThreadReveal(layout: Layout, enabled: boolean) {
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const threadAt = (target: EventTarget | null) => {
    const key = target instanceof Element ? target.closest(".react-flow__node")?.getAttribute("data-id") : null;
    return key ? layout.byKey.get(key)?.thread ?? null : null;
  };
  return {
    handlers: enabled ? {
      onPointerOver: (event: React.PointerEvent) => setHover(threadAt(event.target)),
      onPointerLeave: () => setHover(null),
      onFocusCapture: (event: React.FocusEvent) => setFocus(threadAt(event.target)),
      onBlurCapture: (event: React.FocusEvent) => setFocus(threadAt(event.relatedTarget)),
    } : {},
    visible: (link: Link) => enabled && [hover, focus].includes(layout.byKey.get(link.from.key)?.thread ?? ""),
  };
}
