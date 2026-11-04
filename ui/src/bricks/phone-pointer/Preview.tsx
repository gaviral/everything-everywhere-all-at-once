import { useEffect, useState } from "react";
import type { PointerLink } from "./transport";

export function Preview({ link, allowed, active }: { link: PointerLink; allowed: boolean; active: boolean }) {
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => { if (!active || !allowed) { setRunning(false); setFrame(""); } }, [active, allowed]);
  useEffect(() => {
    if (!running || !active) return;
    const abort = new AbortController();
    let timer = 0, current = "", live = true;
    const next = async () => {
      try {
        const response = await link.request("frame", { start: true }, abort.signal);
        const blob = await response.blob();
        if (!live) return;
        const image = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = image; setFrame(image); setProblem("");
        timer = window.setTimeout(() => void next(), 800);
      } catch (error) {
        if (live) { setProblem(String(error instanceof Error ? error.message : error)); setRunning(false); }
      }
    };
    void next();
    return () => { live = false; abort.abort(); clearTimeout(timer); if (current) URL.revokeObjectURL(current); setFrame(""); };
  }, [link, running, active]);
  return <section className="phone-pointer-preview" aria-label="Screen preview">
    <div><strong>Screen preview</strong><button disabled={!active || !allowed} onClick={() => setRunning(old => !old)}>{running ? "Pause preview" : "Start preview"}</button></div>
    {frame ? <img src={frame} alt="Live view of the Mac’s main display" /> : <p>{allowed ? "Paused · your trackpad works without video." : "Allow Screen Recording for the helper to enable preview."}</p>}
    {problem && <p role="alert">{problem}</p>}
    <small>Pauses when you leave. Start again when you return. No audio.</small>
  </section>;
}
