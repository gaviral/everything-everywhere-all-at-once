import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DictationBreakdown } from "./index";
import { syntheticDictation, syntheticHomes } from "./fixture";

function Preview() {
  const [enabled, setEnabled] = useState(false);
  return <DictationBreakdown enabled={enabled} onEnabledChange={setEnabled} initialSource={syntheticDictation} queueHomes={syntheticHomes} />;
}
createRoot(document.getElementById("root")!).render(<Preview />);
