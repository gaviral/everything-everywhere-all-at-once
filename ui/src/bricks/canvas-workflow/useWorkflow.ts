import { useEffect, useReducer } from "react";
import { newRun, workflow } from "./runtime";

/** The mount owns its clock. Pause, cancel and switch-off release it. */
export function useWorkflow() {
  const [run, send] = useReducer(workflow, undefined, newRun);
  useEffect(() => {
    if (run.phase !== "running") return;
    let previous = performance.now();
    const clock = window.setInterval(() => {
      const now = performance.now();
      send({ type: "tick", milliseconds: now - previous });
      previous = now;
    }, 100);
    return () => window.clearInterval(clock);
  }, [run.phase]);
  return { run, send };
}
