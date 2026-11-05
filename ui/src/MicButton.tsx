import { useEffect, useRef, type MouseEvent } from "react";
import { onReading } from "./apps-audio";
import { keyWords, useSite } from "./site";
import "./micbutton.css";

// Capture state belongs to the corner control; the composer only holds typed thoughts.
export type MicState = "capturing" | "reply-paused" | "failed" | "offline" | "off" | "starting" | "listening" | "hearing" | "paused" | "nokey" | "refused" | "resting" | "blocked";

export function micState(s: { connected: boolean; capturing: boolean; starting: boolean; serviceOn: boolean;
  comparisonPaused?: boolean; comparisonStarting?: boolean; playbackPaused?: boolean; failed?: boolean; words: boolean; paused: boolean; noKey: boolean; refused: boolean; resting?: boolean; blocked?: boolean }): MicState {
  // Capturing comes first: the button never reads off while the browser is taking sound.
  if (s.comparisonStarting) return "starting";
  if (s.capturing && s.comparisonPaused) return "reply-paused";
  if (s.capturing && s.playbackPaused) return "reply-paused";
  if (s.capturing) return !s.serviceOn ? "capturing" : s.words ? "hearing" : "listening";
  if (s.starting) return "starting";
  if (!s.connected) return "offline";
  // Without the AI, allowing the mic wouldn't help yet: the key's state comes first.
  if (s.noKey) return s.refused ? "refused" : s.resting ? "resting" : "nokey";
  if (s.blocked) return "blocked";
  if (s.failed) return "failed";
  return s.paused ? "paused" : "off";
}

/** Said when the connection drops while the mic runs: the words would go nowhere. */
export const MIC_OFFLINE = "The mic stopped: the connection was lost. Tap it once reconnected; you can still type below.";

/** Why the running mic must stop now, or "" to keep it: the connection gone (even before the speech service said it
 * listens: no "not listening" follows, and a reconnect never starts the stream again), a voice error, or this mic's
 * stream ended (`statusNew`, `listenedNew`: news since this mic started, so an old stream's late end is passed over). */
export function micEnds(s: { connected: boolean; listening: boolean; failed: boolean; statusNew: boolean; listenedNew: boolean }): "" | "offline" | "failed" | "ended" {
  if (!s.connected) return "offline";
  if (s.failed) return "failed";
  return !s.listening && s.statusNew && s.listenedNew ? "ended" : "";
}

/** What the state is and what a tap does, for the tip and the button's name. */
export const MIC_WORDS: Record<MicState, { tip: string; label: string }> = {
  capturing: { tip: "Microphone open, connecting speech… Tap to stop.", label: "Stop listening, connecting speech" },
  "reply-paused": { tip: "Capture paused during reply. The microphone is open. Tap to stop capture.", label: "Stop listening, capture paused during reply" },
  failed: { tip: "The mic stopped. Tap to retry, or type below.", label: "Retry microphone" },
  offline: { tip: "Connecting… The mic works once the app is connected.", label: "Microphone, connecting" },
  off: { tip: "Mic off. Tap to talk.", label: "Start listening" },
  starting: { tip: "Starting the microphone… Tap to cancel.", label: "Cancel microphone start" },
  listening: { tip: "Listening. The ring swells as it hears you. Tap to stop.", label: "Stop listening" },
  hearing: { tip: "Hearing you. Tap to stop.", label: "Stop listening, hearing you" },
  paused: { tip: "Paused by “stop listening”: nothing is heard. Tap to talk again.", label: "Start listening, paused" },
  nokey: { tip: keyWords(false, false, "mic"), label: "Start listening, needs an AI key" },
  refused: { tip: keyWords(false, true, "mic"), label: "Start listening, AI key refused" },
  resting: { tip: keyWords(true, false, "mic", true), label: "Start listening, free tries used up until tomorrow" },
  blocked: { tip: "The microphone is blocked for this page. Tap to see how to allow it, or type.", label: "Start listening, microphone blocked" },
};

/** Typing stays available independently of capture state. */
export function composerHint(_state: MicState): string {
  return "Type a thought";
}

/** One persistent control, with feedback only after an intentional attempt is refused. */
export function MicCorner({ note, ...button }: Parameters<typeof MicButton>[0] & { note: string }) {
  return <div className="mic-corner">
    {note && <span className="mic-corner-note" role="status">{note}</span>}
    <MicButton {...button} />
  </div>;
}

// The ring follows each loudness reading the core gets (every 320 ms, apps-audio.ts), on a log scale from a quiet
// room (0.01, where `?level` sees rooms sit between voices) to a shout (0.15, the loudest of the three measured voices,
// README "Volume apps"), so normal speech (0.075) already fills three quarters of it.
const QUIET = 0.01;
const SHOUT = 0.15;
export function ringFill(level: number): number {
  if (!(level > QUIET)) return 0;
  return Math.min(1, Math.log(level / QUIET) / Math.log(SHOUT / QUIET));
}

/** `capturing`: the browser is taking sound, so a tap stops it, even while the speech service is still starting. */
export function MicButton({ state, capturing, disabled, onClick, shortcut }: { state: MicState; capturing: boolean; disabled: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void; shortcut?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const on = state === "listening" || state === "hearing";
  useEffect(() => {
    const el = button.current;
    if (!on || !el) return;
    const stop = onReading((level) => el.style.setProperty("--fill", ringFill(level).toFixed(3)));
    return () => { stop(); el.style.removeProperty("--fill"); };
  }, [on]);
  const { hosted } = useSite();
  // Hosted, the key is the site's: its words say so, never .env.
  const words = hosted && (state === "nokey" || state === "refused") ? { ...MIC_WORDS[state], tip: keyWords(true, state === "refused", "mic") } : MIC_WORDS[state];
  return (
    <button
      ref={button}
      type="button"
      className={capturing ? "mic on" : "mic"}
      data-guide="mic"
      data-state={state}
      data-tip={capturing && state === "starting" ? "Starting the microphone… Tap to stop." : words.tip}
      onClick={onClick}
      // Without a key it stays pressable: the tap says why it can't listen (App.tsx toggleMic).
      disabled={disabled}
      aria-label={capturing && state === "starting" ? "Stop listening, starting" : words.label}
      aria-pressed={capturing}
      aria-keyshortcuts={shortcut}
    >
      <MicGlyph state={state} />
    </button>
  );
}

/** The mic's drawing, also used as the legend's samples in the ? list. */
export function MicGlyph({ state }: { state: MicState }) {
  return <>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {(state === "nokey" || state === "refused" || state === "resting" || state === "blocked") && <path d="M4 3l16 18" />}
    </svg>
    {(state === "paused" || state === "reply-paused") && <span className="mic-badge" aria-hidden="true"><i /><i /></span>}
  </>;
}
