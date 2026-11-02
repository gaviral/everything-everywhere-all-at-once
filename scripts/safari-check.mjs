// No extra dependencies: run with `node scripts/safari-check.mjs`.
// Safari (WebKit) differences from Chrome that showed on screen when the demo flows ran in a real WebKit engine
// (Playwright's WebKit 27.2, headless, against a test core, 2026-11-01). Every flow worked; these held, so a later
// change can't quietly bring them back. Rules and source, not pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("ui/index.html");
const styles = read("ui/src/styles.css");

// 1. Safari tints its toolbar, and an iPhone its status bar, with theme-color. A light one alone left a pale bar over
//    the dark page: there's one per theme, each the page's own --bg for that theme.
const bg = (block) => block.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1].toLowerCase();
const light = bg(styles.split("@media (prefers-color-scheme: dark)")[0]);
const dark = bg(styles.split("@media (prefers-color-scheme: dark)")[1] ?? "");
const theme = (scheme) => html.match(new RegExp(`<meta name="theme-color" content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`, "i"))?.[1].toLowerCase();
assert.ok(light && dark, "styles.css defines --bg for both themes");
assert.equal(theme("light"), light, "theme-color for light is the light --bg");
assert.equal(theme("dark"), dark, "theme-color for dark is the dark --bg");
assert.equal((html.match(/name="theme-color"/g) ?? []).length, 2, "no theme-color without a media query (it would win in both themes)");

// 2. ✦, the mark on everything the AI made: no font in the stack has it, and Safari's fallback drew it at about half the
//    size Chrome's (Zapf Dingbats) did. The stack starts with a face for that one character, from Zapf Dingbats.
const face = styles.match(/@font-face\s*{([^}]*)}/)?.[1] ?? "";
const family = face.match(/font-family:\s*"([^"]+)"/)?.[1];
assert.ok(family && /unicode-range:\s*U\+2726\s*;/i.test(face), "a face that covers only ✦ (U+2726)");
assert.match(face, /src:\s*local\("Zapf Dingbats"\)/, "drawn from Zapf Dingbats, as Chrome draws it");
const body = styles.match(/\nbody\s*{([^}]*)}/)?.[1] ?? "";
assert.match(body, new RegExp(`font:[^;]*\\s"${family}",`), "the body's stack starts with it");

// 3. Recap opened by a click or tap: Safari's showModal() marks its first button :focus-visible, so × wore a ring Chrome
//    never shows. The sheet focuses × again with the ring only when the focus before it showed one, leaving it first
//    (focusing the already focused × again keeps Safari's ring).
const recap = read("ui/src/Recap.tsx");
const opening = recap.slice(recap.indexOf("sheet.showModal()"), recap.indexOf("return () => {", recap.indexOf("sheet.showModal()")));
assert.match(recap, /const ring = !!previous\?\.matches\(":focus-visible"\);[\s\S]*sheet\.showModal\(\)/, "the ring is decided by the focus before the sheet opened");
assert.match(opening, /close\?\.blur\(\);\s*close\?\.focus\(\{ focusVisible: ring \}\);/, "× is left, then focused with that ring");

console.log("Safari checks passed: theme-color follows the theme; ✦ is drawn from one face; a clicked Recap opens without a ring on ×.");
