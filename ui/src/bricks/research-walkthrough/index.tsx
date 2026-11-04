import { useEffect, useRef, useState } from "react";
import { researchWalkthrough } from "../../msg1351/research-walkthrough";
function useResearchExample() {
  const [view, setView] = useState("Cards");
  const [filter, setFilter] = useState("Garden");
  const place = useRef({ view, filter }); place.current = { view, filter };
  const focus = useRef<HTMLSelectElement>(null);
  const [controller] = useState(() => researchWalkthrough.createController({
    captureReturnPoint: () => { const saved = { ...place.current }; return { label: `${saved.view} · ${saved.filter}`, restore: async () => { setView(saved.view); setFilter(saved.filter); requestAnimationFrame(() => focus.current?.focus()); return true; } }; },
    showFeature: async () => { setView("Canvas"); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); return true; },
  }));
  useEffect(() => { void controller.setEnabled(true); return () => { void controller.setEnabled(false); }; }, [controller]);
  return { view, filter, setFilter, focus, controller };
}
import type { BrickProps } from "../contract";
import "./example.css";
export default function Example({ actions }: BrickProps) {
const example = useResearchExample();
const Research = researchWalkthrough.Component;
return <section className="research-walkthrough-example" aria-label="Research walkthrough example" data-guide="research-walkthrough">
<div><strong>Research walkthrough · local example</strong><button onClick={() => actions.openCatalog("research-walkthrough")}>Features</button></div>
<p>This local example preserves the chosen filter when you return from the research note.</p><label>Example filter <select ref={example.focus} value={example.filter} onChange={event => example.setFilter(event.target.value)}><option>Garden</option><option>Workshop</option></select></label>
<section aria-label="Example demonstration"><h2>{example.view} · {example.filter}</h2><p>{example.view === "Canvas" ? "Seed ideas → Choose a place → Keep the next step" : "One idea per card, ready to arrange on the sample Canvas."}</p></section><Research controller={example.controller} />
</section>;
}
