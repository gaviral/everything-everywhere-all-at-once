import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { DemoVariants, createVariantSession } from "./index";
import type { MergeAdapter, MergeRequest, MergeResult, VariantReference } from "./contracts";

const originals: readonly VariantReference[] = [
  { id: "demo-gallery", title: "Gallery", branchId: "sample/gallery", canvasId: "sample-gallery", features: [
    { id: "outline", label: "Outline", description: "A compact outline of the story." },
    { id: "cards", label: "Picture cards", description: "Browse the story as picture cards." },
  ] },
  { id: "demo-timeline", title: "Timeline", branchId: "sample/timeline", canvasId: "sample-timeline", features: [
    { id: "outline", label: "Outline", description: "A compact outline of the story." },
    { id: "steps", label: "Story steps", description: "Follow the story in sequence." },
  ] },
];

function createControlledOwner() {
  let pending: { request: MergeRequest; resolve(result: MergeResult): void; reject(error: Error): void } | undefined;
  const adapter: MergeAdapter = { request: request => new Promise((resolve, reject) => { pending = { request, resolve, reject }; }) };
  return {
    adapter,
    settle(outcome: "merged" | "declined" | "error" | "invalid") {
      if (!pending) return;
      const current = pending;
      pending = undefined;
      if (outcome === "error") { current.reject(new Error("Synthetic owner disconnected")); return; }
      current.resolve({ requestId: outcome === "invalid" ? "wrong-request" : current.request.requestId,
        outcome: outcome === "merged" ? "merged" : "declined", receipt: "synthetic-receipt",
        detail: "Synthetic adapter response. No repository merge was performed." });
    },
  };
}

const controlled = createControlledOwner();
const missing = new URLSearchParams(location.search).has("missing");
const session = createVariantSession(originals, missing ? undefined : controlled.adapter);

function Preview() {
  const [visible, setVisible] = useState(true);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <main>
    <aside style={{ maxWidth: 960, margin: "0 auto 16px", font: "16px/1.5 system-ui" }}>
      <h1>Synthetic demo preview</h1>
      <p>No repository changes. Feature lists are samples; the host is not wired.</p>
      <p>Effective sample feature set: {state.activeId ?? "none"}</p>
      <button onClick={() => setVisible(!visible)} style={{ minHeight: 44 }}>{visible ? "Leave choices" : "Return to choices"}</button>{" "}
      <a href={missing ? "preview.html" : "preview.html?missing"}>{missing ? "Use controlled sample owner" : "Use missing owner"}</a>
      {!missing && <fieldset disabled={state.merge.status !== "pending"} style={{ marginTop: 12 }}>
        <legend>Controlled sample owner</legend>
        {(["merged", "declined", "error", "invalid"] as const).map(outcome => <button key={outcome} style={{ minHeight: 44 }}
          onClick={() => controlled.settle(outcome)}>Reply {outcome}</button>)}
      </fieldset>}
    </aside>
    {visible && <DemoVariants session={session} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
