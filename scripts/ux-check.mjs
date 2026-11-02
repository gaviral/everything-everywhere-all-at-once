// No extra dependencies: run with `node scripts/ux-check.mjs`.
// The UX principles audit's top fixes (2026-11-01), held so a later change can't quietly undo them: card edges that
// survive video compression, a title that beats its thoughts, amber kept for what can slip away, a card that opens
// where you click it, and a Palace whose last frame the dock doesn't cover. Rules and CSS values, not pixels (the
// pixels were measured at 1440 × 900 in both themes when these landed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");
const styles = src("styles.css"), palace = src("palace.css"), app = src("App.tsx");

// WCAG relative luminance and contrast, for hex colors.
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const light = styles.slice(0, styles.indexOf("@media (prefers-color-scheme: dark)"));
const dark = styles.slice(styles.indexOf("@media (prefers-color-scheme: dark)"));
const token = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
const rule = (css, selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

// 1. Cards keep an edge on the page: at 1.15:1 (#e7e6e1) they dissolved into floating text in the take's frames.
for (const [theme, block] of [["light", light], ["dark", dark]]) {
  const edge = contrast(token(block, "--line"), token(block, "--bg"));
  assert.ok(edge >= 1.3, `${theme}: card edge on the page is ${edge.toFixed(2)}:1, under 1.3:1`);
}
const lift = Math.max(...[...light.match(/--shadow:[^;]*/)[0].matchAll(/rgba\(0, 0, 0, ([\d.]+)\)/g)].map(([, a]) => +a));
assert.ok(lift >= 0.07, `the light shadow's deepest layer is ${lift}, under 0.07`);

// 2. A thread's name wins over its thoughts: two px and a weight step up from the 15 px/400 body.
const body = +styles.match(/body\s*\{[^}]*font:\s*(\d+)px/)[1];
const title = rule(styles, ".title");
assert.ok(+title.match(/font-size:\s*(\d+)px/)[1] >= body + 2, "the title is at least 2 px over the body");
assert.ok(+title.match(/font-weight:\s*(\d+)/)[1] >= 650, "the title is at least 650");

// 3. Amber means "this can slip away" (left off, Finish it, due): the count of proposals to review stays quiet.
assert.ok(rule(styles, ".chip.waiting") && !/amber/.test(rule(styles, ".chip.waiting")), "\"N to review\" isn't amber");
const amberChips = [...styles.matchAll(/(\.chip[.\w-]*)\s*\{[^}]*var\(--amber/g)].map(([, s]) => s);
assert.deepEqual(amberChips, [".chip.dropped"], "the only amber chip on a card is left off");

const server = await uiServer();
try {
  const { headClickToggles, showsLiveLine } = await server.ssrLoadModule("/src/ux-rules.ts");
  // 4. The whole head opens the card, except where a click already means something else or ends a selection.
  const at = (inside) => ({ closest: (selector) => (inside && selector.split(",").some((s) => s.trim() === inside) ? {} : null) });
  assert.equal(headClickToggles(at(null)), true, "the title, the picture or the empty head toggles");
  for (const control of ["button", "a", "input", "[role='button']", "[data-tip]"]) assert.equal(headClickToggles(at(control)), false, `a click on ${control} stays its own`);
  assert.equal(headClickToggles(at(null), "Rent is due"), false, "selecting the title to copy it doesn't fold the card");
  assert.equal(headClickToggles(null), false);
  // A tap on the picture's ✦ or the unseen dot (both in the head) shows its tip; the card must stay open under it.
  assert.match(app, /className="picture-mark"[^>]*data-tip=/, "the head's picture mark carries a tip, so the rule must skip it");
  assert.match(app, /className="thread-head" onClick=\{\(event\) => \{\s*if \(headClickToggles\(/, "the card's head is wired to the rule");
  assert.match(app, /className="collapse thread-toggle"[^>]*onClick=\{toggle\}/, "the head and the button toggle the same way");

  // 5. The Palace's last frame: the dock is the composer and what needs you, nothing more.
  const line = (s) => showsLiveLine({ words: false, pending: 0, listening: true, starting: false, view: "map", ...s });
  assert.equal(line({}), true, "on the map, the live line holds its place, empty until words come");
  assert.equal(line({ view: "palace" }), false, "in the Palace the composer already says it");
  assert.equal(line({ view: "palace", words: true }), true, "words always show, in the Palace too");
  assert.equal(line({ view: "palace", starting: true, listening: false }), true, "starting the mic still answers the click");
  assert.equal(line({ pending: 1 }), false, "a pending thought takes the line's place");
  assert.equal(line({ listening: false }), false);
  assert.match(app, /\{showsLiveLine\(\{[^}]*view \}\) && <div/, "the dock is wired to the rule");
  assert.match(app, /className=\{view === "palace" \? "dock in-palace" : "dock"\}/, "the dock knows it is over the Palace");
  assert.match(palace, /\.dock\.in-palace \.dock-inner > :empty \{ display: none; \}/, "empty dock slots give their gaps back over the Palace");
  const top = +palace.match(/\n\.palace \{[^}]*padding:\s*(\d+)px/)[1];
  assert.ok(top <= 16, `the Palace's top padding is ${top} px; 8 threads in 3 rooms clear the dock at 1440 × 900 with 16`);
  assert.ok(+palace.match(/\.palace-intro h1 \{[^}]*clamp\(\d+px, [\d.]+vw, (\d+)px\)/)[1] <= 40, "the Palace title tops out at 40 px");
  console.log("ux-check: ok");
} finally {
  await server.close();
}
