import type { Dispatch } from "react";
import type { Command, Phase } from "./runtime";

export function Controls({ phase, send }: { phase: Phase; send: Dispatch<Command> }) {
  const active = phase === "running" || phase === "paused";
  return <div className="canvas-workflow-controls" role="group" aria-label="Workflow controls">
    {active ? <>
      <button type="button" className="canvas-workflow-primary" onClick={() => send({ type: phase === "paused" ? "resume" : "pause" })}>{phase === "paused" ? "Resume" : "Pause"}</button>
      <button type="button" onClick={() => send({ type: "cancel" })}>Cancel</button>
    </> : <button type="button" className="canvas-workflow-primary" onClick={() => send({ type: "start" })}>{phase === "ready" ? "Run example" : "Run again"}</button>}
    <span>Local example · no model calls</span>
  </div>;
}
