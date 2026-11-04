import { EXAMPLE } from "./example-part";
export function DictationPart({ source, edit, busy, judge, aiEnabled }: { source: string; edit: (value: string) => void; busy: boolean; judge: () => void; aiEnabled: boolean }) {
  return <section className="trigger-parts-dictation" aria-label="Dictation">
    <div className="trigger-parts-section-heading"><label htmlFor="trigger-parts-source">The words coming in</label><span className="trigger-parts-tag">{source === EXAMPLE ? "EXAMPLE DICTATION" : "YOUR DICTATION · LOCAL PREVIEW"}</span></div>
    <textarea id="trigger-parts-source" value={source} maxLength={6000} rows={2} spellCheck={false} onChange={event => edit(event.target.value)} />
    <div className="trigger-parts-source-actions"><span>Type or paste. Nothing starts recording.</span><div>
      <button type="button" onClick={() => edit(EXAMPLE)} disabled={source === EXAMPLE}>Reset example</button>
      <button type="button" className="trigger-parts-primary" onClick={judge} disabled={busy || !source.trim() || !aiEnabled}>{busy ? "Reviewing…" : "Ask Muse Spark"}</button>
    </div></div>
  </section>;
}
