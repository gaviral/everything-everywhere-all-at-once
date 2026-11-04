import { useEffect, useState } from "react";
import { sketchLabelsFeature } from "../../intake1411/sketch-labels/feature";
import { syntheticSketch } from "../../intake1411/sketch-labels/synthetic";
import { SketchLabels } from "../../intake1411/sketch-labels/SketchLabels";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(() => { const drawing = syntheticSketch(); drawing.drawThree(); return { drawing, controller: sketchLabelsFeature.create(drawing.adapters) }; });
useEffect(() => { example.controller.setEnabled(true); return () => example.controller.setEnabled(false); }, [example]);
return <section className="sketch-labels-example" aria-label="Sketch labels example" data-guide="sketch-labels">
<div><strong>Sketch labels · local example</strong><button onClick={() => actions.openCatalog("sketch-labels")}>Features</button></div>
<p>Select sample strokes or highlight a region, add a label, then try Undo. Your original marks stay intact.</p><SketchLabels controller={example.controller} />
</section>;
}
