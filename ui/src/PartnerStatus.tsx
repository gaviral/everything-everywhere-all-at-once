import { useEffect, useState } from "react";
import { usePartner } from "./partner";
import { pageSpeaking, stopPageSpeech, watchPageSpeech } from "./page-speech";
import { sendToCore } from "./room";
import { useBuiltInsOn } from "./shell/features";
import "./partner.css";

export function PartnerStatus() {
  const enabled = useBuiltInsOn().has("partner");
  const partner = usePartner();
  const [speaking, setSpeaking] = useState(pageSpeaking);
  useEffect(() => watchPageSpeech(setSpeaking), []);
  if (!enabled) return null;
  const busy = partner.state === "thinking" || speaking;
  return <div className="partner-status" data-guide="partner" aria-label="Conversation partner">
    <span role="status"><b>E2A2O</b> · {speaking ? "Speaking…" : partner.message}</span>
    {busy && <button type="button" onClick={() => {
      stopPageSpeech();
      sendToCore({ type: "partner_cancel" });
    }}>Cancel reply</button>}
  </div>;
}
