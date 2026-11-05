import { useState } from "react";
import { partById } from "./records";
import type { Composition as CompositionState } from "./useComposition";

export function Composition({ value, stale }: { value: CompositionState; stale: boolean }) {
  return <section className="prompt-parts-results" aria-labelledby="prompt-parts-answer-title">
    <div className="prompt-parts-section-title"><h2 id="prompt-parts-answer-title">{value.example ? "An example, connected." : "Your composition."}</h2><span>{value.example ? "Illustrative answers" : stale ? "Previous run" : "Muse Spark"}</span></div>
    <ol className="prompt-parts-tree" aria-label="Composition tree">
      <li className="prompt-parts-root"><span className="prompt-parts-node" aria-hidden="true">●</span><strong>{value.example ? "Example diff" : "Your input"}</strong><span>{value.results.length} connected {value.results.length === 1 ? "part" : "parts"}</span></li>
      {value.results.map((result, index) => <li key={result.partId} className="prompt-parts-branch"><Answer result={result} index={index} example={value.example} /></li>)}
    </ol>
    {!value.results.length && <p>Choose a part and run it to build your composition here.</p>}
  </section>;
}

function Answer({ result, index, example }: { result: CompositionState["results"][number]; index: number; example: boolean }) {
  const part = partById(result.partId);
  const [copyState, setCopyState] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(result.text); setCopyState("Copied"); }
    catch { setCopyState("Copy unavailable — select the answer to copy."); }
  }
  return <article className="prompt-parts-answer">
    <div className="prompt-parts-answer-top"><span className="prompt-parts-node" aria-hidden="true">{index + 1}</span><h3>{part.name}</h3><span className="prompt-parts-badge">{result.status === "example" ? "Example" : result.status === "running" ? "Working…" : result.status === "done" ? "Complete" : result.status === "stopped" ? "Stopped · partial" : "Failed · partial"}</span></div>
    <p className="prompt-parts-from">{index === 0 ? "From your input" : "From the answer above"}</p>
    <div className="prompt-parts-output" aria-busy={result.status === "running"}>{result.text || (result.status === "running" ? "Spark is thinking…" : "No answer returned.")}</div>
    <div className="prompt-parts-answer-tools"><details><summary>See exact input</summary><pre>{result.input}</pre></details><button type="button" disabled={!result.text || result.status === "running"} onClick={() => void copy()}>Copy {example ? "example" : "answer"}</button></div>
    {copyState && <p role="status" className="prompt-parts-copy-status">{copyState}</p>}
  </article>;
}
