// Capture the real app on an isolated sample map. Never grants microphone access.
// FILM_URL and FILM_OUT are required; media and the detailed report stay outside the repository.
import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../film/chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.FILM_URL);
assert(['localhost', '127.0.0.1'].includes(url.hostname) && !['4360', '4399'].includes(url.port), 'Use a scratch core');
const out = resolve(process.env.FILM_OUT);
await mkdir(out, { recursive: true });
const bricks = [];
for (const entry of await readdir(join(root, 'ui/src/bricks'), { withFileTypes: true })) {
  const name = entry.name;
  if (!entry.isDirectory() || name.startsWith('_')) continue;
  try {
    await access(join(root, 'ui/src/bricks', name, 'index.tsx'));
    const info = JSON.parse(await readFile(join(root, 'ui/src/bricks', name, 'brick.json')));
    assert.equal(info.id, name);
    bricks.push({ ...info, source: 'BRICKS' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const source = await readFile(join(root, 'ui/src/shell/features.ts'), 'utf8');
const builtIns = [...source.split('export const BUILT_INS:')[1].split('];')[0].matchAll(/\{ id: "([^"]+)", kind: "([^"]+)"/g)]
  .map(([, id, kind]) => ({ id, kind, source: 'BUILT_INS' }));
const all = [...bricks.sort((a, b) => a.id.localeCompare(b.id)), ...builtIns];
const selected = process.env.FILM_FEATURES?.split(',');
const report = { viewport: [1920, 1080], sample: 'student-week', microphone: 'denied', features: [] };
const page = await openPage(url.href, 1920, 1080);
async function until(expression, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await page.evaluate(`!!(${expression})`)) return;
    await new Promise(r => setTimeout(r, 80));
  }
  throw Error('Visible state did not arrive');
}
async function settled() {
  await page.evaluate(`(async()=>{
    await document.fonts.ready;
    await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
    let last='', stable=0;
    for(let n=0;n<100;n++) {
      await new Promise(r=>requestAnimationFrame(r));
      const next=[...document.querySelectorAll('main, [data-brick], .react-flow__viewport')].map(e=>{
        const r=e.getBoundingClientRect();return [e.textContent,r.x,r.y,r.width,r.height,e.getAttribute('style')].join('|');
      }).join('~');
      stable=next===last?stable+1:0; last=next;
      if(stable>=8)return;
    }
  })()`);
}
async function click(selector) {
  return page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`);
}
async function populate(feature) {
  if (feature.id === 'work-list') {
    const sample = join(out, 'repair-night.md');
    await writeFile(sample, '# Community repair night\n- Welcome volunteers\n  - Set up three tables\n  - Check the tool kits\n- Open the hall at six\n- Repair, share, and tidy up\n');
    const { root: document } = await page.call('DOM.getDocument');
    const { nodeId } = await page.call('DOM.querySelector', { nodeId: document.nodeId, selector: '.work-list input[type=file]' });
    if (nodeId) {
      await page.call('DOM.setFileInputFiles', { nodeId, files: [sample] });
      await until('document.body.innerText.includes("Welcome volunteers")');
    }
  }
  if (feature.id === 'draw') {
    const box = await page.evaluate('(()=>{const r=document.querySelector(".draw-page").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    for (const left of [.2, .43, .66]) {
      const points = [[left,.35],[left+.16,.35],[left+.16,.65],[left,.65],[left,.35]];
      for (let n = 0; n < points.length; n++) {
        const [x,y] = points[n];
        await page.call('Input.dispatchMouseEvent', { type: n === 0 ? 'mousePressed' : 'mouseMoved', x: box.x+x*box.w, y: box.y+y*box.h, button: 'left', buttons: 1, clickCount: 1 });
      }
      const [x,y] = points.at(-1);
      await page.call('Input.dispatchMouseEvent', { type:'mouseReleased', x:box.x+x*box.w, y:box.y+y*box.h, button:'left', buttons:0, clickCount:1 });
    }
  }
}
async function prepare(feature) {
  const switches = Object.fromEntries(bricks.map(b => [b.id, ['spine', 'quiet-screen', feature?.id].includes(b.id)]));
  const built = Object.fromEntries(builtIns.map(b => [b.id, b.id === 'plugins' || b.id === feature?.id]));
  await page.evaluate(`localStorage.clear();localStorage.setItem('e2a2o.bricks',${JSON.stringify(JSON.stringify(switches))});localStorage.setItem('e2a2o.features',${JSON.stringify(JSON.stringify(built))})`);
  await page.call('Page.navigate', { url: `${url.origin}/?film&sample&bricks=quiet-screen,${feature?.source === 'BRICKS' ? feature.id : 'spine'}` });
  await until('window.e2a2oFilm && document.querySelector("[data-guide=composer] textarea")');
  await until('document.body.innerText.includes("student") || document.body.innerText.includes("essay") || document.querySelectorAll(".react-flow__node").length > 3');
  if (feature?.kind === 'view' && !['spine', 'terse', 'conversation-spine'].includes(feature.id)) {
    await click('[data-guide="catalog"]');
    await until(`document.querySelector('[data-row="${feature.id}"]')`);
    const opened = await page.evaluate(`(()=>{const r=document.querySelector('[data-row="${feature.id}"]');const b=[...r.querySelectorAll('button')].find(b=>b.textContent.trim()==='Show');b?.click();return !!b})()`);
    if (!opened) await click('[data-guide="catalog"]');
  }
  await settled();
}
function visibleState(id) {
  return `(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<1080&&r.left<1920&&s.visibility!=='hidden'&&s.display!=='none'};
    const roots=[...document.querySelectorAll('[data-brick="${id}"]')];
    const nodes=roots.flatMap(r=>[r,...r.querySelectorAll('*')]).filter(visible);
    return {text:document.body.innerText, own:nodes.map(e=>e.innerText?.trim()||e.getAttribute('aria-label')||(['CANVAS','IMG','INPUT','TEXTAREA'].includes(e.tagName)?e.tagName:'')).filter(Boolean).join(' ').slice(0,500),
      errors:[...document.querySelectorAll('.feature-error,[role="alert"]')].filter(visible).map(e=>e.textContent),
      quiet:document.documentElement.classList.contains('quiet-screen')};
  })()`;
}
try {
  await until('document.querySelector("[data-guide=composer] textarea")');
  // The sample button uses the core's normal sample loader and real saved sample content.
  if (await page.evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("See an example"))')) {
    await page.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("See an example")&&!b.disabled)?.click()');
    await until('document.querySelectorAll(".react-flow__node").length > 3');
  }
  await prepare(null);
  const baseline = await page.evaluate(visibleState('none'));
  for (const feature of all.filter(f => !selected || selected.includes(f.id))) {
    const row = { id: feature.id, source: feature.source, kind: feature.kind };
    try {
      await prepare(feature);
      // Reveal safe, local panels when a feature first presents an opener.
      const openers = { draw: '.draw-open', crew: '.crew-open', 'work-list': '.work-list-launcher', 'part-dimensions': '.part-dimensions-open', import: '[data-guide="import"]' };
      if (openers[feature.id]) { await click(openers[feature.id]); await settled(); }
      await populate(feature); await settled();
      const state = await page.evaluate(visibleState(feature.id));
      assert(state.quiet, 'Quiet screen not active');
      if (state.errors.length) throw Error(state.errors.join('; '));
      if (!state.own && state.text === baseline.text && feature.id !== 'spine') {
        row.status = 'skipped'; row.reason = 'No distinct visible state on the desktop sample without further input';
      } else {
        row.status = 'captured'; row.visible = state.own.slice(0, 200);
        row.file = `${feature.id}.png`;
        await writeFile(join(out, row.file), await page.screenshot());
      }
    } catch (error) { row.status = 'skipped'; row.reason = error.message; }
    report.features.push(row);
    await writeFile(join(out, selected ? `capture-${selected[0]}.json` : 'capture.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${row.status} ${row.id}${row.reason ? `: ${row.reason}` : ''}`);
  }
} finally { await page.close(); }
