// No extra dependencies: run with `node scripts/map-render-check.mjs`.
// The window as a judge first sees it, drawn by the window's own components (App.tsx through React's server
// renderer, the way the other checks draw the Palace and the Recap): the empty first screen, with and without a key,
// and the sample map ("Try a sample map": samples/student-week.jsonl, the core's own change messages) fed through the
// window's reducer one change at a time, as the core sends them (core/src/sample.rs `load`). points-check.mjs draws
// cards and points only to measure where points sit; no other check reads what the map's cards, points, action rows,
// tags or chips say: their wiring was held by regexes over App.tsx's source.
// What shows, not how it moves: effects (the socket, timers, scrolling) don't run here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";

// One clock and one time zone, so days and "Today" don't depend on when or where this runs: Tue Nov 3, 2026,
// 3:50 PM Pacific, just after the sample's last thought (3:46 PM).
process.env.TZ = "America/Los_Angeles";
const NOW = Date.UTC(2026, 10, 3, 23, 50);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
};

// Just enough of a browser for the components' render paths (their effects never run here).
// ?cards: today's page opens on the Canvas, and this check reads the cards.
globalThis.location = new URL("http://localhost:4321/?cards");
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.addEventListener = globalThis.removeEventListener = () => {};
const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
// The tour finds its slots by id; here every slot exists, so its step renders in place.
globalThis.document = { getElementById: (id) => (id.startsWith("tour-") ? {} : null), querySelector: () => null, body: {} };

const ui = createRequire(new URL("../ui/package.json", import.meta.url));
const React = ui("react");
const { renderToStaticMarkup } = ui("react-dom/server");
// The server renderer has no portals: the Import dialog, the tour and tips render where they're written.
ui("react-dom").createPortal = (children) => children;

