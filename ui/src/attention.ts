// What "this" means when you say "expand this": the card you selected (keyboard focus you moved there, or words you
// selected in it), and the card under the pointer. The window tells the core when either changes; the core picks
// selection, then pointer, then your active thread (core/src/catalog.rs `this`).

/** The thread a node sits in: a map card (`thread-<id>`) or a Palace tile (`data-thread`); the innermost, so a branch
 *  inside its parent's card is itself. */
export function threadOf(node: Node | null): string | null {
  // An element has `closest`; a text node (inside a selection) reads from its parent.
  const element = node && "closest" in node ? (node as Element) : node?.parentElement ?? null;
  const card = element?.closest<HTMLElement>("section.thread[id^='thread-'], [data-thread]");
  if (!card) return null;
  return card.dataset.thread ?? card.id.slice("thread-".length);
}

/** The selected card: words selected inside one, else keyboard focus (`:focus-visible`) inside one. A mouse click
 *  leaves focus on the button it pressed, which isn't a selection: the pointer already says where you are. */
export function selectedThread(doc: Document): string | null {
  const selection = doc.getSelection();
  if (selection && !selection.isCollapsed) {
    const thread = threadOf(selection.anchorNode);
    if (thread) return thread;
  }
  const active = doc.activeElement;
  if (active && active !== doc.body && active.matches(":focus-visible")) return threadOf(active);
  return null;
}

/** Calls `report` with the selected and pointed card whenever either changes; returns the way to stop. */
export function watchAttention(report: (selected: string | null, pointed: string | null) => void, doc: Document = document): () => void {
  let selected: string | null = null;
  let pointed: string | null = null;
  const update = (nextPointed: string | null) => {
    const nextSelected = selectedThread(doc);
    if (nextSelected === selected && nextPointed === pointed) return;
    selected = nextSelected;
    pointed = nextPointed;
    report(selected, pointed);
  };
  const over = (event: PointerEvent) => update(threadOf(event.target as Node));
  const left = () => update(null);
  // Focus leaves one element before it reaches the next: read it once it has landed.
  let timer = 0;
  const reselect = () => { clearTimeout(timer); timer = setTimeout(() => update(pointed), 0) as unknown as number; };
  doc.addEventListener("pointerover", over);
  doc.documentElement.addEventListener("pointerleave", left);
  doc.addEventListener("focusin", reselect);
  doc.addEventListener("focusout", reselect);
  doc.addEventListener("selectionchange", reselect);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener("pointerover", over);
    doc.documentElement.removeEventListener("pointerleave", left);
    doc.removeEventListener("focusin", reselect);
    doc.removeEventListener("focusout", reselect);
    doc.removeEventListener("selectionchange", reselect);
  };
}

/** Tells the core the latest selected and pointed card, and again on each new connection: a change made while the
 *  connection was down, or a core that restarted, would otherwise leave "this" stale until the next change. */
export function attentionTeller() {
  let last: string | null = null;
  return {
    tell(selected: string | null, pointed: string | null, send: (message: string) => unknown) {
      last = JSON.stringify({ type: "attention", selected, pointed });
      send(last);
    },
    resend(send: (message: string) => unknown) {
      if (last) send(last);
    },
  };
}
