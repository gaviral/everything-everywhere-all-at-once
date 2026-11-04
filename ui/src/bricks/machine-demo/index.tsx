import { useEffect, useState } from "react";
import { MachineDemo, createMachineSession } from "../../intake1417/machine-demo";
import { createSyntheticAdapter, syntheticParts, syntheticProfiles, type SyntheticProfileName } from "../../intake1417/machine-demo/synthetic";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(() => { const supplier = createSyntheticAdapter(); return { supplier, session: createMachineSession(syntheticParts, supplier.adapter) }; });
const [profile, setProfile] = useState<SyntheticProfileName>("Mac · permission denied");
useEffect(() => { example.session.setEnabled(true); return () => example.session.setEnabled(false); }, [example]);
return <section className="machine-demo-example" aria-label="Machine readiness example" data-guide="machine-demo">
<div><strong>Machine readiness · local example</strong><button onClick={() => actions.openCatalog("machine-demo")}>Features</button></div>
<p>These supplied profiles do not inspect your device or change its permissions.</p><label>Example machine <select value={profile} onChange={event => { const name = event.target.value as SyntheticProfileName; setProfile(name); example.supplier.supply(syntheticProfiles[name]); }}>{Object.keys(syntheticProfiles).map(name => <option key={name}>{name}</option>)}</select></label><button onClick={() => example.session.setEnabled(true)}>Show readiness</button><MachineDemo session={example.session}><p>Readiness paused. Choose Show readiness to return.</p></MachineDemo>
</section>;
}
