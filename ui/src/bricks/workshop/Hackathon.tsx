import type { EventData } from "./data";
export function Hackathon({ data }: { data: EventData | null }) {
  return <section className="workshop-event" aria-label="Hackathon canvas"><div className="workshop-section-head"><h2>Hackathon</h2>{data?.updated && <p>{data.updated}</p>}</div>
    {!data ? <p>Loading event data…</p> : data.unavailable ? <p>Local event data is unavailable. Configure the event file, then refresh.</p> : <div className="workshop-canvas">{data.sections.map(section => <article className="workshop-event-card" key={section.title}><h3>{section.title}</h3><ul>{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul></article>)}</div>}
  </section>;
}
