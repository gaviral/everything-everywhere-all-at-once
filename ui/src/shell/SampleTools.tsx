import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./parts";
import { NAMES } from "./names";
import "./sample-tools.css";

export type SampleToolsProps = {
  returnResult: unknown;
  onReturn: () => void;
  onPictures: () => void;
};

/** The sample's shortcuts start visible, then get out of the way of what they reveal. */
export function SampleTools({ returnResult, onReturn, onPictures }: SampleToolsProps) {
  const [open, setOpen] = useState(!returnResult);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => { if (returnResult) setOpen(false); }, [returnResult]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (root.current?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        toggle.current?.focus();
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const act = (action: () => void) => {
    // Closing the menu restores its own focus, without taking it from the composer.
    const focusWasInside = root.current?.contains(document.activeElement);
    setOpen(false);
    if (focusWasInside) toggle.current?.focus({ preventScroll: true });
    action();
  };
  return <div ref={root} className="sample-tools">
    <button ref={toggle} type="button" className="sample-tools-toggle" aria-label="Sample map actions"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span className="stamp" data-stamp={NAMES.stamp.sample} title={NAMES.stampSays.sample}>{NAMES.stamp.sample}</span><Icon name="chevron" />
    </button>
    <div id={id} className="sample-recovery-actions" role="group" aria-label="Sample map actions" aria-hidden={!open} inert={!open} hidden={!open}>
      <button type="button" className="shell-btn" onClick={() => act(onReturn)}>Where was I?</button>
      <button type="button" className="shell-btn" onClick={() => act(onPictures)}>Pictures</button>
    </div>
  </div>;
}
