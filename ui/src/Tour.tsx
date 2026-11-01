import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TOURED_KEY = "e2a2o.toured";
let dismissedInMemory = false;

export function hasToured() {
  try { return dismissedInMemory || localStorage.getItem(TOURED_KEY) === "1"; }
  catch { return dismissedInMemory; }
}

function rememberTour() {
  dismissedInMemory = true;
  try { localStorage.setItem(TOURED_KEY, "1"); } catch { /* Storage may be unavailable. */ }
}

type Step = { slot: string; title: string; text: string };

export function Tour({ populated }: { populated: boolean }) {
  // The initial snapshot determines the path, even if the map changes during the tour.
  const [steps] = useState<Step[]>(() => {
    const composer = { slot: "tour-composer", title: "Speak or type", text: "Start with whatever's on your mind. Tap the mic to talk, or type and press Enter." };
    const map = { slot: "tour-map", title: "Your thread map", text: populated ? "Use Show on a thread to explore its thoughts and branches." : "As thoughts are placed, they find a thread here. Tangents can branch off." };
    const tools = { slot: "tour-tools", title: "Try these", text: "Apps above the map watch and react. Use Palace in the map toolbar for another view, or Recap in the header for a summary." };
    return populated ? [map, composer, tools] : [composer, map, tools];
  });
  const [step, setStep] = useState(() => hasToured() ? -1 : 0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(true);
  useLayoutEffect(() => {
    if (step >= 0 && focusNext.current) {
      nextRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
      nextRef.current?.focus({ preventScroll: true });
      focusNext.current = false;
    }
  }, [step]);

  if (step < 0) return null;
  const current = steps[step];
  const slot = document.getElementById(current.slot);
  if (!slot) return null;
  const finish = () => {
    rememberTour();
    setStep(-1);
    const target = current.slot === "tour-tools" ? ".apps-title" : current.slot === "tour-map" ? ".thread-toggle, .composer input" : ".composer input";
    requestAnimationFrame(() => document.querySelector<HTMLElement>(target)?.focus());
  };
  const next = () => {
    if (step === steps.length - 1) { finish(); return; }
    focusNext.current = true;
    setStep(step + 1);
  };

  return createPortal(<section className="tour-tip" aria-label={`Quick tour, step ${step + 1} of ${steps.length}`}>
    <div className="tour-copy" id="tour-copy">
      <span className="tour-count">Quick tour · {step + 1} of {steps.length}</span>
      <strong>{current.title}</strong>
      <p>{current.text}</p>
    </div>
    <div className="tour-actions">
      <button className="tour-skip" onClick={finish}>Skip tour</button>
      <button ref={nextRef} className="tour-next" aria-describedby="tour-copy" onClick={next}>{step === steps.length - 1 ? "Got it" : "Next"}</button>
    </div>
  </section>, slot);
}
