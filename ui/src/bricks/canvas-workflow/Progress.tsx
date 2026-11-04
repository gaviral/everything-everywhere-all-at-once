import { stepDuration, steps } from "./example";
import type { Run } from "./runtime";

function status(run: Run): string {
  switch (run.phase) {
    case "ready": return "Ready to run · 3 steps";
    case "done": return "Complete · brief ready for review";
    case "cancelled": return "Cancelled · completed steps retained";
    case "paused": return `Paused at step ${run.outputs.length + 1} · progress held`;
    case "running": return `Step ${run.outputs.length + 1} of ${steps.length} · ${steps[run.outputs.length].title}`;
  }
}

export function Progress({ run }: { run: Run }) {
  const percent = Math.floor(100 * run.elapsed / (steps.length * stepDuration));
  const message = status(run);
  return <div className="canvas-workflow-progress">
    <div className="canvas-workflow-status"><span role="status">{message}</span><strong aria-hidden="true">{percent}%</strong></div>
    <progress aria-label="Example workflow progress" aria-valuetext={`${percent}% · ${message}`} value={percent} max={100} />
  </div>;
}
