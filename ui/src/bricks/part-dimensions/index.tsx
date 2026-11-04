import type { BrickProps } from "../contract";
import { PartDimensions, type Presentation, type Contribution } from "../../msg1351/part-dimensions";
import "./example.css";

const parts: Parameters<typeof PartDimensions>[0]["graph"]["parts"] = [
  { id: "example:card", name: "Step card", file: "example/step-card.tsx", line: 1, tags: ["view"], version: 3, version_scope: "file history" },
  { id: "example:selection", name: "Selection", file: "example/selection.ts", line: 1, tags: ["function"], version: 2, version_scope: "file history" },
  { id: "example:record", name: "Step record", file: "example/record.ts", line: 1, tags: ["data"], version: 4, version_scope: "file history" },
];
const reference = (index: number, children: Contribution[] = []): Contribution => ({ part: { id: parts[index].id, version: parts[index].version }, children });
const presentation: Presentation = { version: "example-1", steps: [
  { id: "choose", title: "Choose a step", description: "Select one moment in the sequence.", contributors: { ui: [reference(0, [reference(1)])], functionality: [reference(1)], data: [reference(2)] } },
  { id: "trace", title: "Trace its parts", description: "See the interface, behavior and data that make the step work.", contributors: { ui: [reference(0)], functionality: [reference(1, [reference(2)])], data: [reference(2)] } },
  { id: "inspect", title: "Inspect a part", description: "The same part keeps its identity across every step.", contributors: { ui: [reference(0)], functionality: [reference(1)], data: [reference(2)] } },
] };
export default function PartDimensionsExample({ actions }: BrickProps) {
  return <section className="part-dimensions-example" aria-label="Part dimensions example" data-guide="part-dimensions">
    <div><strong>Part dimensions · example parts</strong><button onClick={() => actions.openCatalog("part-dimensions")}>Features</button></div>
    <PartDimensions enabled graph={{ parts }} presentation={presentation} />
  </section>;
}
