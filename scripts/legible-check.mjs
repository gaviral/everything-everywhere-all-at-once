// No extra dependencies: run with `node scripts/legible-check.mjs`.
// Legibility rules (ui/src/legible.ts, legible.css): which points open their original words, how threads split into
// two columns, that the numbers shared between files agree, and that no text is cut with an ellipsis or a line clamp
// unless it is listed below with its reason.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const src = new URL("../ui/src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, src), "utf8");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { saidDiffers, intoColumns, NATURAL_PAUSE_MS, TWO_COLUMNS, focusSpot, restoreFocus, POINT_OWN } = await server.ssrLoadModule("/src/legible.ts");
  // A click into a point's Move field (or anywhere in its menu) is the menu's, not a toggle of the point's words
  // (bug hunt 17); its buttons and marks keep theirs. The point's click handler asks `closest` with this list.
  const own = new Set(POINT_OWN.split(",").map((s) => s.trim()));
  for (const control of ["button", "input", ".move-menu", "[data-tip]"]) assert.ok(own.has(control), control);
  assert.match(readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8"), /\.closest\(POINT_OWN\)/);

  // A point opens its words only when they say more than the point: case and punctuation don't count.
  assert.equal(saidDiffers("Okay so the deadline is tomorrow at 9 PM", "Deadline tomorrow 9 PM"), true, "a short version");
  assert.equal(saidDiffers("Rent is due Friday.", "rent is due friday"), false, "only case and a period");
  assert.equal(saidDiffers("  ", "Anything"), false, "no words to show");
  assert.equal(saidDiffers("Mom's birthday — Saturday!", "Moms birthday Saturday"), false, "punctuation inside");
  assert.equal(saidDiffers("Café on Main", "Cafe on Main"), true, "a letter that differs is a different word");

  // Two columns by place in the map's order; a thread's column doesn't depend on any other card's size.
  assert.deepEqual(intoColumns([]), [[], []]);
  assert.deepEqual(intoColumns(["a"]), [["a"], []], "a lone thread (centered by legible.css)");
  assert.deepEqual(intoColumns(["a", "b", "c", "d", "e"]), [["a", "c", "e"], ["b", "d"]]);
  const before = intoColumns(["a", "b", "c"]), after = intoColumns(["a", "b", "c", "d"]);
  assert.deepEqual([after[0].slice(0, 2), after[1].slice(0, 1)], [before[0], before[1]], "a new thread moves no other");

  // Crossing the two-column width rebuilds the cards: focus goes back to the same control on the rebuilt card.
  // A small stand-in for the page: a card (with an id) holding focusable controls.
  const page = () => {
    const doc = { body: { id: "" }, activeElement: null, byId: new Map(), getElementById: (id) => doc.byId.get(id) ?? null };
    const node = (id, parent, focusable) => {
      const n = { id, parent, focusable, kids: [], isConnected: true,
        closest: () => { let at = n; while (at && !at.id) at = at.parent; return at ?? null; },
        querySelectorAll: () => { const all = []; const walk = (x) => x.kids.forEach((k) => { if (k.focusable) all.push(k); walk(k); }); walk(n); return all; },
        focus: () => { doc.activeElement = n; } };
      parent?.kids.push(n);
      if (id) doc.byId.set(id, n);
      return n;
    };
    return { doc, node };
  };
  {
    const { doc, node } = page();
    const card = node("thread-a", null, false), head = node("", card, false);
    node("", head, true); const toggle = node("", head, true);
    doc.activeElement = toggle;
    const spot = focusSpot(doc);
    assert.deepEqual([spot.id, spot.index], ["thread-a", 1], "the card and the control's place in it");
    // The rebuild: the old card leaves, a new one with the same id and controls arrives.
    card.isConnected = toggle.isConnected = false; doc.activeElement = doc.body;
    const again = node("thread-a", null, false), head2 = node("", again, false);
    node("", head2, true); const toggle2 = node("", head2, true);
    restoreFocus(spot, doc);
    assert.equal(doc.activeElement, toggle2, "focus returns to the same control on the rebuilt card");
    // Focus that survived (nothing was rebuilt) is left alone.
    doc.activeElement = again; restoreFocus({ element: toggle2, id: "thread-a", index: 0 }, doc);
    assert.equal(doc.activeElement, again, "a control still on the page keeps its focus");
    doc.activeElement = doc.body;
    assert.equal(focusSpot(doc), null, "nothing focused, nothing to restore");
  }

  // The words behind a point open by a real disclosure button (name, expanded state, what it opens), not a bare <li>.
  const point = read("App.tsx").match(/const Point = memo[\s\S]*?\n\}\);/)[0];
  assert.match(point, /<button type="button" className="said-toggle" aria-expanded=\{open\} aria-controls=\{`said-\$\{thought\.id\}`\}[^>]*>(Words said|\{differ \? "Words said" : "Why here"\})<\/button>/, "a Words said button (Why here when the words only repeat the point)");
  assert.match(point, /id=\{`said-\$\{thought\.id\}`\}/, "the words it controls carry the id");
  assert.doesNotMatch(point, /onKeyDown/, "no key handler on the <li>: the button is the keyboard path");
  // A mark inside the point (Tips.tsx) keeps its own job: a tap shows its tip, not the words, and the point's title
  // doesn't add a second tip over it.
  assert.match(point, /closest\(POINT_OWN\)/, "a tap on a point's ✦ or ? shows its tip without opening the words");
  for (const mark of point.match(/<span [^>]*data-tip=[^>]*>/g) ?? []) assert.match(mark, /title=""/, `no second tip over ${mark}`);
  assert.match(read("legible.css"), /\.said-toggle \{[^}]*user-select: none/, "its name stays out of words selected to explain");

  // Numbers that live in two files say the same thing.
  const css = read("legible.css");
  assert.match(TWO_COLUMNS, /min-width: 1100px/);
  assert.ok(css.includes("@media (min-width: 1100px)"), "legible.css switches to two columns where legible.ts does");
  const { PAUSE_MS } = await server.ssrLoadModule("/src/unfinished.ts");
  assert.equal(PAUSE_MS, NATURAL_PAUSE_MS, "the talking state ends at the pull-back's pause");

  // No ellipsis or clamp cuts text, except these, each with why.
  const allowed = {
    // A phone's dock is half the screen at most: a thought on its way shows one line and lands whole in ≈ 3 s.
    ".pill": "phone",
    // A phone's header count ("This session · 30 thoughts · 8 threads") is a status, not content.
    ".session-count": "phone",
    // Screen-reader-only text is never seen.
    ".sr-only": "hidden",
  };
  const rules = (text) => [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const legible = rules(css);
  const undone = (sel) => legible.some((r) => r.sel.split(",").map((s) => s.trim()).includes(sel) &&
    /text-overflow:\s*clip|line-clamp:\s*unset|white-space:\s*normal/.test(r.body));
  const cuts = [];
  for (const file of readdirSync(src).filter((f) => f.endsWith(".css") && f !== "legible.css")) {
    for (const { sel, body } of rules(read(file))) {
      const cutsText = /text-overflow:\s*ellipsis/.test(body) || /line-clamp:\s*\d/.test(body);
      if (!cutsText) continue;
      for (const one of sel.split(",").map((s) => s.trim())) if (!allowed[one] && !undone(one)) cuts.push(`${file}: ${one}`);
    }
  }
  assert.deepEqual(cuts, [], "text cut with an ellipsis or a clamp, not undone in legible.css nor allowed with a reason");
  console.log("legible-check: ok");
} finally {
  await server.close();
}
