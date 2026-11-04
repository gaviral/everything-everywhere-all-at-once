// No extra dependencies: run with `node scripts/feedback-check.mjs`.
// The feedback catalog (ui/src/feedback.ts) matches the code: a click, key, pointer, blur, input, drag or form handler
// in ui/src with no entry there fails, as does an entry whose `says` words aren't in the code or that waits on
// something slow with no working or failed state. The shared press (styles.css "Pressed") must be there for every
// button, Move and Delete included, with Reduce Motion keeping only the dim (the mic too); a dismissed row fades out
// rather than vanishing; and every spoken command in core/src/catalog.rs answers with words the core really sends.
// Source-level, as the other checks here: it doesn't prove a state renders (the e2e run in the card and each feature's
// own check do).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const srcFiles = [
  ...readdirSync(new URL("ui/src/", root)),
  ...readdirSync(new URL("ui/src/shell/", root)).map((f) => `shell/${f}`),
].filter((f) => /\.tsx?$/.test(f) && f !== "feedback.ts" && !f.endsWith(".d.ts"));
const src = Object.fromEntries(srcFiles.map((f) => [f, read(`ui/src/${f}`)]));
const problems = [];

const server = await uiServer();
let ACTIONS, NOT_ACTIONS, PRESS, INSTANT;
try {
  ({ ACTIONS, NOT_ACTIONS, PRESS, INSTANT } = await server.ssrLoadModule("/src/feedback.ts"));
} finally {
  await server.close();
}

