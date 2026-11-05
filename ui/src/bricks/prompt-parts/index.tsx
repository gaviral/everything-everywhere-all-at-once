import { usePluginState, type BrickProps } from "../contract";
import { Catalog } from "./Catalog";
import { Composition } from "./Composition";
import { Workbench } from "./Workbench";
import { EXAMPLE_INPUT, partById } from "./records";
import { useComposition } from "./useComposition";
import style from "./prompt-parts.css?inline";

export default function PromptParts({ map }: BrickProps) {
  const [selected, setSelected] = usePluginState("selected", "explain-diff");
  const [next, setNext] = usePluginState("next", "pr-description");
  const [input, setInput] = usePluginState("input", EXAMPLE_INPUT);
  const { composition, busy, error, run, stop, showExample } = useComposition();
  const part = partById(selected);
  const stale = composition.source !== input || composition.results[0]?.partId !== selected || (composition.results[1]?.partId ?? "") !== next;
  function example() { setSelected("explain-diff"); setNext("pr-description"); setInput(EXAMPLE_INPUT); showExample(); }
  return <main className="prompt-parts" data-guide="prompt-parts">
    <div className="prompt-parts-intro"><div><p className="prompt-parts-eyebrow">Developer collection · Vol. 01</p><h1>Good work.<br /><span>Small parts.</span></h1><p className="prompt-parts-subtitle">One clear job. One useful answer.<br />Connect two, and keep going.</p></div>
      <div className="prompt-parts-intro-side"><span className="prompt-parts-model"><i /> Powered by Muse Spark</span><p>Twelve named prompts<br />for the work around the code.</p><button type="button" disabled={busy} onClick={example}>Load example <span aria-hidden="true">↗</span></button></div></div>
    <div className="prompt-parts-studio">
      <Workbench map={map} part={part} next={next} input={input} busy={busy} setNext={setNext} setInput={setInput} run={() => void run(next ? [part, partById(next)] : [part], input)} stop={stop} />
      <div><Composition value={composition} stale={stale} /><p role="status" className="prompt-parts-status">{error || (busy ? "Answers arrive here. Each completed answer becomes the next part’s input." : stale ? "Input or parts changed. Run again to update the answers." : composition.example ? "Illustrative example · no model call yet. Run it to get a fresh answer." : "Composition complete. Review the answers before using them.")}</p></div>
    </div>
    <Catalog selected={selected} busy={busy} choose={choice => { setSelected(choice.id); if (next === choice.id) setNext(""); }} />
    <footer className="prompt-parts-footer"><span>A prompt is a part. A part has one job.</span><span>Muse Spark · Text in, text out</span></footer>
  </main>;
}

export const styles = style;
