import type { Question, SelectedSourceAdapter } from "./contracts";
import { anchorIsCurrent } from "./SourceAnchor";

export function restoreAcknowledgment<Place>(adapter: SelectedSourceAdapter<Place>, question: Question<Place>): string | null {
  if (!anchorIsCurrent(question.anchor, adapter.getSnapshot()?.source)) return "Source changed. Select the term again.";
  try {
    return adapter.restorePlace(question.place, question.anchor) ? null : "Your earlier place is unavailable. The source is kept here.";
  } catch {
    return "Your earlier place is unavailable. The source is kept here.";
  }
}
