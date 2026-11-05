import { useRef, useState } from "react";
import type { QueueHome, Review } from "./contract";
import { speakerProfiles } from "./boundary-strategy";
import { correctItem, exportWorkflow, rejoinItem, splitItem, startReview } from "./split-review";
import { ItemReview } from "./review-parts";
import "./style.css";
export { dictationBreakdownFeature } from "./feature";
export { exportWorkflow } from "./split-review";
export type { WorkflowExport, QueueHome, Review } from "./contract";

export type DictationBreakdownProps = { enabled: boolean; onEnabledChange: (enabled: boolean) => void;
  initialSource?: string; queueHomes?: readonly QueueHome[] };

function useSplitReview(initialSource: string) {
  const [source, setSource] = useState(initialSource), [profileId, setProfileId] = useState("careful");
  const [state, setState] = useState<Review | null>(null), [history, setHistory] = useState<(Review | null)[]>([]);
  const [notice, setNotice] = useState(""), [exported, setExported] = useState("");
  function apply(action: () => Review, message: string) {
    try { const next = action(); setHistory(old => [...old, state]); setState(next); setExported(""); setNotice(message); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Correction could not be applied."); }
  }
  function undo() {
    if (!history.length) return;
    setState(history[history.length - 1]); setHistory(old => old.slice(0, -1)); setExported(""); setNotice("Previous review restored.");
  }
  function begin() { apply(() => startReview(source, speakerProfiles.find(profile => profile.id === profileId)!), "Items proposed. Check summaries, reasons and boundaries."); }
  return { source, setSource, profileId, setProfileId, state, history, notice, exported, setExported, apply, undo, begin };
}

export function DictationBreakdown({ enabled, onEnabledChange, initialSource = "", queueHomes = [] }: DictationBreakdownProps) {
  const review = useSplitReview(initialSource), status = useRef<HTMLParagraphElement>(null);
  function correction(action: () => Review, message: string) {
    review.apply(action, message);
    status.current?.focus();
  }
  return <section className="dictation-breakdown" aria-label="Dictation breakdown">
    <header><div><p className="db-eyebrow">Transcript workshop</p><h1>Turn a long thought into items</h1></div>
      <label className="db-switch"><input type="checkbox" checked={enabled} onChange={event => onEnabledChange(event.target.checked)} />Enable dictation breakdown</label></header>
    {!enabled ? <p>Off. Enable to review a pasted transcript. In-session work is retained when switched off.</p> : <>
      <p>Paste text, check proposed ideas, then correct the boundaries. No microphone or AI service is used. Work stays in this session; copy the export before leaving.</p>
      <label>Transcript<textarea aria-label="Transcript" rows={6} value={review.source} onChange={event => review.setSource(event.target.value)} /></label>
      <div className="db-actions"><label>Speaker cues<select aria-label="Speaker cues" value={review.profileId} onChange={event => review.setProfileId(event.target.value)}>
        {speakerProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <button type="button" onClick={review.begin}>{review.state ? "Rebuild from transcript" : "Propose items"}</button>
        <button type="button" disabled={!review.history.length} onClick={review.undo}>Undo last change</button></div>
      <p className="db-help">Cue changes apply on rebuild. Manual only keeps one item for you to split. Rebuild replaces corrections; Undo restores them.</p>
      <p ref={status} tabIndex={-1} role="status">{review.notice}</p>
      {review.state && <ReviewWorkspace state={review.state} homes={queueHomes} correction={correction} update={review.apply} onExport={() => review.setExported(JSON.stringify(exportWorkflow(review.state!, queueHomes), null, 2))} />}
      {review.exported && <label>Workflow export · copy to keep<textarea aria-label="Workflow export" readOnly rows={10} value={review.exported} /></label>}
    </>}
  </section>;
}

function ReviewWorkspace({ state, homes, correction, update, onExport }: { state: Review; homes: readonly QueueHome[];
  correction: (action: () => Review, message: string) => void; update: (action: () => Review, message: string) => void; onExport: () => void }) {
  return <section aria-label="Split review"><h2>{state.items.length} correctable items</h2>
    <p>Every source character is retained in order, including small asides. Summaries and kinds are heuristic proposals.</p>
    <details><summary>Full source for this review</summary><pre>{state.source}</pre></details>
    <div className="db-items">{state.items.map((item, index) => <ItemReview key={item.id} item={item} ordinal={index + 1} homes={homes}
      onCorrect={patch => update(() => correctItem(state, item.id, patch), "Correction kept in this review.")}
      onSplit={offset => correction(() => splitItem(state, item.id, offset), "Item split. All source retained.")}
      onRejoin={() => correction(() => rejoinItem(state, item.id), "Items rejoined. All source retained.")} />)}</div>
    <button type="button" onClick={onExport}>Prepare workflow export</button>
    <p>Queue homes are suggestions only. Resolve possible duplicates yourself; no queue rows are written.</p>
  </section>;
}
