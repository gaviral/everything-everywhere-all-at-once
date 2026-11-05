import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeReceipts, createReceiptVisit } from "./index";
import { sampleOperation, sampleOperations } from "./samples";

let receive: ((value: unknown) => void) | undefined;
const visit = createReceiptVisit(sampleOperations, { subscribe(listener) {
  receive = listener;
  return () => { if (receive === listener) receive = undefined; };
} });

function Preview() {
  const [mounted, setMounted] = useState(true);
  return <main>
    <aside className="native-receipts-preview-tools">
      <strong>Isolated synthetic preview</strong><p>No native adapter or Apple account is connected.</p>
      <button onClick={() => setMounted(value => !value)}>{mounted ? "Leave preview" : "Return to preview"}</button>{" "}
      <button onClick={() => receive?.(sampleOperation("confirmed"))}>Inject late sample confirmation</button>
    </aside>
    {mounted && <NativeReceipts visit={visit} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
