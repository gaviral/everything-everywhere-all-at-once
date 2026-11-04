// No extra dependencies: run with `node scripts/world-mirror-check.mjs` (scripts/test.sh runs it after the Rust tests).
// The window's copy of the map (ui/src/core.ts `apply`, with tidy-core, moves-core and apps-core) against the core's
// (world.rs `World::apply`): every kind of change (world.rs `every_change`) and a session that takes every road to Undo
// (replay_tests.rs `session`), written by the core's own tests, give the core's map in the window; so does a snapshot
// the last changes reach again (main.rs `session` subscribes before it snapshots); and a kind the window doesn't know
// leaves its map as it was.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";

const dir = mkdtempSync(join(tmpdir(), "e2a2o-mirror-"));
execFileSync("cargo", ["test", "--quiet", "mirror_fixture"], {
  cwd: new URL("../core", import.meta.url).pathname, env: { ...process.env, E2A2O_FIXTURE_DIR: dir, E2A2O_AGREEMENT_FIXTURE_DIR: dir }, stdio: ["ignore", "ignore", "inherit"],
});
globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const EMPTY = { questions: [], recaps: [], threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: false, notes: {} };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const sorted = (o) => (Array.isArray(o) ? o.map(sorted) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted(o[k])])) : o);
  const same = (a, b) => JSON.stringify(sorted(plain(a))) === JSON.stringify(sorted(plain(b)));
  for (const name of ["every", "session", "agreement"]) {
    const { initial, changes, world, worlds } = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
    if(name==="every")assert.ok(changes.some(c=>c.type==="evidence_kept"),"evidence change in every_change");
    if (name === "every") assert.ok(changes.some(c => c.type === "choice_map_saved"), "choice change is in every_change");
    if (name === "every") assert.ok(changes.some(c => c.type === "action_estimate_set"), "estimate change is in every_change");
    if (name === "every") assert.ok(changes.some(c => c.type === "discussion_status"));
    if (name === "every") assert.ok(changes.some(c => c.type === "research_kept"));
    let mirror = initial ?? EMPTY;
    // Every field the core sends, as the window holds it (a window without notes, places, margin notes or AI
    // participants yet holds none).
    const none = { agreements: {}, kept_answers: [], research: [], discussions: [], evidence_kept: [], choice_maps: [], action_estimates: [], aliases: [], recipe_saves: {}, captions: [], notes: {}, positions: {}, anchors: {}, ai: [] };
    const agree = (core, at) => {
      for (const key of Object.keys(core)) {
        assert.deepEqual(sorted(plain(mirror[key] ?? none[key] ?? null)), sorted(plain(core[key] ?? null)), `${name}: the window's ${key} differs from the core's ${at}`);
      }
    };
    if (name === "every") assert.ok(changes.some(c => c.type === "point_edited"), "point edits must be covered by the core mirror fixture");
    changes.forEach((change, i) => {
      mirror = apply(mirror, change);
      assert.ok(mirror && Array.isArray(mirror.threads), `${name}: change ${i} (${change.type}) left the window with no map`);
      // Step by step where the core wrote each map (every kind): one a later change covers up is still caught.
      if (worlds) agree(worlds[i], `after change ${i} (${change.type})`);
    });
    agree(world, "at the end");
    // A window that connects mid-session may get the last batch or two again, on top of a snapshot that has them.
    let at = initial ?? EMPTY;
    changes.forEach((change, k) => {
      at = apply(at, change);
      let again = at;
      for (const c of changes.slice(Math.max(0, k - 2))) again = apply(again, c);
      assert.ok(same(again, mirror), `${name}: changes up to ${k} (${change.type}) sent again leave another map`);
    });
    assert.equal(apply(mirror, { type: "a_change_from_a_newer_core", thread_id: "T1" }), mirror, "a kind the window doesn't know keeps its map");
  }
  console.log("world-mirror-check: ok");
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
