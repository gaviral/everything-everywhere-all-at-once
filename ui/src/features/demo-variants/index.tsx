import { useSyncExternalStore } from "react";
import { MergeRequest } from "./MergeRequest";
import { VariantCompare } from "./VariantCompare";
import { VariantSelection } from "./VariantSelection";
import type { VariantSession } from "./selection";
import "./demo-variants.css";

export { createVariantSession } from "./selection";
export type { VariantSession } from "./selection";
export type { VariantReference, VariantFeature, VariantState, MergeAdapter, MergeRequest, MergeResult } from "./contracts";

export const demoVariantsFeature = Object.freeze({
  id: "demo-variants",
  defaultEnabled: false,
  control: Object.freeze({ read: "getSnapshot().enabled", write: "setEnabled(boolean)", active: "getSnapshot().activeId" }),
});

export function DemoVariants({ session }: { session: VariantSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <section className="demo-variants" aria-label="Demo variants">
    <header><div><h2>Demo choices</h2><p>Compare alternatives and keep the original ideas.</p></div>
      <label className="demo-variants-switch"><input type="checkbox" checked={state.enabled}
        onChange={event => session.setEnabled(event.target.checked)} />Enable demo choices</label>
    </header>
    <p>{state.enabled ? "Demo choices on" : "Demo choices off"}</p>
    <VariantCompare session={session} />
    <VariantSelection session={session} />
    <MergeRequest session={session} />
  </section>;
}
