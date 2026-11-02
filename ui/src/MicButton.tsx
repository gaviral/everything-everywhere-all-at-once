import { useEffect, useRef } from "react";
import { onReading } from "./apps-audio";
import "./micbutton.css";

// The mic is the main control, and doubt about being heard makes people stop or say it again. So each state it can be
// in looks different at a glance, by shape and color, never by color alone, and says its words on hover, focus and
// tap (Tips.tsx) and in the composer's placeholder:
// - off: a soft blue disc, as before
// - starting: a dashed ring, not yet whole
// - listening: a filled blue disc with a thin ring; hearing you: the ring swells with your voice
// - paused ("stop listening"): the off disc with a pause badge, so it isn't mistaken for never started
// - no key and refused: an amber mic struck through (amber is what needs you)
// - connecting: faded, and it can't be pressed
export type MicState = "offline" | "off" | "starting" | "listening" | "hearing" | "paused" | "nokey" | "refused";

export function micState(s: { connected: boolean; capturing: boolean; starting: boolean; serviceOn: boolean;
  words: boolean; paused: boolean; noKey: boolean; refused: boolean }): MicState {
  // Capturing comes first: the button never reads off while the browser is taking sound.
  if (s.capturing) return !s.serviceOn ? "starting" : s.words ? "hearing" : "listening";
  if (s.starting) return "starting";
  if (!s.connected) return "offline";
  if (s.noKey) return s.refused ? "refused" : "nokey";
  return s.paused ? "paused" : "off";
}

/** What the state is and what a tap does, for the tip and the button's name. */
export const MIC_WORDS: Record<MicState, { tip: string; label: string }> = {
  offline: { tip: "Connecting… The mic works once the app is connected.", label: "Microphone, connecting" },
  off: { tip: "Mic off. Tap to talk.", label: "Start listening" },
  starting: { tip: "Starting the microphone…", label: "Starting the microphone" },
  listening: { tip: "Listening. The ring swells as it hears you. Tap to stop.", label: "Stop listening" },
  hearing: { tip: "Hearing you. Tap to stop.", label: "Stop listening, hearing you" },
  paused: { tip: "Paused by “stop listening”: nothing is heard. Tap to talk again.", label: "Start listening, paused" },
  nokey: { tip: "No AI key: listening needs MODEL_API_KEY in .env. You can still type.", label: "Start listening, needs an AI key" },
  refused: { tip: "The AI key was refused: check MODEL_API_KEY in .env. You can still type.", label: "Start listening, AI key refused" },
};

/** The composer's placeholder, which sits where your eyes are while you talk. */
export function composerHint(state: MicState): string {
  return state === "listening" || state === "hearing" ? "Listening… or type"
    : state === "starting" ? "Starting the microphone… or type"
    : state === "paused" ? "Paused · tap the mic to talk, or type"
    : state === "nokey" ? "Type a thought · the mic needs an AI key"
    : state === "refused" ? "Type a thought · the AI key was refused"
    : state === "offline" ? "Type a thought — it will send when connected"
    : "Type a thought, or tap the mic";
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
export function MicButton({ state, capturing, disabled, onClick }: { state: MicState; capturing: boolean; disabled: boolean; onClick: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const on = state === "listening" || state === "hearing";
  useEffect(() => {
    const el = button.current;
    if (!on || !el) return;
    const stop = onReading((level) => el.style.setProperty("--fill", ringFill(level).toFixed(3)));
    return () => { stop(); el.style.removeProperty("--fill"); };
  }, [on]);
  const words = MIC_WORDS[state];
  return (
    <button
      ref={button}
      type="button"
      className={capturing ? "mic on" : "mic"}
      data-state={state}
      data-tip={capturing && state === "starting" ? "Starting the microphone… Tap to stop." : words.tip}
      onClick={onClick}
      // Without a key it stays pressable: the tap says why it can't listen (App.tsx toggleMic).
      disabled={disabled}
      aria-label={capturing && state === "starting" ? "Stop listening, starting" : words.label}
      aria-pressed={capturing}
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
      {(state === "nokey" || state === "refused") && <path d="M4 3l16 18" />}
    </svg>
    {state === "paused" && <span className="mic-badge" aria-hidden="true"><i /><i /></span>}
  </>;
}
