import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keyWords, useSite } from "./site";

const TOURED_KEY = "e2a2o.toured";
let dismissedInMemory = false;

export function hasToured() {
  // `?recording` in the address skips the tour, so a fresh browser profile can record straight away.
  try { return dismissedInMemory || new URLSearchParams(location.search).has("recording") || localStorage.getItem(TOURED_KEY) === "1"; }
  catch { return dismissedInMemory; }
}

function rememberTour() {
  dismissedInMemory = true;
  try { localStorage.setItem(TOURED_KEY, "1"); } catch { /* Storage may be unavailable. */ }
}

type Step = { slot: string; title: string; text: string };

export function Tour({ populated, noKey }: { populated: boolean; noKey: boolean }) {
  // The initial snapshot determines the path, even if the map changes during the tour.
  const { hosted } = useSite();
  const [order] = useState(() => populated ? ["tour-map", "tour-composer", "tour-tools"] : ["tour-composer", "tour-map", "tour-tools"]);
  // Without a key the tour teaches what works (a sample map is for exploring), never the mic or a model's answer.
  // Read each render: the core's word about the key comes right after the snapshot that mounts the tour.
  const copy: Record<string, Step> = {
    "tour-composer": noKey
      ? { slot: "tour-composer", title: "Type to move around", text: keyWords(hosted, false, "tour") }
      : { slot: "tour-composer", title: "Speak or type", text: "Start with whatever's on your mind. Tap the mic to talk, or type and press Enter. Lost your place? Say “where was I?”" },
    "tour-map": { slot: "tour-map", title: "Your thread map", text: populated ? "Use Show to see a thread’s thoughts. Its branches appear below it." : "As thoughts are placed, they find a thread here. Tangents can branch off." },
    "tour-tools": noKey
      ? { slot: "tour-tools", title: "Try these", text: "Palace shows a picture for every thread, and search finds the words you used. Press ? for everything you can say." }
      : { slot: "tour-tools", title: "Try these", text: "Select words on the map to have them explained. Apps react to your thoughts; Recap gives you a summary. Press ? for everything you can say." },
  };
  const steps = order.map((slot) => copy[slot]);
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
