// No extra dependencies: run with `node scripts/readme-check.mjs`.
// What a judge reads first: the README's first screen says what the app does (the pitch), shows it (an image that
// exists), names each Meta model with its job, and links to a scoped historical aggregate; every model it names
// is one the core's code calls. Also: every source file is in docs/ARCHITECTURE.md's parts list, and the trace
// summary script reads a trace right.
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

// The keyless sample stays first. Hosting is either explicitly pending, or backed by a dated
// guest-entry/served-build record. A URL (or the word "verified") alone is not evidence.
const visible = readme.replace(/<!--[\s\S]*?-->/g, "");
const sample = first.split("\n").find((line) => line.includes("./run.sh sample"));
assert.ok(sample && /\bsample\b/i.test(sample.replace(/`[^`]*`/g, "")) && /\/\?sample/.test(sample) && /no key or mic|keyless/i.test(sample),
  "the first screen needs a labelled keyless ./run.sh sample path and its /?sample URL");
const hosted = first.split("\n").find((line) => /hosted preview/i.test(line));
assert.ok(hosted && /https:\/\/[^\s)]+/.test(hosted), "the first screen needs a hosted preview state and URL");
assert.ok(first.indexOf(sample) < first.indexOf(hosted), "the keyless sample must precede hosting");
if (/verification pending/i.test(hosted)) {
  // Pending warnings elsewhere may describe the checks still needed; affirmative claims may not.
  const claims = visible.replace(/\bnot(?: yet)?(?: a)? verified\b/gi, "");
  assert.doesNotMatch(claims, /\b(?:fresh(?:ly)?\s+)?verified\b|\bverification\s+(?:passed|complete[ds]?)\b/i,
    "pending hosting cannot claim fresh verification");
} else {
  assert.match(hosted, /\bverified\b/i, "hosting must say verification pending or verified with evidence");
  const date = hosted.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const build = hosted.match(/\bbuild\s+`?([a-f0-9]{7,40})\b/i)?.[1];
  const proof = hosted.match(/\[[^\]]+\]\((docs\/[^)\s]+\.md)(#[a-z0-9-]+)?\)/);
  assert.ok(date && build && proof, "verified hosting needs a date, build SHA and local evidence link");
  assert.ok(Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date,
    "hosted verification date must be a real calendar date");
  let evidence = read(proof[1]);
  if (proof[2]) {
    const anchor = proof[2].slice(1);
    evidence = evidence.split(/^(?=#{1,6} )/m).find((part) =>
      part.split("\n")[0].replace(/^#+ /, "").toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-") === anchor) ?? "";
  }
  assert.ok(evidence.includes(date) && evidence.includes(build) && evidence.includes(hosted.match(/https:\/\/[^\s)]+/)[0]),
    "hosted evidence must identify the same date, build and URL");
  assert.match(evidence, /(?:fresh guest|logged.out)[^\n]*(?:passed|verified|succeeded)/i,
    "hosted evidence needs a successful fresh guest check");
  assert.match(evidence, new RegExp(`served build[^\\n]*(?:matches|matched)[^\\n]*\\b${build}\\b`, "i"),
    "hosted evidence needs a matching served build");
  assert.doesNotMatch(evidence, /\b(?:pending|unverified|not verified)\b/i, "pending evidence cannot verify hosting");
}
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
  "put measured latency with its historical provenance, not in the outcome");

// Historical measurements and scripted/simulated surfaces must not read as current human results.
const firstVisible = first.replace(/<!--[\s\S]*?-->/g, "");
const modelContext = firstVisible.slice(Math.max(0, firstVisible.lastIndexOf("\n## ", firstVisible.indexOf("|"))));
assert.match(modelContext, /historical[^\n]*synthe(?:tic|sized)|synthe(?:tic|sized)[^\n]*historical/i,
  "the first screen must label the linked evidence as historical and synthetic");
const measured = visible.match(/^## Measured\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
if (/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/i.test(firstVisible))
  assert.ok(measured, "first-screen timings need the historical Measured provenance section");
if (measured && /\d/.test(measured)) {
  assert.match(measured, /historical/i, "measured numbers need a historical label");
  assert.match(measured, /synthe(?:tic|sized)/i, "measured numbers need their input type");
  assert.match(measured, /\b\d{4}-\d{2}-\d{2}\b/, "measured numbers need a date");
  assert.match(measured, /\b(?:n\s*=\s*\d+|\d+\s+(?:lines|thoughts|calls|requests|rounds|takes))\b/i,
    "measured numbers need a sample count");
  for (const row of measured.split("\n").filter((line) => /^\|/.test(line))) {
    const [, , result, source] = row.split("|").map((cell) => cell.trim());
    if (!/\d/.test(result ?? "")) continue;
    assert.match((source ?? "").replace(/\d{4}-\d{2}-\d{2}/g, ""), /\b[1-9]\d*\b/,
      "each historical result needs n in its source column");
    assert.match(source, /\d{4}-\d{2}-\d{2}|\bsame\b|\btake\b|\btraced run\b/i,
      "each historical result needs a date or explicit reference to the dated take");
  }
}
for (const paragraph of visible.split(/\n\s*\n/)) {
  if (/[Ww]ork spine|\bRemote\b|demo-jobs\.mjs/.test(paragraph)) {
    assert.match(paragraph, /simulat(?:ed|ion)/i, "Work spine/Remote helper work must be labelled simulated");
    assert.doesNotMatch(paragraph, /\b(?:real|live)\s+(?:helper|agent)\s+work\b/i,
      "simulated helper work cannot be described as live work");
  }
}
assert.doesNotMatch(visible, /\b(?:all|every|each)\s+(?:\w+\s+){0,3}(?:changes?|merges?|commits?)\s+(?:\w+\s+){0,8}(?:passed|only when|only after)|\b(?:changes?|merges?|commits?)\s+(?:all|always)\s+passed/i,
  "do not assert universal merge success; report bounded, evidenced checks instead");

// Shows it: every image there exists.
const images = [...first.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
assert.ok(images.some((src) => /screens\//.test(src)), "no screenshot or GIF of the app on the first screen");
for (const src of images) assert.ok(existsSync(root + src), `the first screen shows ${src}, which isn't in the repo`);
for (const match of first.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"[^>]*>/g)) {
  // App icons are branding, not recorded demonstrations with an input type.
  if (/^ui\/public\/icons\//.test(match[1] ?? match[2])) continue;
  const caption = first.slice(match.index, first.indexOf("\n## ", match.index) < 0 ? first.length : first.indexOf("\n## ", match.index));
  assert.match(caption, /synthe(?:tic|sized)|simulated|scripted/i, "first-screen media needs its input type");
  assert.match(caption, /historical|earlier|recorded/i, "first-screen media needs its recorded/historical label");
}
// Below it too (the 16-second run right after the marker): every image exists and loads quickly on a judge's
// connection; 3 MB is about 1 s at 25 Mbit/s, and the run is 1 MB today.
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
// Which Meta model does what, row by row: each role's row names its model (or "no model") and links to the
// trace.md section describing its historical aggregate. These links validate documentation coverage, not
// the original run or current behavior. Removing a role, its link or its aggregate fails here.
const ROLES = [
  { anchor: "heard", model: "Muse Voice Transcribe 1.0", proof: /`muse-voice-transcribe-1\.0`/ },
  { anchor: "placer", model: "Muse Spark 1.3 + 1.2",
    each: [["1.3", /`muse-spark-1\.3`/], ["1.2", /`muse-spark-1\.2`/]] },
  { anchor: "refiner", model: "Muse Spark 1.3", proof: /`muse-spark-1\.3`/ },
  { anchor: "composer", model: "Muse Spark 1.3", proof: /`muse-spark-1\.3`/ },
  { anchor: "recap", model: "Muse Spark 1.3", proof: /`muse-spark-1\.3`/ },
  { anchor: "pictures", model: "Muse Image 1.0", proof: /`muse-image-1\.0`/ },
  { anchor: "rules", model: "no model", when: /where was I\?/i, proof: /without a model call/ },
];
assert.ok(/\(docs\/trace\.md(#[a-z0-9-]+)?\)/.test(first), "the first screen doesn't link to docs/trace.md");
const trace = read("docs/trace.md");
assert.match(trace, /Historical synthetic report, not final-build validation/);
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
const sections = new Map(trace.split(/^(?=## )/m).map((part) => [slug(part.split("\n")[0].replace(/^## /, "")), part]));
const rows = first.split("\n").filter((l) => /^\|.*\(docs\/trace\.md#[a-z0-9-]+\)/.test(l));
assert.equal(rows.length, ROLES.length, `the first screen has ${rows.length} model rows with proof; expected ${ROLES.length}`);
for (const { anchor, model, when, proof, each, none } of ROLES) {
  const row = rows.find((l) => l.includes(`(docs/trace.md#${anchor})`));
  assert.ok(row, `the first screen has no row linking to docs/trace.md#${anchor}`);
  const cells = row.split("|").map((c) => c.trim());
  assert.ok(cells.includes(model), `the #${anchor} row doesn't name ${model} as its model`);
  if (when) assert.match(row, when, `the #${anchor} row isn't the one for ${when}`);
  const section = sections.get(anchor);
  assert.ok(section, `docs/trace.md has no section for #${anchor}`);
  if (proof) assert.match(section, proof, `docs/trace.md#${anchor} shows no evidence for its row (${proof})`);
  for (const [version, shows] of each ?? []) {
    const pending = row.includes(`${version} pending`);
    if (shows.test(section)) assert.ok(!pending, `the #${anchor} row says ${version} is pending, but docs/trace.md#${anchor} shows it`);
    else assert.ok(pending, `docs/trace.md#${anchor} shows no call by ${version} for its row (${shows}), and the row doesn't say "${version} pending"`);
  }
  if (each) assert.ok(each.some(([, shows]) => shows.test(section)), `docs/trace.md#${anchor} proves none of its row's models`);
  if (none) assert.doesNotMatch(section, none, `docs/trace.md#${anchor} says no model, but shows a model call`);
}
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
assert.match(readme, /commitments.*conditions.*negations.*uncertainty/);
for (const text of [readme, read("docs/FEATURES.md")]) {
  assert.match(text, /voices? reports? `localService === true`/,
    "reply playback requires a browser-reported local voice");
  assert.match(text, /remote and unknown-locality voices are excluded/i);
  assert.match(text, /Without a usable local voice, replies remain text/);
  assert.match(text, /(?:browser|This browser) flag is not proof of network isolation/);
  assert.doesNotMatch(text, /does not enforce (?:`localService`|voice locality)/);
}
assert.match(read("docs/FEATURES.md"), /Open \*\*Features\*\*.*switch on \*\*Pictures\*\*.*choose \*\*Show\*\*/,
  "the Pictures route includes its initially off feature switch");
assert.match(readme, /no GPT runtime dependency/);
const story = readme.slice(readme.indexOf("## One minute of talk"), readme.indexOf("## How it works"));
assert.doesNotMatch(story, /tune plays|plays a silly tune|loudly/i,
  "the audible tune beat stays omitted until supported by a recording receipt");

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
assert.match(readme, /start off until you switch them on in Apps: Argument resolver[^.]*Volume watcher/, "README doesn't say the Argument resolver and Volume watcher start off");
assert.match(trace, /Argument resolver, a seeded app, starts off/, "docs/trace.md doesn't say the Argument resolver starts off");

console.log(`readme-check: OK (first screen ${words.length} words, ${images.length} images, ${sources.length} source files listed)`);
