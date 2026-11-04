import { useEffect, useState } from "react";
import { NativeReceipts, createReceiptVisit } from "../../intake1417/native-receipts";
import { sampleOperations } from "../../intake1417/native-receipts/samples";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [visit] = useState(() => createReceiptVisit(sampleOperations));
useEffect(() => { visit.setEnabled(true); return () => visit.setEnabled(false); }, [visit]);
const [open, setOpen] = useState(true);
return <>{!open && <button className="native-receipts-reopen" type="button" onClick={() => setOpen(true)}>Open Reminder receipts</button>}
<section hidden={!open} className="native-receipts-example" aria-label="Reminder receipts example" data-guide="native-receipts">
<div><strong>Reminder receipts · local example</strong><span><button type="button" onClick={() => actions.openCatalog("native-receipts")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<p>Sample outcomes only. This example creates no reminder and connects to no account.</p><NativeReceipts visit={visit} />
</section></>;
}
