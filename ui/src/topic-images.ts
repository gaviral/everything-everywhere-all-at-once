import { useBricksOn } from "./bricks-core";

/** Every topic visual follows the same browser-local feature switch. */
export function useTopicImages() {
  return useBricksOn().has("topic-images");
}
