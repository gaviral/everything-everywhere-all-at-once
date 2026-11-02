// No extra dependencies: run with `node scripts/whyhere-check.mjs`.
// "Why here": a point and each "While you were away" row can say why its thought went to that thread, on demand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";

const ui = (path) => readFileSync(new URL(`../ui/src/${path}`, import.meta.url), "utf8");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { whyLine, hoverTitle, WhyHere, WhyContext, whysAfter } = await server.ssrLoadModule("/src/whyhere.tsx");
  const { NotesContext } = await server.ssrLoadModule("/src/chunks.tsx");
  const { awayItems } = await server.ssrLoadModule("/src/Away.tsx");
  const h = React.createElement;
  const { renderToStaticMarkup } = ReactDOMServer;

  // How a reason reads: the placer's is "Why here", one asked for afterwards only "Likely why".
  assert.equal(whyLine({ why: "names the lease" }, undefined).text, "Why here: names the lease");
  assert.equal(whyLine({ why: "names the lease", later: true }, undefined).text, "Likely why: names the lease");
  assert.equal(whyLine({ why: "names the lease" }, { text: "other", failed: false }).text, "Why here: names the lease", "the kept note wins");
  assert.equal(whyLine({ continues: "a" }, undefined), null, "nothing known, nothing shown");
  assert.equal(whyLine(undefined, { text: "you moved it here", failed: false }).text, "Why here: you moved it here");
  assert.equal(whyLine(undefined, { text: "", failed: false, pending: true }).pending, true);
  assert.equal(whyLine(undefined, { text: "Couldn't say why just now.", failed: true }).failed, true);

  // An answer is about where the thought was when asked: its move, or that move's Undo, drops it (no stale reason,
  // the ask comes back); a fresh map keeps only asks still out.
  const kept = { a: { text: "names the lease", failed: false }, b: { text: "", failed: false, pending: true } };
  const move = (thought_id, undo = false) => ({ type: "change", change: { type: "thought_moved", thought_id, thread_id: "T2", from: "T1", undo } });
  assert.deepEqual(whysAfter(kept, move("a")), { b: kept.b }, "a move drops its answer");
  assert.deepEqual(whysAfter(kept, move("a", true)), { b: kept.b }, "so does its Undo");
  assert.equal(whysAfter(kept, move("z")), kept, "another thought's move keeps all");
  assert.equal(whysAfter(kept, { type: "change", change: { type: "thread_renamed", thread_id: "T1" } }), kept);
  assert.deepEqual(whysAfter(kept, { type: "snapshot" }), { b: kept.b }, "a snapshot keeps only asks still out");
  assert.match(ui("core.ts"), /setWhys\(\(w\) => whysAfter\(w, msg\)\);[^]*setWhys\(\(w\) => whysAfter\(w, msg\)\);/, "wired on snapshot and change");

  // The hover card adds a known reason, never a pending or failed one.
  assert.equal(hoverTitle("“words”", whyLine({ why: "names the lease" })), "“words”\nWhy here: names the lease");
  assert.equal(hoverTitle("“words”", whyLine(undefined, { text: "", failed: false, pending: true })), "“words”");
  assert.equal(hoverTitle("“words”", null), "“words”");
  assert.equal(hoverTitle("", whyLine({ why: "names the lease" })), "Why here: names the lease", "words that repeat the point stay out");

  // Rendered: a quiet button until asked, the line once known, a retry when it failed; `auto` asks at once (effects
  // don't run in a static render, so the ask itself is checked by its button's job).
  const render = (notes, whys) => renderToStaticMarkup(h(NotesContext.Provider, { value: notes },
    h(WhyContext.Provider, { value: { whys, ask: () => {} } }, h(WhyHere, { thoughtId: "b" }))));
  const unknown = render({}, {});
  assert.match(unknown, /<button type="button" class="why-ask">Why here\?<\/button>/);
  assert.match(unknown, /aria-live="polite"/, "an answer is announced when it comes");
  assert.match(render({ b: { why: "names the deposit" } }, {}), /Why here: names the deposit/);
  assert.doesNotMatch(render({ b: { why: "names the deposit" } }, {}), /<button/, "a known reason has nothing to press");
  assert.match(render({}, { b: { text: "", failed: false, pending: true } }), /aria-busy="true"[^]*Why here: …/);
  assert.match(render({}, { b: { text: "Couldn't say why just now.", failed: true } }), /Couldn&#x27;t say why just now\.[^]*Try again/);

  // "While you were away": every thread row can say why, except a new top-level thread ("New thread" says it).
  const thread = (id, extra = {}) => ({ id, title: id, parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "", ...extra });
  const thought = (id, thread_id, at_ms, extra = {}) => ({ id, thread_id, at_ms, speaker: "Ana", text: id, point: id, placed: true, complete: true, unclear: "", place_ms: 10, ...extra });
  const before = { threads: [thread("old")], thoughts: [thought("seen", "old", 1)], suggestions: [], actions: [], merged: {}, active: "old", active_by: {}, recaps: [], apps: [], apps_seeded: true };
  const after = { ...before, threads: [thread("old"), thread("fresh"), thread("branch", { parent_id: "old" })],
    thoughts: [...before.thoughts, thought("more", "old", 10), thought("new", "fresh", 20), thought("tangent", "branch", 30)],
    suggestions: [{ id: "idea", thread_id: "old", text: "Try this", status: "new" }] };
  const rows = Object.fromEntries(awayItems(before, after, "Ana").map((r) => [r.key, r]));
  assert.equal(rows["thread:old"].why, true, "a point added to a thread you had");
  assert.equal(rows["thread:old"].thoughtId, "more", "the reason is for the point the row shows");
  assert.equal(rows["thread:branch"].why, true, "a new tangent says what it branched from");
  assert.equal(rows["thread:fresh"].why, false, "a new thread is its own answer");
  assert.ok(!rows["proposal:idea"].why, "proposals aren't placed thoughts");

  // Wiring: the row's Why? sits beside its link, never inside it (a row only takes you there), and asks on open;
  // the point opens for every placed thought and shows its reason with the words said; the window asks the core.
  const away = ui("Away.tsx");
  assert.match(away, /<\/a>\s*\{\/\*[^]*?\*\/\}\s*\{item\.why && item\.thoughtId && <button type="button" className="away-why" aria-expanded/);
  assert.match(away, /<WhyHere thoughtId=\{item\.thoughtId\} auto \/>/);
  // A dismissed card forgets its open rows, so a later card never opens one (and asks the model) by itself.
  assert.match(away, /useEffect\(\(\) => \{ if \(!items\.length\) setWhy\([^]*\}, \[items\.length\]\);\s*if \(!items\.length\) return null;/);
  const app = ui("App.tsx");
  assert.match(app, /const said = differ \|\| thought\.placed/);
  assert.match(app, /\{differ \? "Words said" : "Why here"\}/, "the toggle says what it opens");
  assert.match(app, /title=\{said && !open \? hoverTitle\(/);
  assert.match(app, /<WhyHere thoughtId=\{thought\.id\} \/>/);
  assert.match(app, /<WhyContext\.Provider value=\{whyAsk\}>/);
  assert.match(app, /<NotesContext\.Provider value=\{notes\}>\s*<Away /, "the away card reads the kept reasons");
  const core = ui("core.ts");
  assert.match(core, /case "why_here":/);
  assert.match(core, /type: "why_here", thought_id/);
  console.log("Why here checks passed: wording (placer vs later), hover card, button until asked, live answer, retry, away rows (new thread left out), wiring.");
} finally {
  await server.close();
}
