import type { CSSProperties } from "react";
import { useBuiltInsOn } from "../contract";

/** The receipt stays visible in both presentations; metadata is only what the landing supplied. */
export function Placement({ note, style, inline = false }: { note: string; style?: CSSProperties; inline?: boolean }) {
  const detailsOn = useBuiltInsOn().has("placement-details");
  return <div className={`spine-landing${inline ? ' spine-landing-inline' : ''}`} style={style}>
    <span>Placed here</span>
    {detailsOn ? <details className="spine-placement-details nodrag nopan" onToggle={event => {
      const details = event.currentTarget;
      if (!details.open) return;
      requestAnimationFrame(() => {
        const panel = details.querySelector('p'); if (!panel) return;
        panel.style.transform = '';
        const box = panel.getBoundingClientRect();
        const scale = box.width / panel.offsetWidth || 1;
        const shift = Math.min(0, innerWidth - 12 - box.right) + Math.max(0, 12 - box.left);
        panel.style.transform = `translateX(${shift / scale}px)`;
      });
    }} onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    }}><summary>Details</summary><p>{note}</p></details> : <span className="spine-placement-inline">{note}</span>}
  </div>;
}
