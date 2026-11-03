// `node scripts/names-check.mjs` fails when a retired display word shows up where a person reads it:
//  - a string in the UI (ui/src, found with the parser the UI build ships: needs `./run.sh` once to install it),
//  - a feature's brick.json (its name and line),
//  - a public doc (README, docs/FEATURES.md, bricks.md, COMMANDS.md, guide.md, ARCHITECTURE.md),
//  - a notice the core sends (core/src, outside tests).
// The names changed on 2026-11-03; docs/names.md is the lookup (new | AKA | old | where the old survives). Code names,
// saved maps, CHANGELOG and docs/trace.md keep the old words and are never read here.
// A deliberate leftover (a spoken alias, an AKA, another sense of the word) carries `names-ok: why` on its line or the
// line above (or, in code, on the line above its statement): `<!-- names-ok: spoken alias -->` in Markdown,
// `// names-ok: spoken alias` in code. Every marker is counted and listed with `--markers`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(dirname(new URL(import.meta.url).pathname), "..");

// ---- The retired words. `re` finds the word; `ok` lists the other senses (tested on the words around the hit).
// `W` wraps a pattern so it matches a word of prose, not a part of a path, an id or a file name (bricks/spine, brick.json, thread_id).
const W = (pattern, flags = "gi") => new RegExp(`(?<![\\w/._-])(?:${pattern})(?![\\w/_-]|\\.\\w)`, flags);
const WORDS = [
  { old: "thread", re: W("threads?"), now: "Topic", ok: [/\b(tokio|worker|OS|single|multi)[- ]?threads?\b/i, /\bthreads? (pool|safety|safe)\b/i] },
  { old: "branch", re: W("branch(?:es)?"), now: "Tangent", ok: [/\bgit\b|\bmerge[ds]?\b|\bcommits?\b|\bpull requests?\b|\bPRs?\b|\bmain branch\b|\bthe branch\b.*\bmerge/i, /ChatGPT.{0,40}branch|branch.{0,40}ChatGPT/i] },
  { old: "margin note", re: W("margin notes?"), now: "Comment", ok: [] },
  { old: "While you were away", re: W("while you were away"), now: "Since you left", ok: [] },
  { old: "Palace", re: W("palace"), now: "Pictures", ok: [/\bPalace of Versailles\b/i] },
  { old: "room", re: W("rooms?"), now: "Shared map", ok: [
    /\.\/run\.sh room|\?room\b|\broom=|--room\b|\/room\b|\bROOM_\w+|\bdata\/room\b/,
    /\broom (for|to|left|enough|here|on)\b/i, /\b(no|some|more|any|enough|much|little|plenty of|quiet|noisy|spare|extra) rooms?\b/i,
  ] },
  { old: "Spine", re: W("spines?"), now: "Canvas", ok: [/\bwork[- ]spine\b/i] },
  { old: "edge chip", re: W("edge chips?"), now: "Off-screen indicator", ok: [] },
  { old: "dock", re: W("dock", "g"), now: "Bottom bar", ok: [] },
  { old: "composer", re: W("composer"), now: "Input box", ok: [] },
  { old: "Bubble flight", re: W("bubble flight"), now: "Fly-in", ok: [] },
  { old: "brick", re: W("bricks?"), now: "Feature", ok: [] },
  { old: "Catalog", re: W("catalog"), now: "Features page", ok: [] },
  { old: "Apps bar", re: W("apps bar"), now: "Features", ok: [] },
  { old: "Notice timeline", re: W("notice timeline"), now: "Notification history", ok: [] },
  { old: "Read progress", re: W("read progress"), now: "Read marker", ok: [] },
  { old: "Brick chip", re: W("brick chip"), now: "Source attribution", ok: [] },
  { old: "Friend", re: W("Friend", "g"), now: "AI helper", ok: [] },
  { old: "Glance", re: W("Glance", "g"), now: "Mark", ok: [] },
  { old: "the ? list", re: /[“"]?\?[”"]? list\b/gi, now: "Help", ok: [] },
  { old: "Countdown", re: W("countdown"), now: "Deadlines", ok: [
    /\bsend countdown\b/i, /\b\d+[- ]seconds? countdown\b/i, /\bcountdown (you can stop|before it sends|before a message sends)\b/i,
    /\b(stop|stops|stopped|stopping|during|after|before) (the|a|its|that) countdown\b/i, /\bcountdown.{0,60}\b(messages?|sends?|sent|sending|Stop)\b/i, /\b(messages?|sends?|sent|sending)\b.{0,60}\bcountdown\b/i,
  ] },
  { old: "Map view", re: /\bthe Map\b|[“"]Map[”"]|\bMap (view|button)\b|\bMap and\b|\band Map\b/g, now: "Cards", ok: [] },
];

