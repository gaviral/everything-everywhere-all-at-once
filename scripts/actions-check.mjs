// No extra dependencies: run with `node scripts/actions-check.mjs`.
// The demo's "Add to Reminders" click, as its row shows it (ui/src/action-line.ts, fed the core's messages through
// `apply` and `actionFailed` in ui/src/core.ts): the button, "Adding to Reminders…" while Apple's side runs, and
// "Added to Reminders · 1.2 s" only once the core says Apple answered success (core/src/apple.rs, whose own test runs
// a stand-in for osascript, so no check here or there ever adds a real reminder). A failure says why on the row and
// offers "Try again"; trying again takes the old reason down.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { apply, actionFailed } = await server.ssrLoadModule("/src/core.ts");
  const { actionLine } = await server.ssrLoadModule("/src/action-line.ts");
  const action = { id: "ac-1", thread_id: "T1", kind: "reminder", title: "Send rent", when: "2026-11-06", status: "new", done_ms: null };
  let world = { threads: [], thoughts: [], active: null, active_by: {}, recaps: [], suggestions: [], actions: [action], merged: {}, apps: [], apps_seeded: true };
  const row = () => actionLine(world.actions[0], "Reminders");
  const status = (status, done_ms = null) => { world = apply(world, { type: "item_status", id: "ac-1", status, done_ms }); };

  assert.deepEqual(row(), { button: "Add to Reminders", label: "Add Send rent to Reminders" }, "proposed: the button");
  status("kept");
  assert.deepEqual(row(), { status: "Adding to Reminders…" }, "clicked: no button, and not yet added");

  // Apple refused (the core offers it again, then says why): the reason on the row, and "Try again".
  status("new");
  const why = "Not added: macOS blocked it. In System Settings › Privacy & Security › Automation, let the app you started E2A2O from control Reminders, then try again.";
  world = actionFailed(world, "ac-1", why);
  assert.deepEqual(row(), { button: "Try again", label: "Try adding Send rent to Reminders again", failed: why });
  assert.equal(actionFailed(world, "other", "x").actions[0].failed, why, "another action's failure isn't this one's");

  // Tried again: the old reason goes while it's being added, and stays gone once Apple answered.
  status("kept");
  assert.deepEqual(row(), { status: "Adding to Reminders…" });
  assert.equal(world.actions[0].failed, undefined);
  status("done", 1234);
  assert.deepEqual(row(), { status: "Added to Reminders · 1.2 s" }, "added, with how long Apple's side took");
  assert.deepEqual(actionLine({ ...action, kind: "event", status: "done", done_ms: 800 }, "Calendar"), { status: "Added to Calendar · 0.8 s" });
  assert.deepEqual(actionLine({ ...action, status: "dismissed" }, "Reminders"), {}, "dismissed: nothing to say");
  console.log("actions-check: ok");
} finally {
  await server.close();
}
