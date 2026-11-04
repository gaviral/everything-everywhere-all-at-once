import type { MouseEvent } from "react";
import { retryPageReply, type Playback } from "./page-speech";
import { usePartner } from "./partner";
import { voicePolicy, type VoicePolicy } from "./talk/call-core";
import "./voice-policy-comparison.css";

type Policy = ReturnType<VoicePolicy["snapshot"]>;
export function VoicePolicyComparison({ policy, connected, captureOpen, starting, playback, placement, onStart, onStop, onStopReply }: {
  policy: Policy; connected: boolean; captureOpen: boolean; starting: boolean; playback: Playback; placement: string;
  onStart: (event: MouseEvent<HTMLButtonElement>) => void; onStop: () => void; onStopReply: () => void;
}) {
  const partner = usePartner();
  const speaking = playback.phase === "queued" || playback.phase === "playing";
  const capture = starting || policy.capture === "starting" ? "Starting"
    : captureOpen && policy.capture === "paused" ? "Mic paused · Speaking"
    : captureOpen ? "Listening" : "Mic off";
  return <section className="voice-policy-comparison" aria-label="Compare voice turns" data-mode={policy.mode}>
    <fieldset>
      <legend>Compare voice turns</legend>
      {([ ["explicit", "Explicit turns"], ["session", "Started session"] ] as const).map(([mode, label]) =>
        <label key={mode}><input type="radio" value={mode} name="voice-policy-mode" checked={policy.mode === mode}
          onChange={() => voicePolicy.select(mode)} />{label}</label>)}
    </fieldset>
    <div className="voice-policy-facts" role="status" aria-live="polite">
      <span data-fact="capture">{capture}</span>
      <span data-fact="device">{captureOpen ? "Microphone open" : "Microphone closed"}</span>
      <span data-fact="placement">{placement}</span>
      <span data-fact="playback">{playback.phase === "playing" ? "Reply playing" : playback.phase === "queued" ? "Reply queued" : playback.phase === "failed" ? "Reply audio failed" : "Reply stopped"}</span>
    </div>
    <div className="voice-policy-actions">
      {policy.mode === "session" && <button type="button" data-action="start-conversation" onClick={onStart}
        disabled={!connected || policy.session !== null}>Start conversation</button>}
      <button type="button" data-action="stop-reply" disabled={!speaking && partner.state !== "thinking"} onClick={onStopReply}>Stop reply</button>
      <button type="button" data-action="stop-conversation" disabled={!captureOpen && !starting && policy.session === null && !speaking && partner.state !== "thinking"} onClick={onStop}>Stop conversation</button>
    </div>
    <p>{policy.mode === "explicit" ? "Tap the mic for each turn. A reply leaves the mic off." : policy.session === null
      ? "Start conversation to keep listening between replies. Selecting this mode leaves the mic off."
      : "Conversation started. Replies pause transcription; Stop conversation closes the mic."}</p>
    {partner.state === "thinking" && <p role="status">Preparing reply</p>}
    {partner.state === "error" && <p role="status">{partner.message}</p>}
    {playback.phase === "failed" && <><p role="status">{playback.error}</p><button type="button" onClick={retryPageReply}>Retry audio</button></>}
    {playback.text && <details><summary>Reply text</summary><p>{playback.text}</p></details>}
  </section>;
}
