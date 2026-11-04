import { useState } from 'react';
import type { Passage } from './model';

function matchingPassages(body: string, quote: string): Passage[] {
  if (!quote.trim()) return [];
  const found: Passage[] = [];
  for (let start = body.indexOf(quote); start !== -1 && found.length < 50; start = body.indexOf(quote, start + 1)) {
    found.push({ start, end: start + quote.length, quote });
  }
  return found;
}

export function PassagePicker({ body, choose }: { body: string; choose: (passage: Passage) => void }) {
  const [quote, write] = useState('');
  const matches = matchingPassages(body, quote);
  return <details className="revision-review-keyboard"><summary>Choose exact words by keyboard</summary>
    <label>Exact words from this revision<input value={quote} onChange={event => write(event.target.value)} maxLength={4000} /></label>
    {quote.trim() && !matches.length && <p>No exact match. Keep the original case and spacing.</p>}
    {matches.length === 50 && <p>First 50 matches shown. Use a longer passage to narrow the choice.</p>}
    {matches.map((passage, index) => <button key={passage.start} type="button" onClick={() => choose(passage)}>
      Occurrence {index + 1} · characters {passage.start + 1}–{passage.end}<br />
      {body.slice(Math.max(0, passage.start - 24), passage.start)}<strong>{quote}</strong>{body.slice(passage.end, passage.end + 24)}
    </button>)}
  </details>;
}
