import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Part } from "./data";
import { runPart, type Result } from "./trial";
export function DeskPart({ part, partial, reduced, remove, select }: { part: Part; partial: string; reduced: boolean; remove: () => void; select: () => void }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState(part.modes[0]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const heard = useRef<{ start: number; text: string } | null>(null);
  const voice = mode === "hears" && !part.prompt;
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    if (!voice) { heard.current = null; return; }
    if (partial) {
      heard.current = { start: heard.current?.start ?? performance.now(), text: partial };
    } else if (heard.current) {
      setResult({ text: heard.current.text, ms: performance.now() - heard.current.start, label: "Transcript span" }); heard.current = null;
    }
  }, [partial, voice]);
  async function run() {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setResult(null);
    try { const next = await runPart(part, mode, input, controller.signal); if (!controller.signal.aborted) setResult(next); }
    catch (error) { if (!controller.signal.aborted) setResult({ ms: 0, error: String(error) }); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <motion.article layout={!reduced} layoutId={reduced ? undefined : part.id} transition={{ duration: .32, ease: "easeInOut" }} className="workshop-part" onFocusCapture={select} onPointerDown={select} aria-label={`${part.name} on desk`}>
    <div className="workshop-part-head"><div><p className="workshop-eyebrow">{part.prompt ? "Flow part" : "Meta model"}</p><h3>{part.name}</h3></div><button onClick={remove} aria-label={`Take ${part.name} away`}>Take away ↑</button></div>
    <p className="workshop-model-id">{part.model}</p>
    <label className="workshop-field">Mode<select value={mode} disabled={busy} onChange={e => { setMode(e.target.value); setResult(null); }}>{part.modes.map(m => <option key={m}>{m}</option>)}</select></label>
    {part.prompt && <details className="workshop-prompt"><summary>Prompt</summary><p>{part.prompt}</p></details>}
    {voice ? <p className="workshop-voice">Ready for speech. Start listening with the app’s control when you choose. Transcript span measures first live words to the end of the turn.</p> : <form onSubmit={e => { e.preventDefault(); void run(); }}>
      <label className="workshop-field">{mode === "draws" ? "Describe an image" : "Text to try"}<textarea maxLength={24000} rows={3} value={input} onChange={e => setInput(e.target.value)} required /></label>
      <div className="workshop-run"><button disabled={busy || !input.trim()} type="submit">{busy ? "Running…" : "Run"}</button>{busy && <button type="button" onClick={() => { active.current?.abort(); setBusy(false); }}>Stop waiting</button>}</div>
    </form>}
    <div className="workshop-result" role="status" aria-live="polite">{voice && partial ? partial : result?.error ? <p className="workshop-error">{result.error}</p> : result ? <><p className="workshop-time">{result.label ?? "Run"} · {(result.ms / 1000).toFixed(2)} s</p>{result.image ? <img className="workshop-image" src={result.image} alt={input} /> : <p>{result.text}</p>}</> : <p>{busy ? "Waiting for the model…" : "Ready · no run yet"}</p>}</div>
  </motion.article>;
}
