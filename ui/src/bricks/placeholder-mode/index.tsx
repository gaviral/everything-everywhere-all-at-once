import { useLayoutEffect, useState } from "react";
import { MAX_NAME_LENGTH, MAX_NAMES } from "./mask-rules";
import { startTextPass } from "./text-pass";
import { startFieldPass } from "./field-pass";
import style from "./placeholder-mode.css?inline";

function useDisplayMask(names: readonly string[]) {
  useLayoutEffect(() => {
    const fields = startFieldPass(document.body, names);
    const stopText = startTextPass(document.body, names, fields.discover);
    return () => { stopText(); fields.stop(); };
  }, [names]);
}

function NameSettings({ names, setNames }: { names: string[]; setNames: (names: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (!name || names.length >= MAX_NAMES || names.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
    setNames([...names, name]); setDraft("");
  };
  return <details className="placeholder-mode-settings">
    <summary>Names to mask <span>{names.length}/{MAX_NAMES}</span></summary>
    <p>Names stay in memory while this feature is on. Entries stay hidden while you type.</p>
    <form onSubmit={event => { event.preventDefault(); add(); }}>
      <label htmlFor="placeholder-mode-name">Private name</label>
      <div className="placeholder-mode-add"><input id="placeholder-mode-name" type="password" autoComplete="off" maxLength={MAX_NAME_LENGTH}
        value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a name" />
        <button disabled={!draft.trim() || names.length >= MAX_NAMES}>Add</button></div>
    </form>
    <ul>{names.map((_, index) => <li key={index}><span>Person {index + 1}</span><button type="button" aria-label={`Remove Person ${index + 1}`} onClick={() => setNames(names.filter((_, i) => i !== index))}>Remove</button></li>)}</ul>
  </details>;
}

/** The feature owns presentation only. No map, network, storage or send action is used. */
export default function PlaceholderMode() {
  const [names, setNames] = useState<string[]>([]);
  useDisplayMask(names);
  return <section className="placeholder-mode" data-placeholder-mode-ui="" aria-label="Placeholder settings">
    <div className="placeholder-mode-heading"><span className="placeholder-mode-light" /><strong>Placeholders on</strong><span>Screen only</span></div>
    <p className="placeholder-mode-caption">Emails, phones &amp; recipients masked. Originals still used when sending.</p>
    <div className="placeholder-mode-example"><span>EXAMPLE</span><strong>you@example.com</strong><small>+1 (555) 010-0100</small></div>
    <NameSettings names={names} setNames={setNames} />
  </section>;
}

export const styles = style;
