import { useState } from "react";
import { DemoParts } from "../../intake1411/demo-parts/DemoParts";
import { createSyntheticAdapter } from "../../intake1411/demo-parts/synthetic";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(createSyntheticAdapter);
const [enabled, setEnabled] = useState(true);
return <section className="demo-parts-example" aria-label="Demo candidates example" data-guide="demo-parts">
<div><strong>Demo candidates · local example</strong><button onClick={() => actions.openCatalog("demo-parts")}>Features</button></div>
<button onClick={() => setEnabled(value => !value)}>{enabled ? "Pause candidate review" : "Resume candidate review"}</button>
<DemoParts enabled={enabled} adapter={example.adapter} />
</section>;
}
