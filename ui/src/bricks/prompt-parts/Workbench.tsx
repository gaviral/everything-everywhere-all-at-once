import type { BrickProps } from "../contract";
import { INPUT_LIMIT, PARTS, type PromptPart } from "./records";

type Props = { map: BrickProps["map"]; part: PromptPart; next: string; input: string; busy: boolean;
  setNext: (value: string) => void; setInput: (value: string) => void; run: () => void; stop: () => void };
export function Workbench({ map, part, next, input, busy, setNext, setInput, run, stop }: Props) {
  const thoughts = map.thoughts.filter(thought => thought.placed && thought.text.trim());
  const activeThought = thoughts.filter(thought => thought.thread_id === map.active).at(-1);
  const length = Array.from(input).length;
  return <section className="prompt-parts-workbench" aria-labelledby="prompt-parts-work-title">
    <div className="prompt-parts-section-title"><h2 id="prompt-parts-work-title">Start with something real.</h2><span>01 / Input</span></div>
    <div className="prompt-parts-input-card">
      <label className="prompt-parts-label" htmlFor="prompt-parts-source">Your thought or pasted text</label>
      <div className="prompt-parts-source-tools">
        <select aria-label="Use a thought from the map" value="" disabled={busy || !thoughts.length} onChange={event => {
          const thought = thoughts.find(row => row.id === event.target.value); if (thought) setInput(thought.text);
        }}><option value="">{thoughts.length ? "Choose a map thought…" : "No map thoughts yet"}</option>{thoughts.map(thought => <option key={thought.id} value={thought.id}>{thought.text.slice(0, 90)}</option>)}</select>
        {activeThought && <button type="button" disabled={busy} onClick={() => setInput(activeThought.text)}>Use selected topic</button>}
      </div>
      <textarea id="prompt-parts-source" spellCheck={false} value={input} disabled={busy} onChange={event => setInput(event.target.value)} />
      <span className={`prompt-parts-count ${length > INPUT_LIMIT ? "prompt-parts-over" : ""}`}>{length.toLocaleString()} / {INPUT_LIMIT.toLocaleString()} characters</span>
    </div>
    <div className="prompt-parts-recipe">
      <span className="prompt-parts-eyebrow">02 / Your part</span><h3>{part.name}</h3><p>{part.job}</p>
      <dl><div><dt>Takes</dt><dd>{part.takes}</dd></div><div><dt>Gives</dt><dd>{part.gives}</dd></div></dl>
      <details className="prompt-parts-prompt"><summary>Read the prompt</summary><p>{part.prompt}</p></details>
      <label className="prompt-parts-label" htmlFor="prompt-parts-next">Then send its answer to</label>
      <select id="prompt-parts-next" value={next} disabled={busy} onChange={event => setNext(event.target.value)}><option value="">No second part</option>{PARTS.filter(row => row.id !== part.id).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <div className="prompt-parts-run-row"><button className="prompt-parts-run" type="button" disabled={busy || !input.trim() || length > INPUT_LIMIT} onClick={run}>{busy ? "Running with Spark…" : next ? "Run two parts" : "Run this part"}<span aria-hidden="true">↗</span></button>{busy && <button type="button" onClick={stop}>Stop</button>}</div>
      <p className="prompt-parts-footnote">Your text goes to Muse Spark when you run. Answers stay here.</p>
    </div>
  </section>;
}
