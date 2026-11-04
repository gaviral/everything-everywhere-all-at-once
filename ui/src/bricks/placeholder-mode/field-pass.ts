import { makeMask } from "./mask-rules";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type Cover = { element: HTMLDivElement; color: string; signature: string };
const selector = 'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]';

/** Cover editable glyphs while leaving the native value, selection and input events intact. */
export function startFieldPass(root: HTMLElement, names: readonly string[]) {
  const mask = makeMask(names), covers = new Map<Field, Cover>();
  let fields: Field[] = [], frame = 0;
  const remove = (field: Field, cover: Cover) => {
    field.classList.remove("placeholder-mode-hidden-field"); cover.element.remove(); covers.delete(field);
  };
  const update = () => {
    for (const field of fields) {
      const value = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.textContent ?? "";
      const displayed = mask(value), rect = field.getBoundingClientRect();
      let cover = covers.get(field);
      if (!field.isConnected || displayed === value || !rect.width || !rect.height) { if (cover) remove(field, cover); continue; }
      if (!cover) {
        const color = getComputedStyle(field).color;
        const element = document.createElement("div");
        element.className = "placeholder-mode-field-cover";
        element.dataset.placeholderModeUi = ""; element.setAttribute("aria-hidden", "true");
        cover = { element, color, signature: "" }; covers.set(field, cover);
        root.append(element); field.classList.add("placeholder-mode-hidden-field");
      }
      const style = getComputedStyle(field);
      const signature = JSON.stringify([displayed, rect.x, rect.y, rect.width, rect.height, field.scrollTop, field.scrollLeft, style.font, style.padding, style.textAlign, style.lineHeight]);
      if (signature === cover.signature) continue;
      cover.signature = signature;
      Object.assign(cover.element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        color: cover.color, font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign,
        padding: style.padding, border: `${style.borderTopWidth} solid transparent`,
        whiteSpace: field instanceof HTMLInputElement ? "pre" : "pre-wrap" });
      cover.element.textContent = displayed;
      // Keep the replacement readable even when the original long value was horizontally scrolled.
    }
    for (const [field, cover] of covers) if (!field.isConnected) remove(field, cover);
  };
  const tick = () => { update(); frame = requestAnimationFrame(tick); };
  const discover = () => { fields = [...root.querySelectorAll<Field>(selector)].filter(field => !field.closest("[data-placeholder-mode-ui]")); update(); };
  root.addEventListener("input", update, true);
  discover(); frame = requestAnimationFrame(tick);
  return { discover, stop() { cancelAnimationFrame(frame); root.removeEventListener("input", update, true); for (const [field, cover] of covers) remove(field, cover); } };
}
