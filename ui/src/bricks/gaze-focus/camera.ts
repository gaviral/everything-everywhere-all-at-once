import { brightnessPosition, facePosition, type Face, type Point } from "./estimate";

type Detector = { detect(image: HTMLCanvasElement): Promise<Face[]> };
type CameraWindow = Window & { FaceDetector?: new (options: { fastMode: boolean; maxDetectedFaces: number }) => Detector };
export type CameraMethod = "Face / eye position · coarse" | "Brightness proxy · very coarse";
export type Camera = { stop(): void };

// Called only by the camera button. Frames stay in this canvas and are never serialized.
export async function startCamera(signal: AbortSignal, sample: (point: Point | null, method: CameraMethod) => void): Promise<Camera> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  canvas.width = 80; canvas.height = 60;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false, timer = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach(track => track.stop());
    video.pause(); video.srcObject = null;
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) { stop(); return { stop }; }
  try {
    if (!context) throw new Error("Local image sampling unavailable");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    if (stopped) return { stop };
    let detector: Detector | null = null;
    try {
      const NativeFace = (window as CameraWindow).FaceDetector;
      if (NativeFace) detector = new NativeFace({ fastMode: true, maxDetectedFaces: 1 });
    } catch { /* Use the local brightness fallback. */ }
    const tick = async () => {
      if (stopped) return;
      let point: Point | null = null;
      if (video.readyState >= 2) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (detector) {
          try {
            const faces = await detector.detect(canvas);
            if (faces[0]) point = facePosition(faces[0], canvas.width, canvas.height);
          } catch { detector = null; }
        }
        if (!detector) point = brightnessPosition(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      }
      if (stopped) return;
      sample(point, detector ? "Face / eye position · coarse" : "Brightness proxy · very coarse");
      timer = window.setTimeout(() => { void tick().catch(stop); }, 140);
    };
    await tick();
    return { stop };
  } catch (error) { stop(); throw error; }
}
