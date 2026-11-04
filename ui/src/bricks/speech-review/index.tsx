import { useLayoutEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { OriginalWords, PasteWords, ReleasePreview, WordEditor } from "./parts";
import { EXAMPLE, makeDraft, wordError, type Draft } from "./review";
import "./speech-review.css";

export default function SpeechReview(props: BrickProps) {
  return <ReviewTray key={JSON.stringify([props.map.mapIdentity ?? props.map.visitKey ?? "example", props.map.me])} {...props} />;
}

function ReviewTray({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(() => makeDraft(EXAMPLE, true));
  const [paste, setPaste] = useState("");
  const [removed, setRemoved] = useState<Draft | null>(null);
  const attempted = useRef(false);
  const retryReady = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); opener.current?.focus(); };
  useLayoutEffect(() => { retryReady.current = draft?.phase === "refused"; }, [draft]);
  function release(retry: boolean) {
    if (!draft || !map.connected || wordError(draft.text) || draft.phase === "submitted") return;
    if (retry && draft.phase === "refused") {
      if (!retryReady.current) return;
      retryReady.current = false;
      attempted.current = false;
    }
    if (attempted.current) return;
    attempted.current = true;
    let accepted = false;
    try { accepted = actions.addThought(draft.text); } catch { /* Keep the exact reviewed text for explicit retry. */ }
    setDraft({ ...draft, phase: accepted ? "submitted" : "refused" });
  }
  return <section className="speech-review" aria-label="Word review" data-guide="speech-review" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && open) { event.preventDefault(); close(); }
  }}>
    <div className="speech-review-bar">
      <button ref={opener} type="button" aria-expanded={open} aria-controls="speech-review-body" onClick={() => open ? close() : setOpen(true)}>◈ Word review <span>{draft?.phase === "submitted" ? "Submitted" : "Before the map"}</span></button>
      {open && <button type="button" onClick={close}>Close</button>}
    </div>
    {open && <div id="speech-review-body" className="speech-review-body">
      <div className="speech-review-intro"><p className="speech-review-eyebrow">{draft?.example ? draft.phase === "submitted" ? "EXAMPLE · SUBMITTED" : "EXAMPLE · EDIT BEFORE RELEASING" : "YOUR WORDS · YOUR LAST LOOK"}</p><h2>Catch the word.<br /><em>Keep the meaning.</em></h2></div>
      <p className="speech-review-note">For pasted recognition text. The live mic still sends directly to the map.</p>
      {draft ? <>
        <OriginalWords draft={draft} />
        {draft.phase === "editing" ? <WordEditor draft={draft} change={text => setDraft({ ...draft, text })} preview={() => { attempted.current = false; setDraft({ ...draft, phase: "preview" }); }} />
          : <ReleasePreview draft={draft} connected={map.connected} release={release} edit={() => { attempted.current = false; setDraft({ ...draft, phase: "editing" }); }} />}
        <div className="speech-review-footer"><button type="button" onClick={() => { setRemoved(draft); setDraft(null); attempted.current = false; }}>{draft.phase === "submitted" ? "Review another" : draft.example ? "Use my own words" : "Set aside"}</button><span>{draft.phase === "submitted" ? "Original kept here" : "Unsent · this visit"}</span></div>
      </> : <>
        <PasteWords value={paste} change={setPaste} review={() => { setDraft(makeDraft(paste)); setPaste(""); attempted.current = false; }} />
        {removed && <button type="button" onClick={() => { setDraft(removed); setRemoved(null); }}>Restore previous {removed.example ? "example" : "review"}</button>}
      </>}
      <p className="speech-review-lifetime">Close keeps edits. Switching this feature off or reloading clears this tray.</p>
    </div>}
  </section>;
}
