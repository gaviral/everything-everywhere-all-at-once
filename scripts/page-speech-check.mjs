// No audio or live core: exercise the page's speech handling with a recording SpeechSynthesis stand-in.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

const server = await uiServer();
try {
  const { hearPageSpeech: hear, stopPageSpeech: stop } = await server.ssrLoadModule("/src/page-speech.ts");
  const spoken = [];
  let cancelled = 0;
  globalThis.window = { speechSynthesis: {
    cancel: () => cancelled++, speak: (utterance) => spoken.push(utterance),
    getVoices: () => [{ name: "Samantha", lang: "en-US" }],
  } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const send = (msg) => hear(JSON.stringify(msg));
  const caption = { type: "guide", kind: "caption", text: "This is a reply.", by: "Claude" };
  send(caption);
  send({ ...caption, kind: "hold", speak: true });
  send({ type: "snapshot", world: { thoughts: [{ text: "Old reply", speak: true }] } });
  assert.equal(spoken.length, 0, "unflagged, held, and replayed words stay silent");
  send({ ...caption, speak: true });
  assert.equal(spoken[0].text, caption.text);
  assert.equal(spoken[0].voice.name, "Samantha");
  send({ type: "change", speak: true, change: { type: "thought_added", thought: { text: "A thought on the map." } } });
  assert.equal(spoken[1].text, "A thought on the map.");
  assert.equal(cancelled, 1, "a newer reply replaces the old one");
  spoken[0].onend(); // A cancelled utterance can finish after its replacement started.
  send({ type: "call", people: [{ ai: true, speaking: true }, { ai: false, remote: true, speaking: true }] });
  assert.equal(cancelled, 1, "AI and remote activity do not barge in");
  send({ type: "call", people: [{ name: "avi2", ai: false, speaking: true }] });
  assert.equal(cancelled, 2, "a room guest stops playback");
  send({ type: "call", people: [{ name: "avi2", ai: false, speaking: true }] });
  assert.equal(cancelled, 2, "no speech remains queued");
  send({ ...caption, speak: true });
  send({ type: "partial", text: "Let me interrupt" });
  assert.equal(cancelled, 3, "local ASR also stops speech when alone");
  send({ ...caption, speak: true });
  stop();
  assert.equal(cancelled, 4, "disconnect cancels page speech");
  hear("invalid JSON");
  delete window.speechSynthesis;
  send({ ...caption, speak: true });
  console.log("page speech checks passed (live flags, replacement, guest barge-in, local partials, disconnect)");
} finally {
  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
  await server.close();
}
