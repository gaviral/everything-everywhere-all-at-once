import { useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { CareGlyph, CareSettings, CornerPrompt } from "./parts";
import { isQuiet, promptDue } from "./state";
import { useCare } from "./use-care";
import css from "./care-prompts.css?inline";

function PersonalCare({ person }: { person: string }) {
  const [open, setOpen] = useState(false);
  const care = useCare(person, open);
  const [example, setExample] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const { preferences: p, now } = care;
  const showing = !open && care.visible && (example || promptDue(p, now));
  const status = !p.enabled ? "Off" : isQuiet(p, now) ? "Quiet hours" : "On";
  const stop = () => { care.stop(); setExample(false); };
  const dismiss = () => { if (example) setExample(false); else care.dismiss(); opener.current?.focus({ preventScroll: true }); };
  return <div className="care-prompts" data-guide="care-prompts">
    {showing && <CornerPrompt water={!example && p.turn % 2 === 1} example={example} dismiss={dismiss} />}
    <div className="care-prompts-mark">
      <button ref={opener} type="button" className="care-prompts-opener" aria-label={`Care prompts: ${status}. Open settings`} aria-haspopup="dialog" onClick={() => { setExample(false); setOpen(true); }}><CareGlyph /><span>Care <small>· {status}</small></span></button>
      {p.enabled && <button type="button" className="care-prompts-stop-mark" onClick={stop}>Stop</button>}
    </div>
    <CareSettings {...care} open={open} opener={opener} close={() => setOpen(false)} stop={stop}
      start={() => { care.start(); setOpen(false); }} example={() => { setExample(true); setOpen(false); }} />
  </div>;
}

export default function CarePrompts({ map }: BrickProps) {
  return <PersonalCare key={map.me} person={map.me} />;
}

export const styles = css;
