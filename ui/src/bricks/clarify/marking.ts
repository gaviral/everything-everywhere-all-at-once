// Marking: finds the asked-about words on screen and underlines them, without touching the page's own elements.
const NAME = "clarify-term";

/** The words as a range inside the thought's element, or null while it isn't on screen. */
export function rangeOf(thoughtId: string, term: string): Range | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => (node as HTMLElement).dataset?.thought === thoughtId ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  for (let host = walker.nextNode(); host; host = walker.nextNode()) {
    const texts = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      const at = text.textContent?.indexOf(term) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + term.length);
      return range;
    }
  }
  return null;
}

export function underline(range: Range | null) {
  if (!("highlights" in CSS)) return;
  if (range) CSS.highlights.set(NAME, new Highlight(range)); else CSS.highlights.delete(NAME);
}
