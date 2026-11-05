import { ClarificationView } from "./view";
import { createClarification } from "./controller";
export { ClarificationView, createClarification };
export type { ClarificationController } from "./controller";
export type { Source, SelectedSource, SourceAnchor, SelectedSourceAdapter } from "./contracts";

/** Host renders the view and owns the switch/adapter; importing this has no side effects.
 * Import clarification.css at the host's CSS seam when admitting this feature. */
export const clarification = Object.freeze({
  id: "clarification",
  namespace: "msg1351.clarification",
  defaultEnabled: false,
  createController: createClarification,
  View: ClarificationView,
});
