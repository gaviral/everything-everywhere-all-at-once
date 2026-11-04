// No extra dependencies: run with `node scripts/loud-app-check.mjs`.
// The video's app beat as built today (at about 1:20): "Make an app that plays a silly tune if we get loud." apps-check
// draws the older beat's card app ("shows a card when I mention the demo"); this one draws the loud-voice app in the
// dock (DockBuild in ui/src/Apps.tsx) and holds the readings that set it off: the window's loudness, sent to the core
// every four 80 ms frames (volumeReporter in ui/src/apps-audio.ts), which the core's watcher compares with its level.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { uiServer } from "./ui-server.mjs";

const ui = createRequire(new URL("../ui/package.json", import.meta.url));
const React = ui("react");
const { renderToStaticMarkup } = ui("react-dom/server");
const server = await uiServer();
try {
  const { noticeQueue } = await server.ssrLoadModule("/src/notice-queue.ts");
  const { DockBuild } = await server.ssrLoadModule("/src/Apps.tsx");
  const { volumeReporter } = await server.ssrLoadModule("/src/apps-audio.ts");
  const { default: LevelMeter } = await server.ssrLoadModule("/src/bricks/level/index.tsx");
  const { REFERENCE_THRESHOLDS } = await server.ssrLoadModule("/src/bricks/level/stretches.ts");
  const calibration = renderToStaticMarkup(React.createElement(LevelMeter, { map: { apps: [] }, on: () => () => {} }));
  assert.ok(calibration.includes("Recording-mic calibration · pending"));
  assert.ok(/<button disabled="">Start calibration<\/button>/.test(calibration), "no readings: cannot start collection");
  assert.ok(!calibration.includes("Export private JSON"), "no finished receipt: cannot export");
  const text = (html) => html.replace(/<div class="sr-only" role="status">.*?<\/div>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Ready to keep: what it is, its blocks in the person's words (a loud stretch, the silly tune and its card), Keep first.
  const request = "plays a silly tune if we get loud";
  const draft = { id: "app-loud", name: "Loud Silly Tune", purpose: "Plays a silly tune when voices stay loud.",
    watcher: { kind: "volume", level: REFERENCE_THRESHOLDS[0], seconds: 3 }, prompt: null,
    publishers: [{ kind: "sound" }, { kind: "card", text: "Voices have been loud for a little while. A small pause might help." }],
    enabled: false, request, cooldown_secs: 60, created_ms: 0, last_run_ms: 0 };
  const build = (stage, extra = {}) => ({ id: "build-7", request, stage, steps: ["Checking existing apps", "Choosing blocks for your app",
    "Checking the watcher, prompt and publishers", "Ready to keep. It starts when you keep it."], draft, match_id: null, message: "", instead: "", ...extra });
  const core = (current) => {
    const queue = noticeQueue();
    queue.push("card", `build:${current.id}`, { data: {
      build: current, app: current.draft, confirmation: `${current.draft.name} · ${current.message}`,
    }, text: current.message, waiting: false, done() {} }, "build");
    return { connected: true, snapshotRevision: 1, world: { apps: [] }, noticeQueue: queue,
      apps: { build: current, inPanel: false }, decideApp() {}, composeApp: () => true };
  };
  const dock = (current) => text(renderToStaticMarkup(React.createElement(DockBuild, { core: core(current), onLeave() {} })));
  const ready = dock(build("ready"));
  assert.ok(ready.startsWith("✦ Loud Silly Tune · Plays a silly tune when voices stay loud."), ready);
  for (const block of ["When Loud voices for 3 seconds", "Then Play a silly tune", "Then Show a card"]) assert.ok(ready.includes(block), block);
  assert.ok(!ready.includes("light tune"), "the loud app's tune is the silly one");
  assert.ok(ready.indexOf("Keep app") > 0 && ready.indexOf("Keep app") < ready.indexOf("Discard"), "Keep, then Discard");
  assert.ok(dock(build("kept", { message: "Your app is on." })).includes("✓ Loud Silly Tune · Your app is on."), "kept");

  // The readings: the loudness (RMS) of four 80 ms frames of 16-bit audio, so a voice's syllables and the gaps between
  // them count together; nothing for fewer; a fresh count after each, and after the mic stops.
  const readings = [];
  const meter = volumeReporter((level) => readings.push(level));
  const frame = (amplitude) => Int16Array.from({ length: 1920 }, (_, i) => Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 200 * i) / 24000))).buffer;
  for (let i = 0; i < 3; i++) meter.feed(frame(0.2));
  assert.equal(readings.length, 0, "three frames: no reading yet");
  meter.feed(frame(0.2));
  assert.equal(readings.length, 1, "the fourth: one reading");
  assert.ok(Math.abs(readings[0] - 0.2 / Math.SQRT2) < 0.002, `a steady tone reads as its RMS: ${readings[0]}`);
  // A loud syllable and three quiet frames read between them, not as the loud one alone.
  for (const a of [0.4, 0.05, 0.05, 0.05]) meter.feed(frame(a));
  const mixed = Math.sqrt((0.4 ** 2 + 3 * 0.05 ** 2) / 8);
  assert.ok(Math.abs(readings[1] - mixed) < 0.002, `four frames together: ${readings[1]} vs ${mixed}`);
  meter.feed(frame(0.3));
  meter.reset();
  for (let i = 0; i < 3; i++) meter.feed(frame(0.3));
  assert.equal(readings.length, 2, "after a reset the count starts over");
  meter.feed(new ArrayBuffer(0));
  assert.equal(readings.length, 2, "an empty frame counts for nothing");
  console.log("loud-app-check: ok (the loud app in the dock, its blocks and Keep; synthetic loudness readings; opt-in calibration starts disabled)");
} finally {
  await server.close();
}
