import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PopulatedVariants } from "./index";
import { syntheticCandidates } from "./ExamplePopulation";
import { browserPreferenceStore } from "./preferences";
import type { PopulatedVariantsAdapter } from "./contracts";
const switchKey = "e2a2o.intake1417.populated-variants.preview-enabled";
const fixture = { reads: 0, subscriptions: 0, cleanups: 0, changed: undefined as (() => void) | undefined, candidates: [...syntheticCandidates] };
// Preview-only instrumentation for the scoped visible check. No app host dependency.
Object.assign(window, { populatedVariantsFixture: fixture });
const adapter: PopulatedVariantsAdapter = {
  getCandidates: () => { fixture.reads++; return fixture.candidates; },
  subscribe: changed => { fixture.subscriptions++; fixture.changed = changed; return () => { fixture.subscriptions--; fixture.cleanups++; fixture.changed = undefined; }; },
  preferences: browserPreferenceStore(),
};
function Preview() {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(switchKey) === "true"; } catch { return false; } });
  const [saveError, setSaveError] = useState(false);
  return <main><div style={{ padding: "1rem", fontFamily: "system-ui" }}><p>Isolated synthetic preview · host integration pending</p>
    <button className="pv-preview-toggle" type="button" role="switch" aria-label="Populated variants" aria-checked={enabled}
      onClick={() => { const next = !enabled; setEnabled(next); try { localStorage.setItem(switchKey, String(next)); setSaveError(false); } catch { setSaveError(true); } }}>Populated variants: {enabled ? "on" : "off"}</button>
    {saveError && <p role="alert">Switch applies for this visit only; local saving is unavailable.</p>}</div>
    <PopulatedVariants enabled={enabled} adapter={adapter} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
