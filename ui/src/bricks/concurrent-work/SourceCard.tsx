import type { BrickActions, MapSnapshot } from '../contract';
import { sourcesOf, sourceAvailable, type HeldThought } from './model';

export function SourceCard({ source, intent, map, actions, hold, setIntent }: {
  source: HeldThought | null; intent: string; map: MapSnapshot; actions: BrickActions;
  hold: (source: HeldThought) => void; setIntent: (text: string) => void;
}) {
  const sources = sourcesOf(map);
  const available = source && sourceAvailable(source, map);
  return <aside className="cw-source" aria-label="Original thought">
    <p className="cw-eyebrow">01 / Your return point</p>
    <h2>Keep the thread.</h2>
    {source ? <><blockquote>{source.text}</blockquote><p className="cw-by">{source.example ? 'Example thought · not on your map' : `Captured words · ${source.speaker}`}</p></>
      : <p>Capture a thought in the input below, then hold it here.</p>}
    <label className="cw-label">Hold a different thought
      <select aria-label="Hold a different thought" value={sources.some(s => s.id === source?.id) ? source!.id : ''} onChange={event => {
        const selected = sources.find(s => s.id === event.target.value); if (selected) hold(selected);
      }}><option value="" disabled>Choose your captured words</option>{sources.map(s => <option key={s.id} value={s.id}>{s.text.slice(0, 100)}</option>)}</select>
    </label>
    <label className="cw-label">What are you trying to achieve?
      <textarea value={intent} maxLength={1200} onChange={event => setIntent(event.target.value)} placeholder="Keep the bigger intention here…" rows={3} />
    </label>
    <p className="cw-caption">Held in this visit. This is your review context; it does not assign these jobs to this thought.</p>
    <button className="cw-return" disabled={!available} onClick={() => { if (source) actions.openThought(source); }}>↩ Return to exact capture</button>
    {source && !source.example && !available && <p role="status">The source changed or left the map. Your held words remain here; choose a current capture to return.</p>}
  </aside>;
}
