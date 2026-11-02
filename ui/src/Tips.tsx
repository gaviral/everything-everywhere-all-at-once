import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./tips.css";

// Every mark that needs a word says it on hover, on keyboard focus and on a tap: put the words in `data-tip` on the
// mark (✦, ✓, ?, the mic) and this one listener shows them. A native title waits about a second and looks like the
// system's, not the app's; one shared tip also stays out of every card's layout and is never clipped by a card.

/** What each ✦ says: what the AI did, then how to undo or answer it where there is a way. */
export const TIPS = {
  suggestion: "AI suggestion from what you said here. Keep saves it; × dismisses it.",
  kept: "AI suggestion you kept in this thread. There's no undo yet.",
  action: (app: string) => `AI proposal from your words. Nothing reaches ${app} until you press Add to ${app}; × dismisses it.`,
  adding: (app: string) => `You approved this; it's being added to ${app}.`,
  added: (app: string) => `Added to ${app}. Change or remove it there.`,
  tag: "Tag suggested by AI. Tap to keep it.",
  picture: "Picture drawn by AI as a memory anchor for this thread.",
  guess: "The AI thinks a word was misheard. Yes swaps in its guess; No keeps what was heard.",
  unclear: (heard: string) => `Might be misheard: “${heard}”.`,
  mapChange: "The AI renamed this on its own, in your words. Undo puts the old title back; × hides this note.",
  tidyRename: "The AI isn't sure this title is better, so it asks. Rename applies it; × keeps yours.",
  tidyMerge: "The AI thinks these are one topic, so it asks. Merge joins them, with Undo after; × keeps them apart.",
  explanation: "AI explanation of the words you selected. Off? notes one that misses the point.",
  awayProposal: "A proposal the AI made while you were away. Open the row to keep or dismiss it.",
  recap: "Written by AI from your map. Off? notes an answer that misses the point.",
  build: "An app the AI is making from your words. Nothing new runs until you keep it.",
} as const;

type Shown = { text: string; el: HTMLElement };

/** What an open tip becomes when its mark changes: gone with the mark or its words, the mark's new words, or as is. */
export function follow(shown: Shown, el: { isConnected: boolean; dataset: { tip?: string } } = shown.el): Shown | null {
  const text = el.isConnected ? el.dataset.tip : undefined;
  if (!text) return null;
  return text === shown.text ? shown : { ...shown, text };
}

export function Tips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const target = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      current.current = el;
      setShown({ text, el });
    };
    const hide = () => { current.current = null; setShown(null); };
    const over = (event: PointerEvent) => { const el = target(event.target); if (el && el !== current.current) show(el); };
    const out = (event: PointerEvent) => {
      const el = current.current;
      // A tap shows the tip and leaves it up until the next tap, as a touch screen has no hover to end it.
      if (el && event.pointerType === "mouse" && !el.contains(event.relatedTarget as Node | null)) hide();
    };
    const down = (event: PointerEvent) => { if (current.current && !current.current.contains(event.target as Node)) hide(); };
    // Keyboard focus only: a click focuses a button too, and the pointer already showed or hid its tip.
    const focus = (event: FocusEvent) => { const el = target(event.target); if (el && el === event.target && el.matches(":focus-visible")) show(el); };
    const blur = (event: FocusEvent) => { if (current.current && current.current === event.target) hide(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && current.current) hide(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key);
    // The tip is placed once; anything that moves its mark ends it rather than leaving it pointing at nothing.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // An open tip follows its mark: a mark that leaves the page (a dismissed proposal) or loses its words (a kept tag)
  // takes the tip with it, and a mark whose words change (the mic you just stopped) shows the new ones.
  useEffect(() => {
    if (!shown) return;
    const watch = new MutationObserver(() => {
      const next = follow(shown);
      if (next === shown) return;
      if (!next) current.current = null;
      setShown(next);
    });
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tip"] });
    return () => watch.disconnect();
  }, [shown]);

  // Screen readers hear the tip as the focused mark's description.
  useEffect(() => {
    if (!shown) return;
    const el = shown.el;
    const before = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", "mark-tip");
    return () => { if (before) el.setAttribute("aria-describedby", before); else el.removeAttribute("aria-describedby"); };
  }, [shown]);

  // Above the mark, centered on it and kept inside the window with the page's 8 px edge; below it when the top is
  // too close (the header's marks).
  useLayoutEffect(() => {
    const box = tip.current;
    if (!shown || !box) return;
    const mark = shown.el.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const edge = 8;
    const gap = 6;
    const left = Math.min(Math.max(edge, mark.left + mark.width / 2 - size.width / 2), window.innerWidth - edge - size.width);
    const above = mark.top - gap - size.height;
    box.style.left = `${left}px`;
    box.style.top = `${above >= edge ? above : mark.bottom + gap}px`;
  }, [shown]);

  if (!shown) return null;
  // Inside an open modal dialog (Recap), the tip must live in the dialog's top layer or it would sit behind it.
  const host = shown.el.closest("dialog[open]") ?? document.body;
  return createPortal(<div ref={tip} id="mark-tip" role="tooltip" className="mark-tip">{shown.text}</div>, host);
}
