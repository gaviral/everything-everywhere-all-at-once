// Crew: say many things at once; each becomes a part on its own branch; what works merges up to main.
// This file only orders the steps: split, fill, check, repair once or turn off, merge, promote.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import { buildPart, mergePart, planParts, promote } from "./api";
import { Board } from "./Board";
import { count, inDependencyOrder, merged, started, withPart, type Part, type Run } from "./run";
import { Tree } from "./Tree";
import "./crew.css";
import "./kit.css";

const BUILD_ALL = /\b(build|make|do) (it |that |this )?all( of)?( that| this| it)?\b|\bbuild everything\b/i;
const opensAtOnce = () => new URLSearchParams(location.search).has("crew");
/** `?crewfault`: one part breaks on purpose, labelled on screen, so a real repair can be seen. */
const faultOn = () => new URLSearchParams(location.search).has("crewfault");

/** The person keeps talking while it builds, so the bottom bar with their live words stays in view. */
function useBarHeight(open: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const stage = document.querySelector('[data-slot="stage"]');
      setHeight(stage ? Math.max(0, Math.min(200, innerHeight - stage.getBoundingClientRect().top)) : 0);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [open]);
  return height;
}

export default function Crew({ on, actions, map }: BrickProps) {
  const [open, setOpen] = useState(opensAtOnce);
  const barHeight = useBarHeight(open);
  const [run, setRun] = useState<Run | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");
  const [clock, setClock] = useState(0);
  const heardUpTo = useRef(0);
  const faulted = useRef(false);
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
      const faulty = faultOn() && !faulted.current;
      if (faulty) faulted.current = true;
      let built = await buildPart(id, part, made, faulty ? { fault: true } : undefined);
      set({ stage: "trying", spec: built.spec, commit: built.commit, ms: built.ms, reused: built.reused });
      if (built.broke) {
        set({ stage: "fixing", why: built.broke });
        built = await buildPart(id, part, made, { broke: built.broke, before: built.spec });
        set({ stage: "trying", spec: built.spec, commit: built.commit, fixed: true });
      }
      if (built.broke) throw new Error(built.broke);
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
    faulted.current = false;
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
        const landed = await promote(plan.run, "main", worked.map(({ id, name, job, spec }) => ({ id, name, job, spec })));
        change(old => ({ ...old, main: "done", commit: landed.commit, commits: landed.commits, catalog: landed.catalog }));
      }
      change(old => ({ ...old, doneMs: Date.now() - old.startedAt }));
    } catch (error) {
      setBusy("");
      actions.notify(error instanceof Error ? error.message : "The crew stopped.");
    }
  }, [actions, busy, change, workOn]);

  // A sketch hands over its parts from the Draw sheet.
  useEffect(() => {
    const fromSketch = (event: Event) => { void go((event as CustomEvent<string>).detail); };
    addEventListener("e2a2o:crew-build", fromSketch);
    return () => removeEventListener("e2a2o:crew-build", fromSketch);
  }, [go]);

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
  return <div className="crew" role="dialog" aria-label="Crew" style={{ bottom: barHeight }}>
    <header className="crew-head">
      <div>
        <h2>{run?.name ?? "Say it all at once."}</h2>
        {run && <p className="crew-said">{run.said}</p>}
      </div>
      {run && <dl className="crew-count">
        <div><dd>{count(run, "merged")} of {run.parts.length}</dd><dt>parts on main</dt></div>
        {run.parts.some(part => part.fixed) && <div><dd>{run.parts.filter(part => part.fixed).length}</dd><dt>repaired</dt></div>}
        {count(run, "off") > 0 && <div><dd>{count(run, "off")}</dd><dt>turned off</dt></div>}
        <div><dd>{(elapsed / 1000).toFixed(1)} s</dd><dt>Muse Spark</dt></div>
      </dl>}
      <button className="crew-close" onClick={() => setOpen(false)}>Close</button>
    </header>
    {run
      ? <div className="crew-work"><Tree run={run} /><Board run={run} /></div>
      : <form className="crew-ask" onSubmit={event => { event.preventDefault(); void go(typed); }}>
        <textarea value={typed} onChange={event => setTyped(event.target.value)} aria-label="What should be built" placeholder="Say it all, or type it here. Time left until seven, what's left to hand in, a water reminder…" />
        <button disabled={!typed.trim() || !!busy}>{busy || "Build all that"}</button>
      </form>}
    {run?.commits && <p className="crew-foot">{run.commits} real commits · parts kept for next time: {run.catalog}{faultOn() ? " · one fault added on purpose" : ""}</p>}
  </div>;
}
