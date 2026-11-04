import { useState } from "react";
import { WorktreeMap, createMapSelection } from "../../intake1411/worktree-map";
import { syntheticSnapshot } from "../../intake1411/worktree-map/syntheticSnapshot";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [selection] = useState(createMapSelection);
const [adapter] = useState(() => ({ getSnapshot: () => syntheticSnapshot(), subscribe: () => () => {} }));
const [open, setOpen] = useState(true);
return <>{!open && <button className="worktree-map-reopen" type="button" onClick={() => setOpen(true)}>Open Worktree map</button>}
<section hidden={!open} className="worktree-map-example" aria-label="Worktree map example" data-guide="worktree-map">
<div><strong>Worktree map · local example</strong><span><button type="button" onClick={() => actions.openCatalog("worktree-map")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<WorktreeMap enabled adapter={adapter} selection={selection} hostView={null} onRequestClose={() => setOpen(false)} />
</section></>;
}
