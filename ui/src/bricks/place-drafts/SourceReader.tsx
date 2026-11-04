import { useEffect, useLayoutEffect, useRef } from "react";
import type { Place, Quote } from "./checkpoint";
import type { ReadingDocument } from "./documents";

export function SourceReader({ document: reading, documentId, folded, place, quote, fold, keepPlace, keepQuote, openSource }: {
  document?: ReadingDocument; documentId: string; folded: Record<string, boolean>; place?: Place; quote?: Quote;
  fold(id: string): void; keepPlace(value: Place): void; keepQuote(value: Quote): void; openSource(id: string): void;
}) {
  const paper = useRef<HTMLDivElement>(null);
  const restoredQuote = useRef("");
  const saved = useRef({ place, quote, keepQuote });
  saved.current = { place, quote, keepQuote };
  useLayoutEffect(() => {
    const element = paper.current;
    const position = saved.current.place;
    if (!element) return;
    if (!position) { element.scrollTop = 0; return; }
    const block = [...element.querySelectorAll<HTMLElement>("[data-reading-block]")]
      .find(candidate => candidate.dataset.readingBlock === position.blockId);
    element.scrollTop = block ? element.scrollTop + block.getBoundingClientRect().top - element.getBoundingClientRect().top - position.offset : position.scroll;
  }, [reading, documentId]);
  useLayoutEffect(() => {
    if (!reading || restoredQuote.current === documentId) return;
    restoredQuote.current = documentId;
    const selection = saved.current.quote;
    if (!selection || !paper.current || document.activeElement?.tagName === "TEXTAREA") return;
    const words = [...paper.current.querySelectorAll<HTMLElement>("[data-reading-words]")]
      .find(element => element.dataset.readingWords === selection.blockId);
    const node = words?.firstChild;
    if (!node || selection.end > (node.textContent?.length ?? 0) || node.textContent?.slice(selection.start, selection.end) !== selection.text) return;
    const range = document.createRange();
    range.setStart(node, selection.start); range.setEnd(node, selection.end);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  }, [documentId, reading]);
  useEffect(() => {
    const selected = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const words = range.startContainer.parentElement?.closest<HTMLElement>("[data-reading-words]");
      if (!words || !paper.current?.contains(words) || !words.contains(range.endContainer)) return;
      const prefix = range.cloneRange(); prefix.selectNodeContents(words); prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      const next = { blockId: words.dataset.readingWords!, start, end: start + range.toString().length, text: range.toString() };
      if (JSON.stringify(saved.current.quote) !== JSON.stringify(next)) saved.current.keepQuote(next);
    };
    document.addEventListener("selectionchange", selected);
    return () => document.removeEventListener("selectionchange", selected);
  }, [documentId]);
  const scroll = () => {
    const element = paper.current;
    if (!element) return;
    const blocks = [...element.querySelectorAll<HTMLElement>("[data-reading-block]")];
    const top = element.getBoundingClientRect().top;
    const block = blocks.find(candidate => candidate.getBoundingClientRect().bottom > top) ?? blocks.at(-1);
    if (block) keepPlace({ blockId: block.dataset.readingBlock!, offset: block.getBoundingClientRect().top - top, scroll: element.scrollTop });
  };
  return <div className="place-drafts-paper" ref={paper} onScroll={scroll} tabIndex={0} aria-label="Reading sources">
    {!reading && <div className="place-drafts-missing"><h2>Source not present in this snapshot.</h2>
      <p>Your place and draft are retained. Choose another reading, or return when this source is available.</p></div>}
    {reading && !reading.blocks.length && <p>This topic has no placed words yet. Your draft can stay here while they arrive.</p>}
    {reading?.blocks.map(block => {
      const id = JSON.stringify([documentId, block.id]);
      const closed = folded[id] === true;
      const bodyId = `place-drafts-source-${encodeURIComponent(id)}`;
      return <article key={block.id} data-reading-block={block.id} className="place-drafts-source">
        <div className="place-drafts-source-top"><span>{block.by}</span>
          <button type="button" aria-expanded={!closed} aria-controls={bodyId} onClick={() => fold(id)}>
            {closed ? "Unfold source" : "Fold source"}</button></div>
        <div id={bodyId} hidden={closed}>
          <p data-reading-words={block.id}>{block.text}</p>
          {block.thoughtId && <button type="button" className="place-drafts-link" onClick={() => openSource(block.thoughtId!)}>Open original ↗</button>}
        </div>
      </article>;
    })}
  </div>;
}
