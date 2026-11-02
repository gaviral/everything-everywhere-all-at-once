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
  const { saidDiffers, intoColumns, NATURAL_PAUSE_MS, TWO_COLUMNS } = await server.ssrLoadModule("/src/legible.ts");

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

  // The words behind a point open by a real disclosure button (name, expanded state, what it opens), not a bare <li>.
  const point = read("App.tsx").match(/const Point = memo[\s\S]*?\n\}\);/)[0];
  assert.match(point, /<button type="button" className="said-toggle" aria-expanded=\{open\} aria-controls=\{`said-\$\{thought\.id\}`\}[^>]*>Words said<\/button>/, "a Words said button");
  assert.match(point, /id=\{`said-\$\{thought\.id\}`\}/, "the words it controls carry the id");
  assert.doesNotMatch(point, /onKeyDown/, "no key handler on the <li>: the button is the keyboard path");

  // Numbers that live in two files say the same thing.
  const css = read("legible.css"), app = read("App.tsx");
  assert.match(TWO_COLUMNS, /min-width: 1100px/);
  assert.ok(css.includes("@media (min-width: 1100px)"), "legible.css switches to two columns where legible.ts does");
  assert.ok(app.includes(`now - lastActivity > ${NATURAL_PAUSE_MS}`), "the talking state ends at the pull-back's pause");

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
