import { useSyncExternalStore } from "react";
import type { ClarificationController } from "./controller";
import { anchorIsCurrent, anchorSelection } from "./SourceAnchor";
import { QuestionMark } from "./QuestionMark";
import { QuestionPanel } from "./QuestionPanel";

export function ClarificationView<Place>({ controller }: { controller: ClarificationController<Place> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const selected = useSyncExternalStore(controller.adapter.subscribe, controller.adapter.getSnapshot, controller.adapter.getSnapshot);
  const stale = !!state.question && !anchorIsCurrent(state.question.anchor, selected?.source);
  const mark = state.question && state.question.status !== "dismissed" && !stale ? state.question.anchor : null;
  return <section className="clarification" aria-label="Clarification">
    <header><h2>Clarification</h2><button role="switch" aria-checked={state.enabled} onClick={() => controller.setEnabled(!state.enabled)}>Clarification {state.enabled ? "on" : "off"}</button></header>
    {state.enabled && <>
      {selected ? <QuestionMark source={selected.source} anchor={mark} /> : <p>Select a source to begin.</p>}
      {mark && <p className="clarification-cue">↑ {state.question?.status === "resolved" ? "Understanding kept" : "Question"} about “{mark.quote}”</p>}
      <button disabled={!anchorSelection(selected)} onClick={controller.ask}>{stale ? "Ask about new selection" : "Ask about selection"}</button>
      {state.question && <QuestionPanel question={state.question} stale={stale} controller={controller} />}
      <p className="clarification-notice" role="status">{state.notice}</p>
    </>}
  </section>;
}
