import { useState } from "react";
import type { BrickProps } from "../contract";
import { DictationBreakdown } from "../../features/dictation-breakdown";
import { syntheticDictation, syntheticHomes } from "../../features/dictation-breakdown/fixture";
import "./example.css";

export default function DictationExample({ actions }: BrickProps) {
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(true);
return <>{!open && <button className="dictation-breakdown-reopen" type="button" onClick={() => setOpen(true)}>Open Dictation breakdown</button>}
<section hidden={!open} className="dictation-breakdown-example" aria-label="Dictation breakdown example" data-guide="dictation-breakdown">
    <div><strong>Dictation breakdown · local example</strong><span><button type="button" onClick={() => actions.openCatalog("dictation-breakdown")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
    <DictationBreakdown enabled={enabled} onEnabledChange={setEnabled} initialSource={syntheticDictation} queueHomes={syntheticHomes} />
  </section></>;
}
