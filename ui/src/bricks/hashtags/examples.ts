import { tagsIn, type TaggedThought } from "./tags";

// Original sentences from samples/debug-break.jsonl; tag suffixes are illustrative.
// These are presentation examples only: never submitted as thoughts or source links.
const examples = [
  ["Empty export on staging", "Okay, the export button works on my laptop, but on staging the file comes out empty. #staging #followup"],
  ["Filename spaces", "Swap the spaces for dashes, that's a one-line fix for later. hashtag followup"],
  ["Before standup", "His change touches the same export code, so I'll read that one first. #followup #review"],
];

export const EXAMPLE_THOUGHTS: TaggedThought[] = examples.map(([topic, text], index) => ({
  id: `example-${index}`, topic, text, speaker: "Example", threadId: null,
  navigable: false, tags: tagsIn(text),
}));
