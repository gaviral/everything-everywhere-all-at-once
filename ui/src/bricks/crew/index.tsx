// Crew: say many things at once; each becomes a part on its own branch; what works merges up to main.
// This file only orders the steps: split, build, try in a sealed frame, repair once or turn off, merge, promote.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import { buildPart, mergePart, planParts, promote } from "./api";
import { Board } from "./Board";
import { tryPart } from "./frame";
import { count, inDependencyOrder, merged, started, withPart, type Part, type Run } from "./run";
import { Tree } from "./Tree";
import "./crew.css";

const BUILD_ALL = /\b(build|make|do) (it |that |this )?all( of)?( that| this| it)?\b|\bbuild everything\b/i;
const opensAtOnce = () => new URLSearchParams(location.search).has("crew");

export default function Crew({ on, actions, map }: BrickProps) {
  const [open, setOpen] = useState(opensAtOnce);
  const [run, setRun] = useState<Run | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");
  const [clock, setClock] = useState(0);
  const heardUpTo = useRef(0);
  const latest = useRef<Run | null>(null);
  const change = useCallback((next: (old: Run) => Run) => setRun(old => { const value = old ? next(old) : old; latest.current = value; return value; }), []);

  useEffect(() => {
    if (!run || run.doneMs !== undefined) return;
    const timer = setInterval(() => setClock(Date.now() - run.startedAt), 100);
    return () => clearInterval(timer);
  }, [run]);

  const workOn = useCallback(async (id: string, part: Part) => {
    const set = (update: Parameters<typeof withPart>[2]) => change(old => withPart(old, part.id, update));
    set({ stage: "building" });
    try {
      const made = (latest.current ? merged(latest.current) : []).map(done => done.name);
      let built = await buildPart(id, part, made);
      set({ stage: "trying", html: built.html, commit: built.commit, ms: built.ms, reused: built.reused });
      let tried = await tryPart(built.html);
      if (!tried.ok) {
        set({ stage: "fixing", why: tried.why });
        built = await buildPart(id, part, made, { broke: tried.why ?? "It failed", before: built.html });
        set({ stage: "trying", html: built.html, commit: built.commit, fixed: true });
        tried = await tryPart(built.html);
      }
      if (!tried.ok) throw new Error(tried.why);
      const joined = await mergePart(id, part.id);
      set({ stage: "merged", commit: joined.commit });
    } catch (error) {
      set({ stage: "off", why: error instanceof Error ? error.message : "It failed" });
      actions.notify(`${part.name} is turned off. The rest carries on.`);
    }
  }, [actions, change]);

  const go = useCallback(async (said: string) => {
    const words = said.trim();
    if (!words || busy) return;
    setOpen(true);
    setBusy("Splitting what you said into parts…");
    setRun(null);
    const at = Date.now();
    try {
      const plan = await planParts(words);
      const first = started(plan, words, at);
      latest.current = first;
      setRun(first);
      setBusy("");
      await inDependencyOrder(plan.parts.map(part => ({ ...part, needs: part.needs ?? [] })), part => workOn(plan.run, part));
      const worked = latest.current ? merged(latest.current) : [];
      if (worked.length) {
        change(old => ({ ...old, staging: "moving" }));
        await promote(plan.run, "staging");
        change(old => ({ ...old, staging: "done", main: "moving" }));
        const landed = await promote(plan.run, "main", worked.map(({ id, name, job, html }) => ({ id, name, job, html })));
        change(old => ({ ...old, main: "done", commit: landed.commit, commits: landed.commits, catalog: landed.catalog }));
      }
      change(old => ({ ...old, doneMs: Date.now() - old.startedAt }));
    } catch (error) {
      setBusy("");
      actions.notify(error instanceof Error ? error.message : "The crew stopped.");
    }
  }, [actions, busy, change, workOn]);

  // "Build all that": everything said since the last run is the brief.
  useBrickEvent(on, "landed", event => {
    if (!event.mine) return;
    const at = map.thoughts.findIndex(thought => thought.id === event.thoughtId);
    if (at < 0 || !BUILD_ALL.test(map.thoughts[at].text)) return;
    const said = map.thoughts.slice(heardUpTo.current, at).map(thought => thought.text).join(" ");
    heardUpTo.current = at + 1;
    void go(said);
  });

  if (!open) return <button className="crew-open" onClick={() => setOpen(true)} aria-label="Open the crew">Crew</button>;
  const elapsed = run?.doneMs ?? clock;
  return <div className="crew" role="dialog" aria-label="Crew">
    <header className="crew-head">
      <div>
        <h2>{run?.name ?? "Say many things at once."}</h2>
        {run && <p className="crew-said">{run.said}</p>}
      </div>
      {run && <dl className="crew-count">
        <div><dt>parts</dt><dd>{run.parts.length}</dd></div>
        <div><dt>merged</dt><dd>{count(run, "merged")}</dd></div>
        {run.parts.some(part => part.fixed) && <div><dt>fixed</dt><dd>{run.parts.filter(part => part.fixed).length}</dd></div>}
        {count(run, "off") > 0 && <div><dt>turned off</dt><dd>{count(run, "off")}</dd></div>}
        <div><dt>Muse Spark</dt><dd>{(elapsed / 1000).toFixed(1)} s</dd></div>
      </dl>}
      <button className="crew-close" onClick={() => setOpen(false)}>Close</button>
    </header>
    {run
      ? <div className="crew-work"><Tree run={run} /><Board run={run} /></div>
      : <form className="crew-ask" onSubmit={event => { event.preventDefault(); void go(typed); }}>
        <textarea value={typed} onChange={event => setTyped(event.target.value)} aria-label="What should be built" placeholder="Say it all, or type it here. Time left until seven, what's left to hand in, a water reminder…" />
        <button disabled={!typed.trim() || !!busy}>{busy || "Build all that"}</button>
      </form>}
    {run?.commits && <p className="crew-foot">{run.commits} real commits · parts kept for next time: {run.catalog}</p>}
  </div>;
}
