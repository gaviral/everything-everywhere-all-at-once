import { motion } from "motion/react";
import type { Part } from "./data";
export function Shelf({ parts, desk, reduced, bring }: { parts: Part[]; desk: string[]; reduced: boolean; bring: (part: Part) => void }) {
  return <div className="workshop-shelf">{parts.map(part => desk.includes(part.id) ? <div className="workshop-shelf-place" key={part.id}><strong>{part.name}</strong><span>On the desk ↓</span></div> : <motion.button layoutId={reduced ? undefined : part.id} transition={{ duration: .32, ease: "easeInOut" }} data-workshop-part={part.id} className="workshop-shelf-part" key={part.id} onClick={() => bring(part)} aria-label={`Bring ${part.name} here`}><strong>{part.name}</strong><span>{part.modes.join(" · ")}</span><b>Bring here ↓</b></motion.button>)}</div>;
}
