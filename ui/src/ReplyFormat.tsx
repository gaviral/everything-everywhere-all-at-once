import { useEffect, useState, useSyncExternalStore } from "react";
import { builtInOn, useBuiltInsOn } from "./shell/features";
import { cancelPageReply, hearPageSpeech, replyStopped } from "./page-speech";
import "./reply-format.css";

export type Preferences = { maxWords: number; bullets: boolean; pointFirst: boolean };
export const DEFAULT_FORMAT: Preferences = { maxWords: 60, bullets: false, pointFirst: false };
export const PREAMBLES = ["sure", "certainly", "of course", "here is", "here are", "happy to help", "let me", "great question"];
export function checkFormat(text: string, format: Preferences): string[] {
  const failed: string[] = [];
  const words = text.trim().split(/\s+/u).filter(w => w && w !== "-" && w !== "•").length;
  const lines = text.split(/\r?\n/u).map(l => l.trim()).filter(Boolean);
  if (!words || words > format.maxWords) failed.push("word count");
  if ([...text].length > 2400) failed.push("display bound");
  if (lines.some(l => format.bullets ? !/^(?:- |• )/u.test(l) : /^(?:- |• |[*#>]|\d+[.)] )/u.test(l))) failed.push("line prefix shape");
  const first = (lines[0] ?? "").replace(/^(?:- |• )/u, "").toLowerCase();
  if (format.pointFirst && PREAMBLES.some(p => first.startsWith(p) && (!first[p.length] || !/[\p{L}\p{N}]/u.test(first[p.length])))) failed.push("no preamble");
  return failed;
}

type Reply = { reply_id: string; displayText: string; speakText: string; available_answer: string | null };
type State = { preferences: Preferences; revision: number; ready: boolean; message: string; reply: Reply | null; ack: string | null; accepted: boolean };
const initial: State = { preferences: DEFAULT_FORMAT, revision: 0, ready: false, message: "Waiting for this conversation", reply: null, ack: null, accepted: false };
let state = initial;
const listeners = new Set<() => void>();
const set = (next: State) => { state = next; listeners.forEach(f => f()); };
const useFormat = () => useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => state, () => initial);
const enabled = () => builtInOn("partner") && builtInOn("reply-format");
let send: ((message: object) => boolean) | null = null;
export function connectReplyFormat(sender: ((message: object) => boolean) | null) { send = sender; }
export function resetReplyFormat() { set(initial); }
export function stopReplyFormat() { cancelPageReply(); set({ ...state, ready: false, reply: null }); }
export function receiveReplyFormat(msg: { type: string; [key: string]: unknown }): boolean {
  if (msg.type !== "reply_format_state" && msg.type !== "partner_reply") {
    if (msg.type === "partner_state" && ["thinking", "cancelled", "error"].includes(String(msg.state))) set({ ...state, reply: null });
    return false;
  }
  if (!enabled()) return true;
  if (msg.type === "reply_format_state") {
    set({ ...state, preferences: msg.preferences as Preferences, revision: msg.revision as number, ready: true,
      message: String(msg.message), ack: msg.request_id as string | null, accepted: !!msg.accepted });
  } else if (!replyStopped(msg.reply_id as string)) {
    const reply = msg as unknown as Reply;
    set({ ...state, reply });
    hearPageSpeech(JSON.stringify({ ...msg, speak: true }));
  }
  return true;
}

export function ReplyFormat() {
  const on = useBuiltInsOn();
  return on.has("reply-format") ? <FormatSettings partner={on.has("partner")} /> : null;
}
function FormatSettings({ partner }: { partner: boolean }) {
  const current = useFormat();
  const [draft, setDraft] = useState(current.preferences);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ request_id: string; observed_revision: number; preferences: Preferences } | null>(null);
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState("");
  useEffect(() => { if (!dirty) setDraft(current.preferences); }, [current.preferences, dirty]);
  useEffect(() => {
    if (pending && current.ack === pending.request_id) {
      if (current.accepted && JSON.stringify(draft) === JSON.stringify(pending.preferences)) setDirty(false);
      setPending(null);
      setLocalMessage("");
    }
  }, [current.ack, current.accepted, pending, draft]);
  const update = (patch: Partial<Preferences>) => { setDraft({ ...draft, ...patch }); setDirty(true); setPending(null); setLocalMessage(""); setResult(null); };
  const save = () => {
    const request = pending ?? { request_id: crypto.randomUUID(), observed_revision: current.revision, preferences: draft };
    setPending(request);
    setLocalMessage(send?.({ type: "reply_format_set", ...request }) ? "Waiting for acknowledgement…" : "Connection unavailable. Your preferences are still editable; retry explicitly.");
  };
  return <section className="reply-format" aria-label="Reply format settings">
    <h3>Reply format</h3><p>For this conversation · preferences reset when the last opted-in connection leaves.</p>
    {!partner && <p>Enable Conversation partner to apply these rules to new requested replies.</p>}
    <label>Maximum visible words <input aria-label="Maximum visible words" type="number" min={20} max={120} step={1} value={draft.maxWords}
      onChange={e => update({ maxWords: Number(e.target.value) })} /></label>
    <label>First answer <select aria-label="First answer" value={draft.bullets ? "bullets" : "plain"} onChange={e => update({ bullets: e.target.value === "bullets" })}>
      <option value="plain">Plain sentences</option><option value="bullets">Short bullets</option></select></label>
    <label className="reply-format-toggle"><input type="checkbox" checked={draft.pointFirst} onChange={e => update({ pointFirst: e.target.checked })} />Require point first</label>
    <p>Point first means the first nonempty sentence or line carries the answer. The checker cannot prove clarity or truth.</p>
    <details><summary>Mechanical checks</summary><p>Whitespace word count (excluding standalone bullet markers), at most 2400 display characters, and line prefixes: every bullet line starts with “- ” or “• ”; plain sentences have no list prefix. Speech stays within 60 words, three sentences and 400 characters.</p>
      <p>With Point first on, the first line cannot start with: {PREAMBLES.join(", ")}. Only this fixed preamble list is enforced.</p></details>
    <button type="button" disabled={!partner || !current.ready || !Number.isInteger(draft.maxWords) || draft.maxWords < 20 || draft.maxWords > 120} onClick={save}>{pending ? "Retry save" : "Save preferences"}</button>
    <p role="status">{localMessage || (current.ack && !current.accepted ? current.message : dirty ? "Unsaved preferences for this conversation" : current.message)}</p>
    <label>Check sample <textarea aria-label="Check sample" maxLength={16000} rows={2} value={sample} onChange={e => { setSample(e.target.value); setResult(null); }} /></label>
    <button type="button" onClick={() => { const failed = checkFormat(sample, draft); setResult(failed.length ? `Mechanical checks failed: ${failed.join(", ")}` : "Mechanical checks passed. Clarity and truth are not checked."); }}>Check sample</button>
    {result && <p className="reply-format-result" role="status">{result}</p>}
  </section>;
}
export function FormattedReply() {
  const on = useBuiltInsOn();
  const { reply } = useFormat();
  if (!on.has("reply-format") || !on.has("partner") || !reply) return null;
  return <section className="formatted-reply" aria-label="Partner reply" key={reply.reply_id}>
    <p role="status">{reply.displayText}</p>
    {reply.available_answer !== null && <details><summary>Show available answer</summary><p>{reply.available_answer}</p><small>This answer did not fit the mechanical format checks.</small></details>}
  </section>;
}
