import { useEffect, useState } from "react";
import { HOLD_MS, lineFor, useSteps } from "./model-line";
import "./model-line.css";

/** Below the classic composer: the Meta model doing the step now ("Muse Spark 1.2 ·
 *  placing your thought"), what it just did and how long it took, or the one listening. Out of the way while you
 *  type (`hidden`). Screen readers hear each model once (model-line.ts `announcement`), not every change. */
export function ModelLine({ hearing, hidden }: { hearing: boolean; hidden: boolean }) {
  const { state, said } = useSteps();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [state]);
  // A finished step's line gives way once its hold is up.
  useEffect(() => {
    if (!state.last) return;
    const left = state.last.at + HOLD_MS - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), left + 20);
    return () => window.clearTimeout(timer);
  }, [state.last]);
  const line = hidden ? null : lineFor(state, now, hearing);
  return <>
    <span className="sr-only" role="status">{said}</span>
    {line && <span className="model-line" aria-hidden="true" title={line.id ?? "No model: a rule did this"}>
      {line.model && <span className="model-name">{line.model}</span>}
      {line.model && <span className="model-dot">·</span>}
      <span key={line.text} className="model-step">{line.text}</span>
    </span>}
  </>;
}
