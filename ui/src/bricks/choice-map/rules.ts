import type { ChoiceMap, ChoiceRelation } from "../contract";
export const activeRelations = (choice: Readonly<ChoiceMap>) => choice.relations.filter(r => !r.removed_by);
export function removalPreview(choice: Readonly<ChoiceMap>, relation: ChoiceRelation) {
  return activeRelations(choice).filter(r => relation.role === "question" || r.id === relation.id || r.option_id === relation.id);
}
