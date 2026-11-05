import { useState } from "react";
import { DemoParts } from "../../features/demo-parts/DemoParts";
import { createSyntheticAdapter } from "../../features/demo-parts/synthetic";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(createSyntheticAdapter);
const [enabled, setEnabled] = useState(true);
const [open, setOpen] = useState(true);
return <>{!open && <button className="demo-parts-reopen" type="button" onClick={() => setOpen(true)}>Open Demo candidates</button>}
<section hidden={!open} className="demo-parts-example" aria-label="Demo candidates example" data-guide="demo-parts">
<div><strong>Demo candidates · local example</strong><span><button type="button" onClick={() => actions.openCatalog("demo-parts")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<button onClick={() => setEnabled(value => !value)}>{enabled ? "Pause candidate review" : "Resume candidate review"}</button>
<DemoParts enabled={enabled} adapter={example.adapter} />
</section></>;
}
