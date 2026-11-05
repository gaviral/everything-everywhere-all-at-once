import { useState } from "react";
import { DependencySequences } from "../../features/dependency-sequences";
import { syntheticSnapshot } from "../../features/dependency-sequences/fixtures";
function createExampleSequence() {
  let complete = false; const listeners = new Set<() => void>();
  return { adapter: { readSnapshot: async () => syntheticSnapshot(complete), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } }, advance() { complete = !complete; listeners.forEach(listener => listener()); } };
}
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(createExampleSequence);
const [open, setOpen] = useState(true);
return <>{!open && <button className="dependency-sequences-reopen" type="button" onClick={() => setOpen(true)}>Open Dependency sequences</button>}
<section hidden={!open} className="dependency-sequences-example" aria-label="Dependency sequences example" data-guide="dependency-sequences">
<div><strong>Dependency sequences · local example</strong><span><button type="button" onClick={() => actions.openCatalog("dependency-sequences")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<button onClick={example.advance}>Toggle prerequisite A complete</button><DependencySequences enabled adapter={example.adapter} onDisable={() => setOpen(false)} />
</section></>;
}
