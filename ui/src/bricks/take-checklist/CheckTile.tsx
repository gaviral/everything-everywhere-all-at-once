import type { ReactNode } from "react";

export function CheckTile({ title, detail, done, source, children, onToggle }: {
  title: string; detail: string; done: boolean; source: string;
  children?: ReactNode; onToggle?: () => void;
}) {
  const contents = <>
    <span className="take-checklist-tile-top">
      <span className="take-checklist-source">{source}</span>
      <span className="take-checklist-tick" aria-hidden="true">{done ? "✓" : "○"}</span>
    </span>
    <span className="take-checklist-tile-title">{title}</span>
    <span className="take-checklist-detail">{detail}</span>
  </>;
  return onToggle
    ? <button type="button" className="take-checklist-tile" data-done={done} aria-pressed={done}
        aria-label={`${title}: ${done ? "checked by you" : "check by hand"}`} onClick={onToggle}>{contents}</button>
    : <div className="take-checklist-tile" data-done={done}>{contents}{children}</div>;
}