// App.tsx's useCore is a stand-in that returns the window state each case sets; everything else is the real module.
const standIn = {
  name: "map-render-stand-in",
  enforce: "pre",
  resolveId: (source, importer) => (source === "./core" && importer?.endsWith("/src/App.tsx") ? "\0app-core" : undefined),
  load: (id) => (id === "\0app-core"
    ? 'export * from "/src/core.ts";\nexport function useCore() { globalThis.mapRenderStandIn = true; return globalThis.mapRenderCore; }\n' : undefined),
};
// Its own cache folder: a config of its own would otherwise rewrite the other checks' (ui/node_modules/.vite).
const server = await uiServer({ plugins: [standIn], optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: join(tmpdir(), "e2a2o-map-render-check") });
try {
  const { default: App } = await server.ssrLoadModule("/src/App.tsx");
  const { useCore, apply, statusLine } = await server.ssrLoadModule("/src/core.ts");
  const { SiteContext, LOCAL, modelsLine } = await server.ssrLoadModule("/src/site.ts");
  // Words other modules own and other checks hold (marks-check, hosted-check): here, only that each shows where it goes.
  const { emptyLine } = await server.ssrLoadModule("/src/ux-rules.ts");
  const { MIC_WORDS, composerHint } = await server.ssrLoadModule("/src/MicButton.tsx");
  const { Markdown } = await server.ssrLoadModule("/src/md.tsx");
  const markdown = (text) => renderToStaticMarkup(React.createElement(Markdown, { text }));
  for (const plain of ["", "Plain text, as before.", "Two  spaces\nand a newline", "5 * 3", "5 * 3 * 2", "*unclosed", "**unclosed", "* spaced *", "# Heading", "[link](https://example.com)", "![image](x)"]) {
    assert.equal(markdown(plain), plain, `literal Markdown: ${plain}`);
  }
  assert.equal(markdown("**bold** *italics* `code`"), "<strong>bold</strong> <em>italics</em> <code>code</code>");
  assert.equal(markdown("**bold *nested***"), "<strong>bold <em>nested</em></strong>");
  assert.equal(markdown("*italic **nested***"), "<em>italic <strong>nested</strong></em>");
  assert.equal(markdown("`**literal** <img src=x onerror=alert(1)>`"), "<code>**literal** &lt;img src=x onerror=alert(1)&gt;</code>");
  const hostile = markdown('<script>alert(1)</script> <img src=x onerror="alert(1)"> & **safe**');
  assert.ok(hostile.includes("&lt;script&gt;") && hostile.includes("&lt;img") && hostile.includes("&amp; <strong>safe</strong>"));
  assert.doesNotMatch(hostile, /<(?:script|img|a)\b|<[^>]*\sonerror=/);
  const bullets = markdown("Before\n- **one**\n- *two*\n3. `three`\n4. four\nAfter");
  assert.equal((bullets.match(/role="list"/g) ?? []).length, 2, "separate bullet and numbered lists");
  assert.equal((bullets.match(/role="listitem"/g) ?? []).length, 4);
  assert.match(bullets, /<strong>one<\/strong>[^]*<em>two<\/em>[^]*>3\.<[^]*<code>three<\/code>[^]*>4\.</);
  assert.ok(bullets.startsWith("Before") && bullets.endsWith("After"));
  assert.equal(markdown("- one\r\n- two"), markdown("- one\n- two"), "typed CRLF lists");

  // The real hook's state before its socket opens: every field App reads, with the window's own defaults.
  let fresh;
  renderToStaticMarkup(React.createElement(function Probe() { fresh = useCore("you"); return null; }));
  const draw = (state, site = LOCAL) => {
    globalThis.mapRenderCore = { ...fresh, connected: true, snapshotRevision: 1, ...state };
    return renderToStaticMarkup(React.createElement(SiteContext.Provider, { value: site }, React.createElement(App)));
  };
  const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  // Words a broken render leaves on screen: a missing field, a bad number, an object where text was meant.
  const junk = (html) => text(html).match(/\b(undefined|NaN|null)\b|\[object Object\]|Invalid Date/)?.[0] ?? null;
  const count = (html, piece) => html.split(piece).length - 1;
  // The map alone (the ? list's legend draws a sample of every chip and mark too).
  const mapOf = (html) => html.slice(html.indexOf('aria-label="Thread map"'), html.indexOf("</main>"));
  // The opening tag that carries `attribute`, so its other attributes are checked in any order.
  const tagWith = (html, attribute) => html.match(new RegExp(`<[a-z]+ [^>]*${attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`))?.[0] ?? "";
  const has = (tag, ...attributes) => attributes.every((a) => tag.includes(a));

  // 1. The first screen (the video's hook opens on it): an empty map, the mic, the sample offered, Meta's models named.
  const models = [{ step: "listens", model: "muse-voice-transcribe-1.0" }, { step: "places", model: "muse-spark-1.2" }];
  const empty = draw({ world: fresh.world }, { ...LOCAL, sample: true, models });
  assert.ok(globalThis.mapRenderStandIn, "App.tsx no longer takes useCore from ./core: point the stand-in at its import");
  assert.equal(junk(empty), null, "first screen");
  const first = text(empty);
  const idle = { connected: true, listening: false, noKey: false, refused: false, resting: false, paused: false };
  for (const words of ["Think out loud.", emptyLine({ starting: false, listening: false, pending: 0, noKey: false }),
    "Tap the mic to talk, or type below and press Enter.", "See an example", modelsLine(models), statusLine(idle)]) {
    assert.ok(first.includes(words), `first screen says “${words}”`);
  }
  assert.match(modelsLine(models), /Muse Voice Transcribe 1\.0[^]*Muse Spark 1\.2|Muse Spark 1\.2[^]*Muse Voice Transcribe 1\.0/, "both models named");
  const sampleButton = tagWith(empty, 'class="sample-button"');
  assert.ok(sampleButton && !sampleButton.includes("disabled"), "the sample button, pressable");
  assert.ok(has(tagWith(empty, 'aria-label="Type a thought"'), `placeholder="${composerHint("off")}"`), "the composer");
  assert.ok(has(tagWith(empty, 'class="mic"'), 'data-state="off"', `aria-label="${MIC_WORDS.off.label}"`, 'aria-pressed="false"', `data-tip="${MIC_WORDS.off.tip}"`), "the mic, off");
  // The tour's slots: a slot renamed or dropped leaves its step with nowhere to show, and the tour stops there unseen.
  for (const slot of ["tour-composer", "tour-map", "tour-tools"]) assert.equal(count(empty, `id="${slot}"`), 1, `slot ${slot}`);
  assert.match(first, /Quick tour · 1 of 3 Speak or type/, "a fresh browser starts the tour at the composer");
  assert.ok(!empty.includes('aria-label="Export map as Markdown"'), "nothing to export yet");

  // Without a key: no model named (none runs), and every place that would ask for the mic says why it can't.
  const keyless = text(draw({ world: fresh.world, noKey: true, keyNotice: "MODEL_API_KEY is not set: listening and placement are off." }, { ...LOCAL, sample: true, models }));
  assert.ok(!keyless.includes(modelsLine(models)), "no key, no model named (none runs)");
  assert.ok(keyless.includes(statusLine({ ...idle, noKey: true })) && keyless.includes("Type to move around"), "the header and the keyless tour say it");
  assert.ok(has(tagWith(draw({ world: fresh.world, noKey: true, keyNotice: "MODEL_API_KEY is not set." }), 'class="mic"'), 'data-state="nokey"', `aria-label="${MIC_WORDS.nokey.label}"`));
  store.set("e2a2o.toured", "1");

  // 2. The sample map, as "Try a sample map" delivers it: every journal line, as the core sends it (its serde
  // defaults filled, core/src/world.rs: a move or a drop with no speaker is "you"'s), through the window's reducer.
  const lines = readFileSync(new URL("../samples/student-week.jsonl", import.meta.url), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const sent = (c) => c.type === "thread_added" ? { ...c, thread: { tags: [], picture: null, dropped_by: "", ...c.thread } }
    : c.type === "thought_added" ? { ...c, thought: { guess: "", heard: "", fixed: "", complete: true, decided: false, ...c.thought } }
    : c.type === "active_changed" || c.type === "thread_status" ? { speaker: "you", ...c } : c;
  let world = lines.map(sent).reduce(apply, fresh.world);
  world = apply(world, { type: "active_changed", thread_id: world.active, speaker: "you" });
  const byType = (type) => lines.filter((l) => l.type === type).length;
  assert.equal(world.threads.length, byType("thread_added"), "every thread");
  assert.equal(world.thoughts.length, byType("thought_added"), "every thought");
  assert.ok(world.thoughts.every((t) => t.placed && world.threads.some((th) => th.id === t.thread_id)), "every thought on a thread on the map");
  assert.equal(world.threads.filter((t) => t.picture).length, new Set(lines.filter((l) => l.type === "thread_picture").map((l) => l.thread_id)).size, "every picture");
  assert.equal(world.actions.length, byType("action_proposed"));
  assert.equal(world.suggestions.length, byType("suggestion_added"));
  assert.equal(world.threads.reduce((n, t) => n + t.tags.length, 0), byType("tag_suggested"), "every tag, none twice");
  // A thread touched after it was left is open again (thread_touched), so only the rent thread is still left off.
  assert.deepEqual(world.threads.filter((t) => t.status === "dropped").map((t) => [t.id, t.dropped_by]), [["T2", "you"]]);
  assert.equal(world.active_by.you, world.active, "your place is the sample's");

  const page = draw({ world, snapshotRevision: 2 });
  assert.equal(junk(page), null, "the sample map");
  const opened = mapOf(page);
  const shown = text(opened);
  // Every thread once, as a heading of its card (branches inside their parent's card).
  for (const thread of world.threads) assert.equal(count(opened, `id="title-${thread.id}"`), 1, thread.title);
  assert.equal(count(opened, '<section id="thread-'), world.threads.length, "one card a thread");
  assert.match(text(page), /This session · 30 thoughts · 8 topics/, "the header counts the session");
  // The thread you're on is open, with its points, each with its placing time; the rest are folded.
  const active = world.threads.find((t) => t.id === world.active);
  assert.match(tagWith(opened, `id="thread-${active.id}"`), /class="thread active /, "your thread is marked active");
  const mine = world.thoughts.filter((t) => t.thread_id === active.id);
  for (const t of mine) assert.match(opened, new RegExp(`<li id="point-${t.id}"`), `${t.id} shows on the open card`);
  assert.ok(shown.includes(`${mine.length} thoughts`), "its count");
  assert.match(opened, /<span class="speed" aria-hidden="true">\d+\.\d s<\/span><span class="sr-only">Placed in \d+\.\d seconds<\/span>/);
  assert.equal(count(opened, 'class="chip now"'), 1, "one active chip");
  // A folded thread still says what waits there: Rent's reminder, the group project's reminder and idea.
  assert.match(shown, /Rent[^]*?left off[^]*?1 new/, "rent: left off, one new");
  assert.ok(shown.includes("2 new"), "group project: a reminder and an idea");
  // Every picture slot: the letter tile under it, the picture fading in once decoded (pictures.ts).
  assert.equal(count(opened, 'class="picture picture-letter"'), world.threads.length);
  assert.equal(count(opened, 'class="picture slot-picture"'), world.threads.filter((t) => t.picture).length);

  // 3. Rent, opened (a click or "where was I?"): the reminder with its day and its Add button, and the left-off chip.
  world = apply(world, { type: "active_changed", thread_id: "T2", speaker: "you" });
  const rent = mapOf(draw({ world, snapshotRevision: 2 }));
  assert.equal(junk(rent), null, "rent open");
  assert.match(rent, /<span class="chip dropped">left off<\/span>/);
  assert.match(rent, /Transfer rent to landlord<span class="when due today"> · Today<\/span>/, "due today, in amber's strongest shade");
  assert.match(rent, /<button aria-label="Add Transfer rent to landlord to Reminders">Add to Reminders<\/button>/);
  assert.match(rent, /<button class="quiet" aria-label="Dismiss Transfer rent to landlord">×<\/button>/);
  assert.match(rent, /data-tip="AI proposal from your words\. Nothing reaches Reminders until you press Add to Reminders; × dismisses it\.">✦<\/span>/);
  // Clicked: "Adding to Reminders…" and no button; Apple answered: the time it took.
  const kept = mapOf(draw({ world: apply(world, { type: "item_status", id: "ac-1", status: "kept", done_ms: null }), snapshotRevision: 2 }));
  assert.ok(text(kept).includes("Adding to Reminders…") && !kept.includes(">Add to Reminders<"));
  const added = text(mapOf(draw({ world: apply(world, { type: "item_status", id: "ac-1", status: "done", done_ms: 1234 }), snapshotRevision: 2 })));
  assert.ok(added.includes("Added to Reminders · 1.2 s") && !added.includes("Today"), "added: its time, no due shade");

  // 4. Hosted or off a Mac: the same row saves a calendar file (site.ts), never Reminders.
  const hosted = mapOf(draw({ world, snapshotRevision: 2 }, { ...LOCAL, hosted: true, calendarFile: true }));
  assert.match(hosted, /<button aria-label="Download Transfer rent to landlord as a calendar file">Download \.ics<\/button>/);
  assert.ok(!text(hosted).includes("Reminders"), "nothing about Reminders hosted");

  // 5. The video's catch beat (its first 30 seconds), frame by frame as the camera sees it.
  const { receiveStep, resetSteps } = await server.ssrLoadModule("/src/model-line.ts");
  const at = (s) => NOW - s * 1000;
  const card = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: at(30), tags: [], picture: null, dropped_by: "", ...extra });
  const said = (id, thread_id, text, point, s, extra = {}) => ({ id, speaker: "you", text, point, thread_id, placed: !!thread_id, unclear: "", guess: "",
    heard: "", fixed: "", complete: true, at_ms: at(s), place_ms: thread_id ? 2600 : null, decided: false, ...extra });
  const mdText = "- **typed**\n- `safe` <img src=x>";
  const mdPoint = "**point** with *emphasis*";
  const mdWorld = { ...fresh.world, threads: [card("MD", "Markdown")], active: "MD", active_by: { you: "MD" },
    thoughts: [said("md-placed", "MD", mdText, mdPoint, 5), said("md-pending", null, mdText, "", 1)] };
  const mdMap = draw({ world: mdWorld, placing: { now: "md-pending", retryAt: {} } });
  assert.match(mdMap, /<span><strong>point<\/strong> with <em>emphasis<\/em><\/span>/, "a placed point");
  assert.match(mdMap, /id="said-md-placed"[^]*?role="list"[^]*?<strong>typed<\/strong>/, "original words, including a first-line bullet");
  assert.match(mdMap, /class="pill"[^]*?role="list"[^]*?<strong>typed<\/strong>/, "a pending thought");
  assert.doesNotMatch(mdMap, /<img src="?x\b/, "thought HTML stays text in every card");
  const half = said("s1", "T1", "My biggest problem is that I never finish my", "Never finishes sentences", 26, { complete: false });
  const rentLine = said("r1", "T2", "Oh, and rent is due Friday and I still haven't sent it.", "Rent due Friday, not sent yet", 20);
  const sendRent = { id: "ac-9", thread_id: "T2", kind: "reminder", title: "Send rent", when: "2026-11-06", status: "new", done_ms: null };
  const catchWorld = { ...fresh.world, threads: [card("T1", "Finishing sentences", { status: "dropped", dropped_by: "you" }), card("T2", "Rent")],
    thoughts: [half, rentLine], actions: [sendRent], active: "T2", active_by: { you: "T2" } };
  // "Wait, where was I?" being said, while Muse Spark places the line before it.
  receiveStep({ type: "step", id: 1, step: "placer", model: "muse-spark-1.2-contributor", done: false, ok: false, ms: 0 });
  const saying = draw({ world: catchWorld, partial: "Wait, where was I?", listening: true }, { ...LOCAL, models });
  assert.equal(junk(saying), null, "catch beat");
  assert.match(tagWith(saying, 'id="thread-T1"'), /class="[^"]*\bdropped\b/, "the left thread wears its flag");
  assert.match(mapOf(saying), /id="title-T1"[^]*?<span class="chip dropped">left off<\/span>/);
  assert.match(saying, /<div class="live words"><span>Wait, where was I\?<\/span><\/div>/, "the live words, in the dock");
  assert.ok(has(tagWith(saying, 'class="model-line"'), 'title="muse-spark-1.2-contributor"'), "the full model id, on hover");
  assert.ok(text(saying).includes("Muse Spark 1.2 · placing your thought"), "the Meta model at work, by its public name");
  // The day in this machine's own words ("Fri, Nov 6" in the US, "Fri 6 Nov" in the UK), as the row writes it.
  const friday = new Date(2026, 10, 6, 9).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  assert.ok(mapOf(saying).includes(`Send rent<span class="when"> · ${friday}</span>`), "the reminder and its day");
  resetSteps();
  // A thought on its way: its pill in the dock says it's being placed, and for how long.
  const onItsWay = said("p1", null, "Sentences. I never finish my sentences.", "", 7);
  const waiting = draw({ world: { ...catchWorld, thoughts: [...catchWorld.thoughts, onItsWay] }, placing: { now: "p1", retryAt: {} } });
  assert.match(waiting, /<span class="pill"><span class="pending-label">Finding a place · 7s<\/span> Sentences\. I never finish my sentences\.<\/span>/);
  // Landed on the thread it finishes: picked up (no flag), and the two parts read as one point, with "✦ joined".
  const finished = { ...catchWorld, active: "T1", active_by: { you: "T1" },
    threads: [card("T1", "Finishing sentences", { last_point: "Never finishes sentences" }), card("T2", "Rent")],
    thoughts: [half, rentLine, said("s2", "T1", "Sentences. I never finish my sentences.", "Never finishes sentences", 4)], notes: { s2: { continues: "s1" } } };
  const joined = draw({ world: finished });
  assert.equal(junk(joined), null, "joined");
  assert.ok(!mapOf(joined).includes("left off"), "picked up: no flag");
  assert.match(joined, /aria-label="Joined across a pause; keep apart: “My biggest problem is that I never finish my” as its own point"/);
  assert.equal(count(mapOf(joined), '<li id="point-'), 1, "one point on the open card, not two");
  assert.match(text(joined), /This session · 2 thoughts · 2 topics/, "the header counts ideas, as the cards do");

  // 6. What the AI adds, each with its ✦ and its way back: a rename it was sure of (a note with Undo), one it asks
  // about, an idea (Keep, ×), suggested tags once a thread says enough, a fix it made, and a word it may have misheard.
  const unsure = said("f1", "T2", "ask muse bark about the lease", "Ask muse bark about the lease", 15, { unclear: "muse bark", guess: "Muse Spark" });
  const sure = said("f2", "T2", "Muse Spark places it", "Muse Spark places it", 12, { heard: "muse bark", fixed: "Muse Spark" });
  const aiWorld = { ...catchWorld, threads: [card("T1", "Finishing sentences"), card("T2", "Rent", { tags: [{ name: "money", kept: false }, { name: "home", kept: true }] })],
    thoughts: [half, rentLine, unsure, sure], suggestions: [{ id: "sg-5", thread_id: "T2", text: "Set up autopay", status: "new" }],
    proposals: [{ id: "p1", kind: "rename", thread_id: "T2", title: "Rent payment", status: "new" }] };
  const renamed = { id: 1, text: "AI renamed “Topic T2” to “Rent”", ai: true, undo: [{ kind: "rename", thread_id: "T2" }], renamed: [["Topic T2", "Rent"]] };
  const ai = draw({ world: aiWorld, mapChange: renamed });
  assert.equal(junk(ai), null, "the AI's marks");
  assert.match(ai, /<div class="map-change"><span aria-hidden="true" data-tip="The AI renamed this on its own[^"]*">✦<\/span> AI renamed “Topic T2” to “Rent”<button class="undo">Undo<\/button>/);
  const marks = mapOf(ai);
  assert.match(marks, /Did you mean “Muse Spark”\?<button>Yes<\/button><button class="quiet" aria-label="No, keep “muse bark”">No<\/button>/);
  assert.match(marks, /<button class="fixed" aria-label="Undo fix: heard “muse bark”">/);
  assert.match(marks, /<button aria-label="Keep suggestion: Set up autopay">Keep<\/button><button class="quiet" aria-label="Dismiss suggestion: Set up autopay">×<\/button>/);
  assert.match(marks, /<button aria-label="Rename: Rename to “Rent payment”\?">Rename<\/button><button class="quiet" aria-label="Keep the title">×<\/button>/);
  assert.match(marks, /aria-label="AI-suggested tag: money" aria-pressed="false"[^>]*><span aria-hidden="true">✦ <\/span>money<\/button>/, "a suggested tag, once the thread has 3 thoughts");
  assert.match(marks, /aria-label="Kept tag: home" aria-pressed="true" title="Remove tag">home<\/button>/);
  console.log("map-render-check: ok (safe thought Markdown, first screen with and without a key, the sample map through the reducer, a reminder from proposed to added, hosted, the catch beat, the AI's marks)");
} finally {
  globalThis.Date = RealDate;
  await server.close();
}
