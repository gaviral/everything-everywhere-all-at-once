// No extra dependencies: run with `node scripts/readme-check.mjs`.
// What a judge reads first: a concrete pitch, a keyless sample and each Meta model with its job and source.
// The film has a reserved link marker. The parts-list and historical trace checks remain independent.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { excerpt, median, parse, shorten, summary, table, KEEP } from "./trace-summary.mjs";

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
const MAX_WORDS = 280;
const words = first.replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<img[^>]*>/g, "")
  .replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
assert.ok(words.length <= MAX_WORDS, `the first screen has ${words.length} words; at most ${MAX_WORDS}`);

// Require a concise, concrete outcome, not approved wording or a performance promise.
const outcome = first.replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/)
  .map((part) => part.trim()).find((part) => part && !part.startsWith("#"));
assert.ok(outcome && outcome.split(/\s+/).length <= 90 && /\bE2A2O\b/.test(outcome)
  && /\b(?:files?|groups?|organizes?|places?|maps?|keeps?|saves?|captures?|returns?|finds?|turns?)\b/i.test(outcome)
  && /\b(?:thoughts?|topics?|ideas?|notes?|conversation|map)\b/i.test(outcome),
"the opening needs a concise concrete outcome for thoughts, topics or the map");
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
// The table links every advertised job to its implementation instead of a historical report.
function checkModelRows(text) {
  const rows = text.split("\n").filter((line) => /^\|.*\]\(core\/src\//.test(line));
  const roles = [
    ["asr", "Muse Voice Transcribe 1.0"],
    ["placer", "Muse Spark 1.3 + 1.2"],
    ["refiner", "Muse Spark 1.3"],
    ["apps", "Muse Spark 1.3"],
    ["recap", "Muse Spark 1.3"],
    ["pictures", "Muse Image 1.0"],
    ["clarify", "Muse Spark 1.3"],
    ["draw", "Muse Spark 1.3 reads it; Muse Image 1.0 draws it back"],
    ["crew", "Muse Spark 1.3"],
    ["flow", "Muse Spark 1.3"],
    ["spoken", "no model"],
  ];
  for (const [role, model] of roles) {
    const row = rows.find((line) => line.includes(`(core/src/${role}.rs)`));
    assert.ok(row, `the models table needs the ${role} job and source link`);
    assert.equal(row.split("|")[2].trim(), model, `the ${role} job must name ${model}`);
    assert.ok(existsSync(root + `core/src/${role}.rs`), `the ${role} source link must land`);
  }
  assert.match(rows.find((line) => line.includes("(core/src/spoken.rs)")), /where was I.*\| no model \|/i);
}
checkModelRows(first);

// Historical reports remain scoped and aggregated in their own documents.
const trace = read("docs/trace.md");
assert.match(trace, /Historical synthetic report, not final-build validation/);
for (const id of ["muse-spark-1.2", "muse-spark-1.3", "muse-image-1.0"]) {
  assert.ok(trace.includes("`" + id + "`"), `docs/trace.md has no aggregate for ${id}`);
}
assert.ok(/"kind":"heard"|Voice turns heard: [1-9]/.test(trace), "docs/trace.md shows no turn heard by Voice Transcribe");
assert.ok(!/MODEL_API_KEY=\S|Bearer |\/Users\/|\/home\//.test(trace), "docs/trace.md carries a key or a home path");

// Keep the public proof to reviewed aggregates; raw request/answer excerpts belong outside submission docs.
assert.doesNotMatch(trace, /```(?:json|jsonl)\b|"(?:sent|answer|raw|kept)"\s*:/,
  "the public model report must omit raw transcripts, prompts and answers");
assert.match(trace, /not an ancestor of verified main/);
assert.match(trace, /not independently revalidated/);
assert.match(trace, /Reported configuration:/);
assert.match(trace, /Voice turns heard: 12/);
assert.match(trace, /Placements: 8/);
assert.match(trace, /Pictures saved: 4/);
const evidenceScope = read("docs/release-evidence.md");
assert.match(evidenceScope, /Hosted entry stays explicitly pending/);
assert.match(evidenceScope, /Final selected build.*remain pending/);

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

// The summary script: per feature and model, failures apart from times; heard, placements and pictures counted.
const lines = parse([
  { kind: "heard", raw: "hi", kept: "hi" },
  { kind: "call", feature: "placer", model: "muse-spark-1.2-contributor", ms: 3000, sent: [{ role: "system", content: "x".repeat(900) }, { role: "user", content: "y".repeat(900) }], answer: "a".repeat(900), usage: { total_tokens: 9 } },
  { kind: "call", feature: "placer", model: "muse-spark-1.2-contributor", ms: 2000, sent: [], answer: "{}" },
  { kind: "call", feature: "placer", model: "muse-spark-1.2-contributor", ms: 12000, sent: [], error: "timed out" },
  { kind: "placed" },
  { kind: "call", feature: "other", model: "muse-spark-1.3", ms: 4000, sent: [{ role: "system", content: "Compose a small app from blocks" }], answer: "{}" },
  { kind: "call", feature: "pictures", model: "muse-image-1.0", ms: 20000, sent: "a lighthouse", answer: { images: 1 } },
  { kind: "picture" },
].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
const s = summary(lines);
assert.deepEqual(s.calls.map((r) => [r.feature, r.calls, r.failed, r.median_ms, r.slowest_ms]),
  [["placer", 3, 1, 2500, 3000], ["composer", 1, 0, 4000, 4000], ["pictures", 1, 0, 20000, 20000]]);
assert.deepEqual([s.heard, s.placements, s.pictures], [1, 1, 1]);
assert.match(table(s), /\| placer \| muse-spark-1\.2-contributor \| 3 \(1 failed\) \| 2\.5 s \| 3\.0 s \|/);
// A median, not the lower middle: an even count averages the two middle values.
assert.deepEqual([median([]), median([5]), median([3000, 2000]), median([4, 1, 3, 2]), median([9, 1, 5])], [null, 5, 2500, 2.5, 5]);
const ex = excerpt(lines);
assert.deepEqual(ex.map((e) => e.feature), ["placer", "composer", "pictures"]);
assert.equal(ex[0].sent.characters, 1800);
assert.ok(ex[0].sent.last.length <= KEEP + 1 && ex[0].answer.length <= KEEP + 1, "an excerpt keeps the whole prompt");
assert.deepEqual(ex[2].answer, { images: 1 });
assert.equal(shorten(lines[3]).error, "timed out");
// A race's slower call is dropped, not failed: it counts apart and keeps out of the times.
const raced = summary(parse([
  { kind: "call", feature: "placer", model: "muse-spark-1.3", ms: 2000, sent: [], answer: "{}" },
  { kind: "call", feature: "placer", model: "muse-spark-1.3", ms: 2000, sent: [], error: "dropped before its answer: another of the same call answered first" },
].map((l) => JSON.stringify(l)).join("\n")));
assert.deepEqual(raced.calls.map((r) => [r.calls, r.failed, r.dropped, r.median_ms]), [[2, 0, 1, 2000]]);
assert.match(table(raced), /\| placer \| muse-spark-1\.3 \| 2 \(1 dropped\) \| 2\.0 s \| 2\.0 s \|/);

// Nothing acts unasked (core/src/apps.rs `starts_on`): only Search-first starts on, and only in demo mode, so the
// docs a judge reads must not say the Argument resolver or the Volume watcher run before they're switched on. Change
// the rule and this fails until the docs say the new one.
const rule = read("core/src/apps.rs").match(/^pub fn starts_on\([^)]*\) -> bool \{(.*)\}$/m);
assert.ok(rule, "core/src/apps.rs has no starts_on");
assert.equal(rule[1].trim(), "demo && matches!(watcher, Watcher::AppRequest {})", "seed defaults changed: update the docs below, then this line");
for (const [doc, text] of [["README.md", readme], ["docs/trace.md", trace]]) {
  assert.ok(!/seed[^.]*on by default|on by default[^.]*seed/i.test(text), `${doc} says seed apps are on by default`);
  for (const sentence of text.split(/(?<=\.)\s+/).filter((t) => /Argument resolver/.test(t) && /seed/i.test(t)))
    assert.ok(/start(s)? off/.test(sentence) || !/runs|plays|fires/.test(sentence), `${doc} says a seed runs without saying it starts off: ${sentence.slice(0, 120)}`);
}
for (const text of [readme, features])
  assert.match(text, /In \*\*Apps\*\*, switch on \*\*Argument resolver\*\* or \*\*Volume watcher\*\*[^.]*; both start off/,
    "the app route must explain that the Argument resolver and Volume watcher start off");
assert.match(trace, /Argument resolver, a seeded app, starts off/, "docs/trace.md doesn't say the Argument resolver starts off");

console.log(`readme-check: OK (first screen ${words.length} words, ${images.length} images, ${sources.length} source files listed)`);
