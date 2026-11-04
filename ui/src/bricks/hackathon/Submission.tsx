import { usePluginState } from "../contract";
import { content, itemState, stateLabels, states, type ItemState, type SavedItem } from "./model";

export default function Submission() {
  const [saved, setSaved] = usePluginState<Record<string, SavedItem>>("hackathon:deliverables", {});
  const ready = content.deliverables.filter(item => itemState(item, saved[item.id]) === "ready").length;
  return <section className="hackathon-submission" aria-labelledby="hackathon-submission-title">
    <div className="hackathon-section-top">
      <div><p className="hackathon-eyebrow">The hand-in</p><h2 id="hackathon-submission-title">Everything accounted for.</h2></div>
      <span className="hackathon-ready" role="status">{ready} / {content.deliverables.length} ready</span>
    </div>
    <div className="hackathon-deliverables">
      {content.deliverables.map((item, index) => {
        const state = itemState(item, saved[item.id]);
        return <article className={`hackathon-deliverable hackathon-state-${state}`} key={item.id}>
          <span className="hackathon-item-number" aria-hidden="true">{state === "ready" ? "✓" : String(index + 1).padStart(2, "0")}</span>
          <h3>{item.title}</h3><p>{item.detail}</p>
          <label className="hackathon-state-label">Status
            <select aria-label={`${item.title} status`} value={state} onChange={event => setSaved(old => ({ ...old,
              [item.id]: { source: JSON.stringify(item), state: event.target.value as ItemState },
            }))}>{states.map(value => <option value={value} key={value}>{stateLabels[value]}</option>)}</select>
          </label>
        </article>;
      })}
    </div>
    <p className="hackathon-footnote">{content.submissionNote}</p>
  </section>;
}
