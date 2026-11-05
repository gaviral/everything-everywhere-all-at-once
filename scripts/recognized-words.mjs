// Owned-browser acceptance: the words must be exposed to the person, including after opening a draft.
import assert from "node:assert/strict";

export const recognizedWordsVisible = words => `(() => {
  const words = ${JSON.stringify(words)};
  return [...document.querySelectorAll('.map-capture-live p,.map-capture-words,.voice-draft p')].some(e => {
    const r = e.getBoundingClientRect();
    return e.checkVisibility() && e.innerText.includes(words) && r.width > 0 && r.height > 0
      && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
})()`;

const draftDisclosure = words => `(() => {
  const draft = document.querySelector('.voice-draft'), summary = draft?.querySelector('summary');
  if (!draft || draft.open || !draft.querySelector('p')?.textContent.includes(${JSON.stringify(words)}) || !summary?.checkVisibility()) return null;
  const r = summary.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  return summary.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
})()`;

const returnToWords = words => `(() => {
  const stored = [...document.querySelectorAll('.map-capture-live p,.map-capture-words,.voice-draft p')].some(e => e.textContent.includes(${JSON.stringify(words)}));
  const button = document.querySelector('.capture-return button');
  if (!stored || !button?.checkVisibility()) return null;
  const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  return button.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
})()`;

const press = async (browser, point) => {
  for (const type of ["mousePressed", "mouseReleased"]) await browser.page("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
};

export async function expectRecognizedWords(browser, words, message = "recognized words remain visible") {
  const visible = recognizedWordsVisible(words), disclosure = draftDisclosure(words), route = returnToWords(words);
  assert.ok(await browser.until(`(${visible}) || !!(${disclosure}) || !!(${route})`, 10000), message);
  if (!await browser.evaluate(visible)) {
    const point = await browser.evaluate(route);
    if (point) await press(browser, point);
  }
  if (!await browser.evaluate(visible)) {
    assert.ok(await browser.until(`(${visible}) || !!(${disclosure})`, 10000), message);
    const point = await browser.evaluate(disclosure);
    if (point) await press(browser, point);
  }
  assert.ok(await browser.until(visible, 10000), message);
}
