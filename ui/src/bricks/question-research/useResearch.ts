import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrickActions, ResearchCommand, ResearchKept } from "../contract";

/** Only explicit commands call the host; late results cannot replace a cancelled preview. */
export function useResearch(actions: BrickActions) {
  const [preview, setPreview] = useState<ResearchKept | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<ResearchCommand | null>(null);
  const [undo, setUndo] = useState<ResearchKept | null>(null);
  const [opened, setOpened] = useState("");
  const researchButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const returnToResearch = useRef(false);
  const generation = useRef(0);
  useLayoutEffect(() => { if (!busy && returnToResearch.current) { returnToResearch.current = false; researchButton.current?.focus(); } }, [busy]);
  useLayoutEffect(() => { if (undo) undoButton.current?.focus(); }, [undo]);
  useEffect(() => () => { generation.current++; }, []);
  const command = async (request: ResearchCommand) => {
    const epoch = ++generation.current;
    setBusy(true); setMessage(request.op === "run" ? "Researching…" : "Saving…");
    let result;
    try { result = await actions.research(request); }
    catch { result = { ok: false, message: "Research unavailable. Your query is kept.", answer: null }; }
    if (epoch !== generation.current) return;
    setBusy(false); setMessage(result.message);
    if (result.ok && result.answer) {
      setRetry(null);
      if (request.op === "run") setPreview(result.answer);
      else if (request.op === "keep") { setOpened(result.answer.id); setPreview(null); }
      else if (request.op === "remove") { setUndo(result.answer); setOpened(""); }
      else { returnToResearch.current = true; setUndo(null); }
    } else if (request.op !== "run") setRetry(request);
  };
  const cancel = () => { returnToResearch.current = true; generation.current++; actions.cancelResearch(); setBusy(false); setPreview(null); setMessage("Research cancelled. Your query is kept."); };
  const clearPreview = () => { setPreview(null); setRetry(null); setMessage(""); };
  return { preview, busy, message, retry, undo, opened, researchButton, undoButton, setOpened, command, cancel, clearPreview };
}
