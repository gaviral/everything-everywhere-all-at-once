// No extra dependencies: run with `node scripts/model-line-check.mjs`.
// Checks the model line (ui/src/model-line.ts): every step the core tells shows the model it asked, by its public
// name, and never another step's model; a rule's step says no model; the line sits in the composer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { modelName, stepped, lineFor, announcement, runningModel, EMPTY_LINE, HOLD_MS } = await server.ssrLoadModule("/src/model-line.ts");
  let id = 0;
  const start = (step, model) => ({ type: "step", id: ++id, step, model, done: false, ok: false, ms: 0 });
  const end = (msg, ms = 2300, ok = true) => ({ ...msg, done: true, ok, ms });

  // Public names: Contributor mode is how the key asks, not another model.
  assert.equal(modelName("muse-spark-1.2-contributor"), "Muse Spark 1.2");
  assert.equal(modelName("muse-spark-1.3"), "Muse Spark 1.3");
  assert.equal(modelName("muse-image-1.0"), "Muse Image 1.0");
  assert.equal(modelName("muse-voice-transcribe-1.0"), "Muse Voice Transcribe 1.0");

  // Every step the core has (trace features), and one it might add: named while it runs and once it's done.
  const steps = [["placer", "muse-spark-1.2-contributor"], ["refiner", "muse-spark-1.3"], ["picture", "muse-image-1.0"],
    ["recap", "muse-spark-1.3"], ["app", "muse-spark-1.3"], ["find", "muse-spark-1.3"], ["explain", "muse-spark-1.2"],
    ["safety net", "muse-spark-1.2"], ["import-chatgpt", "muse-spark-1.2"], ["something-new", "muse-spark-1.3"]];
  for (const [step, model] of steps) {
    const msg = start(step, model);
    let state = stepped(EMPTY_LINE, msg, 0);
    let line = lineFor(state, 0, false);
    assert.ok(line?.model, `${step} running shows a model`);
    assert.equal(line.model, modelName(model), `${step} running names the model asked`);
    assert.equal(line.id, model, `${step}: the tooltip has the full id`);
    assert.ok(line.text && !/undefined/.test(line.text), `${step}: ${line.text}`);
    state = stepped(state, end(msg), 1000);
    line = lineFor(state, 1000 + HOLD_MS - 1, false);
    assert.equal(line?.model, modelName(model), `${step} done names the model that answered`);
    assert.match(line.text, /2\.3 s$/, `${step} done says how long it took`);
    assert.equal(lineFor(state, 1000 + HOLD_MS, false), null, `${step}: gone once its hold is up, the mic off`);
  }

  // Listening: the model hearing the words; anything you wait on takes the line, then it comes back.
  let state = stepped(EMPTY_LINE, start("listen", "muse-voice-transcribe-1.0"), 0);
  assert.deepEqual(lineFor(state, 0, false), { model: "Muse Voice Transcribe 1.0", id: "muse-voice-transcribe-1.0", text: "listening" });
  assert.equal(lineFor(state, 0, true).text, "hearing you");
  // Placing and a picture at once (a new thread's picture starts as the next line is placed): never the wrong model.
  const place = start("placer", "muse-spark-1.2-contributor");
  const picture = start("picture", "muse-image-1.0");
  state = stepped(stepped(state, place, 100), picture, 200);
  assert.equal(lineFor(state, 200, true).model, "Muse Spark 1.2", "the step you wait on, not the one behind");
  assert.equal(lineFor(state, 200, true).text, "placing your thought");
  state = stepped(state, end(place), 2400);
  assert.deepEqual([lineFor(state, 2500, true).model, lineFor(state, 2500, true).text], ["Muse Spark 1.2", "placed it · 2.3 s"],
    "the placing time holds over the picture behind it");
  assert.deepEqual([lineFor(state, 2400 + HOLD_MS, true).model, lineFor(state, 2400 + HOLD_MS, true).text], ["Muse Image 1.0", "drawing a picture"]);
  state = stepped(state, end(picture, 6100), 8000);
  assert.equal(lineFor(state, 8000, true).model, "Muse Image 1.0");
  assert.equal(lineFor(state, 8000 + HOLD_MS, true).model, "Muse Voice Transcribe 1.0", "back to the one listening");
  state = stepped(state, end(start("listen", "muse-voice-transcribe-1.0"), 0), 9000);
  assert.equal(state.listening, null, "mic off: nobody listening");

  // A turned-away try and its stand-in: the line names the model that's asked now.
  const tried = start("placer", "muse-spark-1.2-contributor");
  state = stepped(EMPTY_LINE, tried, 0);
  state = stepped(stepped(state, end(tried, 200, false), 200), start("placer", "muse-spark-1.2"), 200);
  assert.equal(lineFor(state, 300, false).model, "Muse Spark 1.2");
  // A call that failed says so, with its model.
  const failed = start("picture", "muse-image-1.0");
  state = stepped(stepped(EMPTY_LINE, failed, 0), end(failed, 40000, false), 40000);
  assert.deepEqual([lineFor(state, 40000, false).model, lineFor(state, 40000, false).text], ["Muse Image 1.0", "didn't answer"]);

  // Rules: no model named, and said so.
  for (const step of ["back", "tune"]) {
    const rule = { type: "step", id: ++id, step, model: null, done: true, ok: true, ms: 0 };
    const line = lineFor(stepped(EMPTY_LINE, rule, 0), 0, false);
    assert.equal(line.model, null, `${step} is a rule`);
    assert.match(line.text, /by rule, no model$/);
  }

  // The Recap's wait names the model the core is asking for it.
  state = stepped(EMPTY_LINE, start("recap", "muse-spark-1.3"), 0);
  assert.equal(runningModel(state, "recap"), "Muse Spark 1.3");
  assert.equal(runningModel(state, "placer"), null);

  // Screen readers: each model once per kind of step.
  const said = new Set();
  assert.equal(announcement(said, "placer", "muse-spark-1.2-contributor"), "Muse Spark 1.2 is placing your thought.");
  assert.equal(announcement(said, "placer", "muse-spark-1.2-contributor"), null);
  assert.equal(announcement(said, "picture", "muse-image-1.0"), "Muse Image 1.0 is drawing a picture.");
  assert.equal(announcement(said, "back", null), null);

  // Wired: the socket feeds it, the composer shows it, the Recap's wait reads it.
  const src = (f) => readFileSync(new URL(`../ui/src/${f}`, import.meta.url), "utf8");
  assert.match(src("core.ts"), /if \(receiveStep\(msg\)\) return;/);
  assert.match(src("App.tsx"), /<form className="composer"[\s\S]*<ModelLine [\s\S]*<MicButton/);
  assert.match(src("Recap.tsx"), /runningModel\(useSteps\(\)\.state, "recap"\)/);
  // And the core tells every model call from the one place they all pass (core/src/model.rs).
  const model = readFileSync(new URL("../core/src/model.rs", import.meta.url), "utf8");
  assert.equal((model.match(/self\.step_began\(/g) ?? []).length, 3, "call_model_noting, ask_model and its stand-in");
  console.log("model line: every step names the model asked");
} finally {
  await server.close();
}
