import { LayoutGroup, MotionConfig } from "motion/react";
import type { BrickProps } from "../contract";
import { useWorkshop } from "./controller";
import { Shelf } from "./Shelf";
import { DeskPart } from "./DeskPart";
import { Hackathon } from "./Hackathon";
import "./workshop.css";
export default function Workshop({ map }: BrickProps) {
  const { open, setOpen, models, flows, desk, setSelected, event, command, setCommand, notice, error, ready, voice, reduced, deskRef, eventRef, refresh, bring, remove, act } = useWorkshop(map);
  if (!open) return <button className="workshop-launch" onClick={() => setOpen(true)}>Open Workshop</button>;
  return <MotionConfig reducedMotion="user"><LayoutGroup id="workshop"><section className="workshop" aria-label="Workshop">
    <div className="workshop-top"><div><p className="workshop-eyebrow">Models · parts · ideas</p><h1>Workshop</h1></div><div className="workshop-tools"><button onClick={() => deskRef.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" })}>Desk</button><button onClick={() => eventRef.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" })}>Hackathon</button><button onClick={() => void refresh()}>Refresh</button><button aria-label="Close Workshop" onClick={() => setOpen(false)}>Close</button></div></div>
    <div className="workshop-body"><section aria-label="Available models"><div className="workshop-section-head"><h2>Meta models</h2><p>{ready ? "Configured in this core" : "Model key unavailable"}</p></div><Shelf parts={models} desk={desk.map(p => p.id)} reduced={reduced} bring={bring} /></section>
    <section className="workshop-flow" aria-label="Available Flow parts"><h2>Flow parts</h2>{flows.length ? <Shelf parts={flows} desk={desk.map(p => p.id)} reduced={reduced} bring={bring} /> : <p>Save boxes in Flow, then refresh to bring any box here.</p>}</section>
    <section ref={deskRef} className="workshop-desk" aria-label="Desk"><div className="workshop-section-head"><h2>Desk</h2><p>Bring it. Try it. Take it away.</p></div>{desk.length ? <div className="workshop-desk-grid">{desk.map(part => <DeskPart key={part.id} part={part} partial={map.partial} reduced={reduced} remove={() => remove(part)} select={() => setSelected(part.id)} />)}</div> : <div className="workshop-empty">Your work starts here.<span>Choose a model above, or say “Bring Spark here”.</span></div>}</section>
    <div ref={eventRef}><Hackathon data={event} /></div></div>
    <div className="workshop-bottom"><p className="workshop-notice" role="status">{error || notice}</p><form className="workshop-command" onSubmit={e => { e.preventDefault(); act(command); }}><label htmlFor="workshop-command">Command</label><input id="workshop-command" value={command} onChange={e => setCommand(e.target.value)} placeholder="Bring Spark here" /><button type="submit" disabled={!command.trim()}>Do it</button></form><p className="workshop-hint">{voice ? "Voice commands ready when you choose to listen." : "Voice connection unavailable. Type a command or choose a part."}</p></div>
  </section></LayoutGroup></MotionConfig>;
}
