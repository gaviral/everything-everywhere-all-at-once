// An unfinished quote must show the recorded source, even when the placer summarizes it.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { ideasOf } = await server.ssrLoadModule("/src/bricks/spine/layout.ts");
  const source = { id: "a", text: "Before the trip I still need to", point: "Plan trip tasks",
    complete: false, at_ms: 1, speaker: "you", thread_id: "T1", placed: true };
  assert.equal(ideasOf([source], {})[0].text, source.text, "unfinished quote preserves exact source");
  assert.equal(ideasOf([{ ...source, complete: true }], {})[0].text, source.point, "complete points retain summaries");
  const next = { ...source, id: "b", text: "check the", point: "Check travel plans", at_ms: 2 };
  const notes = { b: { continues: "a" } };
  assert.equal(ideasOf([source, next], notes)[0].text, `${source.text} ${next.text}`, "unfinished continuation retains both sources");
  assert.equal(ideasOf([source, { ...next, complete: true }], notes)[0].text, next.point, "completed continuation retains its joined summary");
  console.log("PASS unfinished source: exact quote, complete summary, incomplete and complete joins");
} finally {
  await server.close();
}
