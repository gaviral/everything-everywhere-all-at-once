import { steps } from "./example";
import { stepState, type Run } from "./runtime";

function StepOutput({ lines }: { lines: readonly string[] }) {
  return <ul className="canvas-workflow-output">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>;
}

export function Steps({ run }: { run: Run }) {
  return <ol className="canvas-workflow-steps" aria-label="Workflow steps">{steps.map((step, index) => {
    const state = stepState(run, index);
    return <li key={step.title} className="canvas-workflow-step" data-state={state} aria-current={state === "Running" || state === "Paused" ? "step" : undefined}>
      <div className="canvas-workflow-step-top"><span className="canvas-workflow-number" aria-hidden="true">{state === "Done" ? "✓" : `0${index + 1}`}</span><span>{state}</span></div>
      <h3>{step.title}</h3><p>{step.detail}</p>
      {run.outputs[index] ? <StepOutput lines={run.outputs[index]} /> : <p className="canvas-workflow-pending">{state === "Running" ? "Working through the example…" : state === "Paused" ? "Continue whenever you’re ready." : state === "Cancelled" ? "This step was not completed." : index === 0 ? "Starts when you run the example." : `After ${steps[index - 1].title.toLowerCase()}.`}</p>}
      <div className="canvas-workflow-handoff">{run.outputs[index] ? step.handoff : `Step ${index + 1} of 3`}</div>
    </li>;
  })}</ol>;
}
