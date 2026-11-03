// The shell's small parts: keycaps (every control says its key, 11 px), its 16 px line icons, and the mode's stamp.
import type { ReactNode } from "react";
import { NAMES } from "./names";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘ on a Mac, Ctrl elsewhere: "⌘D" or "Ctrl+D". */
export const mod = (key: string) => (MAC ? `⌘${key}` : `Ctrl+${key}`);
/** The same key for aria-keyshortcuts: "Meta+D" or "Control+D". */
export const modAria = (key: string) => (MAC ? `Meta+${key}` : `Control+${key}`);

/** A key, drawn as a keycap. Seen, not read: the control's own aria-keyshortcuts says it to a screen reader. */
export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="keycap" aria-hidden="true">{children}</kbd>;
}

type IconName = "find" | "catalog" | "chevron" | "close" | "talk" | "history" | "settings" | "back" | "recap" | "export" | "undo" | "spark" | "mic";

const PATHS: Record<IconName, ReactNode> = {
  find: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  catalog: <><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></>,
  chevron: <path d="m4 6 4 4 4-4" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  talk: <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5" />,
  history: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>,
  settings: <><path d="M3 5h10M3 11h10" /><circle cx="6" cy="5" r="1.6" /><circle cx="10" cy="11" r="1.6" /></>,
  back: <path d="M9.5 4 5.5 8l4 4" />,
  recap: <><path d="M3 4h10M3 8h7M3 12h5" /></>,
  export: <><path d="M8 10V2.5M5 5.5l3-3 3 3" /><path d="M3 10v3h10v-3" /></>,
  undo: <><path d="M5.5 4 3 6.5 5.5 9" /><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></>,
  spark: <path d="M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8l4.3-1.2Z" />,
  mic: <><rect x="6" y="2" width="4" height="7.5" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return <svg className="shell-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>;
}

export type Mode = keyof typeof NAMES.stamp;

/** One stamp per mode, top left: what this map is, so demo and real never mix. Yours, alone: none. */
export function Stamp({ mode }: { mode: Mode | null }) {
  if (!mode) return null;
  return <span className="stamp" data-stamp={NAMES.stamp[mode]} title={NAMES.stampSays[mode]}>{NAMES.stamp[mode]}</span>;
}
