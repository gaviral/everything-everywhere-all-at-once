// No extra dependencies: run with `node scripts/frames-check.mjs`.
// Small things the camera sees (UI reviews, 2026-11-02), held so a later change can't quietly undo them: the
// unfinished card's letter in its room's color, no lone last word under the Recap and the Palace, an open Apps panel
// that doesn't stop the map following you, and a notice that leaves the Apps pill readable. Source and CSS
// values, not pixels (the pixels were measured at 1440 × 900 when these landed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");
const app = src("App.tsx"), styles = src("styles.css"), recap = src("recap.css"), palace = src("palace.css"), legible = src("legible.css");
const rules = (css, selector) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter(([, sel]) => sel.split(",").some((s) => s.trim() === selector)).map(([, , body]) => body).join(";");

// 1. The unfinished card's letter tile is its thread's: the map's tile is green, so the card's must be too, not page
//    grey (pictures.ts counts the unfinished card among the room-colored slots).
const pullback = app.slice(app.indexOf('className="pullback"') - 200, app.indexOf("<ThreadPicture thread={pullBack}"));
assert.match(pullback, /style=\{roomStyle\(rooms\.get\(pullBack\.id\)\)\}/, "the unfinished card carries its thread's room color");

// 2. No word alone on the last line of the two most-watched frames: the Recap's summary and the Palace's points.
for (const [name, css, selector] of [["recap.css", recap, ".recap-summary"], ["palace.css or legible.css", palace + legible, ".palace-point"]])
  assert.match(rules(css, selector), /text-wrap:\s*pretty/, `${selector} wraps with text-wrap: pretty (${name})`);

// 3. An open Apps panel isn't "looking elsewhere": the map still follows your words and "where was I?". Only typing
//    in the panel holds it (the rule's first reason, when every build opened the panel).
const elsewhere = app.match(/const lookingElsewhere = \(\) =>[\s\S]*?;\n/)?.[0] ?? "";
assert.ok(elsewhere, "App.tsx has lookingElsewhere");
assert.ok(!elsewhere.includes(".apps-panel.is-open"), "an open Apps panel doesn't hold the map");
assert.ok(elsewhere.includes(".apps-panel input:focus"), "typing in the Apps panel still does");

// 4. A notice or map update never covers the Apps pill: they come after it on the page, in a lane of no height that
//    sticks under the header (nothing moves when one comes or goes). Fixed at the header's foot, they sat on the pill
//    in every take's hook ("Back to Never Finishing Things" over "Apps 1 on Open").
const at = (needle) => { const i = app.indexOf(needle); assert.ok(i >= 0, `App.tsx has ${needle}`); return i; };
assert.ok(at("<Apps core={core} />") < at('className="notice-lane"'), "the Apps pill comes before the notices");
const lane = app.slice(at('className="notice-lane"'), at("<Explain explanations"));
assert.ok(lane.includes('className="notice"') && lane.includes('className="map-change"'), "the notice and the map update are in the lane");
assert.match(rules(styles, ".notice-lane"), /position:\s*sticky[\s\S]*top:\s*calc\(var\(--header-height[\s\S]*height:\s*0/, "the lane sticks under the header and takes no room");
// Below a tall open Apps panel the sticky lane would sit past the screen's foot (sticky can't lift it), and "Describe
// the app…" would expire unseen: while the panel is open the lane is fixed, on a phone as well (display beats contents).
assert.match(rules(styles, ".apps-panel.is-open ~ .notice-lane"), /position:\s*fixed/, "the lane is fixed under an open Apps panel");
assert.match(rules(styles, ".apps-panel.is-open ~ .notice-lane"), /display:\s*flex/, "and shown as a box on a phone, where the lane is contents");
for (const selector of [".notice", ".map-change"])
  assert.doesNotMatch(rules(styles, selector), /position:\s*fixed/, `${selector} isn't fixed over the page`);

console.log("frames-check: ok");
