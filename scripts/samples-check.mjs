// No extra dependencies: run with `node scripts/samples-check.mjs`.
// The sample maps the empty map offers (core/src/sample.rs `SAMPLES`): "Try a sample map" opens the first, a
// student's week; under it, a shorter one per moment where talking into a live map helps (a team meeting that drifts,
// a bug left mid-sentence for a call, a walk through a house). The core's side has its own tests (sample.rs).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const repo = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(repo(path), "utf8");

// 1. What the core offers: each name has its journal in samples/, the first is the button's own, labels fit a button.
const list = read("core/src/sample.rs").match(/pub const SAMPLES: \[\(&str, &str\); \d+\] = \[([\s\S]*?)\];/);
assert.ok(list, "sample.rs lists SAMPLES");
const offered = [...list[1].matchAll(/\("([a-z-]+)", "([^"]+)"\)/g)].map(([, id, label]) => ({ id, label }));
assert.equal(offered[0]?.id, "student-week", "the button's own sample comes first");
assert.ok(offered.length >= 4, `the student's week and three shorter maps, not ${offered.length}`);
for (const { id, label } of offered) {
  assert.ok(existsSync(repo(`samples/${id}.jsonl`)), `samples/${id}.jsonl ships`);
  assert.ok(label.length <= 24, `"${label}" fits a link`);
}

// 2. The shorter ones read as a moment: 6 to 10 spoken lines, all placed, one left unfinished, an unfinished card.
for (const { id } of offered.slice(1)) {
  const events = read(`samples/${id}.jsonl`).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const thoughts = events.filter((e) => e.type === "thought_added").map((e) => e.thought);
  assert.ok(thoughts.length >= 6 && thoughts.length <= 10, `${id}: ${thoughts.length} lines`);
  assert.ok(thoughts.every((t) => t.placed && t.point && t.text), `${id}: every line placed with its point`);
  assert.ok(thoughts.some((t) => t.complete === false), `${id}: a sentence left unfinished`);
  assert.ok(events.some((e) => e.type === "thread_status" && e.status === "dropped"), `${id}: an unfinished card`);
}

const server = await uiServer();
try {
  // 3. The window: what /room offers becomes the row under the button; an older core offers none.
  const site = await server.ssrLoadModule("/src/site.ts");
  assert.deepEqual(site.LOCAL.samples, []);
  assert.deepEqual(site.moreSamples(site.siteFrom({ sample: true }).samples), [], "a core from before the choice: the button alone");
  const door = site.siteFrom({ sample: true, samples: offered });
  assert.deepEqual(site.moreSamples(door.samples).map((s) => s.id), offered.slice(1).map((s) => s.id));

  // 4. Each button sends its own name; the main one sends none (a click event passed as the name would not be one).
  const app = read("ui/src/App.tsx");
  assert.ok(!/onClick=\{core\.sample\}/.test(app), "the main button calls core.sample() itself, not with the click event");
  assert.match(app, /onClick=\{\(\) => core\.sample\(\)\}/);
  assert.match(app, /onClick=\{\(\) => core\.sample\(choice\.id\)\}/);
  assert.match(read("ui/src/core.ts"), /sample: \(name\?: string\) => sendOrWarn\(JSON\.stringify\(name \? \{ type: "sample", name \} : \{ type: "sample" \}\)\)/);
  console.log(`samples-check: ${offered.length} samples offered, ${offered.length - 1} shorter ones under the button`);
} finally {
  await server.close();
}
