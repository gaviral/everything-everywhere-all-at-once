export interface HomePart { x: number; y: number; fontSize: number }

function visiblePart(elementPart: Element | null): elementPart is HTMLElement {
  return elementPart instanceof HTMLElement && elementPart.getBoundingClientRect().width > 0;
}

function elementHomePart(elementPart: HTMLElement): HomePart {
  const boundsPart = elementPart.getBoundingClientRect();
  const stylePart = getComputedStyle(elementPart);
  const insetPart = parseFloat(stylePart.paddingLeft) || 0;
  return { x: boundsPart.x + insetPart, y: boundsPart.y + (boundsPart.height - parseFloat(stylePart.fontSize)) / 2, fontSize: parseFloat(stylePart.fontSize) };
}

function selectorHomePart(selectorPart: string): HomePart | null {
  const elementPart = document.querySelector(selectorPart);
  return visiblePart(elementPart) ? elementHomePart(elementPart) : null;
}

function classicHomePart(): HomePart | null {
  const brandPart = document.querySelector('.brand[data-slot="top-left"]');
  if (!visiblePart(brandPart)) return null;
  const textPart = [...brandPart.childNodes].find(part => part.nodeType === Node.TEXT_NODE && part.textContent?.includes("E2A2O"));
  if (!textPart) return null;
  const rangePart = document.createRange();
  const startPart = textPart.textContent!.indexOf("E2A2O");
  rangePart.setStart(textPart, startPart);
  rangePart.setEnd(textPart, startPart + 5);
  const boundsPart = rangePart.getBoundingClientRect();
  return { x: boundsPart.x, y: boundsPart.y, fontSize: parseFloat(getComputedStyle(brandPart).fontSize) };
}

/** The home part follows the live identity, including the classic header and a narrow map's pill. */
export function measureHomePart(): HomePart | null {
  return selectorHomePart('.shell-wordmark') ?? classicHomePart() ?? selectorHomePart('.shell-identity');
}
