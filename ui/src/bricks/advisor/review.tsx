import type { AdvisorController } from "./escalation";

export function FastResult({ controller: c }: { controller: AdvisorController }) {
  return <article className="advisor-answer advisor-fast" aria-label="Fast Meta result" aria-busy={c.fast.status === "running"}>
    <p className="advisor-step">01 <span>Fast first pass</span></p>
    {c.fast.status === "ready" ? <><h2>{c.fast.answer.text}</h2><p className="advisor-model">{c.fast.answer.model} · {c.fast.answer.source === "injected" ? "Injected example" : "Live Meta result"}</p></> :
      c.fast.status === "failed" ? <><h2>Fast answer unavailable</h2><p role="alert">{c.fast.message}</p></> :
      <h2>{c.fast.status === "running" ? "Finding a first answer…" : "Your next question starts here."}</h2>}
    <p className="advisor-caption">A starting point. You choose whether it needs another look.</p>
  </article>;
}

export function Escalation({ controller: c, available, example }: { controller: AdvisorController; available: boolean; example: boolean }) {
  return <div className="advisor-escalation">
    <div><p className="advisor-eyebrow">Your call</p><h2>Worth a second look?</h2><p>{example ? "Send the question, fast answer and your reason to the example larger reviewer." : available ? "Send only this question, fast answer and your reason to the connected Meta reviewer." : "Live larger-model review is not connected. The existing Meta endpoint has no size selector."}</p></div>
    <label>Why escalate?<select value={c.reason} disabled={c.busy} onChange={event => c.setReason(event.target.value)}>
      <option>Challenge assumptions</option><option>Compare alternatives</option><option>Consequences matter</option>
    </select></label>
    <button type="button" className="advisor-primary" disabled={c.busy || c.fast.status !== "ready" || !available} onClick={() => void c.run("review")}>
      {c.review.status === "running" ? "Reviewing…" : c.review.status === "failed" ? "Retry larger review" : "Ask larger Meta model"}
    </button>
    {example && <small>Injected review · no live request</small>}
  </div>;
}

export function LargerReview({ controller: c }: { controller: AdvisorController }) {
  const answer = c.review.status === "done" ? c.review.answer : null;
  return <article className={`advisor-answer advisor-review ${answer ? `advisor-${answer.verdict}` : ""}`} aria-label="Larger Meta review" aria-busy={c.review.status === "running"}>
    <p className="advisor-step">02 <span>Larger-model review</span></p>
    {answer ? <><p className="advisor-verdict">{answer.verdict === "agree" ? "Agreement · same direction" : "Disagreement · different recommendation"}</p><h2>{answer.text}</h2><p className="advisor-rationale">{answer.rationale}</p><p className="advisor-model">{answer.model} · {answer.source === "injected" ? "Injected example" : "Live Meta result"}</p></> :
      c.review.status === "failed" ? <><p className="advisor-verdict">Review failed</p><h2>Your fast answer stays.</h2><p role="alert">{c.review.message}</p></> :
      <><div className="advisor-orbit" aria-hidden="true"><span>↗</span></div><h2>{c.review.status === "running" ? "A second perspective is on its way." : "More thought, only when you ask."}</h2><p className="advisor-caption">{c.review.status === "running" ? "The first answer stays visible while review runs." : "A larger model may agree, disagree or fail. It never silently replaces the first answer."}</p></>}
    {answer && <p className="advisor-caption">Both perspectives stay here. Advice does not take action.</p>}
  </article>;
}
