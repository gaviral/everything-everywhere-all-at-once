// Streams the microphone as 24 kHz 16-bit PCM frames; returns a function that stops it.
export async function startMic(onFrame: (frame: ArrayBuffer) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext({ sampleRate: 24000 });
  await context.audioWorklet.addModule("/pcm-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const writer = new AudioWorkletNode(context, "pcm-writer");
  writer.port.onmessage = (event) => onFrame(event.data as ArrayBuffer);
  source.connect(writer);
  // Some browsers only run a worklet that reaches the speakers; keep it silent.
  const silent = context.createGain();
  silent.gain.value = 0;
  writer.connect(silent).connect(context.destination);

  return () => {
    writer.port.onmessage = null;
    source.disconnect();
    writer.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };
}
