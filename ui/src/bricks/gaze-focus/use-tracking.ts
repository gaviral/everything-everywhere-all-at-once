import { useCallback, useEffect, useRef, useState } from "react";
import type { Thread } from "../contract";
import { startCamera, type CameraMethod } from "./camera";
import { calibrated, nearest, smooth, type Point, type Target } from "./estimate";
import { visibleTargets } from "./targets";

export type Mode = "demo" | "camera" | "paused";
export type Focus = { target: Target; mode: Mode; method: string };

export function useTracking(threads: readonly Thread[]) {
  const [mode, setMode] = useState<Mode>("demo");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [method, setMethod] = useState<CameraMethod>("Brightness proxy · very coarse");
  const request = useRef<AbortController | null>(null);
  const reading = useRef<{ point: Point; at: number } | null>(null);
  const center = useRef<Point | null>(null);
  const methodRef = useRef<CameraMethod>(method);
  const stop = useCallback(() => {
    request.current?.abort(); request.current = null;
    reading.current = null; center.current = null;
  }, []);
  const pause = useCallback(() => {
    stop(); setPending(false); setMode("paused"); setFocus(null); setPoint(null);
  }, [stop]);
  const demo = () => { stop(); setPending(false); setMessage(""); setMode("demo"); };
  const camera = async () => {
    stop();
    const controller = new AbortController(); request.current = controller;
    setPending(true); setMode("paused"); setFocus(null); setPoint(null); setMessage("");
    try {
      await startCamera(controller.signal, (value, source) => {
        methodRef.current = source; setMethod(source);
        reading.current = value ? { point: value, at: performance.now() } : null;
        if (value && !center.current) center.current = value;
      });
      if (!controller.signal.aborted) setMode("camera");
    } catch {
      if (!controller.signal.aborted) setMessage("Camera unavailable. Try the demo instead.");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  const recenter = () => { center.current = reading.current?.point ?? null; };

  useEffect(() => {
    const hide = () => { if (document.hidden) pause(); };
    const leave = () => pause();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => { stop(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); };
  }, [pause, stop]);

  useEffect(() => {
    if (mode === "paused") return;
    let smoothed: Point | null = null;
    let candidate = "", since = 0;
    const started = performance.now();
    const tick = () => {
      const now = performance.now();
      const targets = visibleTargets(threads);
      const destination = targets[Math.floor((now - started) / 3200) % Math.max(1, targets.length)];
      const live = reading.current;
      const raw = mode === "demo"
        ? destination && { x: destination.box.x + destination.box.width / 2, y: destination.box.y + destination.box.height / 2 }
        : live && center.current && now - live.at < 1200
          ? (() => { const p = calibrated(live.point, center.current); return { x: p.x * innerWidth, y: p.y * innerHeight }; })()
          : null;
      if (!raw) { smoothed = null; candidate = ""; setPoint(null); setFocus(null); return; }
      smoothed = smoothed ? smooth(smoothed, raw) : raw;
      setPoint(smoothed);
      const target = nearest(smoothed, targets);
      if (!target) { candidate = ""; setFocus(null); return; }
      if (candidate !== target.id) { candidate = target.id; since = now; setFocus(null); }
      if (now - since >= 500) setFocus({ target, mode, method: mode === "demo" ? "Simulated gaze" : methodRef.current });
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [mode, threads]);

  return { mode, pending, message, focus, point, method, pause, demo, camera, recenter };
}
