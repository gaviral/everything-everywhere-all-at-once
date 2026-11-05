// Capture the real app on an isolated sample map. Never grants microphone access.
// FILM_URL and FILM_OUT are required; media and the detailed report stay outside the repository.
import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
const statesMode = process.env.FILM_WALL_STATES === '1';
const report = { viewport: [1920, 1080], sample: 'student-week', microphone: 'denied', features: [] };
const page = await openPage(url.href, 1920, 1080);
async function saveReport() {
  const name = selected ? `capture-${selected[0]}` : 'capture';
  await writeFile(join(out, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  const captured = report.features.filter(f => f.status === 'captured').length;
  const skipped = report.features.filter(f => f.status === 'skipped');
  await writeFile(join(out, selected ? `${name}.md` : 'README.md'),
    `# Feature wall captures\n\n1920×1080; shipped student-week sample; fresh browser; microphone denied.\n\n${captured} captured; ${skipped.length} skipped.\n\n## Skipped\n\n` +
    skipped.map(f => `- ${f.id}: ${f.reason}`).join('\n') + '\n');
}
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
  const switches = Object.fromEntries(bricks.map(b => [b.id, ['spine', 'quiet-screen', ...(statesMode ? ['light-theme'] : []), feature?.id].includes(b.id)]));
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
  if (statesMode) {
    await page.evaluate(`(()=>{for(const b of document.querySelectorAll('button')) if(['Paper','Warm paper'].includes(b.textContent.trim()))b.click()})()`);
    await settled();
  }
}
function activity(id) {
  if (/draw|sketch|pen|shape|image|picture/.test(id)) return 'draw';
  if (/part|crew|build|work|demo|machine|depend|trigger|recipe|connection/.test(id)) return 'build';
  if (/understand|clar|research|question|answer|advis|explain|reading|review|speech/.test(id)) return 'understand';
  return 'organize';
}
async function captureSavedQuestions(capture, fill) {
      for(const [question,answer] of [
        ['Who welcomes volunteers?','Mira welcomes volunteers at the front desk.'],
        ['Which tools go on the first table?','Put screwdrivers and pliers on the first table.'],
        ['When does the repair night open?','The hall opens at six on Saturday.'],
        ['How will we sort incoming repairs?','Use separate trays for fabric, bikes, and small appliances.']]){
        await page.evaluate(`[...document.querySelectorAll('.saved-questions button')].find(b=>b.textContent==='Open')?.click()`);
        await fill('.saved-questions form textarea',question);await capture('question: '+question);
        await page.evaluate(`document.querySelector('.saved-questions form button[type=submit]').click()`);
        await until(`document.querySelector('.saved-questions-list')?.textContent.includes(${JSON.stringify(question)})`);await capture('saved: '+question);
        await page.evaluate(`[...document.querySelectorAll('.saved-questions-list li')].find(e=>e.textContent.includes(${JSON.stringify(question)}))?.querySelector('button')?.click()`);
        await until(`document.querySelectorAll('.saved-questions form').length===2`);
        await fill('.saved-questions form:nth-of-type(2) textarea:last-of-type',answer);
        await capture('answer: '+question);
        await page.evaluate(`[...document.querySelectorAll('.saved-questions button')].find(b=>b.textContent==='Save answer').click()`);
        await until(`document.querySelectorAll('.saved-questions form').length===1`);
        await page.evaluate(`[...document.querySelectorAll('.saved-questions button')].find(b=>b.textContent==='Answered').click()`);
        await capture('answered: '+question);
      }

}

async function capturePinnedThoughts(capture, fill) {
      for(let i=0;i<8;i++){
        await page.evaluate(`(()=>{const s=document.querySelector('.sticky-notes select');s.value=[...s.options].find(o=>o.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await capture('choose source '+(i+1));
        await page.evaluate(`document.querySelector('.sticky-notes-pin button[type=submit]').click()`);
        await until(`document.querySelectorAll('.sticky-notes-note').length===${i+1}`);
        await capture('pinned source '+(i+1));
      }

}

async function captureDeadlines(capture, fill) {
      for(const label of ['Welcome volunteers','Open the repair tables','Clean up the hall']){
        await click('.countdown-add');
        const n=await page.evaluate(`document.querySelectorAll('.countdown-row').length`);
        await fill(`.countdown-row:nth-child(${n}) input[type=text]`,label);
        await capture(label);
      }

}

async function captureRectangles(capture, fill) {
      for(const [i,size] of [[0,140],[1,280],[2,420]]){
        await fill('.shapes-range',String(size));await capture('rectangle input '+(i+1));
        await page.evaluate(`[...document.querySelectorAll('.shapes-button')].find(b=>b.textContent==='Place rectangle').click()`);
        await capture('rectangle placed '+(i+1));
      }

}

async function capturePartReadings(capture, fill) {
      const n=await page.evaluate('document.querySelectorAll(".part-lenses-tree button").length');
      for(let p=0;p<n;p++)for(let lens=0;lens<3;lens++){
        await page.evaluate(`document.querySelectorAll('.part-lenses-tree button')[${p}].click();document.querySelectorAll('.part-lenses-switch button')[${lens}].click()`);
        await capture(`part ${p+1}, lens ${lens+1}`);
      }

}

async function capturePartDimensions(capture, fill) {
      const n=await page.evaluate('document.querySelectorAll(".pd-sequence button").length');
      const dimensions=await page.evaluate('document.querySelectorAll(".pd-dimensions button").length');
      for(let p=0;p<n;p++)for(let d=0;d<dimensions;d++){
        await page.evaluate(`document.querySelectorAll('.pd-sequence button')[${p}].click();document.querySelectorAll('.pd-dimensions button')[${d}].click()`);
        await capture(`step ${p+1}, dimension ${d+1}`);
      }

}

async function captureTopicReadings(capture, fill) {
      const n=await page.evaluate('document.querySelectorAll(".topic-views-tree button").length');
      for(let p=0;p<n;p++)for(let v=0;v<2;v++){
        await page.evaluate(`document.querySelectorAll('.topic-views-tree button')[${p}].click()`);
        await settled();
        await page.evaluate(`document.querySelectorAll('.topic-views-switch button')[${v}].click()`);
        await capture(`topic ${p+1}, reading ${v+1}`);
      }

}

async function captureReadingCards(capture, fill) {
      const n=await page.evaluate('document.querySelectorAll(".reading-format-feed article").length');
      for(let p=0;p<Math.min(n,12);p++){
        await page.evaluate(`document.querySelectorAll('.reading-format-feed article')[${p}].scrollIntoView({block:'center'})`);
        await capture(`read item ${p+1}`);
      }

}

async function captureStates(feature, row) {
  row.states = [];
  const seen = new Set();
  async function capture(label) {
    await settled();
    const pixels = await page.screenshot();
    const signature = createHash('sha256').update(pixels).digest('hex');
    if (seen.has(signature)) return;
    seen.add(signature);
    const file = `${feature.id}--${String(row.states.length).padStart(2,'0')}.png`;
    await writeFile(join(out, file), pixels);
    row.states.push({ file, label, activity: activity(feature.id) });
  }
  await capture('initial');
  // Scope all operations to this feature's real surface, never the app's mic or composer.
  const rootExpression = `document.querySelector('[data-guide="${feature.id}"]') || document.querySelector('[data-brick="${feature.id}"]')`;
  const filled = await page.evaluate(`(()=>{
    const root=${rootExpression}; const fields=[...(root?.querySelectorAll('textarea,input[type=text],input:not([type])')??[])].filter(e=>!e.disabled&&!e.readOnly&&!e.closest('[data-guide=composer]'));
    for(const e of fields.slice(0,3)) {
      const descriptor=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
      descriptor.set.call(e,'Free repair night: volunteers, tool tables, and a six o’clock welcome.');
      e.dispatchEvent(new Event('input',{bubbles:true}));
    } return fields.length>0;
  })()`);
  if(filled) await capture('input');
  const controls = await page.evaluate(`(()=>{
    const root=${rootExpression}; if(!root)return [];
    return [...root.querySelectorAll('button,summary,[role=tab]')].filter(e=>{
      const r=e.getBoundingClientRect();return r.width&&r.height&&!e.disabled;
    }).map((e,i)=>({i,text:(e.innerText||e.getAttribute('aria-label')||'').trim(),tag:e.tagName}));
  })()`);
  const unsafe = /mic|listen|speak|voice|email|send|delete|clear|reset|features|theme|look|build all|openai|token|key|close|export|download|copy|share|connect|install|upload|sign in|record|^run|^build|^generate|^original$|^paper$|^orbit$|^signal$|^warm paper$|^cool studio$|^high contrast$/i;
  for (const control of (process.env.FILM_SELECT_STATES ? [] : controls.filter(c => c.text && !unsafe.test(c.text))).slice(0,Number(process.env.FILM_STATE_LIMIT??18))) {
    const changed = await page.evaluate(`(()=>{
      const root=${rootExpression}; if(!root)return false;
      const b=[...root.querySelectorAll('button,summary,[role=tab]')].find(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()===${JSON.stringify(control.text)});
      if(!b||b.disabled||!b.getBoundingClientRect().width||!b.getBoundingClientRect().height)return false;b.click();return true;
    })()`);
    if(changed) await capture(control.text);
  }
  // Text goes through the genuine React input handler, and is retained only if it changes the shown state.
  const input = await page.evaluate(`(()=>{
    const root=${rootExpression}; const e=root?.querySelector('textarea,input[type=text],input:not([type])');
    if(!e||e.disabled||e.readOnly||e.closest('[data-guide=composer]'))return false;
    const descriptor=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
    descriptor.set.call(e,'Free repair night: volunteers, tool tables, and a six o’clock welcome.');
    e.dispatchEvent(new Event('input',{bubbles:true}));return true;
  })()`);
  if (input) await capture('input');
  if(process.env.FILM_SELECT_STATES) {
    const selects=await page.evaluate(`(()=>{const r=${rootExpression};return [...(r?.querySelectorAll('select')??[])].map((s,i)=>({i,options:[...s.options].filter(o=>!o.disabled&&o.value).map(o=>({value:o.value,label:o.label}))}))})()`);
    for(const select of selects) for(const option of select.options.slice(0,10)) {
      if(/look|theme|font|size/i.test(option.label))continue;
      const changed=await page.evaluate(`(()=>{const r=${rootExpression};const s=r?.querySelectorAll('select')[${select.i}];if(!s||s.value===${JSON.stringify(option.value)})return false;s.value=${JSON.stringify(option.value)};s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      if(changed)await capture(option.label);
    }
    const count=await page.evaluate(`(()=>{const r=${rootExpression};return r?.querySelectorAll('input[type=checkbox]').length??0})()`);
    for(let i=0;i<Math.min(count,8);i++){
      const changed=await page.evaluate(`(()=>{const e=(${rootExpression})?.querySelectorAll('input[type=checkbox]')[${i}];if(!e||e.disabled)return false;e.click();return true})()`);
      if(changed)await capture('option '+(i+1));
    }
  }
  if(process.env.FILM_DEEP_STATES) {
    const fill=async(selector,value)=>{
      await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.readOnly)throw Error('Editable field missing');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await settled();
    };
    if(feature.id==='saved-questions') await captureSavedQuestions(capture, fill);
    if(feature.id==='sticky-notes') await capturePinnedThoughts(capture, fill);
    if(feature.id==='countdown') await captureDeadlines(capture, fill);
    if(feature.id==='shapes') await captureRectangles(capture, fill);
    if(feature.id==='part-lenses') await capturePartReadings(capture, fill);
    if(feature.id==='part-dimensions') await capturePartDimensions(capture, fill);
    if(feature.id==='topic-views') await captureTopicReadings(capture, fill);
    if(feature.id==='reading-format') await captureReadingCards(capture, fill);
  }
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
      const openers = { draw: '.draw-open', crew: '.crew-open', 'work-list': '.work-list-launcher', 'part-dimensions': '.part-dimensions-open', import: '[data-guide="import"]', 'saved-questions':'.saved-questions > button', 'sticky-notes':'.sticky-notes-trigger', countdown:'.countdown-card' };
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
        if (statesMode) await captureStates(feature, row);
      }
    } catch (error) { row.status = 'skipped'; row.reason = error.message; }
    report.features.push(row);
    await saveReport();
    console.log(`${row.status} ${row.id}${row.reason ? `: ${row.reason}` : ''}`);
  }
} finally { await page.close(); }
