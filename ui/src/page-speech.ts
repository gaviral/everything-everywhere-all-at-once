// Live bridge replies play in the capturing browser so its mic's echo cancellation can hear the playback.
// No snapshot playback: only an explicitly flagged caption or newly added AI thought speaks.
type SpeechMessage = {
  type: string;
  speak?: boolean;
  kind?: string;
  text?: string;
  change?: { type: string; thought?: { text: string } };
  people?: { ai: boolean; remote?: boolean; speaking: boolean }[];
};

let utterance: SpeechSynthesisUtterance | null = null;

/** Disconnecting or a human taking the floor cuts off this page's reply, including queued speech. */
export function stopPageSpeech() {
  if (!utterance) return;
  utterance = null;
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
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.name === "Samantha") ?? voices.find((v) => v.lang.startsWith("en"));
  if (voice) next.voice = voice;
  next.lang = voice?.lang ?? "en-US";
  next.rate = 1.12;
  next.onend = next.onerror = () => { if (utterance === next) utterance = null; };
  utterance = next;
  window.speechSynthesis.speak(next);
}
