import type { Exchange } from './model';
import { sourceWords } from './model';

export function SourceWords({ item, open }: { item: Exchange; open?: () => void }) {
  const { text, range, warning } = sourceWords(item);
  return <section className="anchored-discussions-source" aria-label="Source words">
    <p className="anchored-discussions-kicker">The words it belongs to</p>
    <blockquote>{range ? <>{text.slice(0, range.start)}<mark>{text.slice(range.start, range.end)}</mark>{text.slice(range.end)}</> : text || item.anchor.quote}</blockquote>
    {!range && text && <p>Captured quote: “{item.anchor.quote}”</p>}
    <p className="anchored-discussions-by">{item.anchor.context?.source_speaker || item.source?.speaker || 'Speaker unavailable'} · {item.title}</p>
    {warning && <p className="anchored-discussions-warning">{warning}</p>}
    {open && item.sourceLive && <button type="button" onClick={open}>Go to source ↗</button>}
  </section>;
}
