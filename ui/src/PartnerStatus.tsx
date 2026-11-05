import { AppMark } from "./AppMark";
import { cancelPartner, usePartner } from "./partner";
import { cancelPageReply, retryPageReply, usePlayback } from "./page-speech";
import { sendToCore } from "./room";
import { useBuiltInsOn } from "./shell/features";
import "./partner.css";

export function PartnerStatus({ onStopConversation, captureActive = false }: { onStopConversation: () => void; captureActive?: boolean }) {
  const features = useBuiltInsOn();
  const enabled = features.has("partner");
  const partner = usePartner();
  const playback = usePlayback();
  const playing = playback.phase === "playing" || playback.phase === "queued";
  if (!enabled && !playing && playback.phase !== "failed" && !captureActive) return null;
  const busy = (enabled && partner.state === "thinking" && playback.phase !== "failed") || playing;
  const replyText = !features.has("built-in-speech") && partner.state !== "thinking" && partner.state !== "error" ? playback.text : "";
  return <div className="partner-status" data-guide="partner" data-playback={playback.phase} aria-label="Spoken exchange">
    <span role="status">{playback.phase === "failed" ? playback.error : playing ? (playback.phase === "playing" ? "Reply playing" : "Preparing reply audio…") : enabled ? <><AppMark size="1.5em" /> · {replyText || (partner.state === "error" && /MODEL_API_KEY|configuration/i.test(partner.message) ? "Conversation unavailable. You can type below; open Details to enable replies." : partner.message)}</> : "Microphone open"}</span>
    {busy && <button type="button" onClick={() => {
      cancelPageReply();
      cancelPartner();
      sendToCore({ type: "partner_cancel" });
    }}>Stop reply</button>}
    {enabled && partner.state === "error" && /MODEL_API_KEY|configuration/i.test(partner.message) && <details><summary>Details</summary>{partner.message}</details>}
    {playback.phase === "failed" && <button type="button" onClick={retryPageReply}>Retry audio</button>}
    {(enabled || captureActive || playing) && <button type="button" onClick={onStopConversation}>Stop conversation</button>}
  </div>;
}
