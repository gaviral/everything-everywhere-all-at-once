// Memory only: survives panel close and feature unmount, ends at page reload.
export const DEFINITION_ID = "topic-reader";
export interface ReaderInstance {
  id: string;
  definitionId: typeof DEFINITION_ID;
  topicId: string;
  expanded: boolean;
  draft: string;
}
export interface InstanceState { heading: string; instances: ReaderInstance[] }
let visit: InstanceState = { heading: "Topic reader", instances: [] };
export function readVisit(): InstanceState { return visit; }
export function retainVisit(next: InstanceState): void { visit = next; }
export function newReader(): ReaderInstance {
  return { id: `reader-${crypto.randomUUID()}`, definitionId: DEFINITION_ID, topicId: "", expanded: true, draft: "" };
}
