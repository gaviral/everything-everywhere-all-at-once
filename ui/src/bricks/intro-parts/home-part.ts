export interface HomePart { x: number; y: number; size: number }

/** Land on the visible icon in either shell, including the narrow phone identity. */
export function measureHomePart(): HomePart | null {
  const icon = document.querySelector<HTMLElement>('.shell-identity .app-mark, .brand[data-slot="top-left"] .app-mark');
  if (!icon) return null;
  const bounds = icon.getBoundingClientRect();
  return bounds.width > 0 ? { x: bounds.x, y: bounds.y, size: bounds.width } : null;
}
