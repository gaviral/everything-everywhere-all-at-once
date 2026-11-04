import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createWalkthrough, ResearchWalkthrough, researchWalkthrough } from "./index";
import "./preview.css";

type Demonstration = { view: string; selected: string; filter: string };

function Preview() {
  const [demo, setDemo] = useState<Demonstration>({ view: "Cards", selected: "Garden", filter: "Selected" });
  const current = useRef(demo);
  current.current = demo;
  const [mounted, setMounted] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [controller] = useState(() => {
    const host = {
      captureReturnPoint() {
        const saved = { ...current.current };
        const scroll = { x: window.scrollX, y: window.scrollY };
        const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return { label: `${saved.view} · ${saved.selected} · ${saved.filter}`, async restore() {
          if ((document.querySelector("#fail-return") as HTMLInputElement)?.checked) return false;
          flushSync(() => setDemo(saved));
          window.scrollTo(scroll.x, scroll.y);
          focus?.focus({ preventScroll: true });
          return true;
        } };
      },
      async showFeature() {
        if ((document.querySelector("#fail-feature") as HTMLInputElement)?.checked) return false;
        flushSync(() => setDemo({ view: "Canvas", selected: "Library", filter: "All" }));
        return true;
      },
    };
    return { verified: researchWalkthrough.createController(host), unavailable: createWalkthrough(host, null) };
  });
  return <main className="research-preview">
    <header><p>Scoped preview · synthetic demonstration</p><h1>A short detour, with a way back</h1>
      <p>This preview exercises the host contract. It is separate from the app's feature catalog.</p></header>
    <div className="research-preview-columns">
      <section className="research-preview-demo" aria-label="Synthetic demonstration" data-view={demo.view}>
        <h2>{demo.view}</h2>
        <p>Selected: <strong>{demo.selected}</strong> · Filter: <strong>{demo.filter}</strong></p>
        <label>Show <select aria-label="Demonstration filter" value={demo.filter} onChange={e => setDemo({ ...demo, filter: e.target.value })}>
          <option>Selected</option><option>All</option></select></label>
        <div className="research-preview-map"><div>Garden<br /><small>Choose a sunny spot</small></div>
          {(demo.filter === "All" || demo.selected === "Library") && <div>Library<br /><small>Collect reference books</small></div>}</div>
      </section>
      {mounted && <ResearchWalkthrough controller={unavailable ? controller.unavailable : controller.verified} />}
    </div>
    <details className="research-preview-tools"><summary>Preview conditions</summary>
      <label><input type="checkbox" checked={!mounted} onChange={e => setMounted(!e.target.checked)} /> Temporarily unmount panel</label>
      <label><input type="checkbox" checked={unavailable} onChange={e => setUnavailable(e.target.checked)} /> No verified evidence</label>
      <label><input id="fail-feature" type="checkbox" /> Feature unavailable</label>
      <label><input id="fail-return" type="checkbox" /> Return temporarily unavailable</label>
    </details>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
