// No extra dependencies: run with `node scripts/apps-check.mjs`.
// The demo's app beats. "Make an app that shows a card when I mention the demo", said aloud, builds in the dock and
// not in the Apps panel: its steps while it works, then the app with Keep and Discard (DockBuild in ui/src/Apps.tsx,
// panelBuildFor in apps-core.ts). And loud voices' AppsSound plays the silly tune in the browser (useApps in
// apps-core.ts, apps-audio.ts), with the Web Audio API stubbed. Components render with React's server renderer: what
// they show, not how it moves.
import assert from "node:assert/strict";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// A page's sound starts suspended until a click, tap or key press resumes it; every note started is kept here.
const started = [];
const param = () => ({ value: 0, ramps: [], setValueAtTime(value) { this.value = value; },
  linearRampToValueAtTime(value) { this.ramps.push(value); }, exponentialRampToValueAtTime(value) { this.ramps.push(value); } });
globalThis.AudioContext = class {
  state = "suspended";
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve().then(() => { this.state = "running"; }); }
  createGain() { return { gain: param(), connect: (to) => to, disconnect() {} }; }
  createOscillator() {
    const note = { type: "sine", frequency: param(), connect: (to) => to, disconnect() {},
      start(at) { note.at = at; started.push(note); }, stop(at) { note.until = at; } };
    return note;
  }
};
// The pitch a note ends on, and the notes of a tune (not the slide whistle's wobble, which shakes another's pitch).
const pitch = (note) => note.frequency.ramps.at(-1) ?? note.frequency.value;
const notes = () => started.filter((note) => pitch(note) > 100);

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { DockBuild, DockTune, Apps } = await server.ssrLoadModule("/src/Apps.tsx");
  const { useApps, panelBuildFor } = await server.ssrLoadModule("/src/apps-core.ts");
  const { unlockTune } = await server.ssrLoadModule("/src/apps-audio.ts");
  const render = (component, props) => ReactDOMServer.renderToStaticMarkup(React.createElement(component, props));
  const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Said aloud: the core drops "make an app that" and builds the rest, step by step (core/src/apps.rs `progress`).
  const request = "shows a card when I mention the demo";
  const steps = ["Checking existing apps", "Choosing blocks for your app", "Checking the watcher, prompt and publishers",
    "Ready to keep. It starts when you keep it."];
  const draft = { id: "app-demo", name: "Demo Mention Card", purpose: "Shows a card when you mention the demo.",
    watcher: { kind: "topic", topic: "the demo" }, prompt: null, publishers: [{ kind: "card", text: "You mentioned the demo." }],
    enabled: false, request, cooldown_secs: 60, created_ms: 0, last_run_ms: 0 };
  const build = (stage, count, extra = {}) => ({ id: "build-1", request, stage, steps: steps.slice(0, count), draft: null,
    match_id: null, message: "", instead: "", ...extra });
  const core = (current, inPanel = false, soundPending = null, played = null) => ({ connected: true, snapshotRevision: 1, world: { apps: [] },
    apps: { build: current, inPanel, soundPending, played, askedInPanel() {}, clearSound() {}, setPlayed() {} },
    decideApp() {}, composeApp: () => true, showNotice() {}, toggleApp() {}, removeApp() {}, appOutput() {} });
  // The dock's card as it shows on screen (without the screen reader's status line, which repeats some of it).
  const dockHtml = (current, inPanel = false) => render(DockBuild, { core: core(current, inPanel), onLeave() {} })
    .replace(/<div class="sr-only" role="status">.*?<\/div>/, "");
  const dock = (current, inPanel = false) => text(dockHtml(current, inPanel));
  // Its steps: "✓" on each done one, the spinner ("…") on the one running now.
  const shownSteps = (html) => [...(html.match(/<ol class="apps-progress"[^>]*>(.*?)<\/ol>/)?.[1] ?? "").matchAll(/<li[^>]*>(.*?)<\/li>/g)]
    .map(([, li]) => (li.includes("apps-spinner") ? "… " : "") + text(li));

  // A build that wasn't asked for in the panel's own form shows in the dock; the panel keeps only its own.
  assert.equal(panelBuildFor(build("searching", 1), null, null), null, "said aloud: the dock's");
  assert.equal(panelBuildFor(build("searching", 1), "Make an app that shows a card when I mention the demo", null), "build-1",
    "typed in the panel: the panel's");
  assert.equal(panelBuildFor(build("composing", 2), null, "build-1"), "build-1", "sent again after a reconnect: stays put");
  assert.equal(panelBuildFor({ ...build("searching", 1), id: "build-2" }, null, "build-1"), null, "the next one said aloud: the dock's");

  // In the dock, what it's making and its steps while it works.
  for (const [stage, count] of [["searching", 1], ["composing", 2], ["validating", 3]]) {
    const html = dockHtml(build(stage, count));
    assert.ok(text(html).includes(`Making an app: “${request}”`), `${stage}: says what it's making`);
    assert.deepEqual(shownSteps(html), steps.slice(0, count).map((step, i) => (i < count - 1 ? `✓ ${step}` : `… ${step}`)), `${stage}: its steps`);
    assert.ok(!text(html).includes("Keep app"), `${stage}: nothing to keep yet`);
  }
  // Then the app in a line, its blocks, and Keep or Discard.
  const ready = dock(build("ready", 4, { draft, message: steps[3] }));
  assert.ok(ready.includes("Demo Mention Card · Shows a card when you mention the demo."), "the app, named");
  assert.ok(ready.includes("When Talking about the demo") && ready.includes("Then Show a card"), "its blocks");
  assert.ok(ready.indexOf("Keep app") >= 0 && ready.indexOf("Keep app") < ready.indexOf("Discard"), "Keep, then Discard");
  // Kept: it says so, and nothing is left to decide.
  const kept = dock(build("kept", 4, { draft, message: "Your app is on." }));
  assert.ok(kept.includes("Demo Mention Card · Your app is on.") && !kept.includes("Keep app"), "kept");
  // The panel's own build doesn't show in the dock.
  assert.ok(!dock(build("ready", 4, { draft }), true).includes("Keep app"), "a panel build stays out of the dock");

  // The tune. The hook's `receive` is what core.ts hands every message to: kept from a server render, it runs as it
  // would in the page (the server renderer drops its state updates, which only the card below needs).
  let apps;
  render(function Window() { apps = useApps(); return null; });
  const loud = { type: "apps_sound", name: "Loud Silly Tune", playful: true };
  // Before the page's first click the browser won't play: nothing starts, and the card offers it instead.
  assert.equal(apps.receive(loud), true);
  assert.equal(notes().length, 0, "no sound before a click");
  const why = "voices stayed loud for 3 s";
  const card = text(render(Apps, { core: core(null, false, { name: "Loud Silly Tune", playful: true, why }) }));
  assert.ok(card.includes(`Loud Silly Tune has a silly tune for you: ${why}.`) && card.includes("Play tune"), "the card offers it, and why");
  // Played: the dock says which app played it and why (the core's `why`, from the watcher that fired), so a tune out
  // of nowhere doesn't read as a glitch on camera.
  const tuneHtml = render(DockTune, { core: core(null, false, null, { name: "Loud Silly Tune", why, id: 1 }) });
  assert.ok(tuneHtml.includes('role="status"') && text(tuneHtml).replace(" :", ":") === `♪ Loud Silly Tune: ${why}`, tuneHtml);
  assert.equal(render(DockTune, { core: core(null) }), "", "nothing played: no line");
  // The first click, tap or key press lets the page play (useApps listens for it); then the message plays the silly
  // tune: three quick hops up and a sliding whistle, done in under a second.
  unlockTune();
  await Promise.resolve();
  assert.equal(apps.receive(loud), true);
  assert.deepEqual(notes().map((note) => [note.type, pitch(note)]),
    [["triangle", 523.25], ["triangle", 659.25], ["triangle", 783.99], ["triangle", 1567.98]], "the silly tune");
  assert.ok(started.every((note) => note.until < 1), "under a second");
  // Any other app's tune is the calm chime.
  started.length = 0;
  apps.receive({ type: "apps_sound", name: "Demo Mention Card", playful: false });
  assert.deepEqual(notes().map((note) => [note.type, pitch(note)]), [["sine", 523.25], ["sine", 659.25], ["sine", 783.99]], "the calm one");
  console.log("apps-check: ok");
} finally {
  await server.close();
}
