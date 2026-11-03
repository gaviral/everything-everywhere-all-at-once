// No extra dependencies: run with `node scripts/blank-check.mjs`.
// Nothing goes blank or says the map is empty when it isn't (reviews ui-core #1, ui-app #3): a change this window
// doesn't know (a newer core, a tab left open across a redeploy) leaves the map as it was; anything that still throws
// shows a way back instead of a white page; and the first-run welcome waits for the core's first snapshot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");
const server = await uiServer();
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const map = { threads: [], thoughts: [], active: null, active_by: {}, recaps: [], suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true };
  assert.equal(apply(map, { type: "made_by_a_newer_core", id: "x" }), map, "an unknown change keeps the map, not undefined");

  // The boundary: a throw anywhere below it shows the way back; the map itself is saved by the core.
  const { Crash } = await server.ssrLoadModule("/src/Crash.tsx");
  const broken = new Crash({ children: null });
  broken.state = Crash.getDerivedStateFromError(new Error("boom"));
  const page = ReactDOMServer.renderToStaticMarkup(broken.render());
  assert.match(page, /Something broke/);
  assert.match(page, /your map is saved/i);
  assert.match(page, /<button[^>]*>Reload<\/button>/);
  const fine = new Crash({ children: React.createElement("p", null, "the map") });
  fine.state = { broken: false };
  assert.equal(ReactDOMServer.renderToStaticMarkup(fine.render()), "<p>the map</p>");
  // The map's page and the phone's Remote (?remote) are both behind the one boundary, in the room.
  assert.match(src("main.tsx"), /<Crash>\s*<Room>[^]*<Remote \/>[^]*<App \/>[^]*<\/Room>\s*<\/Crash>/, "the whole app, and the Remote, sit inside it");

  // Before the first snapshot the window's world is the empty one: the map stays empty rather than greet a returning
  // person with "Think out loud." (the header already says "Connecting…").
  assert.match(src("App.tsx"), /\{world\.threads\.length === 0 \? \(\s*core\.snapshotRevision === 0 \? null : <div className="empty">/);
  console.log("blank-check: ok");
} finally {
  await server.close();
}
