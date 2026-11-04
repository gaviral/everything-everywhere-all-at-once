// Real Chrome, fake speech and capture devices: no voice service or audio hardware needed.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready } from "./headless.mjs";

if (ready()) { console.log(`SKIP page-speech-check: ${ready()}`); process.exit(3); }
const server = await uiServer({
  plugins: [{ name: "speech-check", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/speech-check") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><button class="guide-caption"><span>Partner says</span></button><button id="elsewhere">Elsewhere</button><textarea></textarea>');
    });
  } }],
}, { port: Number(process.env.SPEECH_CHECK_PORT ?? 4620) });
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
    const installed = [
      { name: "French Premium", lang: "fr-FR", default: true },
      { name: "Samantha", lang: "en-US", default: true },
      { name: "English Enhanced", lang: "en-GB" },
      { name: "English Premium", lang: "en-US" },
    ];
    window.voices = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: Object.assign(new EventTarget(), {
      getVoices: () => voices, cancel: () => cancelled++,
      speak: u => { if (window.throwSpeech) throw Error("voice failed"); spoken.push(u); u.onstart?.(); },
    }) });
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
    window.NativeWorkletNode = window.AudioWorkletNode;
    class Node { constructor() { this.port = { postMessage: state => { this.capture = state; }, close() {} }; } connect(next) { return next; } disconnect() {} }
    window.AudioContext = class {
      state = "running"; sampleRate = 24000; destination = {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() { return new Node(); }
      createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
      close() { this.state = "closed"; return Promise.resolve(); }
    };
    window.AudioWorkletNode = class extends Node { constructor() { super(); window.writer = this; } };
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: true } });
    window.echoProtected = true;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {}, getSettings: () => ({ echoCancellation: echoProtected }) }] }),
    } });
    window.mic = await import("/src/mic.ts");
    window.stopMic = await mic.startMic(frame => { window.samples = [...new Int16Array(frame)]; });
    window.frameIs = (value, generation = writer.capture.generation) => {
      writer.port.onmessage({ data: { frame: new Int16Array([123, -456]).buffer, generation } });
      return samples.join() === value;
    };
    check(frameIs("123,-456"), "mic starts with real samples");
    send({ ...caption, speak: false });
    send({ ...caption, kind: "hold" });
    send({ type: "snapshot", world: { thoughts: [{ text: "Old reply", speak: true }] } });
    check(spoken.length === 0, "unflagged, held and replayed words stay silent");
    send({ type: "snapshot", world: { captions: [{ id: "old-caption", by: "Helper" }] } });
    send({ ...caption, caption: { id: "old-caption", by: "Helper" } });
    check(spoken.length === 0, "caption already restored by a snapshot cannot speak from a queued live relay");
    send(caption);
    check(spoken.length === 0 && logs.length === 0, "empty asynchronous list never uses an unspecified voice");
    check(frameIs("0,0"), "waiting for voices keeps capture paused");
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken.length === 0, "another empty voice event still waits");
    voices = installed;
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken[0].voice.name === "English Premium", "Premium English wins over default and Enhanced");
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken.length === 1, "voice events cannot replay the reply");
    check(spoken[0].rate > 1 && spoken[0].rate < 1.2, "slightly faster listening rate");
    check(frameIs("0,0"), "all mic samples are silent during speech");
    const beforeEnd = writer.capture.generation;
    spoken[0].onend();
    check(frameIs("0,0", beforeEnd), "speech frame delivered after end stays silent");
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
    send({ type: "change", change: { type: "thought_added", thought: { text: "An older Comment.", thread_id: "N1" } } });
    send({ type: "change", speak: true, change: { type: "thought_added", thought: { text: "The new Comment.", thread_id: "N1" } } });
    check(spoken.at(-1).text === "The new Comment.", "only the flagged new Comment speaks");
    old.onstart(); old.onend(); old.onerror();
    check(speech.pageSpeaking() && frameIs("0,0"), "late events cannot unpause replacement speech");
    send({ type: "call", people: [{ ai: true, speaking: true }, { ai: false, remote: true, speaking: true }] });
    check(speech.pageSpeaking(), "AI and remote activity do not cut off playback");
    const beforeCut = writer.capture.generation;
    send({ type: "call", people: [{ ai: false, speaking: true }] });
    check(frameIs("0,0", beforeCut), "speech frame delivered after cut-off stays silent");
    check(!speech.pageSpeaking() && frameIs("123,-456"), "a room guest cuts off playback");
    send(caption); send({ type: "partial", text: "Let me interrupt" });
    check(!speech.pageSpeaking(), "a local partial cuts off playback");
    send(caption); speech.stopPageSpeech();
    const count = cancelled;
    speech.stopPageSpeech();
    check(cancelled === count && frameIs("123,-456"), "disconnect cancels once and releases mic");
    const countBeforeIdentified = spoken.length;
    send({ ...caption, caption: { id: "new-caption", by: "Helper" } });
    send({ ...caption, caption: { id: "new-caption", by: "Helper" } });
    check(spoken.length === countBeforeIdentified + 1, "duplicate live caption identity speaks once");
    speech.stopPageSpeech();
    window.throwSpeech = true; send(caption); window.throwSpeech = false;
    check(!speech.pageSpeaking() && frameIs("123,-456"), "synchronous speech failure releases mic");
    check(logs.length === 1 && logs[0].includes("English Premium"), "chosen voice is logged once");
    voices = [];
    const beforeWait = spoken.length;
    send(caption); speech.stopPageSpeech(); voices = installed;
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken.length === beforeWait && !speech.pageSpeaking(), "cancelled pending speech never plays when voices arrive");
    voices = []; send(caption); send({ ...caption, text: "The replacement reply." });
    voices = installed; speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken.length === beforeWait + 1 && spoken.at(-1).text === "The replacement reply.", "only the latest waiting reply plays");
    speech.stopPageSpeech();
    voices = [{ name: "French installed", lang: "fr-FR", default: true }]; send(caption);
    check(spoken.at(-1).voice.name === "French installed", "an installed voice is explicit even without English");
    speech.stopPageSpeech(); voices = installed;
    speech.hearPageSpeech("invalid JSON");
    window.features = await import("/src/shell/features.ts");
    const reply = { type: "command_reply", speak: true, text: "Back to Workshop: We still need to" };
    const beforeCommands = spoken.length;
    send(reply);
    check(spoken.length === beforeCommands && !speech.pageSpeaking(), "command speech defaults off");
    send(caption);
    check(!writer.capture.bargeIn, "local detection defaults off with the partner setting");
    writer.port.onmessage({ data: { type: "barge", generation: writer.capture.generation } });
    check(speech.pageSpeaking(), "disabled local evidence cannot interrupt legacy speech");
    features.switchBuiltIn("partner", true);
    check(writer.capture.bargeIn, "the same setting arms local detection during started playback");
    const detectionGeneration = writer.capture.generation;
    writer.port.onmessage({ data: { type: "barge", generation: detectionGeneration - 1 } });
    check(speech.pageSpeaking(), "stale local evidence cannot interrupt a replacement");
    const beforeBarge = cancelled;
    writer.port.onmessage({ data: { type: "barge", generation: detectionGeneration } });
    check(!speech.pageSpeaking() && cancelled === beforeBarge + 1, "current local detection cancels browser speech once");
    check(writer.capture.resumeBarge === detectionGeneration && !writer.capture.muted, "only the accepted generation can release its buffered onset");
    writer.port.onmessage({ data: { type: "barge", generation: detectionGeneration } });
    check(cancelled === beforeBarge + 1, "duplicate evidence cannot cancel again");
    send(caption); const beforeOptOut = writer.capture.generation;
    features.switchBuiltIn("partner", false);
    check(!writer.capture.bargeIn && writer.capture.generation !== beforeOptOut, "opt-out immediately disarms and invalidates queued detection");
    writer.port.onmessage({ data: { type: "barge", generation: beforeOptOut } });
    check(speech.pageSpeaking(), "queued evidence after opt-out is ignored");
    speech.stopPageSpeech(); features.switchBuiltIn("partner", true);
    voices = []; send(caption);
    check(!writer.capture.bargeIn, "waiting for a voice never learns silence as a playback residual");
    voices = installed; speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(writer.capture.bargeIn, "voice start arms a fresh playback calibration");
    speech.stopPageSpeech();
    const beforeQuiet = spoken.length;
    send({ ...reply, speak: false });
    send({ type: "notice", speak: true, message: "Routine notification" });
    check(spoken.length === beforeQuiet, "unflagged commands and ordinary notices stay silent");
    voices = installed; send(reply);
    check(spoken.at(-1).text === reply.text, "opted-in command uses shared speech channel");
    speech.stopPageSpeech(); features.switchBuiltIn("partner", false);
    const beforeDisabled = spoken.length; send(reply);
    check(spoken.length === beforeDisabled, "disabled window rejects late command speech");

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

  // Voices arriving near the loading deadline still earn the reply's full speaking time.
  await evaluate(`(async () => {
    const installed = voices;
    voices = []; send(caption);
    await new Promise(resolve => setTimeout(resolve, shortDelay * 3 / 4));
    check(speech.pageSpeaking(), "reply is still waiting near the loading deadline");
    const count = spoken.length;
    voices = installed; speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    check(spoken.length === count + 1, "late voices start the waiting reply");
    window.playbackStarted = performance.now();
    await new Promise(resolve => setTimeout(resolve, shortDelay * 0.9));
    check(speech.pageSpeaking() && frameIs("0,0"), "late voice keeps its speaking time and mic pause past the old deadline");
  })()`);
  assert.ok(await until("!speech.pageSpeaking()", delay + 1500), "late voice still has a bounded speaking time");
  assert.equal(await evaluate('performance.now() - playbackStarted >= shortDelay && frameIs("123,-456")'), true, "full speaking time elapses before capture resumes");
  await evaluate('voices = []; window.beforeTimeout = spoken.length; send(caption)');
  assert.ok(await until("!speech.pageSpeaking()", delay + 1500), "missing voice list releases the mic within the text-based limit");
  await evaluate('voices = [{ name: "Late voice", lang: "en-US" }]; speechSynthesis.dispatchEvent(new Event("voiceschanged")); check(spoken.length === beforeTimeout, "voice loading timeout cannot play later")');
  await evaluate('stopMic(); check(writer.port.onmessage === null, "capture cleanup still works")');

  // Chrome's real audio thread: speech ends inside the worklet's first buffered frame.
  await evaluate(`(async () => {
    for (const rate of [24000, 44100, 48000]) {
      const context = new OfflineAudioContext(1, rate, rate);
      await context.audioWorklet.addModule("/pcm-worklet.js");
      const writer = new NativeWorkletNode(context, "pcm-writer");
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, rate, rate);
      source.buffer.getChannelData(0).fill(0.5, 0, 512);
      source.connect(writer).connect(context.destination); source.start();
      const frames = [];
      const received = new Promise(resolve => { writer.port.onmessage = ({ data }) => {
        frames.push(new Int16Array(data.frame));
        if (data.generation === 2) resolve();
      }; });
      const paused = context.suspend(256 / rate), resumed = context.suspend(512 / rate);
      const rendered = context.startRendering();
      await paused; writer.port.postMessage({ muted: true, generation: 1 }); await context.resume();
      await resumed; writer.port.postMessage({ muted: false, generation: 2 }); await context.resume();
      await rendered; await received;
      check(frames.length > 0 && frames.every(f => f.every(s => s === 0)), rate + ": Chrome clears buffered speech and the filter tail");
      writer.disconnect(); writer.port.close();
    }
  })()`);
  // End to end: native worklet evidence -> real mic.ts callback -> fake TTS cancellation -> native onset release.
  // Offline sources only; the silent worklet output never reaches real speakers.
  await evaluate(`(async () => {
    features.switchBuiltIn("partner", true);
    // Offline rendering can outrun queued state messages. Add a test-only acknowledgement to the unchanged
    // state handler and wait for it before starting the source, so 40 ms means 40 ms of armed capture.
    const workletSource = await (await fetch("/pcm-worklet.js")).text();
    const marker = "this.resetProbe();\\n      // Normal end";
    check(workletSource.includes(marker), "state readiness instrumentation matches the worklet");
    const workletURL = URL.createObjectURL(new Blob([workletSource.replace(marker,
      "this.resetProbe(); this.port.postMessage({ type: 'state-ready', generation: this.generation });\\n      // Normal end")], { type: "text/javascript" }));
    try {
      for (const rate of [24000, 44100, 48000]) for (const scenario of ["normal", "early", "very-early", "pause", "variable-echo"]) {
        const context = new OfflineAudioContext(1, Math.round(rate * 1.2), rate);
        await context.audioWorklet.addModule(workletURL);
        const native = new NativeWorkletNode(context, "pcm-writer");
        const captured = [], events = [];
        const stop = await mic.startMic(frame => captured.push([...new Int16Array(frame)]));
        const bridge = writer;
        bridge.port.postMessage = state => { bridge.capture = state; native.port.postMessage(state); };
        let acknowledge;
        const armed = new Promise(resolve => { acknowledge = resolve; });
        native.port.onmessage = ({ data }) => {
          if (data.type === "state-ready") {
            if (data.generation === bridge.capture.generation) acknowledge();
            return;
          }
          events.push(data); bridge.port.onmessage?.({ data });
        };
        native.port.postMessage(bridge.capture);
        send(caption);
        let armTimeout;
        try {
          await Promise.race([armed, new Promise((_, reject) => {
            armTimeout = setTimeout(() => reject(Error("worklet state not ready")), 1000);
          })]);
        } finally { clearTimeout(armTimeout); }
        const playbackGeneration = bridge.capture.generation;
        const before = cancelled;
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, Math.round(rate * 1.2), rate);
        const input = source.buffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          const t = i / rate;
          const quiet = t < (scenario === "very-early" ? 0.04 : scenario === "early" ? 0.10 : scenario === "variable-echo" ? 0.30 : 0.48)
            || (scenario === "pause" && t >= 0.60 && t < 0.68);
          input[i] = (quiet ? 0.004 : scenario === "variable-echo" ? 0.025 : 0.12) * Math.sin(2 * Math.PI * 600 * t);
        }
        source.connect(native).connect(context.destination); source.start();
        const paused = context.suspend(scenario.includes("early") ? 0.45 : scenario === "pause" ? 0.90 : 0.70);
        const rendered = context.startRendering();
        await paused;
        if (scenario === "variable-echo") {
          await context.resume(); await rendered;
          for (let n = 0; n < 100 && captured.length < 15; n++) await new Promise(resolve => setTimeout(resolve, 10));
          check(captured.length >= 15, rate + ": variable echo was processed");
          check(speech.pageSpeaking() && cancelled === before, rate + ": variable echo cannot cancel playback");
          check(events.every(e => e.type !== "barge"), rate + ": variable echo creates no evidence");
          check(captured.every(f => f.every(s => s === 0)), rate + ": variable echo stays out of ASR");
          speech.stopPageSpeech(); stop(); native.disconnect(); native.port.close();
          continue;
        }
        for (let n = 0; n < 100 && speech.pageSpeaking(); n++) await new Promise(resolve => setTimeout(resolve, 10));
        check(!speech.pageSpeaking() && cancelled === before + 1, rate + "/" + scenario + ": local PCM cancels spoken reply; "
          + JSON.stringify({ barges: events.filter(e => e.type === "barge"), frames: captured.length, state: bridge.capture }));
        check(bridge.capture.resumeBarge === playbackGeneration, rate + ": mic acknowledges only this reply");
        check(captured.length > 0 && captured.every(f => f.every(s => s === 0)), rate + ": ASR stays silent before acknowledgement");
        await context.resume(); await rendered;
        for (let n = 0; n < 100 && captured.filter(f => f.some(s => s !== 0)).length < 8; n++) await new Promise(resolve => setTimeout(resolve, 10));
        const audible = captured.filter(f => f.some(s => s !== 0));
        check(audible.length >= 8, rate + ": onset and continuous correction reach ASR");
        const onset = audible.flat().findIndex(s => Math.abs(s) > 1500);
        check(onset >= 0 && onset <= 960, rate + ": first speech onset is preserved with short preroll");
        check(events.filter(e => e.type === "barge").length === 1, rate + ": single local interruption");
        stop(); native.disconnect(); native.port.close();
      }
    } finally { URL.revokeObjectURL(workletURL); }
    window.echoProtected = false;
    const stop = await mic.startMic(() => {});
    send(caption);
    check(!writer.capture.bargeIn, "explicit AEC refusal retains hard mute");
    speech.stopPageSpeech(); stop(); window.echoProtected = true;
    const abort = new AbortController();
    await mic.startMic(() => {}, undefined, abort.signal);
    send(caption); const abandoned = writer;
    abort.abort();
    check(abandoned.port.onmessage === null, "abort detaches queued local evidence");
    speech.stopPageSpeech(); features.switchBuiltIn("partner", false);
  })()`);
  console.log(`page speech checks passed in headless Chrome on :${port} (local interruption opt-in and generation handshake; async voices, late frames, real worklet at 24/44.1/48 kHz, cancellation and cleanup)`);
} finally {
  await browser?.close();
  await server.close();
}
