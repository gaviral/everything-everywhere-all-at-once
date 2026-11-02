// No extra dependencies: run with `node scripts/a11y-check.mjs`.
// Keyboard and zoom basics (accessibility review, 2026-11-02), held so a later change can't quietly undo them:
// one key from the page's top to the composer, the keys the README and the tour promise, and a map that keeps its
// room when the window is short (200–400% zoom, a phone on its side). Rules and CSS, not pixels: the pixels were
// measured in headless Chrome on the sample map when this landed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("ui/src/App.tsx"), styles = read("ui/src/styles.css"), tour = read("ui/src/Tour.tsx"), readme = read("README.md");
const server = await uiServer();
try {
  const keys = await server.ssrLoadModule("/src/keys.ts");

  // 1. A skip link is the page's first stop: Tab, then Enter, puts you in the composer (it took 46 Tabs).
  const top = app.slice(app.indexOf('<div className="app"'), app.indexOf("<header"));
  assert.match(top, /<a className="skip-link" href=\{`#\$\{COMPOSER_ID\}`\}/, "the skip link comes before the header");
  assert.match(top, /composerRef\.current\?\.focus\(\)/, "the skip link focuses the composer");
  assert.match(app, /<input\s+id=\{COMPOSER_ID\}\s+ref=\{composerRef\}/, "the composer's input carries the link's target");
  assert.equal(keys.COMPOSER_ID, "type-a-thought");
  // Hidden until focused, then on screen above everything.
  const skip = styles.match(/\.skip-link\s*\{([^}]*)\}/)?.[1] ?? "";
  const shown = styles.match(/\.skip-link:focus(?:-visible)?\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(skip, /position:\s*(fixed|absolute)/, "the skip link sits outside the layout");
  assert.match(shown, /(translate|transform|top|left|clip)/, "the skip link shows on focus");

  // 2. "Press ? for everything you can say" (the tour): ? opens the list from anywhere but a field.
  assert.match(tour, /Press \? for everything you can say/);
  assert.equal(keys.opensHelp({ key: "?", field: false, modified: false }), true, "? on the page");
  assert.equal(keys.opensHelp({ key: "?", field: true, modified: false }), false, "? typed in a field stays a character");
  assert.equal(keys.opensHelp({ key: "?", field: false, modified: true }), false, "⌘? and the like are the browser's");
  assert.equal(keys.opensHelp({ key: "/", field: false, modified: false }), false, "/ is search");
  assert.match(app, /opensHelp\(\{ key: event\.key, field, modified: /, "the page's keydown handler asks opensHelp");
  assert.match(app, /setHelpOpen\(\(open\) => !open\)/, "? toggles the list");

  // 3. "Tab to it and press Enter" (README): Enter or Space on a focused point opens its words, as a click does.
  assert.match(readme, /Tab to it and press Enter/);
  assert.equal(keys.togglesPoint({ key: "Enter", onPoint: true }), true);
  assert.equal(keys.togglesPoint({ key: " ", onPoint: true }), true);
  assert.equal(keys.togglesPoint({ key: "Enter", onPoint: false }), false, "a point's own buttons keep their Enter");
  assert.equal(keys.togglesPoint({ key: "a", onPoint: true }), false);
  // Enter that asked to explain words selected in the point (Explain.tsx, window capture) leaves them showing.
  assert.equal(keys.togglesPoint({ key: "Enter", onPoint: true, taken: true }), false, "Explain's Enter doesn't also fold the words");
  assert.match(app, /onKeyDown=\{said \? \(event\) => \{ if \(togglesPoint\(\{ key: event\.key, onPoint: event\.target === event\.currentTarget, taken: event\.defaultPrevented \}\)\)/,
    "the point's keydown asks togglesPoint");
  // The ? list says both keys, so they can be found without the README.
  const help = app.slice(app.indexOf("<strong>Keyboard</strong>"), app.indexOf("<Symbols />"));
  assert.match(help, /\? · opens or closes this list/);
  assert.match(help, /Tab, then Enter · from the page's top, straight to typing/);
  assert.match(help, /point · Enter or Space shows or hides the words you said/);

  // 4. A short window (200–400% zoom: 1440 × 900 is 720 × 450 at 200%, 360 × 225 at 400%; 1280 × 1024 is 640 × 512
  // at 200%) unpins the header and the tools, which took 210 of 256 px at 400% and left no map. The dock keeps only
  // the composer pinned; its cards scroll inside it, capped so the map keeps most of the window.
  const short = [...styles.matchAll(/@media \(max-height: (\d+)px\) \{([\s\S]*?)\n\}/g)];
  assert.equal(short.length, 1, "one short-window block");
  const [, limit, css] = short[0];
  assert.ok(+limit >= 512 && +limit < 600, `the short-window limit ${limit}px covers 200% of 1280 × 1024 and leaves a 600 px laptop window alone`);
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".map-tools"), /position:\s*static/, "the tools scroll away");
  // The header scrolls away too, but stays positioned: static, its z-index stopped applying and its backdrop-filter
  // kept the open ? list under the no-key notice (headless Chrome, 720 × 450).
  assert.match(rule("header"), /position:\s*relative/, "the header scrolls away and keeps its z-index");
  assert.match(styles, /header:has\(\.shortcuts\[open\]\) \{ z-index: 11; \}/, "open, the ? list's header goes over the notice (10)");
  assert.match(styles.match(/\.notice \{\s*position: fixed;[^}]*\}/)?.[0] ?? "", /z-index: 10;/, "the notice sits at 10");
  assert.match(rule(".thread, .palace-tile"), /scroll-margin-top:\s*12px/, "a card brought to the top has no bars to clear");
  const dock = rule(".dock");
  const cap = +(dock.match(/max-height:\s*(\d+)dvh/)?.[1] ?? 100);
  assert.ok(cap <= 40, `the dock is capped at ${cap}dvh, over 40`);
  assert.match(rule(".composer"), /position:\s*sticky;\s*bottom:\s*0/, "the composer stays in reach while dock cards scroll");
  // Palace opens at its top: with the tools unpinned there's no bar to leave room for.
  assert.match(read("ui/src/Palace.tsx"), /position === "sticky"/, "Palace measures the tools only while they're pinned");
} finally {
  await server.close();
}
console.log("a11y-check: ok");
