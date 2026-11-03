// Live bridge replies play in this browser; its microphone sends silence until playback finishes.
// No snapshot playback: only an explicitly flagged caption or newly added AI thought speaks.
import { slowReadMs } from "./notice-rules";
import { NATURAL_PAUSE_MS } from "./legible";

type SpeechMessage = {
  type: string;
  speak?: boolean;
  kind?: string;
  text?: string;
  change?: { type: string; thought?: { text: string } };
  people?: { ai: boolean; remote?: boolean; speaking: boolean }[];
};

let utterance: SpeechSynthesisUtterance | null = null;
let cleanup: (() => void) | null = null;
let loggedVoice = false;
const speakingListeners = new Set<(speaking: boolean) => void>();

// Ask early: some browsers populate their installed voices asynchronously.
if (typeof window !== "undefined") window.speechSynthesis?.getVoices();

export const pageSpeaking = () => utterance !== null;

export function watchPageSpeech(listener: (speaking: boolean) => void): () => void {
  speakingListeners.add(listener);
  listener(pageSpeaking());
  return () => { speakingListeners.delete(listener); };
}

function finish() {
  utterance = null;
  cleanup?.();
  cleanup = null;
  speakingListeners.forEach((listener) => listener(false));
}

/** Disconnecting or a human taking the floor cuts off this page's reply, including queued speech. */
export function stopPageSpeech() {
  if (!utterance) return;
  finish();
  window.speechSynthesis.cancel();
}

/** Every human page hears the room socket, including a named guest or a Remote. */
export function hearPageSpeech(data: unknown) {
  if (typeof data !== "string" || typeof window === "undefined" || !window.speechSynthesis) return;
  let msg: SpeechMessage;
  try { msg = JSON.parse(data) as SpeechMessage; } catch { return; }
  if ((msg.type === "call" && msg.people?.some((p) => p.speaking && !p.ai && !p.remote))
      || (msg.type === "partial" && msg.text?.trim())) {
    stopPageSpeech();
    return;
  }
  if (!msg.speak) return;
  const text = msg.type === "guide" && msg.kind === "caption" ? msg.text
    : msg.type === "change" && msg.change?.type === "thought_added" ? msg.change.thought?.text : "";
  if (!text?.trim()) return;
  stopPageSpeech();
  const next = new SpeechSynthesisUtterance(text);
  // A little quicker than normal speech, without rushing the words while walking.
  next.rate = 1.12;
  next.onend = () => { if (utterance === next) finish(); };
  next.onerror = () => { if (utterance === next) stopPageSpeech(); };
  utterance = next;
  speakingListeners.forEach((listener) => listener(true));
  const synth = window.speechSynthesis;
  const speak = () => {
    if (utterance !== next) return;
    const installed = synth.getVoices();
    if (!installed.length) return; // Wait for voiceschanged; never let the browser pick an unspecified voice.
    synth.removeEventListener("voiceschanged", speak);
    const english = installed.filter((v) => /^en(?:[-_]|$)/i.test(v.lang));
    const quality = (v: SpeechSynthesisVoice) => /premium/i.test(v.name) ? 2 : /enhanced/i.test(v.name) ? 1 : 0;
    const voice = (english.length ? english : installed).slice()
      .sort((a, b) => quality(b) - quality(a) || Number(!!b.default) - Number(!!a.default))[0];
    next.voice = voice;
    next.lang = voice.lang;
    if (!loggedVoice) { console.info("Page voice:", voice.name); loggedVoice = true; }
    try { synth.speak(next); } catch { stopPageSpeech(); }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== " " && event.key !== "Escape") return;
    stopPageSpeech();
    if (event.key === " " && !(event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]"))) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(".guide-caption")) stopPageSpeech();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("click", click, true);
  // A slow reading of these words plus a natural pause allows for voice startup and punctuation.
  // Cancel too: a voice that never reports its end must not keep speaking over the resumed mic.
  const timer = window.setTimeout(stopPageSpeech, slowReadMs(text) + NATURAL_PAUSE_MS);
  cleanup = () => {
    synth.removeEventListener("voiceschanged", speak);
    window.clearTimeout(timer);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("click", click, true);
  };
  synth.addEventListener("voiceschanged", speak);
  speak();
}
