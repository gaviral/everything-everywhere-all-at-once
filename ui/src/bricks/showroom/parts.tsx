import { useLayoutEffect, useRef, type ReactNode } from "react";
import { GROUPS, type Feature, type Group } from "./catalog";

export function ShowroomDialog({ children, label, close, className = "" }: { children: ReactNode; label: string; close: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`showroom-dialog ${className}`} aria-label={label} onCancel={event => { event.preventDefault(); close(); }}>{children}</dialog>;
}

export function GroupPicker({ group, choose, counts }: { group: Group; choose: (group: Group) => void; counts: number[] }) {
  return <nav className="showroom-groups" aria-label="Feature groups">{GROUPS.map((name, i) =>
    <button key={name} aria-pressed={group === name} onClick={() => choose(name)}>{name}<span>{counts[i]}</span></button>)}</nav>;
}

export function FeatureCard({ feature, selected, number, select, tryFeature }: { feature: Feature; selected: boolean; number: number; select: () => void; tryFeature: () => void }) {
  return <article className={`showroom-card ${selected ? "showroom-selected" : ""}`} data-feature={feature.id} aria-label={feature.name} aria-current={selected ? "true" : undefined} onFocus={select}>
    <div className="showroom-card-top"><span className="showroom-number">{String(number).padStart(2, "0")}</span><span className={`showroom-state ${feature.on ? "showroom-on" : ""}`}>{feature.on ? "On" : "Off"}</span></div>
    <div className="showroom-card-copy"><p className="showroom-kind">{feature.kind}{feature.fresh ? " · New today" : ""}</p><h2>{feature.name}</h2><p className="showroom-does">{feature.does}</p></div>
    <button className="showroom-try" disabled={!feature.available} onClick={tryFeature} aria-label={`Try ${feature.name}`}>{feature.available ? "Try" : "Unavailable here"}<span aria-hidden="true">↗</span></button>
  </article>;
}

export function ReturnDecision({ feature, keep, off, resume }: { feature: Feature; keep: () => void; off: () => void; resume: () => void }) {
  return <ShowroomDialog label={`Keep ${feature.name}?`} close={resume} className="showroom-decision">
    <p className="showroom-eyebrow">You tried it</p><h1>Keep {feature.name}?</h1><p>Choose what stays on your map.</p>
    <div className="showroom-decisions"><button className="showroom-primary" onClick={keep}>Keep on</button><button onClick={off}>Turn off</button></div>
    <button className="showroom-resume" onClick={resume}>Keep trying</button>
  </ShowroomDialog>;
}
