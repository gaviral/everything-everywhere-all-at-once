// Real Chrome, fake speech and capture devices: no voice service or audio hardware needed.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";
import { openPage, ready } from "./headless.mjs";

if (ready()) { console.log(`SKIP page-speech-check: ${ready()}`); process.exit(3); }
const server = await createServer({
  root: new URL("../ui", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: Number(process.env.SPEECH_CHECK_PORT ?? 4620), strictPort: true, hmr: false, ws: false, watch: null },
  plugins: [{ name: "speech-check", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/speech-check") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><button class="guide-caption"><span>Claude says</span></button><button id="elsewhere">Elsewhere</button><textarea></textarea>');
    });
  } }],
});
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  assert.ok(port >= 4620, "use a spare port, away from the running apps");
  browser = await openPage(`http://127.0.0.1:${port}/speech-check`);
  const { evaluate, page, until } = browser;
  assert.ok(await until('!!document.querySelector(".guide-caption")'));
  await evaluate(`(async () => {
    window.spoken = []; window.cancelled = 0; window.logs = []; window.delays = [];
    window.voices = [
      { name: "French Premium", lang: "fr-FR", default: true },
      { name: "Samantha", lang: "en-US", default: true },
      { name: "English Enhanced", lang: "en-GB" },
      { name: "English Premium", lang: "en-US" },
    ];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => voices, cancel: () => cancelled++,
      speak: u => { if (window.throwSpeech) throw Error("voice failed"); spoken.push(u); },
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const info = console.info;
    console.info = (...args) => { logs.push(args.join(" ")); info(...args); };
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => { delays.push(ms); return timeout(fn, ms, ...args); };
    window.speech = await import("/src/page-speech.ts");
    window.send = msg => speech.hearPageSpeech(JSON.stringify(msg));
    window.caption = { type: "guide", kind: "caption", text: "This is a reply.", speak: true };
    window.check = (ok, why) => { if (!ok) throw Error(why); };

    // Exercise the real capture callback, with an identifiable non-silent PCM frame.
    class Node { constructor() { this.port = {}; } connect(next) { return next; } disconnect() {} }
    window.AudioContext = class {
      state = "running"; sampleRate = 24000; destination = {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() { return new Node(); }
      createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
      close() { this.state = "closed"; return Promise.resolve(); }
    };
    window.AudioWorkletNode = class extends Node { constructor() { super(); window.writer = this; } };
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: true } });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    } });
    window.mic = await import("/src/mic.ts");
    window.stopMic = await mic.startMic(frame => { window.samples = [...new Int16Array(frame)]; });
    window.frameIs = value => {
      writer.port.onmessage({ data: new Int16Array([123, -456]).buffer });
      return samples.join() === value;
    };
    check(frameIs("123,-456"), "mic starts with real samples");
    send({ ...caption, speak: false });
    send({ ...caption, kind: "hold" });
    send({ type: "snapshot", world: { thoughts: [{ text: "Old reply", speak: true }] } });
    check(spoken.length === 0, "unflagged, held and replayed words stay silent");
    send(caption);
    check(spoken[0].voice.name === "English Premium", "Premium English wins over default and Enhanced");
    check(spoken[0].rate > 1 && spoken[0].rate < 1.2, "slightly faster listening rate");
    check(frameIs("0,0"), "all mic samples are silent during speech");
    spoken[0].onend();
    check(frameIs("123,-456"), "end immediately restores the mic");
    voices = voices.filter(v => !v.name.includes("Premium"));
    send(caption);
    check(spoken.at(-1).voice.name === "English Enhanced", "Enhanced beats default");
    spoken.at(-1).onerror();
    check(!speech.pageSpeaking() && frameIs("123,-456"), "error immediately restores the mic");
    voices = [{ name: "English alternative", lang: "en-GB" }, { name: "English default", lang: "en-US", default: true }];
    send(caption);
    check(spoken.at(-1).voice.name === "English default", "default English wins within the remaining tier");
    const old = spoken.at(-1);
    send({ type: "change", speak: true, change: { type: "thought_added", thought: { text: "A thought on the map." } } });
    check(spoken.at(-1).text === "A thought on the map.", "a live thought speaks");
    old.onend(); old.onerror();
    check(speech.pageSpeaking() && frameIs("0,0"), "late events cannot unpause replacement speech");
    send({ type: "call", people: [{ ai: true, speaking: true }, { ai: false, remote: true, speaking: true }] });
    check(speech.pageSpeaking(), "AI and remote activity do not cut off playback");
    send({ type: "call", people: [{ ai: false, speaking: true }] });
    check(!speech.pageSpeaking() && frameIs("123,-456"), "a room guest cuts off playback");
    send(caption); send({ type: "partial", text: "Let me interrupt" });
    check(!speech.pageSpeaking(), "a local partial cuts off playback");
    send(caption); speech.stopPageSpeech();
    const count = cancelled;
    speech.stopPageSpeech();
    check(cancelled === count && frameIs("123,-456"), "disconnect cancels once and releases mic");
    window.throwSpeech = true; send(caption); window.throwSpeech = false;
    check(!speech.pageSpeaking() && frameIs("123,-456"), "synchronous speech failure releases mic");
    check(logs.length === 1 && logs[0].includes("English Premium"), "chosen voice is logged once");
    speech.hearPageSpeech("invalid JSON");
  })()`);

  // Real browser key and pointer events reach the same listeners as a person's input.
  for (const key of [" ", "Escape"]) {
    await evaluate("send(caption)");
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === " " ? "Space" : "Escape" });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === " " ? "Space" : "Escape" });
    assert.equal(await evaluate('!speech.pageSpeaking() && frameIs("123,-456")'), true, `${key}: cut-off restores mic`);
  }
  await evaluate('send(caption); document.querySelector("#elsewhere").click(); check(speech.pageSpeaking(), "other clicks leave speech alone")');
  const point = await evaluate('(() => { const r = document.querySelector(".guide-caption span").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
  await page("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  assert.equal(await evaluate('!speech.pageSpeaking() && frameIs("123,-456")'), true, "caption click restores mic");

  // Leave the real timer running: a longer reply earns more time, but missing end never holds the mic forever.
  await evaluate('send({ ...caption, text: caption.text.repeat(20) }); window.longDelay = delays.at(-1); speech.stopPageSpeech(); send(caption); window.shortDelay = delays.at(-1)');
  assert.equal(await evaluate("longDelay > shortDelay"), true, "deadline grows with the text");
  const delay = await evaluate("shortDelay");
  assert.ok(await until("!speech.pageSpeaking()", delay + 1500), "missing end is cancelled within the text-based limit");
  assert.equal(await evaluate('frameIs("123,-456")'), true, "missing end restores real mic samples");
  await evaluate('stopMic(); check(writer.port.onmessage === null, "capture cleanup still works")');
  console.log(`page speech checks passed in headless Chrome on :${port} (voice tiers, mic silence, end, error, no-end, replacement, Space, Esc, caption click)`);
} finally {
  await browser?.close();
  await server.close();
}
