import type { BrickProps } from "../contract";
import { sampleNotes } from "./example";
import { Controls } from "./Controls";
import { Progress } from "./Progress";
import { Steps } from "./Steps";
import { useWorkflow } from "./useWorkflow";
import style from "./canvas-workflow.css?inline";

function ExampleNotes() {
  return <details className="canvas-workflow-source" open>
    <summary>Example input · three launch notes</summary>
    <ul>{sampleNotes.map(note => <li key={note.text}>{note.text}</li>)}</ul>
  </details>;
}

export default function CanvasWorkflow(_props: BrickProps) {
  const { run, send } = useWorkflow();
  return <section className="canvas-workflow" aria-label="Canvas workflow" data-guide="canvas-workflow">
    <div className="canvas-workflow-heading"><div><p>WORKFLOW / LOCAL EXAMPLE</p><h2>From notes to next steps.</h2></div><span className="canvas-workflow-badge">Launch brief</span></div>
    <Progress run={run} />
    <Controls phase={run.phase} send={send} />
    <ExampleNotes />
    <Steps run={run} />
    <p className="canvas-workflow-footnote">Simulated pacing · nothing is sent or added to your map. Switching this feature off resets the example.</p>
  </section>;
}

export const styles = style;