// 1. Every handler in ui/src is an action with an entry, or says why it isn't one.
const HANDLER = /\bon(?:Click|Submit|DoubleClick|ContextMenu|DragStart|KeyDown|Change|Input|Blur(?:Capture)?|Pointer(?:Down|Up|Cancel))=\{|\bonDrop:|addEventListener\("(?:keydown|drop|pointer(?:down|up))"/g;
const handlers = [];
const found = (file, text) => {
  const out = [];
  for (const m of text.matchAll(HANDLER)) {
    // Its line and the next: a handler opened at a line's end ("onClick={(event) => {") is named by its first line.
    const start = text.lastIndexOf("\n", m.index) + 1, end = text.indexOf("\n", text.indexOf("\n", m.index) + 1);
    const line = text.slice(start, end < 0 ? undefined : end);
    // The element it's on: the last tag opened before it.
    const tag = [...text.slice(Math.max(0, m.index - 2000), m.index).matchAll(/<([a-zA-Z][\w.]*)/g)].at(-1)?.[1] ?? "";
    out.push({ file, line, lineNo: text.slice(0, m.index).split("\n").length, tag, handler: m[0] });
  }
  return out;
};
for (const [file, text] of Object.entries(src)) handlers.push(...found(file, text));
const marks = [
  ...ACTIONS.flatMap((a) => a.at.map(([file, marker]) => ({ file, marker, action: a }))),
  ...NOT_ACTIONS.map(({ at: [file, marker] }) => ({ file, marker, action: null })),
];
const catalogued = (h) => marks.filter((m) => m.file === h.file && h.line.includes(m.marker));
// The net catches what it says it does: an uncatalogued handler of each kind, added to a real file, fails.
for (const file of ["App.tsx", "shell/Shell.tsx"]) {
  for (const added of ["onPointerUp={() => go()}", "onBlur={() => go()}", "onBlurCapture={() => go()}", "onInput={() => go()}", "onClick={() => go()}"]) {
    const extra = found(file, `${src[file]}\n<button type="button" ${added}>Go</button>\n`).filter((h) => !catalogued(h).length);
    assert.ok(extra.some((h) => h.line.includes(added)), `the check misses an uncatalogued ${added} in ${file}`);
  }
}
for (const h of handlers) {
  const by = catalogued(h);
  if (!by.length) problems.push(`${h.file}:${h.lineNo} ${h.handler} on <${h.tag}> gives no catalogued feedback: add it to ui/src/feedback.ts`);
  h.by = by;
}
for (const m of marks) {
  if (!src[m.file]) { problems.push(`feedback.ts: ${m.file} isn't in ui/src`); continue; }
  if (!handlers.some((h) => h.file === m.file && h.line.includes(m.marker))) problems.push(`feedback.ts: no handler in ${m.file} on a line with ${JSON.stringify(m.marker)} (stale entry?)`);
}

// 2. Each action shows something at every step it has, and says only words that are in the code.
const code = Object.values(src).join("\n");
const ids = new Set();
for (const a of ACTIONS) {
  if (ids.has(a.id)) problems.push(`feedback.ts: ${a.id} twice`);
  ids.add(a.id);
  if (!a.pressed?.trim()) problems.push(`${a.id}: nothing shows when it's pressed`);
  if (!a.done?.trim()) problems.push(`${a.id}: nothing shows when it's done`);
  if (a.waits && a.waits !== "core" && !a.working?.trim()) problems.push(`${a.id}: waits on ${a.waits} with no working state`);
  if (a.waits && !a.failed?.trim()) problems.push(`${a.id}: waits on ${a.waits} with no failed state`);
  for (const words of a.says ?? []) if (!code.includes(words)) problems.push(`${a.id}: says “${words}”, which isn't in ui/src`);
  // The shared press is only a button's, a link's or a form's (its submit button): a clickable div or point needs its
  // own answer (INSTANT, when the press does it within the frame).
  if (a.pressed === PRESS) {
    const on = handlers.filter((h) => h.by?.some((m) => m.action === a));
    if (on.length && !on.some((h) => /^(button|a|summary|form)$/.test(h.tag) || h.file === "MicButton.tsx"))
      problems.push(`${a.id}: the shared press is for buttons and links, but it's on <${on.map((h) => h.tag).join(", ")}>`);
  }
}
assert.ok(ACTIONS.some((a) => a.pressed === INSTANT), "INSTANT is used");

// 3. The shared press, at once on press and eased back on release, and only a dim under Reduce Motion.
const styles = read("ui/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const press = styles.match(/(?:^|\n)([^{}\n]*button[^{}\n]*:active[^{}\n]*)\{([^}]*)\}/g)?.find((r) => /scale:\s*\.97/.test(r) && /opacity:/.test(r));
if (!press) problems.push("styles.css: no shared press (button:active with scale: .97 and a dim)");
else {
  if (!/transition-duration:\s*0s/.test(press)) problems.push("styles.css: the press must show at once (transition-duration: 0s on :active)");
  for (const el of ["summary", "a[href]", "[role=\"button\"]"]) if (!press.includes(el)) problems.push(`styles.css: the shared press leaves out ${el}`);
}
// Move and Delete show at opacity: 1 (moves.css), which wins over the zero-specificity press: their own dim must be there.
const moves = read("ui/src/moves.css").replace(/\/\*[\s\S]*?\*\//g, "");
if (!/\.move-button:active[^{]*\{[^}]*opacity:\s*\.75/.test(moves)) problems.push("moves.css: Move and Delete don't dim when pressed (their opacity: 1 hides the shared press)");
const reduced = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
if (!/:active[^{]*\{[^}]*scale:\s*none/.test(reduced)) problems.push("styles.css: under Reduce Motion the press must not move (scale: none)");
if (!/\.mic[^{]*:active[^{]*\{[^}]*transform:\s*none[^}]*opacity:\s*\.75/.test(reduced)) problems.push("styles.css: under Reduce Motion the mic's press must not move, and must dim instead");
if (!/\*\s*\{\s*animation:\s*none !important;\s*transition:\s*none !important;/.test(reduced)) problems.push("styles.css: Reduce Motion must stop every animation and transition");

// 4. A suggestion or action you dismiss fades out, so the rows below close the gap instead of jumping.
const app = read("ui/src/MapCards.tsx");
const row = (start) => app.slice(app.indexOf(start), app.indexOf(">", app.indexOf(start)));
for (const [name, start] of [["suggestion", "<motion.div key={s.id}"], ["action", "<motion.div ref={row}"]]) {
  if (!/\bexit=\{/.test(row(start))) problems.push(`App.tsx: a dismissed ${name} row vanishes (no exit)`);
}
if (!/<AnimatePresence initial=\{false\}>\s*\{ideas\.map/.test(app)) problems.push("App.tsx: suggestion rows aren't in an AnimatePresence, so their exit never plays");
if (!/<AnimatePresence initial=\{false\}>\s*\{actions\.map/.test(app)) problems.push("App.tsx: action rows aren't in an AnimatePresence, so their exit never plays");

// 5. Every spoken command answers where you see it, with words the core really sends.
const rust = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? rust(`${dir}${d.name}/`)
  : d.name.endsWith(".rs") ? [read(`${dir}${d.name}`)] : []);
const catalog = read("core/src/catalog.rs");
// A view command's answer is the window's (App.tsx shows "Later: …" for the core's `view`), so the UI counts too.
const core = [...rust("core/src/").filter((t) => t !== catalog), code].join("\n");
const defs = [...catalog.matchAll(/Def \{ act: Act::(\w+),.*?answers: "([^"]*)"/g)];
assert.ok(defs.length >= 20, `catalog.rs has its commands (${defs.length})`);
for (const [, act, answers] of defs) {
  if (!answers.trim()) { problems.push(`catalog.rs: ${act} answers nothing`); continue; }
  for (const [, quoted] of answers.matchAll(/“([^”]*)”/g)) {
    const stem = quoted.split("…")[0].replace(/[“\s]+$/, "");
    if (stem.length >= 4 && !core.includes(stem)) problems.push(`catalog.rs: ${act} answers “${quoted}”, but the core never says “${stem}”`);
  }
}

assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
console.log(`feedback-check: ok (${ACTIONS.length} actions on ${handlers.length} handlers, ${defs.length} spoken commands)`);
