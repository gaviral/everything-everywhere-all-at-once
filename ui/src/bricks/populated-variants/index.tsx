import { useState } from "react";
import { PopulatedVariants } from "../../features/populated-variants";
import { syntheticCandidates } from "../../features/populated-variants/ExamplePopulation";
import { browserPreferenceStore } from "../../features/populated-variants/preferences";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [adapter] = useState(() => ({ getCandidates: () => [...syntheticCandidates], subscribe: () => () => {}, preferences: browserPreferenceStore("e2a2o.examples.populated-variants") }));
const [open, setOpen] = useState(true);
return <>{!open && <button className="populated-variants-reopen" type="button" onClick={() => setOpen(true)}>Open Populated variants</button>}
<section hidden={!open} className="populated-variants-example" aria-label="Populated variants example" data-guide="populated-variants">
<div><strong>Populated variants · local example</strong><span><button type="button" onClick={() => actions.openCatalog("populated-variants")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<PopulatedVariants enabled adapter={adapter} />
</section></>;
}
