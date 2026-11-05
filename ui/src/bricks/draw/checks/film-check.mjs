// Four focused regressions, using isolated bricks and a synthetic local API.
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../../../node_modules/vite/dist/node/index.js';
import { openPage } from '../../../../../scripts/headless.mjs';

const root = new URL('../../../../', import.meta.url).pathname;
const vite = await createServer({ root, configFile: false, define: { 'import.meta.env.VITE_E2A2O_FILM': '"1"' }, esbuild: { jsx: 'automatic' }, cacheDir: mkdtempSync(join(tmpdir(), 'film-vite-')), server: { middlewareMode: true, hmr: false, watch: null } });
const calls = [], saved = [];
let holdRead = false;
const pendingRead = Promise.withResolvers();
const spec = { title: 'Example part', blocks: [{ kind: 'line', text: 'Example content' }] };
const server = httpServer(async (req, res) => {
  if (!req.url.startsWith('/crew/') && req.url !== '/clarify' && req.url !== '/draw/read') return vite.middlewares(req, res);
  let bytes = ''; for await (const chunk of req) bytes += chunk;
  const body = JSON.parse(bytes); calls.push({ path: req.url, body });
  let value;
  if (req.url === '/clarify') value = { term: 'holon', question: 'What is a holon?' }; // Deliberately repeats an answered word.
  if (req.url === '/draw/read') value = { ms: 10, reading: { said: 'The lower box connects to the upper box. '.repeat(12), parts: [], links: [], unsure: [], flow: { name: 'Sketch', steps: [{name:'Example',prompt:'Example'}] }, draw_back: '' } };
  if (req.url === '/crew/plan') value = { run: 'example', name: 'Example build', ms: 1, parts: Array.from({length:body.said.includes('seven') ? 7 : 3}, (_,i) => ({id:`part-${i}`,name:`Part ${i}`,job:'Example',needs:[]})) };
  if (req.url === '/crew/build') value = { spec, commit: 'abc123', reused: false, broke: null, ms: 1 };
  if (req.url === '/crew/merge') value = { commit: 'abc123' };
  if (req.url === '/crew/promote') { if (body.to === 'main') saved.push(body.keep); value = {commit:'abc123',commits:'9',catalog:body.keep?.length ?? 0}; }
  if (req.url === '/draw/read' && holdRead) await pendingRead.promise;
  res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(value));
});
let page;
try {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(4374,'127.0.0.1',resolve); });
  page = await openPage('http://127.0.0.1:4374/src/bricks/draw/checks/film.html', { debugPort:4375, preserveProfile:true });
  const {evaluate,until} = page;
  const wait = async expression => assert.ok(await until(expression,15000), expression);
  await wait('!!window.film && !!document.querySelector("[data-thought]")');
  await evaluate('film.land("thought", "the holon lane")');
  await wait('!!document.querySelector(".clarify-note")');
  await evaluate('film.land("answer", "It means a unit of the whole.")');
  await wait('!document.querySelector(".clarify-note")');
  await evaluate('film.remount()');
  await evaluate('film.land("thought", "the holon lane")');
  await wait('!!document.querySelector("[data-thought]")');
  await wait('performance.getEntriesByType("resource").filter(r=>r.name.endsWith("/clarify")).length === 2');
  assert.equal(await evaluate('!!document.querySelector(".clarify-note")'),false);
  assert.deepEqual(calls.filter(c=>c.path==='/clarify').at(-1).body.answered,['holon']);
  console.log('PASS clarify: answered word stays dismissed after remount, even if the provider repeats it.');

  await evaluate('film.mode("crew")');
  await wait('!!document.querySelector(".crew-open")');
  for (const [brief,total] of [['three parts',3],['seven parts',7]]) {
    await evaluate(`dispatchEvent(new CustomEvent('e2a2o:crew-build',{detail:${JSON.stringify(brief)}}))`);
    await wait(`document.querySelector('.crew-count dd')?.textContent === '${total} of ${total}' && document.querySelector('.crew-foot')?.textContent.includes('next time: ${total}')`);
    assert.equal(saved.at(-1).length,total);
  }
  console.log('PASS crew count: 3/3 and 7/7 each save all 3 and 7 parts.');

  await evaluate('film.mode("draw")');
  await wait('!!document.querySelector(".draw-open")');
  await evaluate('document.querySelector(".draw-open").click()');
  await wait('!!document.querySelector(".draw-ink")');
  await evaluate('[...document.querySelectorAll(".draw-tools button")].find(b=>b.textContent==="Read it").click()');
  await wait('!!document.querySelector(".draw-said:not(.draw-looking)")');
  for (const [width,height] of [[1440,900],[640,480],[320,320]]) {
    await page.page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await wait(`innerWidth===${width} && document.querySelector('.draw-said').getBoundingClientRect().width <= ${width}`);
    const boxes = await evaluate(`(()=>{const ink=document.querySelector('.draw-ink').getBoundingClientRect(),said=document.querySelector('.draw-said').getBoundingClientRect();return {inkBottom:ink.bottom,saidTop:said.top,saidBottom:said.bottom,height:innerHeight}})()`);
    assert.ok(boxes.inkBottom<=boxes.saidTop && boxes.saidBottom<=boxes.height,JSON.stringify(boxes));
  }
  console.log('PASS draw layout: long reading stays below all ink at desktop, compact, and narrow sheet sizes.');

  // Start a fresh read, then ask to build while Spark is still reading.
  holdRead = true;
  await evaluate('film.remount()');
  await wait('!!document.querySelector(".draw-open")');
  await evaluate('document.querySelector(".draw-open").click()');
  await wait('!!document.querySelector(".draw-ink")');
  await evaluate('[...document.querySelectorAll(".draw-tools button")].find(b=>b.textContent==="Read it").click()');
  await wait('!!document.querySelector(".draw-looking")');
  const plans = calls.filter(c=>c.path==='/crew/plan').length;
  await evaluate('film.words("Build all that");film.words("")');
  pendingRead.resolve();
  await wait('!!document.querySelector(".crew-foot")');
  await evaluate('film.land("build-command", "Build all that")');
  assert.equal(calls.filter(c=>c.path==='/crew/plan').length,plans+1);
  assert.ok(calls.filter(c=>c.path==='/crew/plan').at(-1).body.said.includes('The lower box'));
  assert.equal(await evaluate('!!document.querySelector(".draw-sheet")'),false);
  console.log('PASS draw speech: Build all that alone waits for the reading and builds the sketch exactly once.');
} finally {
  pendingRead.resolve();
  await page?.close();
  await new Promise(resolve=>server.close(resolve));
  await vite.close();
}
