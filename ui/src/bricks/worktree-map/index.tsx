import { useState } from "react";
import { WorktreeMap, createMapSelection } from "../../intake1411/worktree-map";
import { syntheticSnapshot } from "../../intake1411/worktree-map/syntheticSnapshot";
import type { BrickProps } from "../contract";
import "./example.css";
import { LookSwitch, type Look } from "./looks/LookSwitch";
import "./looks/looks.css";

export default function Example({ actions }: BrickProps) {
const [look, setLook] = useState<Look>("current");
const [selection] = useState(createMapSelection);
const [adapter] = useState(() => ({ getSnapshot: () => syntheticSnapshot(), subscribe: () => () => {} }));
return <section data-look={look} className="worktree-map-example" aria-label="Worktree map example" data-guide="worktree-map">
<div><strong>Worktree map · local example</strong><button onClick={() => actions.openCatalog("worktree-map")}>Features</button></div>
<LookSwitch value={look} onChange={setLook} />
<WorktreeMap enabled adapter={adapter} selection={selection} hostView={null} onRequestClose={() => actions.openCatalog("worktree-map")} />
</section>;
}
