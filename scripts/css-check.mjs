// No extra dependencies: run with `node scripts/css-check.mjs`.
// Every class the window's stylesheets style is one its code still uses: a rule left behind when its element went
// (the Palace's keyboard line, the Apps bar's ✦ and a point's mark, 2026-11-01) is dead weight that reads as live.
// A class counts as used when it is a word of a class-list-shaped string (lowercase words only, so prose such as "See
// the map" can't vouch for `.map`) in ui/src's code, ui/public's scripts or ui/index.html, comments left out.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const ui = new URL("../ui/", import.meta.url);
const files = (dir, test) => readdirSync(new URL(dir, ui)).filter(test).map((f) => readFileSync(new URL(dir + f, ui), "utf8"));
// The app's own folders beside src/: the new shell (src/shell/, behind ?shell=2) has its code and stylesheet there.
const code = [...files("src/", (f) => /\.tsx?$/.test(f)), ...files("src/shell/", (f) => /\.tsx?$/.test(f)), ...files("public/", (f) => f.endsWith(".js")), readFileSync(new URL("index.html", ui), "utf8")]
  .join("\n").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w"'`\\])\/\/.*$/gm, "$1");
const quoted = [...code.matchAll(/"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g)].map((m) => m[1] ?? m[2]);
const templates = [...code.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, " "));
const used = new Set([...quoted, ...templates].map((s) => s.trim().split(/\s+/))
  .filter((words) => words.every((w) => /^[a-z][\w-]*$/.test(w))).flat());
const css = [...files("src/", (f) => f.endsWith(".css")), ...files("src/shell/", (f) => f.endsWith(".css"))].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const classes = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));
const unused = [...classes].filter((c) => !used.has(c)).sort();
assert.deepEqual(unused, [], "styled classes no code uses: drop their rules");
console.log(`css-check: ok (${classes.size} classes)`);
