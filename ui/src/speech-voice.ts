// Browser capability, independent of the saved Features choice. Empty lists are normal,
// including while local voices load; never queue audio or pause capture waiting for one.
// Browser voices with remote or unknown locality never receive reply text.
function detectVoice(): SpeechSynthesisVoice | null {
  try {
    if (typeof window === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") return null;
    const installed = (window.speechSynthesis?.getVoices() ?? []).filter(v => v.localService === true);
    const english = installed.filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    const quality = (v: SpeechSynthesisVoice) => /premium/i.test(v.name) ? 2 : /enhanced/i.test(v.name) ? 1 : 0;
    return (english.length ? english : installed).slice()
      .sort((a, b) => quality(b) - quality(a) || Number(!!b.default) - Number(!!a.default))[0] ?? null;
  } catch { return null; }
}

let voice = detectVoice();
const watchers = new Set<() => void>();
function update(next: SpeechSynthesisVoice | null) {
  const changed = !!voice !== !!next;
  voice = next;
  if (changed) watchers.forEach(watcher => watcher());
}
if (typeof window !== "undefined") {
  window.speechSynthesis?.addEventListener("voiceschanged", () => update(detectVoice()));
}
export const speechVoice = () => voice;
export const speechAvailable = () => voice !== null;
export const watchSpeechAvailability = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
// A listed voice can still be unusable (for example, a missing voice download).
// Fall back to text until the browser reports a fresh voice list.
export const disableSpeech = () => update(null);
