import { useState } from "react";
import type { TriggerController } from "./controller-part";

function HumanDisputePart({ id, submit }: { id: string; submit: (id: string, reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <form onSubmit={event => { event.preventDefault(); submit(id, reason); setReason(""); }} className="trigger-parts-dispute-form">
    <label htmlFor="trigger-parts-dispute">Why should these words stay together?</label>
    <div><input id="trigger-parts-dispute" autoFocus value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="This is still the same idea…" required />
      <button type="submit" disabled={!reason.trim()}>Record dispute</button></div>
  </form>;
}
export function RedTeamPart({ controller: c }: { controller: TriggerController }) {
  const target = c.result.triggers.find(row => row.id === c.selected);
  return <section className="trigger-parts-red-team" aria-label="Red team">
    <div className="trigger-parts-red-team-intro"><div><span className="trigger-parts-kicker">RED TEAM / QUESTION THE CUT</span><h2>A pause isn’t always a new idea.</h2><p>You or an AI can challenge a split. You make the final call.</p></div>
      <button type="button" disabled={c.busy || c.result.parts.length < 2} onClick={() => void c.run("dispute")}>Ask Muse Spark to challenge</button></div>
    <div className="trigger-parts-review-target"><label htmlFor="trigger-parts-target">Split to review</label><select id="trigger-parts-target" value={target?.id ?? ""} onChange={event => c.setSelected(event.target.value || null)}>
      <option value="">Choose a phrase…</option>{c.result.triggers.map(row => <option key={row.id} value={row.id}>“{row.phrase}”{c.session.joined.includes(row.id) ? " · joined" : ""}</option>)}
    </select></div>
    {target && <div className="trigger-parts-review-body"><HumanDisputePart key={target.id} id={target.id} submit={c.dispute} />
      <button className="trigger-parts-join" type="button" onClick={() => c.join(target.id, !c.session.joined.includes(target.id))}>{c.session.joined.includes(target.id) ? "Restore this split" : "Join with previous part"}</button></div>}
    {c.visibleDisputes.length > 0 && <ul className="trigger-parts-disputes">{c.visibleDisputes.map(row => <li key={`${row.id}-${row.by}`}><strong>{row.by}</strong><span>“{c.result.triggers.find(trigger => trigger.id === row.id)?.phrase}” — {row.reason}</span><button type="button" onClick={() => c.setSelected(row.id)}>{c.session.joined.includes(row.id) ? "Joined · review" : "Review split"}</button></li>)}</ul>}
  </section>;
}
