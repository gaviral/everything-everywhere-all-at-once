import { makeMask } from "./mask-rules";

type SavedLabel = { original: string; displayed: string };
type Cover = { element: HTMLElement; signature: string };
const skip = 'script,style,noscript,textarea,input,select,[contenteditable]:not([contenteditable="false"]),[data-placeholder-mode-ui]';
const attributes = ["title", "aria-label", "aria-description", "alt", "placeholder"];

/** Clone only the painted presentation. Real text nodes remain available to selection and handlers. */
function paintedCopy(source: HTMLElement, mask: (text: string) => string): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((original, index) => {
    const target = copies[index], computed = getComputedStyle(original);
    target.removeAttribute("id"); target.removeAttribute("name");
    target.removeAttribute("autofocus"); target.classList.remove("placeholder-mode-hidden-text");
    for (const property of computed) target.style.setProperty(property, computed.getPropertyValue(property));
    target.style.pointerEvents = "none";
    target.style.animation = "none"; target.style.transition = "none";
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.value = mask(original instanceof HTMLInputElement || original instanceof HTMLTextAreaElement ? original.value : "");
  });
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = mask(node.nodeValue ?? "");
  copy.dataset.placeholderModeUi = ""; copy.setAttribute("aria-hidden", "true"); copy.inert = true;
  copy.style.setProperty("opacity", "1", "important");
  Object.assign(copy.style, { position: "fixed", margin: "0", right: "auto", bottom: "auto", zIndex: "2147483645", transformOrigin: "top left", pointerEvents: "none" });
  return copy;
}

/** Discovers sensitive text nodes, then paints masked copies without replacing any source text. */
export function startTextPass(root: HTMLElement, names: readonly string[], changed: () => void) {
  const covers = new Map<HTMLElement, Cover>();
  const labels = new Map<Element, Map<string, SavedLabel>>();
  const plainMask = makeMask(names);
  let frame = 0;
  const remove = (source: HTMLElement, cover: Cover) => {
    source.classList.remove("placeholder-mode-hidden-text"); cover.element.remove(); covers.delete(source);
  };
  const position = (source: HTMLElement, cover: Cover) => {
    const rect = source.getBoundingClientRect();
    const scaleX = source.offsetWidth ? rect.width / source.offsetWidth : 1;
    const scaleY = source.offsetHeight ? rect.height / source.offsetHeight : 1;
    const signature = `${rect.x},${rect.y},${rect.width},${rect.height},${scaleX},${scaleY}`;
    if (signature === cover.signature) return;
    cover.signature = signature;
    Object.assign(cover.element.style, { left: `${rect.left}px`, top: `${rect.top}px`, visibility: rect.width && rect.height ? "visible" : "hidden", transform: `scale(${scaleX},${scaleY})` });
  };
  const track = () => {
    for (const [source, cover] of covers) {
      if (!source.isConnected) remove(source, cover); else position(source, cover);
    }
    frame = requestAnimationFrame(track);
  };
  const scan = () => {
    observer.disconnect();
    // Restore paint first so copied computed styles include original opacity.
    for (const [source, cover] of covers) remove(source, cover);
    const recipients = new Map<Element, ReturnType<typeof makeMask>>();
    for (const head of root.querySelectorAll(".send-card-head")) {
      if (head.closest("[data-placeholder-mode-ui]")) continue;
      const recipient = head.textContent?.match(/^(?:Email|Message) to (.*?)(?: · dry run)?$/)?.[1];
      const card = head.closest(".send-card");
      if (recipient && card) recipients.set(card, makeMask(names, recipient));
    }
    const maskFor = (element: Element) => recipients.get(element.closest(".send-card")!) ?? plainMask;
    const candidates = new Set<HTMLElement>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && parent !== root && !parent.closest(skip) && maskFor(parent)(node.nodeValue ?? "") !== node.nodeValue) candidates.add(parent);
    }
    for (const source of candidates) {
      if ([...candidates].some(other => other !== source && other.contains(source))) continue;
      const element = paintedCopy(source, maskFor(source));
      const cover = { element, signature: "" };
      root.append(element); position(source, cover);
      source.classList.add("placeholder-mode-hidden-text"); covers.set(source, cover);
    }
    for (const element of root.querySelectorAll(attributes.map(name => `[${name}]`).join(","))) {
      if (element.closest("[data-placeholder-mode-ui],script,style")) continue;
      const saved = labels.get(element) ?? new Map<string, SavedLabel>();
      for (const name of attributes) {
        const current = element.getAttribute(name);
        if (current === null) { saved.delete(name); continue; }
        const previous = saved.get(name);
        const original = previous && current === previous.displayed ? previous.original : current;
        const displayed = maskFor(element)(original);
        if (displayed !== original) saved.set(name, { original, displayed }); else saved.delete(name);
        if (current !== displayed) element.setAttribute(name, displayed);
      }
      if (saved.size && root.contains(element)) labels.set(element, saved); else labels.delete(element);
    }
    for (const element of labels.keys()) if (!root.contains(element)) labels.delete(element);
    changed();
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attributes });
  };
  const observer = new MutationObserver(scan);
  scan(); frame = requestAnimationFrame(track);
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    for (const [source, cover] of covers) remove(source, cover);
    for (const [element, saved] of labels) for (const [name, value] of saved) {
      if (element.getAttribute(name) === value.displayed) element.setAttribute(name, value.original);
    }
    labels.clear();
  };
}
