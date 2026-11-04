// One feature, synthetic props, no core/model/microphone. Chrome's disposable profile is retained.
import assert from 'node:assert/strict';
import { uiServer } from './ui-server.mjs';
import { createServer as freePortServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openPage } from './headless.mjs';

const portReservation = freePortServer();
await new Promise(resolve => portReservation.listen(0, '127.0.0.1', resolve));
const port = portReservation.address().port;
await new Promise(resolve => portReservation.close(resolve));
assert.ok(![4360, 4399].includes(port));
const harness = `<!doctype html><html><head><style>
  :root{--ink:#f1f3ed;--muted:#b2b9b0;--bg:#161c18;--card:#222a24;--line:#475549;--accent:#bedc9d;--shadow:0 12px 40px #0003}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px system-ui;padding:16px;box-sizing:border-box}#root{max-width:600px;margin:0 auto}
  </style><script>window.errors=[];addEventListener('error',e=>errors.push(e.message));</script></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:speech-review-check"></script></body></html>`;
const module = `import React from 'react';
  import ReactDOM from 'react-dom/client';
  import SpeechReview from '/src/bricks/speech-review/index.tsx';
  const root=ReactDOM.createRoot(document.getElementById('root'));
  window.sent=[];window.accept=true;
  navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone access forbidden')};
  window.props={map:{mapIdentity:'map-one',me:'Demo',connected:true},actions:{addThought:text=>{sent.push(text);return accept;}}};
  window.paint=()=>root.render(React.createElement(SpeechReview,props));paint();`;
const moduleId = '\0virtual:speech-review-check';
const server = await uiServer({
  plugins: [{ name: 'speech-review-check',
    resolveId(id) { if (id === 'virtual:speech-review-check' || id === moduleId) return moduleId; },
    load(id) { if (id === moduleId) return module; },
    configureServer(vite) {
    vite.middlewares.use((req,res,next) => {
      if (req.url === '/__review') { res.setHeader('Content-Type','text/html'); res.end(harness); }
      else next();
    });
  }}]
}, { port });
let browser;
try {
  await server.listen();
  browser = await openPage(`http://127.0.0.1:${port}/__review`, { preserveProfile: true });
  const { evaluate, until, page } = browser;
  const click = async text => {
    assert.ok(await until(`Array.from(document.querySelectorAll('.speech-review button')).some(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled)`), `enabled ${text}`);
    await evaluate(`Array.from(document.querySelectorAll('.speech-review button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  };
  const fill = async text => {
    await evaluate(`(()=>{const t=document.querySelector('.speech-review textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.ok(await until(`document.querySelector('.speech-review textarea').value===${JSON.stringify(text)}`));
  };
  assert.ok(await until(`!!document.querySelector('.speech-review textarea')`, 15000), 'example opens');
  assert.match(await evaluate(`document.querySelector('.speech-review').textContent`), /EXAMPLE/);
  assert.match(await evaluate(`document.querySelector('.speech-review').textContent`), /live mic still sends directly/);
  assert.deepEqual(await evaluate('sent'), [], 'mount never submits');
  const corrected = 'Meet at the pier before the garden event.';
  await fill(corrected);
  await click('Preview release →');
  assert.ok(await until(`document.querySelector('.speech-review-exact')?.textContent===${JSON.stringify(corrected)}`));
  assert.deepEqual(await evaluate('sent'), [], 'editing and preview never submit');
  await click('Edit words');
  assert.ok(await until(`document.activeElement===document.querySelector('.speech-review textarea')`), 'edit returns focus');
  await click('Close');
  await click('◈ Word review Before the map');
  assert.equal(await evaluate(`document.querySelector('.speech-review textarea').value`), corrected, 'close preserves edits');
  await click('Preview release →');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Release example to map ↗');b.click();b.click();})()`);
  assert.ok(await until(`document.querySelector('.speech-review-status')?.textContent.startsWith('Submitted')`));
  assert.deepEqual(await evaluate('sent'), [corrected], 'only reviewed words released once');
  assert.match(await evaluate(`document.querySelector('.speech-review-original').textContent`), /at the pair/);
  await click('Review another');
  await fill('The workshop starts at seven.');
  await click('Review these words →');
  await click('Preview release →');
  await evaluate(`props={...props,map:{...props.map,connected:false}};paint()`);
  assert.ok(await until(`document.querySelector('.speech-review-status')?.textContent.startsWith('Disconnected')`));
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Release to map ↗').disabled`), true);
  assert.equal((await evaluate('sent')).length, 1, 'disconnect never submits');
  await evaluate(`accept=false;props={...props,map:{...props.map,connected:true}};paint()`);
  await click('Release to map ↗');
  assert.ok(await until(`document.querySelector('.speech-review-status')?.textContent.startsWith('Not submitted')`));
  assert.equal((await evaluate('sent')).length, 2, 'refusal has no automatic retry');
  await evaluate('accept=true');
  await click('Retry release');
  assert.ok(await until(`document.querySelector('.speech-review-status')?.textContent.startsWith('Submitted')`));
  assert.deepEqual(await evaluate('sent'), [corrected, 'The workshop starts at seven.', 'The workshop starts at seven.']);
  await click('Review another');
  await click('Restore previous review');
  assert.ok(await until(`document.querySelector('.speech-review-status')?.textContent.startsWith('Submitted')`), 'restoring submitted text cannot resubmit');
  await evaluate(`props={...props,map:{...props.map,mapIdentity:'map-two'}};paint()`);
  assert.ok(await until(`document.querySelector('.speech-review textarea')?.value.includes('at the pair')`), 'new map has no old draft');
  await click('Use my own words');
  await fill('x'.repeat(6001));
  assert.ok(await until(`document.querySelector('.speech-review-paste').textContent.includes('6,000')`), 'oversize retained and explained');
  assert.equal(await evaluate(`document.querySelector('button[type=submit]').disabled`), true);
  await fill('We meet at the pier.');
  await click('Review these words →');
  await click('Set aside');
  await click('Restore previous review');
  assert.ok(await until(`document.querySelector('.speech-review textarea')?.value==='We meet at the pier.'`), 'set aside is reversible');
  const evidence = new URL('../artifacts/speech-review/', import.meta.url);
  mkdirSync(evidence, { recursive: true });
  for (const width of [1440,390]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    assert.ok(await until(`document.querySelector('.speech-review').getBoundingClientRect().right<=innerWidth`));
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false, 'no horizontal overflow');
    const shot = await page('Page.captureScreenshot',{format:'png'});
    writeFileSync(new URL(`review-${width}.png`, evidence), Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(await evaluate('errors'), [], 'no browser errors');
  console.log('PASS speech-review: exact reviewed release, no pre-release dispatch, duplicate guard, refusal/retry, disconnect, original, focus, close, restore, map scope, bounds, desktop/phone. Live microphone hold is outside this feature.');
} catch (error) {
  if (browser) console.error('Page diagnostics:', await browser.evaluate('JSON.stringify({errors:window.errors,body:document.body.innerText})'));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
