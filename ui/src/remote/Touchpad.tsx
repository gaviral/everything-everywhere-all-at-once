import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { useCore } from "../core";
import type { RemoteGesture, RemotePosition } from "../bricks/contract";
import { sendToCore } from "../room";
import { micEnds } from "../MicButton";
import { startMic, micFailure, micPlace } from "../mic";
import { watchRemote } from "./channel";
import "./touchpad.css";

type Core = ReturnType<typeof useCore>;
const patterns = {
  left: [15], right: [15, 35, 15], up: [30], down: [15, 25, 30], open: [50], back: [30, 30, 30],
  talk: [70, 25, 15], release: [15, 25, 70], zoom: [10, 15, 10, 15, 10], pan: [35, 15, 10],
};
export function haptic(kind: keyof typeof patterns) { navigator.vibrate?.(patterns[kind]); }
export const initialPosition: RemotePosition = { kind: "selection", thread_id: null, thought_id: null, enabled: false, label: "Connecting to the screen…" };
export function useRemotePosition(connected: boolean) {
  const [position, setPosition] = useState(initialPosition);
  useEffect(() => watchRemote((message) => { if (message.kind === "selection") setPosition(message); }), []);
  useEffect(() => {
    if (!connected) { setPosition(initialPosition); return; }
    sendToCore({ type: "remote_selection", message: { kind: "hello" } });
  }, [connected]);
  return position;
}

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export default function Touchpad({ core, position, exit }: { core: Core; position: RemotePosition; exit: () => void }) {
  const [micLabel, setMicLabel] = useState("");
  const surface = useRef<HTMLElement>(null);
  const latest = useRef(core); latest.current = core;
  const points = useRef(new Map<number, Point>());
  const start = useRef<Point | null>(null);
  const multi = useRef<{ center: Point; gap: number; mode: "zoom" | "pan" | null } | null>(null);
  const multiFrame = useRef<number | null>(null);
  const used = useRef(false);
  const held = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStart = useRef({ error: 0, status: 0, listened: 0 });
  const capture = useRef<{ abort: AbortController; stop?: () => void } | null>(null);
  const clearHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const stopMic = () => {
    const running = capture.current;
    capture.current = null;
    if (running) { running.stop?.(); running.abort.abort(); latest.current.listen(false); haptic("release"); }
  };
  const stopAll = () => { if (multiFrame.current !== null) cancelAnimationFrame(multiFrame.current); multiFrame.current = null; clearHold(); if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null; stopMic(); points.current.clear(); };
  useEffect(() => {
    surface.current?.focus({ preventScroll: true });
    const hidden = () => { if (document.hidden) stopAll(); };
    const blur = () => stopAll();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("blur", blur);
    return () => { stopAll(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => { if (!core.connected || !position.enabled) { stopAll(); setMicLabel(""); } }, [core.connected, position.enabled]);
  useEffect(() => {
    if (!capture.current) return;
    const began = voiceStart.current;
    const ended = micEnds({ connected: core.connected, listening: core.listening, failed: core.voiceErrorRevision > began.error,
      statusNew: core.voiceStatusRevision > began.status, listenedNew: core.listenedRevision > began.listened });
    if (ended) { stopMic(); setMicLabel(ended === "failed" ? core.voiceError : "Microphone stopped"); }
  }, [core.connected, core.listening, core.voiceErrorRevision, core.voiceStatusRevision, core.listenedRevision]);
  const send = (gesture: RemoteGesture) => {
    if (!core.connected || !position.enabled) return;
    if (sendToCore({ type: "remote_selection", message: gesture }) && gesture.kind !== "hello") haptic(gesture.kind);
    setMicLabel("");
  };
  const talk = async () => {
    if (points.current.size !== 1) return;
    held.current = true; haptic("talk");
    voiceStart.current = { error: latest.current.voiceErrorRevision, status: latest.current.voiceStatusRevision, listened: latest.current.listenedRevision };
    if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null;
    if (latest.current.noKey) { setMicLabel("Listening needs the speech service"); return; }
    const running = { abort: new AbortController(), stop: undefined as (() => void) | undefined };
    capture.current = running;
    try {
      setMicLabel("Starting microphone…");
      const connected = latest.current.micConnection();
      running.stop = await startMic((frame) => latest.current.sendAudio(frame), () => { stopMic(); setMicLabel("Microphone stopped"); }, running.abort.signal, () => points.current.size === 1 && held.current);
      if (capture.current !== running || !connected() || !latest.current.listen(true)) { running.stop(); stopMic(); return; }
      setMicLabel("Listening…");
    } catch (error) {
      if (!running.abort.signal.aborted) { capture.current = null; setMicLabel(micFailure(error, micPlace()).words); }
    }
  };
  const geometry = () => {
    const [a, b] = [...points.current.values()];
    return a && b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, gap: distance(a, b) } : null;
  };
  const down = (event: PointerEvent<HTMLElement>) => {
    if (!position.enabled || !core.connected) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 1) {
      start.current = { x: event.clientX, y: event.clientY }; used.current = false; held.current = false;
      clearHold(); holdTimer.current = setTimeout(() => void talk(), 450);
    } else {
      clearHold(); stopMic(); used.current = true;
      if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null;
      const g = geometry(); if (g) multi.current = { ...g, mode: null };
    }
  };
  const flushMulti = () => {
    multiFrame.current = null;
    if (points.current.size < 2) return;
    const g = geometry(), was = multi.current;
    if (!g || !was) return;
    let mode = was.mode;
    const scale = g.gap / Math.max(1, was.gap);
    if (!mode && (Math.abs(g.gap - was.gap) > 6 || distance(g.center, was.center) > 6)) {
      mode = Math.abs(g.gap - was.gap) > distance(g.center, was.center) * 1.3 ? "zoom" : "pan";
      haptic(mode);
    }
    if (mode === "zoom") sendToCore({ type: "remote_selection", message: { kind: "zoom", scale } });
    if (mode === "pan") sendToCore({ type: "remote_selection", message: { kind: "pan", x: g.center.x - was.center.x, y: g.center.y - was.center.y } });
    // Accumulate the first few pixels until there is a clear gesture.
    if (mode) multi.current = { ...g, mode };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!points.current.has(event.pointerId)) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size >= 2) {
      // One touch event updates two pointers separately. Read their joint geometry after both updates.
      if (multiFrame.current === null) multiFrame.current = requestAnimationFrame(flushMulti);
    } else if (start.current && distance(start.current, { x: event.clientX, y: event.clientY }) > 18) clearHold();
  };
  const up = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    if (!points.current.has(event.pointerId)) return;
    if (multiFrame.current !== null) {
      cancelAnimationFrame(multiFrame.current);
      if (!cancelled) flushMulti(); else multiFrame.current = null;
    }
    points.current.delete(event.pointerId); clearHold();
    if (cancelled && tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
    if (capture.current || held.current) { stopMic(); if (micLabel === "Listening…" || micLabel === "Starting microphone…") setMicLabel(""); }
    else if (!cancelled && !used.current && start.current) {
      const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 48) {
        if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null;
        send({ kind: Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up" });
      } else if (Math.hypot(dx, dy) < 18) {
        if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; send({ kind: "back" }); }
        else tapTimer.current = setTimeout(() => { tapTimer.current = null; send({ kind: "open" }); }, 280);
      }
    }
    if (!points.current.size) { start.current = null; multi.current = null; }
  };
  return <main ref={surface} className="phone-touchpad" role="application" tabIndex={0} aria-label="Touchpad. Swipe left or right for topics; up or down for thoughts. Tap opens; double tap goes back. Hold to talk. Two fingers pinch to zoom or drag to pan. Escape exits."
    onPointerDown={down} onPointerMove={move} onPointerUp={(event) => up(event)} onPointerCancel={(event) => up(event, true)}
    onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key === "Escape") { stopAll(); exit(); return; }
      const kind = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "open", Backspace: "back" } as const)[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Enter" | "Backspace"];
      if (kind) { event.preventDefault(); send({ kind }); }
    }}>
    <p className="phone-touchpad-label" role="status" aria-live="polite">{micLabel || (!core.connected ? "Connecting to the screen…" : position.label)}</p>
  </main>;
}
