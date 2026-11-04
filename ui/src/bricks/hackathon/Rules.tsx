import { content } from "./model";

export default function Rules() {
  return <section aria-labelledby="hackathon-rules-title">
    <div className="hackathon-section-top"><div><p className="hackathon-eyebrow">Protect eligibility</p><h2 id="hackathon-rules-title">Check before sending.</h2></div><span className="hackathon-badge">Verification needed</span></div>
    <p className="hackathon-context">{content.rulesNote}</p>
    <div className="hackathon-rules-layout">
      <div className="hackathon-rules-list">{content.rules.map((rule, index) => <article key={rule.title}>
        <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{rule.title}</h3><p>{rule.detail}</p></div>
      </article>)}</div>
      <aside className="hackathon-tracks" aria-label="Tracks"><p className="hackathon-eyebrow">Find the right track</p>
        {content.tracks.map(track => <div key={track.name}><h3>{track.name}</h3><span className="hackathon-badge">{track.status}</span><p>{track.detail}</p></div>)}
      </aside>
    </div>
  </section>;
}
