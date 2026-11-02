// No extra dependencies: run with `node scripts/firstframe-check.mjs`.
// The video's first and last frames (reviews 2026-11-02, spec-empty, spec-palace, spec-recap, docs-ux):
// - the first frame says "Listening" once, in the header, not five times; the models line uses the end card's words
// - the Palace opens on pictures, never on a grid of letters, and no letter shows through a picture fading in
// - Recap prints each decision as the map does: capitalized, with its ✓
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const read = (path) => readFileSync(new URL(`../ui/src/${path}`, import.meta.url), "utf8");
const app = read("App.tsx");
const server = await uiServer();
try {
  // 1. "Listening" once. The header's word (App.tsx) keeps it: the app's state, where a person checks the mic is on
  //    (and what the recording run sheet says to wait for). The other four places said it again.
  const { emptyLine, liveLine } = await server.ssrLoadModule("/src/ux-rules.ts");
  const { composerHint } = await server.ssrLoadModule("/src/MicButton.tsx");
  const { lineFor, stepped, EMPTY_LINE } = await server.ssrLoadModule("/src/model-line.ts");
  const listen = stepped(EMPTY_LINE, { type: "step", id: 1, step: "listen", model: "muse-voice-transcribe-1.0", done: false, ok: true, ms: 0 }, 0);
  const others = {
    "empty map": emptyLine({ starting: false, listening: true, pending: 0, noKey: false }),
    dock: liveLine("", false),
    composer: composerHint("listening"),
    "model line": `${lineFor(listen, 0, false).model} · ${lineFor(listen, 0, false).text}`,
  };
  for (const [where, text] of Object.entries(others)) assert.ok(!/listen/i.test(text), `${where} says "${text}"; the header already says Listening`);
  const { statusLine } = await server.ssrLoadModule("/src/core.ts");
  assert.equal(statusLine({ connected: true, listening: true, noKey: false, refused: false, resting: false, paused: false }), "Listening", "the header still says Listening");
  // Wired to this tab's capture, not the core's word: it says Listening whenever the mic here takes sound, from its
  // first frame, and never because another window or an older session is listening.
  assert.match(app, /const status = statusLine\(\{ connected: core\.connected, listening: !!stopMic/, "the header is wired to it");
  assert.equal(others["empty map"], "Say what's on your mind.");
  assert.equal(others.composer, "Or type a thought");
  assert.equal(others["model line"], "Muse Voice Transcribe 1.0 · mic on", "the model line names who hears");
  assert.equal(lineFor(listen, 0, true).text, "hearing you");
  assert.equal(liveLine("", true), "Starting the microphone…", "starting the mic still answers the click");
  assert.equal(liveLine("I never finish my", false), "I never finish my");
  assert.match(app, /emptyLine\(\{ starting: startingMic, listening: core\.listening, pending: pending\.length, noKey: core\.noKey, resting: core\.resting \}\)/, "the empty map is wired to the rule");
  assert.match(emptyLine({ starting: false, listening: false, pending: 1, noKey: true, resting: true }), /tomorrow/, "a held-back key says when (the daily limit)");
  assert.match(app, /\{liveLine\(core\.partial \|\| core\.handoff, startingMic\)\}/, "the dock is wired to the rule");

  // The models line in the end card's words (docs/demo.md, end card): one model, its steps together.
  const { modelsLine } = await server.ssrLoadModule("/src/site.ts");
  const models = [["hears", "muse-voice-transcribe-1.0"], ["places", "muse-spark-1.2-contributor"], ["tidies", "muse-spark-1.3"],
    ["builds", "muse-spark-1.3"], ["recaps", "muse-spark-1.3"], ["draws", "muse-image-1.0"]].map(([step, model]) => ({ step, model }));
  assert.equal(modelsLine(models), "Hears: Muse Voice Transcribe 1.0 · Places: Muse Spark 1.2 · Tidies, builds, recaps: Muse Spark 1.3 · Draws: Muse Image 1.0");
  // Recap on its own model (RECAP_MODEL): named apart, never folded into a group it isn't in.
  assert.equal(modelsLine([models[2], models[3], { step: "recaps", model: "muse-spark-1.2" }]), "Tidies, builds: Muse Spark 1.3 · Recaps: Muse Spark 1.2");
  assert.equal(modelsLine([]), "");
  // Placing's racing calls on two models (core/src/placer.rs `MODELS`, one entry each): one step, both named.
  const mixed = [models[0], { step: "places", model: "muse-spark-1.3" }, { step: "places", model: "muse-spark-1.2" }, ...models.slice(2)];
  assert.equal(modelsLine(mixed), "Hears: Muse Voice Transcribe 1.0 · Places: Muse Spark 1.3 + 1.2 · Tidies, builds, recaps: Muse Spark 1.3 · Draws: Muse Image 1.0");

  // 2. The Palace starts each tile from the map's copy, already decoded (no fade, no letter), with the large copy
  //    fading in over it; and while any picture is on its way, the letter stays hidden (the room's color shows).
  const { Palace } = await server.ssrLoadModule("/src/Palace.tsx");
  const thread = { id: "T1", title: "Never finishing things", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [],
    picture: "/pictures/T1-small.webp", dropped_by: "" };
  const html = ReactDOMServer.renderToStaticMarkup(React.createElement(Palace, { threads: [thread], active: "T1", onOpen() {} }));
  const art = html.match(/<span class="palace-art">([^]*?)<span class="palace-placeholder"/)[1];
  assert.deepEqual([...art.matchAll(/src="([^"]+)"/g)].map(([, src]) => src), ["/pictures/T1-small.webp", "/pictures/T1-palace.webp"],
    "the map's copy first, the large one over it");
  assert.ok(!/<img[^>]*src="\/pictures\/T1-small\.webp"[^>]*loading="lazy"/.test(art), "the map's copy isn't lazy: it's already here");
  const solo = ReactDOMServer.renderToStaticMarkup(React.createElement(Palace, { threads: [{ ...thread, picture: "/pictures/T1.webp" }], active: "T1", onOpen() {} }));
  assert.equal(solo.match(/<img/g).length, 1, "a map with only the full picture shows it once");
  const palaceCss = read("palace.css");
  assert.match(palaceCss, /\.palace-art:has\(> img\) \.palace-placeholder > span \{ visibility: hidden; \}/, "no letter under a picture");
  assert.match(read("styles.css"), /\.picture-wrap:has\(> img\) > \.picture-letter \{ color: transparent; \}/, "the map card's letter goes too");

  // 3. Recap: a decision reads as the map shows it, capitalized and with its ✓; plans and questions are capitalized.
  const { Recap } = await server.ssrLoadModule("/src/Recap.tsx");
  const item = (thread_id, text) => ({ thread_id, text });
  const recap = { period: "today", since_ms: 0, through_ms: 1, generated_ms: 2, source_key: "", summary: "A day.",
    decisions: [item("T1", "if under $80 booking pottery class tonight")], plans: [item("T1", "book the cooking class")], questions: [],
    worked_on: [], unfinished: [], actions: [], thought_count: 1, thread_count: 1, limited: false };
  const world = { threads: [thread], thoughts: [], active: "T1", active_by: {}, recaps: [], suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true };
  const sheet = ReactDOMServer.renderToStaticMarkup(React.createElement(Recap, { view: { period: "today", loading: false, message: "", recap },
    world, connected: true, noKey: false, listening: false, onRequest() {}, onMark: () => true, onClose() {}, onFocus() {} }));
  const text = sheet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /✓ If under \$80 booking pottery class tonight/, "the decision, capitalized, after its ✓");
  assert.match(text, / Book the cooking class/, "a plan is capitalized too");
  assert.equal(text.match(/✓/g).length, 1, "only decisions wear the ✓");
  assert.match(sheet, /<span class="decided" aria-hidden="true">✓<\/span>/, "the ✓ in the map's decided color");
} finally {
  await server.close();
}
console.log("First-frame checks passed: \"Listening\" once (the header), the models line in the end card's words, Palace tiles start from the map's pictures with no letter under them, and Recap's decisions capitalized with their ✓.");
