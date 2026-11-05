import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStage, openPage } from './chrome.mjs';
import { timeline, frameRange } from './timeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] ?? join(here, 'renders'));
await mkdir(output, { recursive: true });
const review = await mkdtemp(join(output, 'title-review-'));
const stage = await openStage(join(here, 'stage.html'), 1920, 1080);
const visible = () => stage.evaluate(`(() => {
  const alpha = n => Number(getComputedStyle(n).opacity);
  const letters = document.querySelector('.tm-letters').textContent;
  const name = document.querySelector('.tm-name'), line = document.querySelector('.tm-tagline');
  return {letters, name: alpha(name) > .99 ? name.textContent : '',
    tagline: alpha(line) > .99 ? line.textContent : '', background: getComputedStyle(document.querySelector('#stage')).backgroundColor,
    glass: alpha(document.querySelector('.tm-glass')), vector: alpha(document.querySelector('.tm-icon svg')),
    credits: [...document.querySelectorAll('.end-credits,.caption,.label')].filter(n => !n.hidden && n.textContent).length};
})()`);
const variants = [
  { variant: 'short', seconds: 5.2, full: 1.15, initials: 2.09, folded: 2.5, impact: 3.23, seated: 3.56, hold: 4.5, colour: 'rgb(0, 0, 0)' },
  { variant: 'long', seconds: 8, full: 1.8, initials: 3.13, folded: 3.7, impact: 4.61, seated: 5.02, hold: 6.8, colour: 'rgb(255, 255, 255)' },
];
try {
  for (const [index, spec] of variants.entries()) {
    const shot = { ...timeline({ shots: [{ kind: 'titlemorph', variant: spec.variant, seconds: spec.seconds }] }).shots[0], index };
    await stage.frame(shot, spec.full);
    assert.equal((await visible()).letters, 'EVERYTHINGEVERYWHEREALLATONCE', 'The complete film title is readable');
    await stage.frame(shot, spec.initials);
    assert.equal((await visible()).letters, 'EEAAO', 'Only the five initials remain');
    await stage.frame(shot, spec.folded);
    assert.equal((await visible()).letters, 'E2A2O', 'The duplicate initials have become small twos');
    const folded = await stage.screenshot();
    const beadPositions = [];
    for (const time of [spec.impact, (spec.impact + spec.seated) / 2, spec.seated]) {
      await stage.frame(shot, time);
      beadPositions.push(await stage.evaluate('(() => { const r = document.querySelector(".tm-bead").getBoundingClientRect(); return r.y + r.height / 2; })()'));
    }
    assert.ok(beadPositions[1] < beadPositions[0] - 60, 'The bead rebounds visibly after impact');
    assert.ok(Math.abs(beadPositions[0] - beadPositions[2]) < .01, 'The bead seats at the impact height after one bounce');
    await stage.frame(shot, spec.hold);
    const end = await visible();
    assert.equal(end.background, spec.colour);
    assert.equal(end.letters, ''); assert.equal(end.name, 'E2A2O');
    assert.equal(end.tagline, spec.variant === 'long' ? 'Think out loud. Build what you mean.' : '');
    assert.equal(end.glass, 1); assert.equal(end.vector, 0); assert.equal(end.credits, 0);
    const still = await stage.screenshot();
    await stage.frame(shot, spec.seconds - 1 / 30);
    assert.deepEqual(await stage.screenshot(), still, 'The final signature holds completely still');
    const cold = await openStage(join(here, 'stage.html'), 1920, 1080);
    try {
      await cold.frame(shot, spec.hold);
      assert.deepEqual(await cold.screenshot(), still, 'A fresh renderer reproduces the held signature pixel for pixel');
    } finally { await cold.close(); }
    await stage.frame(shot, spec.folded);
    assert.deepEqual(await stage.screenshot(), folded, 'Backward seeking reproduces the visible title');
    const count = frameRange(spec.seconds, 30).count;
    assert.equal(count, spec.variant === 'short' ? 156 : 240);
    const frames = [];
    for (let i = 0; i < 24; i++) {
      const frame = Math.round(i * (count - 1) / 23), seconds = frame / 30;
      await stage.frame(shot, seconds);
      const filename = `${spec.variant}-${String(i).padStart(2, '0')}.png`;
      await writeFile(join(review, filename), await stage.screenshot());
      frames.push({ frame, seconds, filename });
    }
    await writeFile(join(review, `${spec.variant}.json`), JSON.stringify({ width: 1920, height: 1080, fps: 30, frames }, null, 2) + '\n');
    const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#25282d;color:#eee;font:18px -apple-system,BlinkMacSystemFont,sans-serif}header{height:54px;padding:16px 20px}main{display:grid;grid-template-columns:repeat(4,480px)}figure{margin:0;background:#17191c}img{display:block;width:480px;height:270px}figcaption{height:26px;padding:3px 12px;font-size:15px}</style><header>Everything Everywhere All at Once · ${spec.variant} · 24 frames / 30 fps</header><main>${frames.map(f => `<figure><img src="${f.filename}"><figcaption>${f.seconds.toFixed(3)} s · frame ${f.frame}</figcaption></figure>`).join('')}</main>`;
    const sheetFile = join(review, `title-${spec.variant}-sheet.html`);
    await writeFile(sheetFile, html);
    const sheet = await openPage(pathToFileURL(sheetFile).href, 1920, 1830);
    try {
      const deadline = Date.now() + 15000;
      while (!(await sheet.evaluate('document.querySelectorAll("img").length === 24'))) {
        assert.ok(Date.now() < deadline, 'Review sheet loads');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await sheet.evaluate('Promise.all([...document.images].map(img => img.decode()))');
      await writeFile(join(review, `title-${spec.variant}-sheet.png`), await sheet.screenshot());
    } finally { await sheet.close(); }
    console.log(`PASS ${spec.variant}: title/initials/twos, bounce, final glass/wording, still hold, cold renderer, backward seek, ${count} frames; 24-frame sheet.`);
  }
} finally { await stage.close(); }
console.log(`Review: ${review}`);
