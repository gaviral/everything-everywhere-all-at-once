// No extra dependencies: run with `node scripts/readme-check.mjs`.
// What a judge reads first: a concrete pitch, a keyless sample and each Meta model with its job and source.
// The film has a reserved link marker. Source links and the architecture parts list must stay current.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(root + path, "utf8");
const readme = read("README.md");

// The first screen is everything above this marker; anything added there must push something else out.
const MARKER = "<!-- end of the first screen -->";
assert.ok(readme.includes(MARKER), `README.md has no "${MARKER}"`);
const first = readme.slice(0, readme.indexOf(MARKER));

// The first route opens populated example content without a key or microphone.
const visible = readme.replace(/<!--[\s\S]*?-->/g, "");
const sample = first.split("\n").find((line) => line.includes("./run.sh sample"));
assert.ok(sample && /\bsample\b/i.test(sample.replace(/`[^`]*`/g, "")) && /\/\?sample/.test(sample) && /no key or mic|keyless/i.test(sample),
  "the first screen needs a labelled keyless ./run.sh sample path and its /?sample URL");
assert.doesNotMatch(first, /Create an account/);
assert.match(readme, /http:\/\/localhost:4400\/\?sample/);
assert.match(readme, /labelled SAMPLE/);
assert.match(readme, /deadlines are examples/);

// A ratchet, not a target: the first screen's count when it was set (2026-11-01: 270 words, 95 of them the pitch)
// rounded up to the next 20, so a line added there means one cut. The judge's 10 seconds go to the pitch and the
// table's first two columns; the rest is there for the next minute (238 words a minute, legible.ts).
const MAX_WORDS = 380;
const words = first.replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<img[^>]*>/g, "")
  .replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
assert.ok(words.length <= MAX_WORDS, `the first screen has ${words.length} words; at most ${MAX_WORDS}`);

// Keep the visible IDE opening and its concrete capabilities, without a performance promise.
const outcome = first.split("\n").slice(0, 3).join("\n");
assert.equal(outcome, [
  "# Everything Everywhere All at Once",
  "The IDE from the future, for developers and AI to follow each other.",
  "Speak, type and sketch; build reusable board parts with Muse Spark; inspect the work across real Git branches.",
].join("\n"), "the opening must introduce the IDE and its speech, sketch, parts and Git capabilities");
assert.doesNotMatch(outcome, /\b\d+(?:\.\d+)?\s*(?:to\s*\d+\s*)?(?:ms|s|seconds?|minutes?)\b/i,
  "the product outcome must not promise latency");

// Product copy describes capabilities; measured results and demonstration reports stay outside the pitch.
const features = read("docs/FEATURES.md");
function checkProductCopy(text) {
  const copy = text.replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(copy, /historical synthetic|verification pending|simulated|not typical|narration|unverified|not independently revalidated/i,
    "product copy must omit report disclosures and narration notes");
  assert.doesNotMatch(copy, /docs\/trace\.md|(?:^|\n)## (?:Typed-input measurements|Measured|.*known limits)/i,
    "product copy must omit historical reports, measurements and limits sections");
  assert.doesNotMatch(copy, /\b\d+(?:\.\d+)?\s*(?:to\s*\d+\s*)?(?:ms|seconds?)\b/i,
    "product copy must omit speed claims");
}
for (const text of [readme, features]) checkProductCopy(text);
assert.doesNotMatch(visible, /\b(?:all|every|each)\s+(?:\w+\s+){0,3}(?:changes?|merges?|commits?)\s+(?:\w+\s+){0,8}(?:passed|only when|only after)|\b(?:changes?|merges?|commits?)\s+(?:all|always)\s+passed/i,
  "do not assert universal merge success; report bounded, evidenced checks instead");

// The film slot is reserved; the removed hero and caption must not return.
assert.ok(first.includes("<!-- Film link goes here. -->"), "reserve the first-screen film link");
assert.doesNotMatch(readme, /hero\.gif|Earlier scripted demo|edited zoom, labels and captions/i);
const images = [...first.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
// Remaining images, including the logo, must exist and stay small.
for (const [, a, b] of readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"/g)) {
  const src = a ?? b;
  if (/^https?:/.test(src)) continue;
  assert.ok(existsSync(root + src), `the README shows ${src}, which isn't in the repo`);
  assert.ok(statSync(root + src).size <= 3e6, `the README shows ${src}, ${(statSync(root + src).size / 1e6).toFixed(1)} MB; at most 3 MB`);
}

// Which Meta model does what: each model the core calls by default is named, and every name is a real one.
const code = readdirSync(root + "core/src").filter((f) => f.endsWith(".rs")).map((f) => read(`core/src/${f}`)).join("\n");
const called = new Set([...code.matchAll(/"(muse-[a-z0-9.-]+)"/g)].map((m) => m[1]));
const named = {
  "Muse Voice Transcribe 1.0": "muse-voice-transcribe-1.0",
  "Muse Spark 1.2": "muse-spark-1.2",
  "Muse Spark 1.3": "muse-spark-1.3",
  "Muse Image 1.0": "muse-image-1.0",
};
// "Muse Spark 1.3 + 1.2" (two models racing, as the model line says it) names both.
const spelled = first.replace(/(Muse (?:Voice Transcribe|Spark|Image)) ([\d.]+) \+ ([\d.]+)/g, "$1 $2 + $1 $3");
for (const [name, id] of Object.entries(named)) {
  assert.ok(spelled.includes(name), `the first screen doesn't name ${name}`);
  assert.ok(called.has(id), `the first screen names ${name}, but the core never calls "${id}"`);
}
for (const m of spelled.matchAll(/Muse (?:Voice Transcribe|Spark|Image)(?: [\d.]+)?(?: Contributor)?/g)) {
  const id = m[0].toLowerCase().replace(/ /g, "-");
  assert.ok([...called].some((c) => c.startsWith(id)), `the first screen names ${m[0]}, which the core never calls`);
}
// Each visible job names its model and links directly to the implementation.
const ROLES = [
  { job: "Speak", file: "asr.rs", model: "Muse Voice Transcribe 1.0" },
  { job: "Finish a thought", file: "placer.rs", model: "Muse Spark 1.3 + 1.2" },
  { job: "Pause", file: "refiner.rs", model: "Muse Spark 1.3" },
  { job: "Request an app", file: "apps.rs", model: "Muse Spark 1.3" },
  { job: "Ask for a recap", file: "recap.rs", model: "Muse Spark 1.3" },
  { job: "Let a topic settle", file: "pictures.rs", model: "Muse Image 1.0" },
  { job: "Ask about a word", file: "clarify.rs", model: "Muse Spark 1.3" },
  { job: "Sketch an idea", file: "draw.rs", model: "Muse Spark 1.3 reads it; Muse Image 1.0 draws it back" },
  { job: "Build board parts with Crew", file: "crew.rs", model: "Muse Spark 1.3" },
  { job: "Transform text with Flow", file: "flow.rs", model: "Muse Spark 1.3" },
  { job: "Ask “where was I?”", file: "spoken.rs", model: "no model" },
];
const modelRows = first.split("\n").filter((line) => /^\|/.test(line))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
  .filter((cells) => cells.some((cell) => cell.includes("](core/src/")));
assert.equal(modelRows.length, ROLES.length, "the model table covers each job once");
function checkModelRole({ job, file, model }) {
  const row = modelRows.find((cells) => cells[0] === job);
  assert.ok(row, `the model table has no job named ${job}`);
  assert.equal(row.length, 3, `${job} shows its model and implementation`);
  assert.equal(row[1], model, `${job} must name ${model}`);
  assert.ok(row[2].includes(`](core/src/${file})`), `${job} must link to ${file}`);
  assert.ok(existsSync(root + `core/src/${file}`), `${file} must exist`);
}
ROLES.forEach(checkModelRole);

// Catch the stale claims that a source-list/link check alone used to accept.
function boundedClaims(text) {
  assert.doesNotMatch(text, /(?:12|twelve) words or fewer|at most (?:12|twelve) words/i,
    "the placer preserves meaning instead of imposing the old word cap");
  assert.doesNotMatch(text, /browser talks only to it|loads nothing from elsewhere|Nothing else at runtime/i,
    "network scope must include optional speech, connectors and tunnels");
}
for (const text of [readme, read("docs/FEATURES.md")]) boundedClaims(text);
for (const stale of ["a point of 12 words or fewer", "The browser talks only to it", "Nothing else at runtime"])
  assert.throws(() => boundedClaims(stale), "stale claims must be rejected");
assert.match(features, /Open \*\*Features\*\*.*switch on \*\*Pictures\*\*.*choose \*\*Show\*\*/,
  "the Pictures route includes its initially off feature switch");
assert.match(readme, /core holds the key and calls Meta models/);

// Every source file is in ARCHITECTURE.md's parts list (tests, the page's entry and Vite's types excepted).
const arch = read("docs/ARCHITECTURE.md");
const parts = arch.slice(arch.indexOf("## Parts"), arch.indexOf("## State"));
const sources = [
  ...readdirSync(root + "core/src").filter((f) => f.endsWith(".rs") && !f.endsWith("_tests.rs")),
  ...readdirSync(root + "ui/src").filter((f) => /\.tsx?$/.test(f) && !["main.tsx", "vite-env.d.ts"].includes(f)),
];
const missing = sources.filter((f) => !new RegExp(`(^|[\\s(])${f.replace(/\./g, "\\.")}\\b`, "m").test(parts));
assert.deepEqual(missing, [], `docs/ARCHITECTURE.md's parts list is missing ${missing.join(", ")}`);

// Nothing acts unasked (core/src/apps.rs `starts_on`): only Search-first starts on, and only in demo mode, so the
// docs a judge reads must not say the Argument resolver or the Volume watcher run before they're switched on. Change
// the rule and this fails until the docs say the new one.
const rule = read("core/src/apps.rs").match(/^pub fn starts_on\([^)]*\) -> bool \{(.*)\}$/m);
assert.ok(rule, "core/src/apps.rs has no starts_on");
assert.equal(rule[1].trim(), "demo && matches!(watcher, Watcher::AppRequest {})", "seed defaults changed: update the docs below, then this line");
for (const [doc, text] of [["README.md", readme], ["docs/FEATURES.md", read("docs/FEATURES.md")]]) {
  assert.ok(!/seed[^.]*on by default|on by default[^.]*seed/i.test(text), `${doc} says seed apps are on by default`);
  for (const sentence of text.split(/(?<=\.)\s+/).filter((t) => /Argument resolver/.test(t) && /seed/i.test(t)))
    assert.ok(/start(s)? off/.test(sentence) || !/runs|plays|fires/.test(sentence), `${doc} says a seed runs without saying it starts off: ${sentence.slice(0, 120)}`);
}
for (const text of [readme, features])
  assert.match(text, /In \*\*(?:Apps|Features)\*\*, switch on \*\*Argument resolver\*\* or \*\*Volume watcher\*\*[^.]*; both start off/,
    "the app route must explain that the Argument resolver and Volume watcher start off");

console.log(`readme-check: OK (first screen ${words.length} words, ${images.length} images, ${sources.length} source files listed)`);
