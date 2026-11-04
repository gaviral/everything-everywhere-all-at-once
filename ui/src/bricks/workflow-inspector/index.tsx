import { useEffect, useState } from "react";
import type { BrickProps } from "../contract";
import { createExampleAdapter, exampleDefinition } from "../../msg1351/workflow-inspector/example";
import { createInspector } from "../../msg1351/workflow-inspector/runtime";
import { WorkflowInspector } from "../../msg1351/workflow-inspector/WorkflowInspector";
import "./example.css";

export default function WorkflowExample({ actions }: BrickProps) {
  const [example] = useState(() => {
    const adapter = createExampleAdapter();
    const inspector = createInspector(adapter);
    inspector.setEnabled(true);
    return { adapter, inspector };
  });
  useEffect(() => { example.inspector.setEnabled(true); return () => example.inspector.dispose(); }, [example]);
  const [open, setOpen] = useState(true);
return <>{!open && <button className="workflow-inspector-reopen" type="button" onClick={() => setOpen(true)}>Open Workflow inspector</button>}
<section hidden={!open} className="workflow-inspector-example" aria-label="Workflow inspector example" data-guide="workflow-inspector">
    <div><strong>Workflow inspector · local example</strong><span><button type="button" onClick={() => actions.openCatalog("workflow-inspector")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
    <WorkflowInspector definition={exampleDefinition} inspector={example.inspector} source={example.adapter.source} />
  </section></>;
}
