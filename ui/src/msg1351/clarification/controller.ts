import type { Question, SelectedSourceAdapter } from "./contracts";
import { anchorIsCurrent, anchorSelection } from "./SourceAnchor";
import { unknownTermPolicy } from "./UnknownTermPolicy";
import { restoreAcknowledgment } from "./Acknowledgment";

type State<Place> = Readonly<{ enabled: boolean; question: Question<Place> | null; notice: string }>;

/** Keep one controller per thought visit, outside the mounted view. No storage or network. */
export function createClarification<Place>(adapter: SelectedSourceAdapter<Place>) {
  let state: State<Place> = { enabled: false, question: null, notice: "" };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<State<Place>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const currentQuestion = () => {
    if (!state.enabled || !state.question) return null;
    if (!anchorIsCurrent(state.question.anchor, adapter.getSnapshot()?.source)) {
      update({ notice: "Source changed. Select the term again." });
      return null;
    }
    return state.question;
  };
  const finish = (status: "resolved" | "dismissed") => {
    const question = currentQuestion();
    if (!question || (status === "resolved" && !question.understanding.trim())) return;
    const notice = restoreAcknowledgment(adapter, question);
    if (notice) { update({ notice }); return; }
    update({ question: { ...question, status }, notice: status === "resolved" ? "Understanding confirmed. Back at your thought." : "Question dismissed. Back at your thought." });
  };
  return {
    adapter,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(enabled: boolean) { update({ enabled, notice: "" }); },
    ask() {
      if (!state.enabled) return;
      const selected = adapter.getSnapshot();
      const anchor = anchorSelection(selected);
      if (!anchor) { update({ notice: "Select an exact term in the current source first." }); return; }
      const policy = unknownTermPolicy(selected?.known, selected?.critical);
      if (policy === "preserve") { update({ notice: "Known term preserved. No question added." }); return; }
      update({ question: { anchor, place: adapter.capturePlace(), understanding: "", status: "asking", lookupRequired: policy === "critical-lookup" }, notice: "" });
    },
    setUnderstanding(understanding: string) {
      const question = currentQuestion();
      if (question?.status === "asking") update({ question: { ...question, understanding: understanding.slice(0, 120) } });
    },
    confirm() { finish("resolved"); },
    dismiss() { finish("dismissed"); },
    followUp() {
      const question = currentQuestion();
      if (question) update({ question: { ...question, status: "asking" }, notice: "" });
    },
    revisit() {
      const question = currentQuestion();
      if (question) update({ notice: restoreAcknowledgment(adapter, question) ?? "Back at your thought." });
    },
  };
}

export type ClarificationController<Place> = ReturnType<typeof createClarification<Place>>;
