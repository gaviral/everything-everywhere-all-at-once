// What "this" means when you say "expand this": the card you selected (keyboard focus you moved there, or words you
// selected in it), and the card under the pointer. The window tells the core when either changes; the core picks
// selection, then pointer, then your active thread (core/src/catalog.rs `this`). The window's own "this" mark
// (Attention.tsx) picks the same way from what it told (`resolveThis`).
import type { World } from "./core";
import { resolveMerged } from "./merges";

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

/** The command thought a node sits in (Spine's explicit target or Cards' point id), for "delete this" (core moves.rs). */
export function pointOf(node: Node | null): string | null {
  const element = node && "closest" in node ? (node as Element) : node?.parentElement ?? null;
  const command = element?.closest<HTMLElement>("[data-command-thought]")?.dataset?.commandThought;
  if (command) return command;
  const id = element?.closest<HTMLElement>("li[id^='point-']")?.id;
  return id?.startsWith("point-") ? id.slice("point-".length) : null;
}

/** The selected point, as `selectedThread` picks a card: words selected in it, else keyboard focus in it. */
export function selectedPoint(doc: Document): string | null {
  const selection = doc.getSelection();
  if (selection && !selection.isCollapsed) {
    const point = pointOf(selection.anchorNode);
    if (point) return point;
  }
  const active = doc.activeElement;
  if (active && active !== doc.body && active.matches(":focus-visible")) return pointOf(active);
  return null;
}

/** Whether `node` is in the composer, where typing "this" means what you selected before you came to type. */
function inComposer(node: unknown): boolean {
  return !!node && typeof (node as Element).closest === "function" && !!(node as Element).closest("form.composer");
}

/** Calls `report` with the selected and pointed card, and the point you're on (selected, else under the pointer),
 *  whenever any changes; returns the way to stop. Focus moving into the composer keeps the card and point you had
 *  selected, ahead of the pointer, so a typed "delete this" acts on them (the composer is in no card); a click
 *  outside the composer, Esc there, or focus anywhere else lets them go. */
export function watchAttention(report: (selected: string | null, pointed: string | null, point: string | null) => void, doc: Document = document): () => void {
  let selected: string | null = null;
  let pointed: string | null = null;
  let point: string | null = null;
  let pointer: string | null = null;
  let held: { thread: string | null; point: string | null } | null = null;
  const update = (nextPointed: string | null, nextPointer: string | null = pointer) => {
    let nextSelected = selectedThread(doc);
    let selectedAt = selectedPoint(doc);
    if (nextSelected || selectedAt) held = { thread: nextSelected, point: selectedAt };
    else if (held && inComposer(doc.activeElement)) ({ thread: nextSelected, point: selectedAt } = held);
    else held = null;
    const nextPoint = selectedAt ?? nextPointer;
    pointer = nextPointer;
    if (nextSelected === selected && nextPointed === pointed && nextPoint === point) return;
    selected = nextSelected;
    pointed = nextPointed;
    point = nextPoint;
    report(selected, pointed, point);
  };
  const over = (event: PointerEvent) => update(threadOf(event.target as Node), pointOf(event.target as Node));
  const left = () => update(null, null);
  // Focus leaves one element before it reaches the next: read it once it has landed.
  let timer = 0;
  const reselect = () => { clearTimeout(timer); timer = setTimeout(() => update(pointed), 0) as unknown as number; };
  const drop = () => { held = null; reselect(); };
  const down = (event: PointerEvent) => { if (held && !inComposer(event.target)) drop(); };
  const key = (event: KeyboardEvent) => { if (held && event.key === "Escape" && inComposer(event.target)) drop(); };
  doc.addEventListener("pointerover", over);
  doc.documentElement.addEventListener("pointerleave", left);
  doc.addEventListener("focusin", reselect);
  doc.addEventListener("focusout", reselect);
  doc.addEventListener("selectionchange", reselect);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("keydown", key, true);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener("pointerover", over);
    doc.documentElement.removeEventListener("pointerleave", left);
    doc.removeEventListener("focusin", reselect);
    doc.removeEventListener("focusout", reselect);
    doc.removeEventListener("selectionchange", reselect);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key, true);
  };
}

/** How long the card the pointer just left still counts as "this" (catalog.rs `POINTER_MS`, which has the why). */
export const POINTER_MS = 2_000;

/** Where your attention is, kept as the core keeps it (catalog.rs `Attention`): the selected card, the card under the
 *  pointer, and the last card the pointer left, with when. */
export type Attending = { selected: string | null; pointed: string | null; left: { id: string; at: number } | null };

/** The next `Attending` once the window says what's selected and pointed at, as catalog.rs `attend` records it. */
export function attend(was: Attending, selected: string | null, pointed: string | null, now: number): Attending {
  return { selected, pointed, left: was.pointed && was.pointed !== pointed ? { id: was.pointed, at: now } : was.left };
}

/** The card "this" means (catalog.rs `resolve_this`): the selected card, else the one under the pointer, else the one
 *  it left within POINTER_MS, else your active thread. A card counts only while its thread is on the map; a merged
 *  one counts as the thread it joined. */
export function resolveThis(a: Attending, world: Pick<World, "threads" | "merged">, active: string | null, now: number): string | null {
  const onMap = (id: string | null) => {
    if (id) id = resolveMerged(world, id);
    return id && world.threads.some((thread) => thread.id === id) ? id : null;
  };
  const left = a.left && now - a.left.at <= POINTER_MS ? a.left.id : null;
  return onMap(a.selected) ?? onMap(a.pointed) ?? onMap(left) ?? active;
}

/** Tells the core the latest selected and pointed card, and again on each new connection: a change made while the
 *  connection was down, or a core that restarted, would otherwise leave "this" stale until the next change. It also
 *  keeps what it told, for the window's own "this" mark (`attending`, and `watch` for each change). */
export function attentionTeller() {
  let last: string | null = null;
  let now: Attending = { selected: null, pointed: null, left: null };
  const watchers = new Set<() => void>();
  return {
    tell(selected: string | null, pointed: string | null, send: (message: string) => unknown, point: string | null = null) {
      now = attend(now, selected, pointed, Date.now());
      // The point only when there is one: the core reads a missing one as none.
      last = JSON.stringify({ type: "attention", selected, pointed, ...(point ? { point } : {}) });
      send(last);
      for (const watcher of watchers) watcher();
    },
    resend(send: (message: string) => unknown) {
      if (last) send(last);
    },
    attending: (): Attending => now,
    watch(watcher: () => void): () => void {
      watchers.add(watcher);
      return () => { watchers.delete(watcher); };
    },
  };
}

export type AttentionTeller = ReturnType<typeof attentionTeller>;
