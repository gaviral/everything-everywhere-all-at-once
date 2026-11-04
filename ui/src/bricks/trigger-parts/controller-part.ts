import { useEffect, useRef, useState } from "react";
import { usePluginState } from "../contract";
import { candidates } from "./candidate-part";
import { exampleJudgements, judgementPrompt, readJudgements } from "./ai-part";
import { breakdown } from "./breakdown-part";
import { EXAMPLE } from "./example-part";
import { requestJudgement } from "./model-request-part";
import type { Dispute, Judgement, MatcherId, Switches } from "./types";

type Session = { source: string; switches: Switches; ai: Judgement[] | null; disputes: Dispute[]; joined: string[] };
const initial = (): Session => ({ source: EXAMPLE, switches: { exact: true, regex: true, fuzzy: true, ai: true }, ai: null, disputes: [], joined: [] });

export function useTriggerParts() {
  const [session, setSession] = usePluginState<Session>("trigger-review-v1", initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Example ready. Change the words or switch a matcher off.");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const rows = candidates(session.source);
  const example = session.ai === null;
  const result = breakdown(session.source, session.switches, session.ai ?? exampleJudgements(session.source, rows), example, session.joined);
  useEffect(() => () => { revision.current++; active.current?.abort(); }, []);

  function cancel() { revision.current++; active.current?.abort(); active.current = null; setBusy(false); }
  function edit(source: string) {
    cancel(); setSession(old => ({ ...old, source, ai: null, disputes: [], joined: [] })); setSelected(null);
    setStatus(source === EXAMPLE ? "Example restored." : "Local preview updated. Run Muse Spark for AI judgement on these words.");
  }
  function toggle(id: MatcherId) {
    cancel(); setSession(old => ({ ...old, switches: { ...old.switches, [id]: !old.switches[id] } }));
    setSelected(null); setStatus("Matchers updated. The parts below reflect your switches.");
  }
  async function run(mode: "split" | "dispute") {
    cancel();
    const controller = new AbortController(); active.current = controller;
    const version = revision.current;
    const allowed = mode === "split" ? rows.filter(row => row.source.start > 0) : result.parts.flatMap(part => part.trigger ? [part.trigger] : []);
    if (!allowed.length) { setStatus("There are no candidate splits to review yet."); return; }
    setBusy(true); setStatus(mode === "split" ? "Muse Spark is judging the idea boundaries…" : "Muse Spark is challenging the proposed splits…");
    try {
      const answer = await requestJudgement(judgementPrompt(mode), { transcript: session.source, candidates: allowed, proposedParts: result.review.items }, controller.signal);
      const judgements = readJudgements(answer, allowed);
      if (version !== revision.current || controller.signal.aborted) return;
      setSession(old => mode === "split" ? { ...old, ai: judgements } : { ...old, disputes: [...old.disputes.filter(row => row.by !== "Muse Spark"), ...judgements.map(row => ({ ...row, by: "Muse Spark" as const }))] });
      setStatus(mode === "split" ? `Muse Spark proposed ${judgements.length} boundaries. Your switches still apply.` : judgements.length ? `Muse Spark disputed ${judgements.length} splits. You decide whether to join them.` : "Muse Spark found no split to dispute. This is a review, not a guarantee.");
    } catch (error) {
      if (version === revision.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "The AI review could not finish.");
    } finally { if (version === revision.current) { setBusy(false); active.current = null; } }
  }
  function dispute(id: string, reason: string) {
    if (!reason.trim()) return;
    setSession(old => ({ ...old, disputes: [...old.disputes.filter(row => row.id !== id || row.by !== "You"), { id, reason: reason.trim(), by: "You" }] }));
    setStatus("Your dispute is recorded. Join the parts or keep the split.");
  }
  function join(id: string, joined: boolean) {
    cancel(); setSession(old => ({ ...old, joined: joined ? [...new Set([...old.joined, id])] : old.joined.filter(value => value !== id) }));
    setStatus(joined ? "Joined with the previous part. Every original word is kept." : "Split restored.");
  }
  const visibleDisputes = session.disputes.filter(row => result.triggers.some(trigger => trigger.id === row.id));
  return { session, result, selected, setSelected, status, busy, edit, toggle, run, dispute, join, visibleDisputes };
}
export type TriggerController = ReturnType<typeof useTriggerParts>;
