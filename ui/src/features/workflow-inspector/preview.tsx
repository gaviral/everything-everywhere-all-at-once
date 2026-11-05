import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createExampleAdapter, exampleDefinition } from "./example";
import { createInspector, unavailableRuntime } from "./runtime";
import { WorkflowInspector } from "./WorkflowInspector";

function PreviewSession({ mode }: { mode: string }) {
  const adapter = useMemo(() => mode === "example" ? createExampleAdapter() : unavailableRuntime(exampleDefinition), [mode]);
  const inspector = useMemo(() => createInspector(adapter), [adapter]);
  useEffect(() => () => inspector.dispose(), [inspector]);
  return <WorkflowInspector definition={exampleDefinition} inspector={inspector} source={adapter.source} />;
}
function Preview() {
  const [mode, setMode] = useState("example");
  return <main><label className="wi-preview-mode">Preview source <select value={mode} onChange={event => setMode(event.target.value)}><option value="example">Local example</option><option value="runtime">Unconnected runtime</option></select></label>
    <PreviewSession key={mode} mode={mode} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
