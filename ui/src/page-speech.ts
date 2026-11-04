// Live replies play in this browser; capture stays silent unless an opted-in local interruption is confirmed.
// No snapshot playback: only flagged live replies, captions and newly added AI thoughts speak.
import { useSyncExternalStore } from "react";
import { builtInOn } from "./shell/features";
import { slowReadMs } from "./notice-rules";
import { NATURAL_PAUSE_MS } from "./legible";

type SpeechMessage = {
  type: string;
  reply_id?: string;
  state?: string;
  speak?: boolean;
  kind?: string;
  caption?: { id: string; by: string };
  world?: { captions?: { id: string; by: string }[] };
  text?: string;
  change?: { type: string; thought?: { text: string } };
  people?: { ai: boolean; remote?: boolean; speaking: boolean }[];
};

const heardCaptions = new Set<string>();
const captionKey = (c: { id: string; by: string }) => JSON.stringify([c.by, c.id]);

export type Playback = { phase: "off" | "queued" | "playing" | "failed"; text: string; error: string };
let playback: Playback = { phase: "off", text: "", error: "" };
const playbackListeners = new Set<() => void>();
function publish(phase: Playback["phase"], error = "") {
  playback = { ...playback, phase, error };
  playbackListeners.forEach(listener => listener());
}
export const usePlayback = () => useSyncExternalStore(listener => { playbackListeners.add(listener); return () => { playbackListeners.delete(listener); }; }, () => playback);
let replyId: string | undefined;
const stoppedReplies = new Set<string>();
export const replyStopped = (id?: string) => !!id && stoppedReplies.has(id);
/** Local cancellation wins even if an already-sent service answer arrives later. */
export function cancelPageReply() {
  if (replyId) stoppedReplies.add(replyId);
  stopPageSpeech();
  publish("off");
}
export function retryPageReply() {
  if (playback.text) hearPageSpeech(JSON.stringify({ type: "guide", kind: "caption", text: playback.text, speak: true, reply_id: replyId }));
}

let utterance: SpeechSynthesisUtterance | null = null;
let started = false;
let cleanup: (() => void) | null = null;
let loggedVoice = false;
const speakingListeners = new Set<(speaking: boolean, started: boolean) => void>();

// Ask early: some browsers populate their installed voices asynchronously.
if (typeof window !== "undefined") window.speechSynthesis?.getVoices();

export const pageSpeaking = () => utterance !== null;

export function watchPageSpeech(listener: (speaking: boolean, started: boolean) => void): () => void {
  speakingListeners.add(listener);
  listener(pageSpeaking(), started);
  return () => { speakingListeners.delete(listener); };
}

function finish() {
  utterance = null;
  started = false;
  publish("off");
  cleanup?.();
  cleanup = null;
  speakingListeners.forEach((listener) => listener(false, false));
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
  if (msg.type === "snapshot") {
    for (const caption of msg.world?.captions ?? []) heardCaptions.add(captionKey(caption));
    return;
  }
  if (msg.type === "guide" && msg.caption) {
    const key = captionKey(msg.caption);
    if (heardCaptions.has(key)) return;
    heardCaptions.add(key);
  }
  if (replyStopped(msg.reply_id)) return;
  if (msg.type === "partner_state" && msg.state === "thinking") replyId = msg.reply_id;
  if (msg.type === "partner_state" && ["thinking", "cancelled", "error"].includes(msg.state ?? "")) { stopPageSpeech(); return; }
  if ((msg.type === "call" && msg.people?.some((p) => p.speaking && !p.ai && !p.remote))
      || (msg.type === "partial" && msg.text?.trim())) {
    stopPageSpeech();
    return;
  }
  if (!msg.speak || (msg.type === "command_reply" && !builtInOn("partner"))) return;
  const text = msg.type === "command_reply" ? msg.text
    : msg.type === "guide" && msg.kind === "caption" ? msg.text
    : msg.type === "change" && msg.change?.type === "thought_added" ? msg.change.thought?.text : "";
  if (!text?.trim()) return;
  stopPageSpeech();
  replyId = msg.reply_id;
  playback = { phase: "queued", text, error: "" };
  const next = new SpeechSynthesisUtterance(text);
  // A little quicker than normal speech, without rushing the words while walking.
  next.rate = 1.12;
  next.onstart = () => {
    if (utterance !== next) return;
    started = true;
    publish("playing");
    speakingListeners.forEach((listener) => listener(true, true));
  };
  next.onend = () => { if (utterance === next) finish(); };
  const failed = () => {
    if (utterance !== next) return;
    stopPageSpeech();
    publish("failed", "Reply audio failed. Read the reply on the spine, retry audio, or type below.");
  };
  next.onerror = failed;
  utterance = next;
  publish("queued");
  speakingListeners.forEach((listener) => listener(true, false));
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
    // Loading voices must not use up the reply's speaking time.
    window.clearTimeout(timer);
    timer = window.setTimeout(failed, slowReadMs(text) + NATURAL_PAUSE_MS);
    try { synth.speak(next); } catch { failed(); }
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
  let timer = window.setTimeout(failed, slowReadMs(text) + NATURAL_PAUSE_MS);
  cleanup = () => {
    synth.removeEventListener("voiceschanged", speak);
    window.clearTimeout(timer);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("click", click, true);
  };
  synth.addEventListener("voiceschanged", speak);
  speak();
}
