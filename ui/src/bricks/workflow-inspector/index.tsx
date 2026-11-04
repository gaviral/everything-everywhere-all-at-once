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
  return <section className="workflow-inspector-example" aria-label="Workflow inspector example" data-guide="workflow-inspector">
    <div><strong>Workflow inspector · local example</strong><button onClick={() => actions.openCatalog("workflow-inspector")}>Features</button></div>
    <WorkflowInspector definition={exampleDefinition} inspector={example.inspector} source={example.adapter.source} />
  </section>;
}
