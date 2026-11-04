import { useState } from "react";
import { PopulatedVariants } from "../../intake1417/populated-variants";
import { syntheticCandidates } from "../../intake1417/populated-variants/ExamplePopulation";
import { browserPreferenceStore } from "../../intake1417/populated-variants/preferences";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [adapter] = useState(() => ({ getCandidates: () => [...syntheticCandidates], subscribe: () => () => {}, preferences: browserPreferenceStore("e2a2o.examples.populated-variants") }));
return <section className="populated-variants-example" aria-label="Populated variants example" data-guide="populated-variants">
<div><strong>Populated variants · local example</strong><button onClick={() => actions.openCatalog("populated-variants")}>Features</button></div>
<PopulatedVariants enabled adapter={adapter} />
</section>;
}