/** The retired words in `text`, minus the other senses: [{ old, now, hit }]. */
export function retired(text) {
  const found = [];
  for (const { old, re, now, ok } of WORDS) {
    for (const m of text.matchAll(re)) {
      const around = text.slice(Math.max(0, m.index - 48), m.index + m[0].length + 48);
      if (ok.some((r) => r.test(around))) continue;
      found.push({ old, now, hit: m[0] });
    }
  }
  return found;
}

// ---- What a person reads in each kind of file.
const problems = [];
const markers = [];
const report = (file, line, text, hits) => {
  for (const { old, now, hit } of hits) problems.push(`${file}:${line}: “${hit}” (${old}) is now ${now}: ${text.trim().slice(0, 110)}`);
};
const marked = (lines, i) => /names-ok/.test(lines[i] ?? "") || /names-ok/.test(lines[i - 1] ?? "");

/** Markdown prose: code spans, fenced blocks, link targets, HTML comments and bare URLs are code or addresses, not prose. */
export function proseOf(markdown) {
  const lines = markdown.split("\n");
  // A fenced block with a language (sh, rust, json) is code. One without is a diagram or a file tree, whose descriptions are prose.
  let fenced = false, code = false;
  return lines.map((line) => {
    const fence = line.match(/^\s*(?:```|~~~)\s*(\S*)/);
    if (fence) { fenced = !fenced; code = fenced && fence[1] !== ""; return ""; }
    if (fenced && code) return "";
    return line
      .replace(/<!--(?!.*names-ok).*?-->/g, " ")
      .replace(/\[([^\]]*)\]\(\s*<?(?:\.\/|\.\.\/)?(?:docs\/)?trace\.md[^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/`[^`\n]*`/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/<(?:img|a|source)\b[^>]*>/g, " ");
  });
}

const PUBLIC_DOCS = ["README.md", "docs/FEATURES.md", "docs/bricks.md", "docs/COMMANDS.md", "docs/guide.md", "docs/ARCHITECTURE.md"];
function checkDocs() {
  for (const file of PUBLIC_DOCS) {
    if (!existsSync(join(root, file))) continue;
    const raw = readFileSync(join(root, file), "utf8").split("\n");
    const prose = proseOf(raw.join("\n"));
    prose.forEach((line, i) => {
      if (!line.trim()) return;
      const hits = retired(line);
      if (!hits.length) return;
      if (marked(raw, i)) { markers.push(`${file}:${i + 1}`); return; }
      report(file, i + 1, raw[i], hits);
    });
  }
}

function checkBricks() {
  const files = execFileSync("git", ["ls-files", "ui/src/bricks/*/brick.json"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const file of files) {
    const info = JSON.parse(readFileSync(join(root, file), "utf8"));
    for (const field of ["name", "does"]) {
      const hits = retired(String(info[field] ?? ""));
      if (hits.length) report(file, 1, `${field}: ${info[field]}`, hits);
    }
  }
}

// ---- UI strings: the string literals, template text, JSX text and label attributes of ui/src, from the build's own parser.
// Skipped, because a person never reads them: a comparison's other side, a class list or selector, an id (one lowercase
// word), an import path, an object key, an `aka` (the name a feature is also known by), a label inside a type.
const LABEL_ATTRS = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label"]);
const SKIP_METHODS = new Set(["includes", "startsWith", "endsWith", "has", "get", "set", "querySelector", "querySelectorAll", "closest", "matches",
  "getElementById", "getAttribute", "setAttribute", "add", "delete", "contains", "toggle", "getItem", "setItem", "removeItem", "test", "split",
  "indexOf", "emit", "on", "off", "addEventListener", "removeEventListener", "dispatchEvent", "import", "resolve", "glob", "warn"]);
const codeLike = (s) => /^[.#\[:<>*&]/.test(s) || /\bdata-[a-z]|::|=>|[{}]|\bon[A-Z]\w*=/.test(s) || /\.(tsx?|css|json|md|mjs|webp|png|svg)\b/.test(s)
  || (/-/.test(s) && /^[a-z0-9_ .:#[\]>,*=~^$"'-]+$/.test(s)) || /^[a-z0-9_.:/#-]+$/.test(s);
const looksLikeId = (s) => !/\s|[A-Z]|[^\x00-\x7f]|[?!,;()“”]/.test(s);

async function parser() {
  const path = join(root, "ui/node_modules/rolldown/dist/parse-ast-index.mjs");
  if (!existsSync(path)) return null;
  return (await import(pathToFileURL(path).href)).parseAst;
}

export function uiStrings(source, parseAst, tsx) {
  const ast = parseAst(source, { lang: tsx ? "tsx" : "ts", jsx: tsx });
  const out = [];
  const lineAt = (pos) => source.slice(0, pos).split("\n").length;
  const statementLine = (stack) => {
    for (let i = stack.length - 1; i >= 0; i--) if (/Declaration$|Statement$/.test(stack[i].type) && !/^Block|^TS/.test(stack[i].type) && stack[i].start !== undefined) return lineAt(stack[i].start);
    return null;
  };
  const stack = [];
  const visit = (node, parent, key) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) visit(n, parent, key); return; }
    if (typeof node.type !== "string") return;
    const t = node.type;
    const add = (text, kind, pos, plain) => out.push({ text, kind, line: lineAt(pos), statement: statementLine(stack), plain });
    if (t === "Literal" && typeof node.value === "string" && parent) {
      const p = parent.type;
      const skip = p === "ImportDeclaration" || p === "ExportNamedDeclaration" || p === "ExportAllDeclaration" || p === "ImportExpression" || p === "TSLiteralType" || p === "TSEnumMember"
        || (p === "Property" && key === "key" && !parent.computed) || p === "SwitchCase" || p === "TSImportType" || p === "TSExternalModuleReference"
        || (p === "BinaryExpression" && /^[!=]==?$/.test(parent.operator))
        || (p === "CallExpression" && parent.callee?.type === "MemberExpression" && SKIP_METHODS.has(parent.callee.property?.name))
        || (p === "Property" && key === "value" && ["aka", "className", "id", "kind", "type", "view", "slot", "stage"].includes(parent.key?.name ?? parent.key?.value))
        || (p === "JSXAttribute");
      // A lone lowercase word is an id, except as the noun of a count (`plural(n, "thread")`, `n === 1 ? "thread" : "threads"`).
      const noun = /^(threads?|branch(es)?|rooms?|bricks?)$/.test(node.value) && ((p === "ConditionalExpression" && key !== "test") || (p === "CallExpression" && /^plural/.test(parent.callee?.name ?? "") && parent.arguments?.[1] === node));
      if (!skip && (!looksLikeId(node.value) || noun) && (noun || !codeLike(node.value))) add(node.value, "string", node.start);
    } else if (t === "TemplateLiteral") {
      if (!(parent && parent.type === "TaggedTemplateExpression")) for (const q of node.quasis) { const text = q.value.cooked ?? q.value.raw; if (text.trim() && !codeLike(text) && !looksLikeId(text)) add(text, "template", q.start); }
    } else if (t === "JSXText") {
      if (node.value.trim()) add(node.value, "jsx", node.start);
    } else if (t === "JSXAttribute" && node.value?.type === "Literal" && typeof node.value.value === "string") {
      const name = node.name?.name;
      if (LABEL_ATTRS.has(name)) add(node.value.value, `attr:${name}`, node.value.start);
    }
    stack.push(node);
    for (const k of Object.keys(node)) if (k !== "type" && k !== "start" && k !== "end") visit(node[k], node, k);
    stack.pop();
  };
  visit(ast, null, "");
  return out;
}

// ui/src/feedback.ts is a catalog read by a check and never shipped: only the words it says about the screen count, not the
// code snippets it points at (`at`).
const FEEDBACK_KEYS = /^\s*(?:\{\s*)?(?:id|how|at|pressed|working|done|failed|waits|says)\b/;
function uiSelfTest(parseAst) {
  const snippet = `export const f = (n, x) => <div className="thread palace-tile" aria-label="Palace of threads" data-guide="palace">
    {n === 1 ? "thread" : "threads"} {plural(n, "branch")} <p>the room</p> {x === "Friend"} {document.querySelector(".thread-toggle")}
    {{ aka: "Countdown", id: "spine" }} {\`all threads\`}</div>;`;
  const texts = uiStrings(snippet, parseAst, true).map((s) => s.text.trim()).filter((t) => retired(t).length).sort();
  const want = ["Palace of threads", "all threads", "branch", "the room", "thread", "threads"].sort();
  if (JSON.stringify(texts) !== JSON.stringify(want)) { console.error(`names-check self-test: UI strings found ${JSON.stringify(texts)}, wanted ${JSON.stringify(want)}`); process.exit(2); }
}
async function checkUi() {
  const parseAst = await parser();
  if (parseAst) uiSelfTest(parseAst);
  if (!parseAst) { console.log("names-check: UI strings skipped (the UI's parser isn't installed: run ./run.sh once)"); return 0; }
  const files = execFileSync("git", ["ls-files", "ui/src"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const lines = source.split("\n");
    for (const s of uiStrings(source, parseAst, file.endsWith(".tsx"))) {
      if (file === "ui/src/feedback.ts" && /\bat:\s*\[\[/.test(lines[s.line - 1]) && /onClick=|<form|<div|className=|\(\) =>|\(event\)|aria-label=|\.tag\(|toggleTab|showView|onOpen|switchBrick|closeCatalog/.test(s.text)) continue;
      const hits = retired(s.text);
      if (!hits.length) continue;
      const okLine = [s.line - 1, s.line - 2, s.statement ? s.statement - 1 : -9, s.statement ? s.statement - 2 : -9].some((i) => /names-ok/.test(lines[i] ?? ""));
      if (okLine) { markers.push(`${file}:${s.line}`); continue; }
      report(file, s.line, s.text.replace(/\s+/g, " "), hits);
    }
  }
  return files.length;
}

// ---- The core's notices: what the core sends for display, outside its tests. Model prompts are instructions, not text a person reads.
const NOTICE = /(?:\bmessage\s*:|\bnotice\(|\bdoes\s*:|\banswers\s*:)\s*(?:&?format!\(\s*)?(r?#*"(?:[^"\\]|\\.)*")/g;
function checkCore() {
  const files = execFileSync("git", ["ls-files", "core/src"], { cwd: root, encoding: "utf8" }).split("\n")
    .filter((f) => f.endsWith(".rs") && !/(^|\/)tests?\.rs$|_tests\.rs$|\/tests\//.test(f));
  for (const file of files) {
    let source = readFileSync(join(root, file), "utf8");
    const cut = source.indexOf("#[cfg(test)]");
    if (cut >= 0) source = source.slice(0, cut);
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const m of line.matchAll(NOTICE)) {
        const hits = retired(m[1]);
        if (!hits.length) continue;
        if (marked(lines, i)) { markers.push(`${file}:${i + 1}`); continue; }
        report(file, i + 1, m[1], hits);
      }
    });
  }
}

// ---- The check checks itself first: the words it must catch, and the senses it must let be.
function selfTest() {
  const bad = ["Move to another thread", "Open the Palace", "Leave room", "a brick stopped", "The Friend says one", "Glance", "Catalog", "While you were away", "the ? list", "Notice timeline", "edge chips", "Countdown", "the dock", "a margin note", "the composer", "Bubble flight", "Spine", "Read progress", "Brick chip", "back to the Map", "this room", "A branch off a thread"];
  const fine = ["Add to Dock", "Send countdown", "a 5-second countdown, then Sent", "git branch", "brick.json", "bricks/spine", "catalog.rs", "room for more", "there is no room", "Work spine", "a friend's trial link", "Plant the tomatoes", "your map", "./run.sh room", "?room=abc", "the Palace of Versailles", "Pictures", "AI helper", "Share"];
  for (const text of bad) if (!retired(text).length) { console.error(`names-check self-test: should flag “${text}”`); process.exit(2); }
  for (const text of fine) if (retired(text).length) { console.error(`names-check self-test: should let “${text}” be`); process.exit(2); }
  if (proseOf("a `thread` here\n```sh\nthread\n```\n[composer](docs/trace.md#composer) and [x](docs/thread.md)").join("|") !== "a   here||||  and x" || proseOf("```\nthread\n```").join("|") !== "|thread|") { console.error("names-check self-test: Markdown prose"); process.exit(2); }
}

selfTest();
if (process.argv.includes("--self-test")) { console.log("names-check self-test: ok"); process.exit(0); }
checkDocs();
checkBricks();
const scanned = await checkUi();
checkCore();
if (process.argv.includes("--markers")) console.log(markers.join("\n"));
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`names-check: ${problems.length} retired word${problems.length === 1 ? "" : "s"} where a person reads (docs/names.md has the new names; a deliberate leftover takes a names-ok marker)`);
  process.exit(1);
}
console.log(`names-check: ok (${scanned || 0} UI files, ${PUBLIC_DOCS.length} docs, the features' brick.json and the core's notices; ${markers.length} names-ok markers)`);
