import { useLayoutEffect, useRef, useState } from "react";

/** Follow the rendered source through pan, zoom and late view mounting. */
export function useAnchor(id: string | undefined) {
  const bead = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    if (!id) { setVisible(false); return; }
    let frame = 0, wasVisible = false;
    const follow = () => {
      const target = document.querySelector<HTMLElement>(`[data-guide="point:${CSS.escape(id)}"]`)
        ?? document.querySelector<HTMLElement>(`[data-thought="${CSS.escape(id)}"]`);
      const box = target?.getBoundingClientRect();
      const shown = !!box && box.width > 0 && box.height > 0 && box.bottom > 90
        && box.top < innerHeight - 110 && box.right > 0 && box.left < innerWidth;
      if (shown !== wasVisible) { wasVisible = shown; setVisible(shown); }
      if (shown && box && bead.current && note.current) {
        const x = Math.max(24, Math.min(innerWidth - 24, box.right + 14));
        const y = Math.max(102, Math.min(innerHeight - 120, box.top + Math.min(box.height / 2, 36)));
        bead.current.style.transform = `translate(${x}px, ${y}px)`;
        const width = Math.min(340, innerWidth - 32);
        const height = note.current.offsetHeight;
        const left = Math.max(16, Math.min(innerWidth - width - 16, x + 20));
        const top = Math.max(92, Math.min(innerHeight - height - 90, y + 22));
        note.current.style.transform = `translate(${left}px, ${top}px)`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return { bead, note, visible };
}
