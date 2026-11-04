import { useEffect, useState } from "react";
import { NativeReceipts, createReceiptVisit } from "../../intake1417/native-receipts";
import { sampleOperations } from "../../intake1417/native-receipts/samples";
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [visit] = useState(() => createReceiptVisit(sampleOperations));
useEffect(() => { visit.setEnabled(true); return () => visit.setEnabled(false); }, [visit]);
return <section className="native-receipts-example" aria-label="Reminder receipts example" data-guide="native-receipts">
<div><strong>Reminder receipts · local example</strong><button onClick={() => actions.openCatalog("native-receipts")}>Features</button></div>
<p>Sample outcomes only. This example creates no reminder and connects to no account.</p><NativeReceipts visit={visit} />
</section>;
}
