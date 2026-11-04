import type { Ledger, Source } from "./model";

export const exampleSources: Source[] = [
  { id: "example-venue", topicId: "example-launch", topic: "Launch gathering", speaker: "Alex", at: 1793808000000, text: "We chose the garden if the forecast stays dry. It gives everyone room to meet." },
  { id: "example-weather", topicId: "example-launch", topic: "Launch gathering", speaker: "Sam", at: 1793811600000, text: "Rain is now likely. We decided to use the studio if its capacity is confirmed: it keeps the gathering accessible and dry." },
  { id: "example-question", topicId: "example-launch", topic: "Launch gathering", speaker: "Alex", at: 1793815200000, text: "Should we offer a remote way to join? Let's review the options before choosing." },
];
export const exampleLedger: Ledger = { version: 1, entries: [
  { id: "garden", kind: "decision", question: "Where should we gather?", outcome: "Meet in the garden", condition: "Only if the forecast stays dry", reason: "More room for people to meet.", source: exampleSources[0], context: [exampleSources[0]], actor: "Alex", at: 1793808000000 },
  { id: "studio", kind: "decision", question: "Where should we gather?", outcome: "Move the gathering to the studio", condition: "Confirm capacity before booking", reason: "Rain is now likely. The studio keeps the gathering accessible and dry.", source: exampleSources[1], context: exampleSources.slice(0, 2), actor: "Sam", at: 1793811600000, supersedes: "garden" },
  { id: "remote", kind: "review", question: "Should we offer a remote way to join?", reason: "Compare access needs and setup effort before choosing.", source: exampleSources[2], context: exampleSources, actor: "Alex", at: 1793815200000 },
] };
