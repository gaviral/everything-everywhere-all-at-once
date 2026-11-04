import { useState } from "react";
import type { BrickProps } from "../contract";
import { DemoVariants, createVariantSession, type VariantReference } from "../../msg1351/demo-variants";
import "./example.css";

const choices: readonly VariantReference[] = [
  { id: "example-gallery", title: "Gallery", branchId: "example/gallery", canvasId: "example-gallery", features: [
    { id: "outline", label: "Outline", description: "A compact outline of the story." },
    { id: "cards", label: "Picture cards", description: "Browse the story as picture cards." },
  ] },
  { id: "example-timeline", title: "Timeline", branchId: "example/timeline", canvasId: "example-timeline", features: [
    { id: "outline", label: "Outline", description: "A compact outline of the story." },
    { id: "steps", label: "Story steps", description: "Follow the story in sequence." },
  ] },
];
export default function DemoChoicesExample({ actions }: BrickProps) {
  const [session] = useState(() => { const session = createVariantSession(choices); session.setEnabled(true); return session; });
  const [open, setOpen] = useState(true);
return <>{!open && <button className="demo-variants-reopen" type="button" onClick={() => setOpen(true)}>Open Demo choices</button>}
<section hidden={!open} className="demo-variants-example" aria-label="Demo choices example" data-guide="demo-variants">
    <div><strong>Demo choices · local example</strong><span><button type="button" onClick={() => actions.openCatalog("demo-variants")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
    <p>Compare sample feature lists. Your choice stays in this example; repository merging is unavailable.</p>
    <DemoVariants session={session} />
  </section></>;
}
