import { useEffect, useState } from "react";

/** The browser owns full screen, including Escape and permission refusals. */
export function FullScreen() {
  const [active, setActive] = useState(!!document.fullscreenElement);
  const [error, setError] = useState("");
  useEffect(() => {
    const changed = () => { setActive(!!document.fullscreenElement); setError(""); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Full screen unavailable. Try the browser's full screen control.");
    }
  };
  return <>
    <button type="button" className="shell-pill shell-button shell-fullscreen" aria-keyshortcuts="Enter" aria-pressed={active} aria-label={active ? "Exit full screen" : "Full screen"} title={active ? "Exit full screen" : "Full screen"} onClick={toggle}>
      <svg className="shell-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d={active ? "M1 5h4V1m6 0v4h4M1 11h4v4m6 0v-4h4" : "M5 1H1v4m10-4h4v4M1 11v4h4m6 0h4v-4"} />
      </svg>
      <span className="shell-fullscreen-word">{active ? "Exit full screen" : "Full screen"}</span>
    </button>
    {error && <span className="shell-fullscreen-error" role="status">{error}</span>}
  </>;
}
