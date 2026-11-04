import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AliasRequest, AliasTarget, BrickProps, VoiceAlias } from "../contract";
import { normalizePhrase, targetLabel } from "./rules";
import "./voice-shortcuts.css";

type Draft = {id: string; revision: number; phrase: string; target: AliasTarget; enabled: boolean};
const fresh = (): Draft => ({id:crypto.randomUUID(),revision:0,phrase:"",target:{kind:"next_topic"},enabled:true});
export default function VoiceShortcuts({map, actions}: BrickProps) {
  const [draft, setDraft] = useState(fresh);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState("");
  const [undo, setUndo] = useState<{alias: VoiceAlias; revision:number} | null>(null);
  const [retry, setRetry] = useState<{request: AliasRequest; before?: VoiceAlias} | null>(null);
  const [focusReturn, setFocusReturn] = useState(0);
  const phrase = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const generation = useRef(0);
  useEffect(() => {live.current=true; return () => {live.current=false;};}, []);
  useLayoutEffect(() => { if (focusReturn) phrase.current?.focus(); }, [focusReturn]);
  const records = (map.aliases ?? []).filter(a => a.owner === map.me && !a.deleted);
  const update = (next: Partial<Draft>) => { generation.current++; setDraft(d => ({...d,...next})); setPreview(false); setRetry(null); setMessage(""); };
  const ask = async (request: AliasRequest, before?: VoiceAlias) => {
    const at = generation.current;
    setBusy(true); setMessage("Waiting for acknowledgement…");
    const answer = await actions.voiceShortcut(request);
    if (!live.current || at !== generation.current) return;
    setBusy(false); setMessage(answer.message);
    if (!answer.ok) { setRetry({request,before}); return; }
    setRetry(null);
    if (request.operation === "preview") { setPreview(request.id === draft.id && request.revision === draft.revision && request.phrase === draft.phrase && JSON.stringify(request.target) === JSON.stringify(draft.target) && request.enabled === draft.enabled); return; }
    if (request.operation === "try") return;
    if (before) setUndo({alias:before,revision:before.revision+1});
    else setUndo(null);
    if (request.id === draft.id) setDraft(fresh()); setPreview(false);
    setFocusReturn(n => n + 1);
  };
  const request = (operation: AliasRequest["operation"], value: Draft = draft): AliasRequest => ({...value,request_id:crypto.randomUUID(),operation});
  const edit = (alias: VoiceAlias) => { update(alias); phrase.current?.focus(); };
  const testAlias = () => {
    const found = records.find(a => a.enabled && !a.unavailable && normalizePhrase(a.phrase) === normalizePhrase(test));
    if (!found) { setMessage("No exact enabled shortcut. These words keep their ordinary meaning."); return; }
    // Test is the mutation-free server Preview; never sends a turn or executes an action.
    void ask(request("preview", found));
  };
  return <section className="voice-shortcuts" aria-label="My voice shortcuts">
    <h2>My voice shortcuts</h2>
    <p>Taught by you · exact whole turns only. Preview and Test never execute.</p>
    <ul>{records.map(alias => <li key={alias.id}>
      <strong>{alias.phrase}</strong><span>{alias.unavailable ? `Topic no longer on map${alias.target.kind === "open_topic" ? ` (${alias.target.topic_id})` : ""}` : targetLabel(alias.target,map.threads)}</span>
      <small>{alias.enabled ? "Enabled" : "Disabled"} · Taught by you</small>
      <div className="voice-shortcuts-controls">
        <button type="button" disabled={busy} onClick={() => edit(alias)}>Edit</button>
        <button type="button" disabled={busy} onClick={() => void ask(request("preview",alias))}>Preview</button>
        <button type="button" disabled={busy || !alias.enabled || alias.unavailable || !map.connected} onClick={() => void ask(request("try",alias))}>Try now</button>
        <button type="button" disabled={busy || (alias.unavailable && !alias.enabled)} onClick={() => void ask(request("save",{...alias,enabled:!alias.enabled}),alias)}>{alias.enabled ? "Disable" : "Enable"}</button>
        <button type="button" disabled={busy} onClick={() => void ask(request("delete",alias),alias)}>Delete</button>
      </div>
    </li>)}</ul>
    <form onSubmit={e => {e.preventDefault(); if (!busy) void ask(request("preview"));}}>
      <h3>{draft.revision ? "Edit shortcut" : "Add shortcut"} · {records.length}/30</h3>
      <label>Phrase<input ref={phrase} value={draft.phrase} maxLength={160} disabled={busy} onChange={e => update({phrase:e.target.value})} required /></label>
      <label>Action<select value={draft.target.kind} disabled={busy} onChange={e => update({target:e.target.value === "open_topic" ? {kind:"open_topic",topic_id:map.threads[0]?.id ?? ""} : {kind:e.target.value as "next_topic" | "previous_topic" | "show_recap"}})}>
        <option value="open_topic">Open topic by ID</option><option value="next_topic">Next topic</option><option value="previous_topic">Previous topic</option><option value="show_recap">Show recap</option>
      </select></label>
      {draft.target.kind === "open_topic" && <label>Topic<select value={draft.target.topic_id} disabled={busy} required onChange={e => update({target:{kind:"open_topic",topic_id:e.target.value}})}>
        <option value="">Choose a topic</option>{map.threads.map(t => <option key={t.id} value={t.id}>{t.title} ({t.id})</option>)}
      </select></label>}
      <div className="voice-shortcuts-controls"><button type="submit" disabled={busy || !map.connected}>Preview</button>
        <button type="button" disabled={busy || !preview || !map.connected} onClick={() => void ask(request("save"))}>Save</button>
        <button type="button" disabled={busy} onClick={() => {update(fresh()); phrase.current?.focus();}}>Cancel edit</button></div>
    </form>
    <label>Test alias<input value={test} disabled={busy} onChange={e => {setTest(e.target.value); setPreview(false);}} /></label>
    <button type="button" disabled={busy || !test.trim() || !map.connected} onClick={testAlias}>Test alias</button>
    <p role="status" aria-live="polite">{message}</p>
    {retry && <button type="button" disabled={busy || !map.connected} onClick={() => void ask(retry.request,retry.before)}>Retry request</button>}
    {undo && <button type="button" disabled={busy || !map.connected} onClick={() => void ask(request("save",{...undo.alias,revision:undo.revision}))}>Undo</button>}
    <p>Navigation stays local. Recap uses its ordinary model allowance. Switching this feature off keeps saved shortcuts.</p>
  </section>;
}
