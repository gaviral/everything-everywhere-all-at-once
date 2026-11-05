import type { WalkthroughController } from "./controller";

export function ReturnPoint({ controller }: { controller: WalkthroughController }) {
  const state = controller.getSnapshot();
  return <div className="research-walkthrough-return">
    <p>Return to: {state.returnLabel}</p>
    <button disabled={state.busy} onClick={() => void controller.resume()}>Resume demonstration</button>
  </div>;
}
