import { useEffect, useState } from "react";
import { sketchLabelsFeature } from "../../features/sketch-labels/feature";
import { syntheticSketch } from "../../features/sketch-labels/synthetic";
import { SketchLabels } from "../../features/sketch-labels/SketchLabels";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(() => { const drawing = syntheticSketch(); drawing.drawThree(); return { drawing, controller: sketchLabelsFeature.create(drawing.adapters) }; });
useEffect(() => { example.controller.setEnabled(true); return () => example.controller.setEnabled(false); }, [example]);
const [open, setOpen] = useState(true);
return <>{!open && <button className="sketch-labels-reopen" type="button" onClick={() => setOpen(true)}>Open Sketch labels</button>}
<section hidden={!open} className="sketch-labels-example" aria-label="Sketch labels example" data-guide="sketch-labels">
<div><strong>Sketch labels · local example</strong><span><button type="button" onClick={() => actions.openCatalog("sketch-labels")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<p>Select sample strokes or highlight a region, add a label, then try Undo. Your original marks stay intact.</p><SketchLabels controller={example.controller} />
</section></>;
}
