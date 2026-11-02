// No extra dependencies: run with `node scripts/merges-check.mjs`.
// Following merges (ui/src/merges.ts), the one copy every window rule uses, as the core's `World::resolve`: a merged
// thread's changes land on the thread it became, through a chain of merges, and a corrupt snapshot with a cycle
// still answers instead of freezing the tab. No other file in ui/src keeps its own copy of the loop.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { resolveMerged } = await server.ssrLoadModule("/src/merges.ts");
  assert.equal(resolveMerged({ merged: {} }, "T1"), "T1", "a thread never merged is itself");
  assert.equal(resolveMerged({ merged: { T1: "T2", T2: "T3" } }, "T1"), "T3", "through a chain of merges");
  assert.equal(resolveMerged({ merged: { T1: "T2" } }, "T3"), "T3", "another thread's merge leaves it alone");
  assert.equal(resolveMerged({}, "T1"), "T1", "a world without merges yet (a move before the first snapshot)");
  const cycle = resolveMerged({ merged: { T1: "T2", T2: "T1" } }, "T1");
  assert.ok(cycle === "T1" || cycle === "T2", "a cycle stops after one hop per merge");

  const src = new URL("../ui/src/", import.meta.url);
  const copies = readdirSync(src).filter((f) => /\.tsx?$/.test(f) && f !== "merges.ts")
    .filter((f) => /\.merged(?: \?\? \{\})?\)\.length;[^;]*\.merged\[/.test(readFileSync(new URL(f, src), "utf8")));
  assert.deepEqual(copies, [], "follow merges with resolveMerged (ui/src/merges.ts), not a copy of its loop");
  console.log("merges-check: ok");
} finally {
  await server.close();
}
