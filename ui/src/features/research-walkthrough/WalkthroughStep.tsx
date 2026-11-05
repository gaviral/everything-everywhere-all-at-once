import { useEffect, useRef } from "react";
import type { WalkthroughController } from "./controller";
import { EvidenceCard } from "./EvidenceCard";
import { ReturnPoint } from "./ReturnPoint";

export function WalkthroughStep({ controller }: { controller: WalkthroughController }) {
  const state = controller.getSnapshot();
  const evidence = controller.evidence;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [state.step]);
  if (!evidence) return <p role="status">Verified evidence unavailable. Continue the demonstration without this optional step.</p>;
  return <div>
    <h2 ref={heading} tabIndex={-1}>{state.step === "feature" ? `Demonstration: ${evidence.feature}` : "A place to return to"}</h2>
    {state.step === "feature" ? <>
      <p>{evidence.feature} is open. Explore it, then resume where you left off.</p>
      <button disabled={state.busy} onClick={() => controller.explain()}>Back to explanation</button>
    </> : <>
      <EvidenceCard evidence={evidence} />
      <p>{evidence.connection}</p>
      <button disabled={state.busy} onClick={() => void controller.showFeature()}>Try {evidence.feature}</button>
    </>}
    <ReturnPoint controller={controller} />
  </div>;
}
