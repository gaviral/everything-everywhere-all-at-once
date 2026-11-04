import { usePluginState } from "../contract";
import { content, draftValue, type SavedDraft } from "./model";

export default function Drafts() {
  const [saved, setSaved] = usePluginState<Record<string, SavedDraft>>("hackathon:drafts", {});
  return <section aria-labelledby="hackathon-drafts-title">
    <div className="hackathon-section-top"><div><p className="hackathon-eyebrow">Words to review</p><h2 id="hackathon-drafts-title">Start with a draft.</h2></div><span className="hackathon-badge">Example content</span></div>
    <p className="hackathon-context">{content.draftsNote}</p>
    <div className="hackathon-drafts">{content.drafts.map(draft => {
      const value = draftValue(draft, saved[draft.id]);
      const write = (next: SavedDraft) => setSaved(old => ({ ...old, [draft.id]: next }));
      return <article className="hackathon-draft" key={draft.id}>
        <div className="hackathon-draft-top"><label htmlFor={`hackathon-answer-${draft.id}`}>{draft.label}</label>
          <button type="button" aria-pressed={value.reviewed} disabled={!value.text.trim()} onClick={() => write({ ...value, reviewed: !value.reviewed })}>
            {value.reviewed ? "✓ Reviewed" : "Mark reviewed"}
          </button>
        </div>
        <textarea id={`hackathon-answer-${draft.id}`} rows={draft.id === "name" ? 2 : 4} value={value.text}
          onChange={event => write({ ...value, text: event.target.value, reviewed: false })} />
      </article>;
    })}</div>
    <p className="hackathon-footnote">Edits and review marks stay in this browser when storage is available. Recheck in the official form.</p>
  </section>;
}
