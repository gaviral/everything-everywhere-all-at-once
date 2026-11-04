import type { Question } from "./contracts";
import type { ClarificationController } from "./controller";
import { ConfirmationSpine } from "./ConfirmationSpine";

export function QuestionPanel<Place>({ question, stale, controller }: {
  question: Question<Place>; stale: boolean; controller: ClarificationController<Place>;
}) {
  return <div className="clarification-question">
    {stale && <p role="alert">Source changed. Select the term again.</p>}
    {question.lookupRequired && <p className="clarification-caution">Authoritative lookup required before relying on this term. No lookup has been performed.</p>}
    {question.status === "asking" ? <>
      <ConfirmationSpine quote={question.anchor.quote} understanding={question.understanding} onChange={controller.setUnderstanding} disabled={stale} />
      <div className="clarification-actions">
        <button disabled={stale || !question.understanding.trim()} onClick={controller.confirm}>Confirm understanding</button>
        <button disabled={stale} onClick={controller.dismiss}>Dismiss question</button>
      </div>
    </> : <>
      <p>{question.status === "resolved" ? "Confirmed" : "Dismissed"}: “{question.anchor.quote}”{question.status === "resolved" && <> — {question.understanding}</>}</p>
      <div className="clarification-actions">
        <button disabled={stale} onClick={controller.revisit}>Revisit source</button>
        <button disabled={stale} onClick={controller.followUp}>Ask a follow-up</button>
      </div>
    </>}
  </div>;
}
