import { useEffect, useRef, type MouseEvent } from "react";
import { onReading } from "./apps-audio";
import { keyWords, useSite } from "./site";
import "./micbutton.css";

// The mic is the main control, and doubt about being heard makes people stop or say it again. So each state it can be
// in looks different at a glance, by shape and color, never by color alone, and says its words on hover, focus and
// tap (Tips.tsx) and in the composer's placeholder:
// - off: a soft blue disc, as before
// - starting: a dashed ring, not yet whole
// - listening: a filled blue disc with a thin ring; hearing you: the ring swells with your voice
// - paused ("stop listening"): the off disc with a pause badge, so it isn't mistaken for never started
// - no key, refused, resting (the hosted site's daily limit) and blocked (the browser or the computer keeps the mic
//   from this page): an amber mic struck through (amber is what needs you); each says why on a tap
// - connecting: faded, and it can't be pressed
export type MicState = "offline" | "off" | "starting" | "listening" | "hearing" | "paused" | "nokey" | "refused" | "resting" | "blocked";

export function micState(s: { connected: boolean; capturing: boolean; starting: boolean; serviceOn: boolean;
  words: boolean; paused: boolean; noKey: boolean; refused: boolean; resting?: boolean; blocked?: boolean }): MicState {
  // Capturing comes first: the button never reads off while the browser is taking sound.
  if (s.capturing) return !s.serviceOn ? "starting" : s.words ? "hearing" : "listening";
  if (s.starting) return "starting";
  if (!s.connected) return "offline";
  // Without the AI, allowing the mic wouldn't help yet: the key's state comes first.
  if (s.noKey) return s.refused ? "refused" : s.resting ? "resting" : "nokey";
  if (s.blocked) return "blocked";
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
  offline: { tip: "Connecting… The mic works once the app is connected.", label: "Microphone, connecting" },
  off: { tip: "Mic off. Tap to talk.", label: "Start listening" },
  starting: { tip: "Starting the microphone…", label: "Starting the microphone" },
  listening: { tip: "Listening. The ring swells as it hears you. Tap to stop.", label: "Stop listening" },
  hearing: { tip: "Hearing you. Tap to stop.", label: "Stop listening, hearing you" },
  paused: { tip: "Paused by “stop listening”: nothing is heard. Tap to talk again.", label: "Start listening, paused" },
  nokey: { tip: keyWords(false, false, "mic"), label: "Start listening, needs an AI key" },
  refused: { tip: keyWords(false, true, "mic"), label: "Start listening, AI key refused" },
  resting: { tip: keyWords(true, false, "mic", true), label: "Start listening, free tries used up until tomorrow" },
  blocked: { tip: "The microphone is blocked for this page. Tap to see how to allow it, or type.", label: "Start listening, microphone blocked" },
};

/** The composer's placeholder, which sits where your eyes are while you talk. */
export function composerHint(state: MicState): string {
  return state === "listening" || state === "hearing" ? "Or type a thought"
    : state === "starting" ? "Starting the microphone… or type"
    : state === "paused" ? "Paused · tap the mic to talk, or type"
    : state === "nokey" ? "Type a thought · the mic needs an AI key"
    : state === "refused" ? "Type a thought · the AI key was refused"
    : state === "resting" ? "Type a thought · placed tomorrow"
    : state === "blocked" ? "Type a thought · the mic is blocked"
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
export function MicButton({ state, capturing, disabled, onClick }: { state: MicState; capturing: boolean; disabled: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
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
      {(state === "nokey" || state === "refused" || state === "resting" || state === "blocked") && <path d="M4 3l16 18" />}
    </svg>
    {state === "paused" && <span className="mic-badge" aria-hidden="true"><i /><i /></span>}
  </>;
}
