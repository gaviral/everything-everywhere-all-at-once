import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { BrickProps } from "../contract";
import { commandOf, endpoint, flowParts, matches, modelParts, request, type EventData, type Part } from "./data";
export function useWorkshop(map: BrickProps["map"]) {
  const [open, setOpen] = useState(true), [models, setModels] = useState<Part[]>([]), [flows, setFlows] = useState<Part[]>([]);
  const [desk, setDesk] = useState<Part[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [event, setEvent] = useState<EventData | null>(null), [command, setCommand] = useState("");
  const [notice, setNotice] = useState("Bring a model or part here to try it."), [error, setError] = useState("");
  const [ready, setReady] = useState(false), [voice, setVoice] = useState(false);
  const reduced = !!useReducedMotion();
  const deskRef = useRef<HTMLElement | null>(null), eventRef = useRef<HTMLDivElement | null>(null);
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
  function bring(part: Part) { setDesk(old => old.some(p => p.id === part.id) ? old : [...old, part]); setSelected(part.id); setNotice(`${part.name} is ready on the desk.`); requestAnimationFrame(() => deskRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "instant" : "smooth" })); }
  function remove(part: Part) { setDesk(old => old.filter(p => p.id !== part.id)); setSelected(null); setNotice(`${part.name} is back on the shelf.`); requestAnimationFrame(() => { [...document.querySelectorAll<HTMLButtonElement>("[data-workshop-part]")].find(button => button.dataset.workshopPart === part.id)?.focus(); }); }
  function act(text: string) {
    const command = commandOf(text); if (!command) { setNotice('Try “Bring Spark here” or “take this away”.'); return; }
    const pool = command.kind === "bring" ? [...models, ...flows] : desk;
    let found = /^(this|it)$/i.test(command.name) ? pool.filter(p => p.id === selected) : matches(pool, command.name);
    if (command.kind === "bring" && found.length > 1 && found.every(p => !p.prompt && p.model.replace(/[0-9. -]+$/g, "") === found[0].model.replace(/[0-9. -]+$/g, ""))) found = [found[0]];
    if (found.length !== 1) { setNotice(found.length ? `Choose one: ${found.map(p => p.name).join(", ")}.` : "No matching part. Choose one on the shelf or desk."); return; }
    if (command.kind === "bring") bring(found[0]); else remove(found[0]);
    setCommand("");
  }
  actRef.current = act;
  return { open, setOpen, models, flows, desk, selected, setSelected, event, command, setCommand, notice, error, ready, voice, reduced, deskRef, eventRef, refresh, bring, remove, act };
}
