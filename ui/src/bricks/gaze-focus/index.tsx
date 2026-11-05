import { useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { Thought } from "./Thought";
import { useTracking } from "./use-tracking";
import "./gaze-focus.css";

function ExampleTopics() {
  return <div className="gaze-focus-example" aria-label="Example topics">
    <span className="gaze-focus-example-label">EXAMPLE MAP</span>
    <svg className="gaze-focus-branches" viewBox="0 0 290 125" aria-hidden="true"><path d="M48 49 Q150 6 220 78 M48 49 Q60 134 134 102" /></svg>
    <span className="gaze-focus-topic gaze-focus-topic-a" data-gaze-example="example-garden">A shared garden</span>
    <span className="gaze-focus-topic gaze-focus-topic-b" data-gaze-example="example-water">Keep the rain</span>
    <span className="gaze-focus-topic gaze-focus-topic-c" data-gaze-example="example-pause">Room to pause</span>
  </div>;
}

function GazePanel({ map, actions }: BrickProps) {
  const tracker = useTracking(map.threads);
  const [open, setOpen] = useState(true);
  const toggle = useRef<HTMLButtonElement>(null);
  const { focus, point, mode } = tracker;
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return <>
    {point && <div className="gaze-focus-dot" aria-hidden="true" style={{ left: point.x, top: point.y }} />}
    {focus && <div className="gaze-focus-halo" aria-hidden="true" style={{ left: focus.target.box.x - 6, top: focus.target.box.y - 6, width: focus.target.box.width + 12, height: focus.target.box.height + 12 }} />}
    <section className="gaze-focus" aria-label="Gaze focus" data-guide="gaze-focus"
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <button className="gaze-focus-toggle" ref={toggle} aria-expanded={open} aria-controls="gaze-focus-body" onClick={() => setOpen(!open)}>
        <span className={`gaze-focus-eye ${mode === "paused" ? "gaze-focus-eye-paused" : ""}`} aria-hidden="true">◉</span>
        <span><strong>Gaze focus</strong><small>{mode === "demo" ? "Demo · no camera" : mode === "camera" ? "Camera · local only" : "Paused · camera off"}</small></span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && <div id="gaze-focus-body" className="gaze-focus-body">
        <div className="gaze-focus-current" role="status"><small>{mode === "demo" ? "SIMULATED ATTENTION" : "APPROXIMATE ATTENTION"}</small>
          <strong>{focus?.target.title ?? (mode === "paused" ? "Take a quiet pause" : "Finding a topic…")}</strong>
        </div>
        {!map.threads.length && <ExampleTopics />}
        <p className="gaze-focus-note">{mode === "demo" ? "A simulated path explores visible topics. This is not measured gaze." : mode === "camera" ? `${tracker.method}. Face position or light estimates a region, not your exact eye direction.` : "Choose the demo or tap Use camera to begin."}</p>
        <div className="gaze-focus-controls">
          <button type="button" aria-pressed={mode === "demo"} onClick={tracker.demo}>Demo</button>
          {mode === "camera" || tracker.pending
            ? <button type="button" onClick={tracker.pause}>Stop camera</button>
            : <button type="button" onClick={() => void tracker.camera()}>Use camera</button>}
          {mode === "camera" ? <button type="button" onClick={tracker.recenter}>Center estimate</button>
            : mode === "demo" && <button type="button" onClick={tracker.pause}>Pause</button>}
        </div>
        <p className="gaze-focus-note">{tracker.pending ? "Waiting for your camera permission…" : "Frames stay on this device. Nothing is recorded or uploaded."}</p>
        {tracker.message && <p className="gaze-focus-note" role="status">{tracker.message}</p>}
        <Thought focus={focus} actions={actions} connected={map.connected} />
      </div>}
    </section>
  </>;
}

export default function GazeFocus(props: BrickProps) {
  return <GazePanel key={`${props.map.visitKey ?? props.map.mapIdentity ?? "visit"}:${props.map.me}`} {...props} />;
}
