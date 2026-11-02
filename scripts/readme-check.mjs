// No extra dependencies: run with `node scripts/readme-check.mjs`.
// What a judge reads first: the README's first screen says what the app does (the pitch), shows it (an image that
// exists), names each Meta model with its job, and links to a real trace that proves each one; every model it names
// is one the core's code calls. Also: every source file is in docs/ARCHITECTURE.md's parts list, and the trace
// summary script reads a trace right.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { excerpt, median, parse, shorten, summary, table, KEEP } from "./trace-summary.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(root + path, "utf8");
const readme = read("README.md");

// The first screen is everything above this marker; anything added there must push something else out.
const MARKER = "<!-- end of the first screen -->";
assert.ok(readme.includes(MARKER), `README.md has no "${MARKER}"`);
const first = readme.slice(0, readme.indexOf(MARKER));

// A ratchet, not a target: the first screen's count when it was set (2026-11-01: 270 words, 95 of them the pitch)
// rounded up to the next 20, so a line added there means one cut. The judge's 10 seconds go to the pitch and the
// table's first two columns; the rest is there for the next minute (238 words a minute, legible.ts).
const MAX_WORDS = 280;
const words = first.replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<img[^>]*>/g, "")
  .replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
assert.ok(words.length <= MAX_WORDS, `the first screen has ${words.length} words; at most ${MAX_WORDS}`);

// What it does, for a person: the pitch, word for word as approved, as one whole paragraph.
// When the pitch changes, change it here too: a cut that only this check sees is the point.
const PITCH = "For people who think out loud and lose their threads. You talk (or type), and E2A2O puts each thought on the right thread of a live map a few seconds later: a topic, or a tangent branching off one. When you jump to something new halfway through a sentence, it marks the thread you left, and at the next pause it offers to take you back. While you're quiet, it tidies titles, suggests a next step, gives each thread with a few thoughts a picture, and proposes reminders and calendar events from what you decided; nothing reaches your Reminders or Calendar until you approve it. It can also start from your past AI chats.";
assert.ok(first.split("\n").includes(PITCH), "the pitch on the first screen isn't the approved one, word for word (whole paragraph)");

// Shows it: every image there exists.
const images = [...first.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*src="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
assert.ok(images.some((src) => /screens\//.test(src)), "no screenshot or GIF of the app on the first screen");
for (const src of images) assert.ok(existsSync(root + src), `the first screen shows ${src}, which isn't in the repo`);

// Which Meta model does what: each model the core calls by default is named, and every name is a real one.
const code = readdirSync(root + "core/src").filter((f) => f.endsWith(".rs")).map((f) => read(`core/src/${f}`)).join("\n");
const called = new Set([...code.matchAll(/"(muse-[a-z0-9.-]+)"/g)].map((m) => m[1]));
const named = {
  "Muse Voice Transcribe 1.0": "muse-voice-transcribe-1.0",
  "Muse Spark 1.2": "muse-spark-1.2",
  "Muse Spark 1.3": "muse-spark-1.3",
  "Muse Image 1.0": "muse-image-1.0",
};
for (const [name, id] of Object.entries(named)) {
  assert.ok(first.includes(name), `the first screen doesn't name ${name}`);
  assert.ok(called.has(id), `the first screen names ${name}, but the core never calls "${id}"`);
}
for (const m of first.matchAll(/Muse (?:Voice Transcribe|Spark|Image)(?: [\d.]+)?(?: Contributor)?/g)) {
  const id = m[0].toLowerCase().replace(/ /g, "-");
  assert.ok([...called].some((c) => c.startsWith(id)), `the first screen names ${m[0]}, which the core never calls`);
}
// Which Meta model does what, row by row: each role's row names its model (or "no model") and links to the
// trace.md section that proves it; that section shows the feature's own traced call by that model (or, for rules,
// none at all). Removing a row, its link or its evidence fails here.
const ROLES = [
  { anchor: "heard", model: "Muse Voice Transcribe 1.0", proof: /"kind":"heard"/ },
  // Contributor mode is opt-in; a trace taken with it on still proves Muse Spark 1.2 places.
  { anchor: "placer", model: "Muse Spark 1.2", proof: /"feature":"placer","model":"muse-spark-1\.2(-contributor)?"/ },
  { anchor: "refiner", model: "Muse Spark 1.3", proof: /"feature":"refiner","model":"muse-spark-1\.3"/ },
  { anchor: "composer", model: "Muse Spark 1.3", proof: /"feature":"composer","model":"muse-spark-1\.3"/ },
  { anchor: "recap", model: "Muse Spark 1.3", proof: /"feature":"recap","model":"muse-spark-1\.3"/ },
  { anchor: "pictures", model: "Muse Image 1.0", proof: /"feature":"picture","model":"muse-image-1\.0"/ },
  { anchor: "rules", model: "no model", when: /where was I\?/i, proof: /"kind":"heard","raw":"Wait, where was I\?"/, none: /"model":/ },
];
assert.ok(/\(docs\/trace\.md(#[a-z0-9-]+)?\)/.test(first), "the first screen doesn't link to docs/trace.md");
const trace = read("docs/trace.md");
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
const sections = new Map(trace.split(/^(?=## )/m).map((part) => [slug(part.split("\n")[0].replace(/^## /, "")), part]));
const rows = first.split("\n").filter((l) => /^\|.*\(docs\/trace\.md#[a-z0-9-]+\)/.test(l));
assert.equal(rows.length, ROLES.length, `the first screen has ${rows.length} model rows with proof; expected ${ROLES.length}`);
for (const { anchor, model, when, proof, none } of ROLES) {
  const row = rows.find((l) => l.includes(`(docs/trace.md#${anchor})`));
  assert.ok(row, `the first screen has no row linking to docs/trace.md#${anchor}`);
  const cells = row.split("|").map((c) => c.trim());
  assert.ok(cells.includes(model), `the #${anchor} row doesn't name ${model} as its model`);
  if (when) assert.match(row, when, `the #${anchor} row isn't the one for ${when}`);
  const section = sections.get(anchor);
  assert.ok(section, `docs/trace.md has no section for #${anchor}`);
  assert.match(section, proof, `docs/trace.md#${anchor} shows no evidence for its row (${proof})`);
  if (none) assert.doesNotMatch(section, none, `docs/trace.md#${anchor} says no model, but shows a model call`);
}
for (const id of ["muse-spark-1.2", "muse-spark-1.3", "muse-image-1.0"]) {
  assert.ok(trace.includes(`"model":"${id}`), `docs/trace.md shows no call by ${id}`);
}
assert.ok(/"kind":"heard"|Voice turns heard: [1-9]/.test(trace), "docs/trace.md shows no turn heard by Voice Transcribe");
assert.ok(!/MODEL_API_KEY=\S|Bearer |\/Users\/|\/home\//.test(trace), "docs/trace.md carries a key or a home path");

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

console.log(`readme-check: OK (first screen ${words.length} words, ${images.length} images, ${sources.length} source files listed)`);
