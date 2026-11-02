// Streams the microphone as 24 kHz 16-bit PCM frames; returns a function that stops it.
// The audio context is made at the click, before the permission prompt: Safari only lets a context run that a click
// started. Chromium browsers get a 24 kHz context and resample themselves (the demo's path, measured in every take).
// Safari and Firefox run at the device's rate and the worklet resamples (ui/public/pcm-worklet.js, checked by
// scripts/mic-check.mjs), since what their own resampling does to a mic at 24 kHz can't be checked here: Firefox
// refuses a mic in a context at another rate, and Safari's has had bugs.
export const RATE = 24000;

/** A reason the page itself gives, already in plain words: said as it is (`micFailure`). */
export class MicUnavailable extends Error {}

/** Where to send someone whose mic is blocked: the browser's own settings differ by browser, and a block by the
 *  computer itself is lifted in its system settings. */
export type MicPlace = { safari: boolean; os: "mac" | "windows" | "other" };

export function micPlace(): MicPlace {
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Android/.test(ua);
  const os = /Mac/.test(navigator.platform || ua) ? "mac" : /Win/.test(navigator.platform || ua) ? "windows" : "other";
  return { safari, os };
}

/** Why the mic didn't start, as the window says it, and whether the mic now looks blocked ("site": this site, in the
 *  browser; "mac": the computer blocks the browser). Never the browser's own message: it goes to the console. */
export function micFailure(error: unknown, place: MicPlace): { words: string; blocked: "" | "site" | "mac" } {
  if (error instanceof MicUnavailable) return { words: error.message, blocked: "" };
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const message = error instanceof Error || error instanceof DOMException ? error.message : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    // Chrome says "by system" when macOS or Windows keeps the browser itself from the mic: the site's setting is fine.
    if (/by system/i.test(message)) {
      if (place.os === "windows") return { words: "Windows is blocking the microphone for this browser. Turn it on in Settings › Privacy & security › Microphone, then reopen the browser.", blocked: "mac" };
      if (place.os === "mac") return { words: "Your Mac is blocking the microphone for this browser. Turn it on in System Settings › Privacy & Security › Microphone, then reopen the browser.", blocked: "mac" };
      return { words: "Your computer is blocking the microphone for this browser. Allow it in the system's privacy settings, then reopen the browser.", blocked: "mac" };
    }
    // The prompt closed without an answer: the next tap asks again.
    if (/dismissed/i.test(message)) return { words: "The microphone wasn't allowed. Tap the mic and choose Allow, or type below.", blocked: "" };
    if (place.safari) return { words: "Safari is blocking the microphone for this site. Allow it in Safari › Settings for This Website, then tap the mic. You can type meanwhile.", blocked: "site" };
    return { words: "The browser is blocking the microphone for this site. Allow it from the icon beside the address, then tap the mic. You can type meanwhile.", blocked: "site" };
  }
  if (["NotFoundError", "OverconstrainedError", "DevicesNotFoundError"].includes(name)) {
    return { words: "No microphone found. Connect one, then tap the mic, or type below.", blocked: "" };
  }
  if (["NotReadableError", "AbortError", "TrackStartError"].includes(name)) {
    return { words: "The microphone is busy in another app or didn't start. Close that app, then tap the mic, or type below.", blocked: "" };
  }
  return { words: "Couldn't start the mic. Tap it to try again, or type below.", blocked: "" };
}

/** Follows this site's mic permission where the browser tells it (Chrome, Edge, Safari 16+): `onState` with its state
 *  now and on each change. Firefox throws for "microphone" and older Safari has no `permissions`: nothing then.
 *  Returns a function that stops following. */
export function watchMicPermission(permissions: Pick<Permissions, "query"> | undefined, onState: (state: PermissionState) => void): () => void {
  let status: PermissionStatus | null = null;
  let stopped = false;
  permissions?.query({ name: "microphone" as PermissionName }).then((s) => {
    if (stopped) return;
    status = s;
    onState(s.state);
    s.onchange = () => onState(s.state);
  }).catch(() => { /* this browser doesn't say */ });
  return () => { stopped = true; if (status) status.onchange = null; };
}

export async function startMic(onFrame: (frame: ArrayBuffer) => void, onEnded?: () => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    throw new MicUnavailable(window.isSecureContext === false
      ? "Live audio needs a secure page (https). Open the link that starts with https."
      : "Live audio isn't available in this browser. You can type below.");
  }
  // Before any await, so it counts as part of the click.
  let context = atRate();
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      // Firefox: "Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported".
      void context.close();
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
    }
    // A context that starts or falls suspended (Safari after the prompt; iOS after a call) is asked to run again.
    const wake = () => { if (context.state !== "running" && context.state !== "closed") void context.resume().catch(() => {}); };
    wake();
    context.onstatechange = wake;
    await context.audioWorklet.addModule("/pcm-worklet.js");
    const writer = new AudioWorkletNode(context, "pcm-writer");
    writer.port.onmessage = (event) => onFrame(event.data as ArrayBuffer);
    source.connect(writer);
    // Some browsers only run a worklet that reaches the speakers; keep it silent.
    const silent = context.createGain();
    silent.gain.value = 0;
    writer.connect(silent).connect(context.destination);

    const tracks = stream.getTracks();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      writer.port.onmessage = null;
      context.onstatechange = null;
      source.disconnect();
      writer.disconnect();
      tracks.forEach((track) => { track.onended = null; track.stop(); });
      void context.close();
    };
    // The mic taken away (another app or tab took it, it was unplugged, or the page went to the background on a phone):
    // stop, and say so, rather than show "Listening" over silence.
    for (const track of tracks) track.onended = () => { stop(); onEnded?.(); };
    return stop;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    void context.close();
    throw error;
  }
}

// A context at 24 kHz in Chromium (the only browsers with navigator.userAgentData), else, or where a browser won't make
// one at 24 kHz, at the device's rate.
function atRate(): AudioContext {
  if (!("userAgentData" in navigator)) return new AudioContext();
  try {
    const context = new AudioContext({ sampleRate: RATE });
    if (context.sampleRate === RATE) return context;
    void context.close();
  } catch { /* the device's rate, below */ }
  return new AudioContext();
}
