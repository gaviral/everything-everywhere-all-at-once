import { useEffect, useRef, useSyncExternalStore } from "react";
import bundledEvidence from "./evidence.json";
import { createWalkthrough, type WalkthroughController } from "./controller";
import { WalkthroughStep } from "./WalkthroughStep";
import style from "./research-walkthrough.css?inline";
export { createWalkthrough } from "./controller";
export type { WalkthroughHost, ReturnPoint, VerifiedEvidence, LocalAsset } from "./contract";

export const researchWalkthrough = {
  id: "research-walkthrough",
  defaultEnabled: false,
  createController: (host: Parameters<typeof createWalkthrough>[0]) => createWalkthrough(host, bundledEvidence),
  Component: ResearchWalkthrough,
} as const;

export function ResearchWalkthrough({ controller }: { controller: WalkthroughController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const open = useRef<HTMLButtonElement>(null);
  const switchControl = useRef<HTMLButtonElement>(null);
  const previous = useRef(state);
  useEffect(() => {
    if (previous.current.step !== "ready" && state.step === "ready") {
      (state.enabled ? open.current : switchControl.current)?.focus({ preventScroll: true });
    }
    previous.current = state;
  }, [state]);
  return <section className="research-walkthrough" aria-label="Research walkthrough" aria-busy={state.busy}>
    <style>{style}</style>
    <div className="research-walkthrough-control">
      <span>Research walkthrough</span>
      <button ref={switchControl} role="switch" aria-label="Research walkthrough" aria-checked={state.enabled}
        disabled={state.busy} onClick={() => void controller.setEnabled(!state.enabled)}>{state.enabled ? "On" : "Off"}</button>
    </div>
    {state.enabled && (state.step === "ready" ? <>
      {controller.evidence ? <><p>One research note behind the Canvas. Your demonstration keeps its place.</p>
        <button ref={open} onClick={() => controller.open()}>Open research note</button></> :
        <p role="status">Verified evidence unavailable. Continue the demonstration without this optional step.</p>}
    </> : <WalkthroughStep controller={controller} />)}
    {state.busy && <p role="status">Returning or opening the demonstration…</p>}
    {state.error && <p role="alert">{state.error}</p>}
  </section>;
}
