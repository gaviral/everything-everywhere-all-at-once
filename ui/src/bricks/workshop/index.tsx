import { useEffect, useRef, useState } from "react";
import { LayoutGroup, MotionConfig, useReducedMotion } from "motion/react";
import type { BrickProps } from "../contract";
import { commandOf, endpoint, flowParts, matches, modelParts, request, type EventData, type Part } from "./data";
import { Shelf } from "./Shelf";
import { DeskPart } from "./DeskPart";
import { Hackathon } from "./Hackathon";
import "./workshop.css";
export default function Workshop({ map }: BrickProps) {
  const [open, setOpen] = useState(true), [models, setModels] = useState<Part[]>([]), [flows, setFlows] = useState<Part[]>([]);
  const [desk, setDesk] = useState<Part[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [event, setEvent] = useState<EventData | null>(null), [command, setCommand] = useState("");
  const [notice, setNotice] = useState("Bring a model or part here to try it."), [error, setError] = useState("");
  const [ready, setReady] = useState(false), [voice, setVoice] = useState(false);
  const reduced = !!useReducedMotion();
  const actRef = useRef<(text: string) => void>(() => {});
  const refreshRef = useRef<AbortController | null>(null);
  async function refresh() {
    refreshRef.current?.abort(); const controller = new AbortController(); refreshRef.current = controller;
    setError("");
    const catalog = request("/workshop/catalog", controller.signal).then(value => { const parts = modelParts(value.models); setModels(parts); setReady(value.ready); return parts; });
    const library = request("/flow/library", controller.signal);
    try {
      const [parts, saved] = await Promise.all([catalog, library]);
      const model = parts.find(p => p.modes.includes("flow"))?.model;
      setFlows(model ? flowParts(saved.flows, model) : []);
    } catch { if (!controller.signal.aborted) setError("Couldn't refresh models or Flow parts. Try Refresh."); }
    try { setEvent(await request("/workshop/hackathon", controller.signal)); }
    catch { if (!controller.signal.aborted) setEvent({ unavailable: true, sections: [] }); }
  }
  useEffect(() => { void refresh(); return () => refreshRef.current?.abort(); }, [map.visitKey]);
  useEffect(() => { setDesk([]); setSelected(null); }, [map.visitKey]);
  useEffect(() => {
    if (!open) return;
    const url = endpoint("/workshop/turns"); url.searchParams.set("name", map.me);
    const source = new EventSource(url);
    source.onopen = () => setVoice(true); source.onerror = () => setVoice(false);
    source.onmessage = message => { try { actRef.current(JSON.parse(message.data).text); } catch { setError("Couldn't read the command. Try again."); } };
    return () => { source.close(); setVoice(false); };
  }, [map.me, map.visitKey, open]);
  function bring(part: Part) { setDesk(old => old.some(p => p.id === part.id) ? old : [...old, part]); setSelected(part.id); setNotice(`${part.name} is ready on the desk.`); }
  function remove(part: Part) { setDesk(old => old.filter(p => p.id !== part.id)); setSelected(null); setNotice(`${part.name} is back on the shelf.`); }
  function act(text: string) {
    const command = commandOf(text); if (!command) { setNotice('Try “Bring Spark here” or “take this away”.'); return; }
    const pool = command.kind === "bring" ? [...models, ...flows] : desk;
    const found = /^(this|it)$/i.test(command.name) ? pool.filter(p => p.id === selected) : matches(pool, command.name);
    if (found.length !== 1) { setNotice(found.length ? `Choose one: ${found.map(p => p.name).join(", ")}.` : "No matching part. Choose one on the shelf or desk."); return; }
    if (command.kind === "bring") bring(found[0]); else remove(found[0]);
    setCommand("");
  }
  actRef.current = act;
  if (!open) return <button className="workshop-launch" onClick={() => setOpen(true)}>Open Workshop</button>;
  return <MotionConfig reducedMotion="user"><LayoutGroup id="workshop"><section className="workshop" aria-label="Workshop">
    <div className="workshop-top"><div><p className="workshop-eyebrow">Models · parts · ideas</p><h1>Workshop</h1></div><div className="workshop-tools"><button onClick={() => void refresh()}>Refresh</button><button onClick={() => setOpen(false)}>Close Workshop</button></div></div>
    <div className="workshop-body"><section aria-label="Available models"><div className="workshop-section-head"><h2>Meta models</h2><p>{ready ? "Configured in this core" : "Model key unavailable"}</p></div><Shelf parts={models} desk={desk.map(p => p.id)} reduced={reduced} bring={bring} /></section>
    <section className="workshop-flow" aria-label="Available Flow parts"><h2>Flow parts</h2>{flows.length ? <Shelf parts={flows} desk={desk.map(p => p.id)} reduced={reduced} bring={bring} /> : <p>Save boxes in Flow, then refresh to bring any box here.</p>}</section>
    <section className="workshop-desk" aria-label="Desk"><div className="workshop-section-head"><h2>Desk</h2><p>Bring it. Try it. Take it away.</p></div>{desk.length ? <div className="workshop-desk-grid">{desk.map(part => <DeskPart key={part.id} part={part} partial={map.partial} reduced={reduced} remove={() => remove(part)} select={() => setSelected(part.id)} />)}</div> : <div className="workshop-empty">Your work starts here.<span>Choose a model above, or say “Bring Spark here”.</span></div>}</section>
    <Hackathon data={event} /></div>
    <div className="workshop-bottom"><p className="workshop-notice" role="status">{error || notice}</p><form className="workshop-command" onSubmit={e => { e.preventDefault(); act(command); }}><label htmlFor="workshop-command">Command</label><input id="workshop-command" value={command} onChange={e => setCommand(e.target.value)} placeholder="Bring Spark here" /><button type="submit" disabled={!command.trim()}>Do it</button></form><p className="workshop-hint">{voice ? "Voice commands ready when you choose to listen." : "Voice connection unavailable. Type a command or choose a part."}</p></div>
  </section></LayoutGroup></MotionConfig>;
}
