import { useState } from "react";
import { DependencySequences } from "../../intake1417/dependency-sequences";
import { syntheticSnapshot } from "../../intake1417/dependency-sequences/fixtures";
function createExampleSequence() {
  let complete = false; const listeners = new Set<() => void>();
  return { adapter: { readSnapshot: async () => syntheticSnapshot(complete), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } }, advance() { complete = !complete; listeners.forEach(listener => listener()); } };
}
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(createExampleSequence);
return <section className="dependency-sequences-example" aria-label="Dependency sequences example" data-guide="dependency-sequences">
<div><strong>Dependency sequences · local example</strong><button onClick={() => actions.openCatalog("dependency-sequences")}>Features</button></div>
<button onClick={example.advance}>Toggle prerequisite A complete</button><DependencySequences enabled adapter={example.adapter} onDisable={() => actions.openCatalog("dependency-sequences")} />
</section>;
}
