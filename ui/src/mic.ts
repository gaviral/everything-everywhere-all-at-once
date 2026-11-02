// Streams the microphone as 24 kHz 16-bit PCM frames; returns a function that stops it.
// The audio context is made at the click, before the permission prompt: Safari only lets a context run that a click
// started. Chromium browsers get a 24 kHz context and resample themselves (the demo's path, measured in every take).
// Safari and Firefox run at the device's rate and the worklet resamples (ui/public/pcm-worklet.js, checked by
// scripts/mic-check.mjs), since what their own resampling does to a mic at 24 kHz can't be checked here: Firefox
// refuses a mic in a context at another rate, and Safari's has had bugs.
export const RATE = 24000;

export async function startMic(onFrame: (frame: ArrayBuffer) => void, onEnded?: () => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    throw new Error(window.isSecureContext === false
      ? "Live audio needs a secure page (https). Open the link that starts with https."
      : "Live audio isn't available in this browser.");
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
