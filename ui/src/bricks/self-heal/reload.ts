import { pageSpeaking } from "../../page-speech";

const RELOADED = "e2a2o.self-heal.chunk-reloaded";
export function chunkFailed(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (?:CSS )?chunk [\w-]+ failed/i.test(error.message);
}
function hasDraft() {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea,input:not([type]),input[type="text"],input[type="search"],[contenteditable="true"]')]
    .some(field => !field.readOnly && (field.isContentEditable ? field.textContent : field.value)?.trim());
}
/** One attempt per tab, recorded before navigation. Never interrupt typing, capture, sending or speech. */
export function reloadChunkOnce(error: unknown): boolean {
  if (!chunkFailed(error) || !navigator.onLine || hasDraft() || pageSpeaking()
    || document.querySelector('.mic[aria-pressed="true"],.mic[data-state="starting"],.shell-status-wait')) return false;
  try {
    if (sessionStorage.getItem(RELOADED)) return false;
    sessionStorage.setItem(RELOADED, "1");
    location.reload();
    return true;
  } catch { return false; }
}
