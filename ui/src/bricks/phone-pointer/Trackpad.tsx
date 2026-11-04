import { useEffect, useRef, type PointerEvent } from "react";
import type { Input } from "./transport";

export function Trackpad({ disabled, send }: { disabled: boolean; send: (input: Input) => Promise<boolean> }) {
  const finger = useRef<{ id: number; x: number; y: number; distance: number; at: number } | null>(null);
  const delta = useRef({ dx: 0, dy: 0 });
  const pending = useRef<Promise<void> | null>(null);
  const version = useRef(0);
  const pump = (): Promise<void> => {
    if (pending.current) return pending.current;
    const work = async () => {
      while (delta.current.dx || delta.current.dy) {
        const move = { dx: Math.max(-500, Math.min(500, delta.current.dx)), dy: Math.max(-500, Math.min(500, delta.current.dy)) };
        delta.current.dx -= move.dx; delta.current.dy -= move.dy;
        if (!await send({ kind: "move", ...move })) { delta.current = { dx: 0, dy: 0 }; break; }
      }
    };
    pending.current = work().finally(() => { pending.current = null; });
    return pending.current;
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || finger.current || !event.isPrimary) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    version.current++;
    finger.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, at: performance.now() };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const last = finger.current;
    if (!last || last.id !== event.pointerId || disabled) return;
    const dx = event.clientX - last.x, dy = event.clientY - last.y;
    last.distance += Math.hypot(dx, dy); last.x = event.clientX; last.y = event.clientY;
    delta.current.dx += dx * 1.6; delta.current.dy += dy * 1.6;
    void pump();
  };
  const finish = async (event: PointerEvent<HTMLDivElement>) => {
    const last = finger.current;
    if (!last || last.id !== event.pointerId) return;
    finger.current = null;
    const current = version.current;
    await pump();
    if (!disabled && current === version.current && last.distance < 8 && performance.now() - last.at < 400) {
      await send({ kind: "click", button: "left" });
    }
  };
  const cancel = () => { finger.current = null; delta.current = { dx: 0, dy: 0 }; version.current++; };
  useEffect(() => { if (disabled) cancel(); return cancel; }, [disabled]);
  return <div className="phone-pointer-pad" role="group" aria-label="Relative trackpad" aria-disabled={disabled}
    onPointerDown={down} onPointerMove={move} onPointerUp={event => void finish(event)}
    onPointerCancel={cancel} onLostPointerCapture={() => { if (finger.current) cancel(); }}>
    <span className="phone-pointer-orbit" aria-hidden="true">↖</span>
    <strong>Slide to move</strong><span>Lift, reposition, keep going.</span><small>Tap to click at the Mac pointer.</small>
  </div>;
}
