export { ClarificationView } from "./view";
export { createClarification } from "./controller";
export type { ClarificationController } from "./controller";
export type { Source, SelectedSource, SourceAnchor, SelectedSourceAdapter } from "./contracts";

/** Host renders the view and owns the switch/adapter; importing this has no side effects.
 * Import clarification.css at the host's CSS seam when admitting this feature. */
export const clarification = Object.freeze({
  id: "clarification",
  namespace: "msg1351.clarification",
  defaultEnabled: false,
  control: { read: "controller.getSnapshot().enabled", write: "controller.setEnabled(boolean)" },
});
