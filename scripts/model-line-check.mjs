// No extra dependencies: run with `node scripts/model-line-check.mjs`.
// Checks the model line (ui/src/model-line.ts): every step the core tells shows the model it asked, by its public
// name, and never another step's model; a rule's step says no model; the line sits in the composer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { modelName, stepped, lineFor, announcement, runningModel, together, EMPTY_LINE, HOLD_MS } = await server.ssrLoadModule("/src/model-line.ts");
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
    ["safety net", "muse-spark-1.2"], ["import-chatgpt", "muse-spark-1.2"], ["app search", "muse-spark-1.3"],
    ["app run", "muse-spark-1.3"], ["something-new", "muse-spark-1.3"]];
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
    // The call answered; whether the feature then did its thing is the map's to show, so no "placed it".
    assert.equal(line.text, "answered · 2.3 s", `${step} done says it answered and how long it took`);
    assert.equal(lineFor(state, 1000 + HOLD_MS, false), null, `${step}: gone once its hold is up, the mic off`);
  }

  // A placement's race, each lane on its own model (core/src/placer.rs `MODELS`): both named while they run, then
  // the one that won, and the dropped one never covers it.
  assert.deepEqual(together(["muse-spark-1.3", "muse-spark-1.2"]), { model: "Muse Spark 1.3 + 1.2", id: "muse-spark-1.3, muse-spark-1.2" });
  assert.deepEqual(together(["muse-spark-1.2", "muse-spark-1.2-contributor"]), { model: "Muse Spark 1.2", id: "muse-spark-1.2, muse-spark-1.2-contributor" });
  assert.equal(together(["muse-spark-1.3", "muse-image-1.0"]).model, "Muse Spark 1.3 + Muse Image 1.0");
  {
    const lane0 = start("placer", "muse-spark-1.3");
    const lane1 = start("placer", "muse-spark-1.2");
    let race = stepped(stepped(EMPTY_LINE, lane0, 0), lane1, 1);
    assert.deepEqual(lineFor(race, 1, false), { model: "Muse Spark 1.3 + 1.2", id: "muse-spark-1.3, muse-spark-1.2", text: "placing your thought" });
    for (const [won, lost] of [[lane1, lane0], [lane0, lane1]]) {
      const after = stepped(stepped(race, end(won, 1800), 1800), { ...lost, done: true, dropped: true }, 1801);
      assert.deepEqual(lineFor(after, 1900, false), { model: modelName(won.model), id: won.model, text: "answered · 1.8 s" }, `won by ${won.model}`);
    }
    // Two lanes on one model (PLACER_MODEL): named once.
    const same = stepped(stepped(EMPTY_LINE, start("placer", "muse-spark-1.2"), 0), start("placer", "muse-spark-1.2"), 1);
    assert.equal(lineFor(same, 1, false).model, "Muse Spark 1.2");
  }

  // Listening: the model hearing the words; anything you wait on takes the line, then it comes back.
  const mic = start("listen", "muse-voice-transcribe-1.0");
  let state = stepped(EMPTY_LINE, mic, 0);
  assert.deepEqual(lineFor(state, 0, false), { model: "Muse Voice Transcribe 1.0", id: "muse-voice-transcribe-1.0", text: "mic on" });
  assert.equal(lineFor(state, 0, true).text, "hearing you");
  // Placing and a picture at once (a new thread's picture starts as the next line is placed): never the wrong model.
  const place = start("placer", "muse-spark-1.2-contributor");
  const picture = start("picture", "muse-image-1.0");
  state = stepped(stepped(state, place, 100), picture, 200);
  assert.equal(lineFor(state, 200, true).model, "Muse Spark 1.2", "the step you wait on, not the one behind");
  assert.equal(lineFor(state, 200, true).text, "placing your thought");
  state = stepped(state, end(place), 2400);
  assert.deepEqual([lineFor(state, 2500, true).model, lineFor(state, 2500, true).text], ["Muse Spark 1.2", "answered · 2.3 s"],
    "the placing time holds over the picture behind it");
  assert.deepEqual([lineFor(state, 2400 + HOLD_MS, true).model, lineFor(state, 2400 + HOLD_MS, true).text], ["Muse Image 1.0", "drawing a picture"]);
  // The picture finishing 0.1 s later leaves the placing time up for its whole hold.
  const quick = stepped(state, end(picture, 2400), 2500);
  assert.deepEqual([lineFor(quick, 2600, true).model, lineFor(quick, 2400 + HOLD_MS - 1, true).text], ["Muse Spark 1.2", "answered · 2.3 s"],
    "a step behind never covers a placing time");
  state = stepped(state, end(picture, 6100), 8000);
  assert.equal(lineFor(state, 8000, true).model, "Muse Image 1.0");
  assert.equal(lineFor(state, 8000 + HOLD_MS, true).model, "Muse Voice Transcribe 1.0", "back to the one listening");
  state = stepped(state, end(mic, 0), 9000);
  assert.equal(state.listening, null, "mic off: nobody listening");
  // Mic off and on quickly: the old session ends after the new one began, and clears only itself.
  const oldMic = start("listen", "muse-voice-transcribe-1.0"), newMic = start("listen", "muse-voice-transcribe-1.0");
  state = stepped(stepped(stepped(EMPTY_LINE, oldMic, 0), newMic, 100), end(oldMic, 0), 200);
  assert.equal(lineFor(state, 200, false)?.model, "Muse Voice Transcribe 1.0", "a late end of an old session");
  assert.equal(stepped(state, end(newMic, 0), 300).listening, null);
  // An app a watcher woke runs behind: never "building your app", never over the step you wait on.
  const placing = start("placer", "muse-spark-1.2");
  state = stepped(stepped(EMPTY_LINE, placing, 0), start("app run", "muse-spark-1.3"), 10);
  assert.equal(lineFor(state, 10, false).text, "placing your thought");
  state = stepped(state, end(placing), 2300);
  assert.equal(lineFor(state, 2300 + HOLD_MS, false).text, "running your app");

  // A turned-away try and its stand-in: the line names the model that's asked now.
  const tried = start("placer", "muse-spark-1.2-contributor");
  state = stepped(EMPTY_LINE, tried, 0);
  state = stepped(stepped(state, end(tried, 200, false), 200), start("placer", "muse-spark-1.2"), 200);
  assert.equal(lineFor(state, 300, false).model, "Muse Spark 1.2");
  // A placement's racing calls (placer.rs): the winner answers, the loser is cut off and told as dropped. That
  // isn't a failure: the line says the winner's time, never "didn't answer", and nothing is left "placing".
  const raceA = start("placer", "muse-spark-1.2-contributor"), raceB = start("placer", "muse-spark-1.2-contributor");
  state = stepped(stepped(EMPTY_LINE, raceA, 0), raceB, 0);
  state = stepped(state, end(raceB, 3200), 3200);
  state = stepped(state, { ...end(raceA, 3201, false), dropped: true }, 3201);
  assert.deepEqual(state.running, [], "the dropped lane no longer runs");
  assert.deepEqual([lineFor(state, 3201, true).model, lineFor(state, 3201, true).text], ["Muse Spark 1.2", "answered · 3.2 s"],
    "a race's loser never covers the winner's time");
  // A call that failed says so, with its model.
  const failed = start("picture", "muse-image-1.0");
  state = stepped(stepped(EMPTY_LINE, failed, 0), end(failed, 40000, false), 40000);
  assert.deepEqual([lineFor(state, 40000, false).model, lineFor(state, 40000, false).text], ["Muse Image 1.0", "didn't answer"]);

  // A placement races 2 calls (placer.rs): the slower one, cut off once the first answers, is dropped, not failed. The
  // line says the winner answered, with its time, for the whole hold (take cleanup1: 9 of 9 said "didn't answer").
  const lane0 = start("placer", "muse-spark-1.2"), lane1 = start("placer", "muse-spark-1.2");
  state = stepped(stepped(EMPTY_LINE, lane0, 0), lane1, 0);
  state = stepped(state, end(lane0, 2000), 2000);
  state = stepped(state, { ...end(lane1, 2001, false), dropped: true }, 2001);
  assert.deepEqual(state.running, [], "the dropped lane no longer runs");
  for (const at of [2001, 2000 + HOLD_MS - 1]) {
    assert.deepEqual([lineFor(state, at, false).model, lineFor(state, at, false).text], ["Muse Spark 1.2", "answered · 2.0 s"],
      "a race's loser never reads as the model failing");
  }
  // A dropped call with nothing else showing says nothing, not "didn't answer" (Search-first past its patience).
  const gaveUp = start("app search", "muse-spark-1.3");
  assert.equal(lineFor(stepped(stepped(EMPTY_LINE, gaveUp, 0), { ...end(gaveUp, 4000, false), dropped: true }, 4000), 4000, false), null);

  // A Recap draft nobody asked for (recap.rs, ≈ 0.5 s after each landing) runs behind: never "reading your day", never
  // over the placing time it follows; the Recap you ask for is still a step you wait on.
  const placed = start("placer", "muse-spark-1.2");
  state = stepped(EMPTY_LINE, placed, 0);
  state = stepped(state, end(placed, 2300), 2300);
  const draft = start("recap draft", "muse-spark-1.3");
  state = stepped(state, draft, 2800);
  assert.equal(lineFor(state, 2800, false).text, "answered · 2.3 s", "a draft starting never covers the placing time");
  state = stepped(state, end(draft, 1800), 4600);
  assert.equal(lineFor(state, 2300 + HOLD_MS - 1, false).text, "answered · 2.3 s", "nor does it finishing");
  assert.equal(lineFor(stepped(EMPTY_LINE, draft, 0), 0, false).text, "keeping your recap ready");
  assert.equal(lineFor(stepped(stepped(EMPTY_LINE, draft, 0), start("recap", "muse-spark-1.3"), 10), 10, false).text, "reading your day");

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
  // Asked while a draft is being made: the core waits for that draft and answers with it, so the wait names its model.
  state = stepped(EMPTY_LINE, start("recap draft", "muse-spark-1.3"), 0);
  assert.equal(runningModel(state, "recap", "recap draft"), "Muse Spark 1.3");

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
  assert.match(src("Recap.tsx"), /runningModel\(useSteps\(\)\.state, "recap", "recap draft"\)/);
  // And the core tells every model call from the one place they all pass (core/src/model.rs).
  const model = readFileSync(new URL("../core/src/model.rs", import.meta.url), "utf8");
  assert.equal((model.match(/self\.step_began\(/g) ?? []).length, 3, "call_model_noting, ask_model and its stand-in");
  console.log("model line: every step names the model asked");
} finally {
  await server.close();
}
