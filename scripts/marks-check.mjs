// No extra dependencies: run with `node scripts/marks-check.mjs`.
// Every mark explains itself and every mic state is its own: the mic's state rules, its ring scale, the words each
// state shows, and a scan that fails when a ✦ in the UI has no tip.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const src = new URL("../ui/src/", import.meta.url);
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { micState, MIC_WORDS, composerHint, ringFill } = await server.ssrLoadModule("/src/MicButton.tsx");
  const { TIPS, follow } = await server.ssrLoadModule("/src/Tips.tsx");
  const { AWAY_AFTER_MS, AWAY_WHAT, AWAY_WHEN } = await server.ssrLoadModule("/src/Away.tsx");

  // A microphone that goes away on its own (its track ends: unplugged, switched off) is said at once, once; one we
  // stop ourselves never is (bug hunt 20: the window showed "Listening" to nothing).
  const { startMic } = await server.ssrLoadModule("/src/mic.ts");
  const fakeTrack = () => Object.assign(new EventTarget(), { stop() {} });
  let track;
  const audioNode = () => ({ connect: (next) => next, disconnect() {} });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    track = fakeTrack();
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } } });
  globalThis.window ??= globalThis;
  globalThis.AudioWorkletNode = class { port = {}; connect(next) { return next; } disconnect() {} };
  globalThis.AudioContext = class { sampleRate = 24000; audioWorklet = { addModule: async () => {} }; destination = {};
    createMediaStreamSource() { return audioNode(); } createGain() { return { gain: { value: 1 }, ...audioNode() }; } close() {} };
  let lost = 0;
  const stopMic = await startMic(() => {}, () => lost++);
  track.dispatchEvent(new Event("ended"));
  track.dispatchEvent(new Event("ended"));
  assert.equal(lost, 1, "a track that ends on its own is said once");
  stopMic();
  const stopAgain = await startMic(() => {}, () => lost++);
  stopAgain();
  track.dispatchEvent(new Event("ended"));
  assert.equal(lost, 1, "after our own stop, nothing is said");
  assert.match(readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8"), /startMic\(core\.sendAudio, \(\) => \{\s*if \(liveStop\.current !== stop\) return;\s*releaseMic\(\);/);

  // Escape that hides a tip hides only the tip: heard before the document's listener (App.tsx folds the quiet threads
  // on Escape there), and stopped unless typed in a field (bug hunt 18).
  const tipsSource = readFileSync(new URL("../ui/src/Tips.tsx", import.meta.url), "utf8");
  assert.match(tipsSource, /window\.addEventListener\("keydown", key, true\)/);
  assert.match(tipsSource, /if \(event\.key !== "Escape" \|\| !current\.current\) return;\s*hide\(\);[^]*?if \(!typing\) event\.stopPropagation\(\);/);

  const base = { connected: true, capturing: false, starting: false, serviceOn: false, words: false, paused: false, noKey: false, refused: false };
  const state = (extra) => micState({ ...base, ...extra });
  assert.equal(state({}), "off");
  assert.equal(state({ starting: true }), "starting");
  assert.equal(state({ capturing: true }), "starting", "capturing before the speech service says it listens");
  assert.equal(state({ capturing: true, serviceOn: true }), "listening");
  assert.equal(state({ capturing: true, serviceOn: true, words: true }), "hearing");
  assert.equal(state({ paused: true }), "paused");
  assert.equal(state({ noKey: true }), "nokey");
  assert.equal(state({ noKey: true, refused: true }), "refused");
  assert.equal(state({ connected: false }), "offline");
  // Never "off" (or paused, or keyless) while the browser is taking sound, whatever else is true.
  for (const connected of [true, false]) for (const noKey of [true, false]) for (const paused of [true, false]) for (const serviceOn of [true, false]) {
    assert.ok(["starting", "listening", "hearing"].includes(state({ capturing: true, connected, noKey, paused, serviceOn })));
  }
  // Each state has its own words, and its own placeholder where one shows.
  const states = Object.keys(MIC_WORDS);
  assert.equal(states.length, 8);
  assert.equal(new Set(states.map((s) => MIC_WORDS[s].tip)).size, states.length, "every state's tip differs");
  assert.equal(new Set(states.map((s) => MIC_WORDS[s].label)).size, states.length, "every state's name differs");
  for (const s of ["off", "starting", "paused", "nokey", "refused", "offline"]) assert.notEqual(composerHint(s), composerHint("listening"), s);
  assert.equal(composerHint("listening"), composerHint("hearing"), "words in the strip already say you're heard");
  assert.match(MIC_WORDS.nokey.tip, /MODEL_API_KEY/);
  // The ring: silent rooms leave it thin, the three measured voices fill most of it, a shout fills it.
  assert.equal(ringFill(0), 0);
  assert.equal(ringFill(0.01), 0);
  assert.ok(ringFill(0.075) > 0.7 && ringFill(0.075) < 0.8, `normal speech ${ringFill(0.075)}`);
  assert.ok(ringFill(0.1) > ringFill(0.075) && ringFill(0.1) < 1);
  assert.equal(ringFill(0.15), 1);
  assert.equal(ringFill(0.5), 1);
  assert.equal(ringFill(NaN), 0);

  // Every tip says something, and the ✦ ones name a way back where there is one.
  for (const [name, tip] of Object.entries(TIPS)) {
    const text = typeof tip === "function" ? tip("Reminders") : tip;
    assert.ok(text.length > 10 && text.length <= 120, `${name}: ${text.length} chars`);
  }
  assert.match(TIPS.suggestion, /×/);
  assert.match(TIPS.action("Calendar"), /Add to Calendar/);

  // A kept suggestion has no Keep or × left, so its tip names neither; the map picks the tip by status.
  assert.doesNotMatch(TIPS.kept, /Keep saves|×/);
  assert.match(TIPS.kept, /no undo/);
  assert.match(readFileSync(new URL("App.tsx", src), "utf8"), /s\.status === "kept" \? TIPS\.kept : TIPS\.suggestion/);

  // An open tip follows its mark: new words replace the old (the mic just stopped), and a mark that loses its words
  // (a kept tag) or leaves the page takes the tip with it.
  const el = { isConnected: true, dataset: { tip: MIC_WORDS.listening.tip } };
  const open = { text: MIC_WORDS.listening.tip, el };
  assert.equal(follow(open), open, "unchanged words keep the same tip");
  el.dataset.tip = MIC_WORDS.off.tip;
  assert.equal(follow(open)?.text, MIC_WORDS.off.tip, "stopping the mic updates its open tip");
  assert.equal(follow(open)?.el, el);
  el.dataset.tip = undefined;
  assert.equal(follow(open), null, "a mark that loses its tip hides it");
  el.dataset.tip = TIPS.tag;
  el.isConnected = false;
  assert.equal(follow(open), null, "a mark that leaves the page hides it");

  // The away card's rule matches the code's.
  assert.match(AWAY_WHEN, new RegExp(`${AWAY_AFTER_MS / 1000} s`));
  assert.match(AWAY_WHAT, /thoughts landed/);

  // Every ✦ in the UI carries its tip on its own element, or sits in a control that explains it. Allowed without:
  // the ? list's legend, the tip texts themselves, a suggested tag's ✦ (its button has the tip) and "✦ fixed"
  // (its button turns into "heard … · undo" on hover and focus).
  const missing = [];
  for (const file of readdirSync(src).filter((name) => name.endsWith(".tsx"))) {
    if (["Symbols.tsx", "Tips.tsx"].includes(file)) continue;
    const text = readFileSync(new URL(file, src), "utf8");
    const lines = text.split("\n");
    for (let at = text.indexOf("✦"); at !== -1; at = text.indexOf("✦", at + 1)) {
      const i = text.slice(0, at).split("\n").length - 1;
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) continue;
      // The element the ✦ is in: its opening tag may run over several lines.
      const tag = text.slice(text.lastIndexOf("<", at), at);
      if (tag.includes("data-tip")) continue;
      if (/fixed|heard/.test(line)) continue;
      if (/!t\.kept/.test(line) && lines.slice(Math.max(0, i - 8), i).some((l) => l.includes("data-tip"))) continue;
      missing.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(missing, [], "a ✦ without a tip");
  console.log("Marks checks passed: mic states (never off while capturing), each with its own words and placeholder, the ring's scale, every tip, the away card's rule, open tips that follow their mark, and every ✦ in the UI has a tip.");
} finally {
  await server.close();
}
