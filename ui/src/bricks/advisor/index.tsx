import { useState } from "react";
import type { BrickProps } from "../contract";
import type { AdvisorProvider, Scenario } from "./contract";
import { exampleProvider, flowProvider, useAdvisor } from "./escalation";
import { Escalation, FastResult, LargerReview } from "./review";
import advisorStyles from "./advisor.css?inline";

function InputPart({ controller: c, example }: { controller: ReturnType<typeof useAdvisor>; example: boolean }) {
  return <div className="advisor-input">
    <label>Your question<textarea value={c.question} readOnly={example} maxLength={1200} onChange={event => c.edit(event.target.value)} /></label>
    <div className="advisor-input-actions"><button type="button" disabled={c.busy || !c.question.trim()} onClick={() => void c.run("fast")}>
      {c.fast.status === "running" ? "Requesting…" : example ? "Replay fast example" : "Ask Meta for a fast answer"}
    </button>{c.busy && <button type="button" onClick={c.cancel}>Cancel request</button>}</div>
    <small>{example ? "Fixed example question. Choose Live Meta to ask your own." : "Sends only this question to Meta when you ask. Model size is unspecified by this endpoint."}</small>
  </div>;
}

/** Also accepts an injected provider for a host that supplies larger Meta results. */
export function AdvisorWorkspace({ provider: injected }: { provider?: AdvisorProvider }) {
  const [mode, setMode] = useState<"injected" | "live">("injected");
  const [scenario, setScenario] = useState<Scenario>("disagree");
  const provider = injected ?? (mode === "live" ? flowProvider : exampleProvider(scenario));
  const c = useAdvisor(provider);
  const example = provider.kind === "injected";
  return <section className="advisor" aria-label="Advisor mode" data-guide="advisor">
    <div className="advisor-heading"><div><p className="advisor-eyebrow">Advisor mode · Meta</p><h1>Fast when you need it.<br /><em>Deeper when you choose.</em></h1><p>Get a fast answer, then choose whether to ask for a second perspective.</p></div><span className="advisor-badge">{example ? "Example · injected results" : "Live · Meta first pass"}</span></div>
    {!injected && <div className="advisor-controls"><label>Result source<select value={mode} onChange={event => { const next = event.target.value as typeof mode; setMode(next); c.reset(next === "injected", scenario === "fast-failure"); }}><option value="injected">Injected examples</option><option value="live">Live Meta · fast only</option></select></label>
      {example && <label>Review example<select value={scenario} onChange={event => { const next = event.target.value as Scenario; setScenario(next); c.reset(true, next === "fast-failure"); }}><option value="disagree">Models disagree</option><option value="agree">Models agree</option><option value="review-failure">Larger review fails</option><option value="fast-failure">Fast answer fails</option></select></label>}
    </div>}
    <InputPart controller={c} example={example} />
    <div className="advisor-journey"><FastResult controller={c} /><Escalation controller={c} available={!!provider.review} example={example} /><LargerReview controller={c} /></div>
    <p className="advisor-status" role="status" aria-live="polite">{c.notice}</p>
    <p className="advisor-footnote">No automatic escalation. No capture. No map changes. You make the decision.</p>
  </section>;
}
export default function Advisor({ actions }: BrickProps) { return <><button className="advisor-back" type="button" onClick={actions.closeView}>Back to map</button><AdvisorWorkspace /></>; }
export const styles = advisorStyles;
