import { useEffect, useRef, useState } from "react";
import { hasToured } from "./Tour";
import "./install.css";

// Install to the Dock or a phone's home screen. The manifest and icons (index.html, public/) make the app
// installable from the browser's own menu at any time; this is the one nudge, said once per browser, at a
// moment that earns it: after a thought of yours has found its thread in this visit, when the dock is quiet.

/** How this browser installs a web app: its own prompt (Chrome, Edge), a menu Safari names, or not at all. */
export type Way = "prompt" | "mac-safari" | "ios-safari" | null;

/** Which way applies, from the user agent; `prompt` is whether the browser has offered its install prompt. */
export function installWay(ua: string, touchPoints: number, prompt: boolean): Way {
  if (prompt) return "prompt";
  // Other browsers on iOS and in-app views name themselves; only Safari has Add to Home Screen and Add to Dock.
  if (!/Safari\//.test(ua) || /Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Firefox/.test(ua)) return null;
  // An iPad asks for the desktop site and says "Macintosh"; its touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "ios-safari";
  // Add to Dock arrived with Safari 17 (macOS Sonoma).
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  return /Macintosh/.test(ua) && version >= 17 ? "mac-safari" : null;
}

/** What the hint says, in the browser's own words for its menu. */
export function hintText(way: Exclude<Way, null>, phone: boolean): string {
  if (way === "mac-safari") return "Keep E2A2O in your Dock: File › Add to Dock.";
  if (way === "ios-safari") return "Keep E2A2O on your Home Screen: Share › Add to Home Screen.";
  return phone ? "Open E2A2O from your home screen, like any app." : "Open E2A2O from your Dock, like any app.";
}

/**
 * An address that won't open the map next week: a room guest's (the host laptop's IP, which changes with the
 * network) or a quick tunnel's (a new name every run). An icon for it would lead nowhere, so no hint there;
 * the browser's own menu still installs it for anyone who wants to.
 */
export function temporaryAddress(hostname: string): boolean {
  const name = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") return false;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(":") || name.endsWith(".trycloudflare.com");
}

/** Whether the hint may show in this browser at all (the moment comes later). */
export function eligible(page: { search: string; hostname: string; standalone: boolean; toured: boolean; shownBefore: boolean }) {
  // The demo's takes (`?recording`) never show it; nor does the installed app, a temporary address, a browser
  // still on its first tour, or one that has seen the hint.
  return !new URLSearchParams(page.search).has("recording") && !page.standalone && page.toured
    && !temporaryAddress(page.hostname) && !page.shownBefore;
}

/**
 * Whether a thought of yours was placed during this visit: one whose id wasn't on the map when it arrived (`atStart`).
 * Ids, not a count: a thought taken back ("scratch that") and a new one would leave the count where it started.
 */
export function placedSince(atStart: ReadonlySet<string> | null, placed: readonly string[]): boolean {
  return atStart !== null && placed.some((id) => !atStart.has(id));
}

const SHOWN_KEY = "e2a2o.install-hint";

/** True when it was already shown, or when storage doesn't work (then "once" can't be kept, so never). */
export function shownBefore() {
  try {
    localStorage.setItem(`${SHOWN_KEY}.probe`, "1");
    localStorage.removeItem(`${SHOWN_KEY}.probe`);
    return localStorage.getItem(SHOWN_KEY) === "1";
  } catch { return true; }
}
export function rememberShown() {
  try { localStorage.setItem(SHOWN_KEY, "1"); } catch { /* checked in shownBefore */ }
}

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
// Chrome may offer its prompt before the app mounts, so it's caught from the start. Holding it back keeps Chrome
// from showing its own banner on a phone at load, before the person has done anything; the Dock icon in the
// address bar stays.
let offered: PromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    offered = event as PromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    offered = null;
    rememberShown();
    listeners.forEach((l) => l());
  });
}

function standalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * `placedMine`: the ids of this window's thoughts on the map. `quiet`: nothing else is in the dock and the
 * person isn't mid-thought; `loaded`: the map has arrived, so what's on it already doesn't count. Returns the hint to
 * show, or null.
 */
export function useInstallHint(placedMine: readonly string[], quiet: boolean, loaded: boolean) {
  const [, rerender] = useState(0);
  const allowed = useRef<boolean | null>(null);
  // The tour is checked as it goes: it may finish during this visit, and counts from then on.
  if (allowed.current === null) {
    allowed.current = eligible({ search: location.search, hostname: location.hostname, standalone: standalone(),
      toured: true, shownBefore: shownBefore() });
  }
  const atStart = useRef<Set<string> | null>(null);
  if (loaded && atStart.current === null) atStart.current = new Set(placedMine);
  const [phase, setPhase] = useState<"waiting" | "shown" | "done">("waiting");
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  const way = installWay(navigator.userAgent, navigator.maxTouchPoints ?? 0, !!offered);
  // Earned from the next render on, never the one where the thought lands: the dock's own reply to it (the
  // first-thought line) is set in that same moment, and the hint must wait for it to go.
  const [earned, setEarned] = useState(false);
  useEffect(() => { if (placedSince(atStart.current, placedMine)) setEarned(true); }, [placedMine]);
  const show = phase === "waiting" ? allowed.current && hasToured() && way !== null && earned && quiet : phase === "shown";
  useEffect(() => {
    // Read again at the moment: another tab of this browser may have shown it since this one loaded.
    if (phase === "waiting" && show) {
      if (shownBefore()) { setPhase("done"); return; }
      rememberShown();
      setPhase("shown");
    }
    // Once seen, it goes as soon as the dock is needed again (a new thought, a card) and doesn't come back.
    if (phase === "shown" && !quiet) setPhase("done");
  }, [phase, show, quiet]);
  if (phase !== "shown" || way === null) return null;
  const close = () => setPhase("done");
  return {
    way,
    text: hintText(way, /Android/.test(navigator.userAgent)),
    install: way === "prompt" ? async () => {
      const event = offered;
      offered = null;
      close();
      if (event) { await event.prompt(); await event.userChoice.catch(() => null); }
    } : null,
    close,
  };
}

/** The hint, one quiet line in the dock above the composer. */
export function InstallHint({ hint, onLeave }: { hint: NonNullable<ReturnType<typeof useInstallHint>>; onLeave: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // A choice made from the keyboard: the hint goes, so focus goes back to the composer rather than the page.
  const leave = (then: () => void) => () => {
    const hadFocus = !!box.current?.contains(document.activeElement);
    then();
    if (hadFocus) requestAnimationFrame(onLeave);
  };
  return <div ref={box} className="install-hint" role="status" data-dock-card>
    <span>{hint.text}</span>
    <span className="install-hint-actions">
      {hint.install && <button type="button" onClick={leave(hint.install)}>Install</button>}
      <button type="button" className="quiet" onClick={leave(hint.close)}>{hint.install ? "Not now" : "Got it"}</button>
    </span>
  </div>;
}
