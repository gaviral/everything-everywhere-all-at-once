// One populated example in both system schemes. No model calls or microphone access.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openPage, ready, standInCore } from './headless.mjs';

assert.equal(ready(), '', 'built UI and Chrome available');
const now = 1800000000000;
const words = [
  'Example · A little room to think',
  'Start with a conversation. Let the ideas find their place.',
  'Keep the original thought, and give the next one room.',
  'A quiet space to see what matters.',
];
const world = {
  threads: [{ id: 'T1', title: 'A little room to think', parent_id: null, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' }],
  thoughts: words.map((text, i) => ({ id: `p${i}`, thread_id: 'T1', speaker: i % 2 ? 'Mira' : 'you', text, point: text, complete: true, placed: true, at_ms: now + i * 1000, place_ms: 0 })),
  active: 'T1', active_by: { you: 'T1' }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, notes: {}, recaps: [], proposals: [], positions: {},
};
const core = await standInCore(() => [{ type: 'snapshot', world }], { port: 48151 });
let browser;

async function openExample(scheme) {
  browser = await openPage('about:blank', { width: 960, height: 1016, debugPort: 48152, preserveProfile: true });
  await browser.page('Page.enable');
  await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured','1');
    localStorage.setItem('e2a2o.install-hint','1');
    window.micRequests=0;
    navigator.mediaDevices.getUserMedia=()=>{window.micRequests++;throw Error('Microphone forbidden')};
  ` });
  await browser.page('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });
  await browser.page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample` });
  assert.ok(await browser.until(`!!document.querySelector('.spine-ready [data-thought="p3"]')`), 'example thoughts appear');
  for (const type of ['keyDown', 'keyUp']) await browser.page('Input.dispatchKeyEvent', { type, key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  assert.ok(await browser.until(`!!document.querySelector('.shell-turn-text')`), 'chat appears');
  await browser.evaluate('document.fonts.ready');
}

async function palette() {
  return browser.evaluate(`(() => {
    const rgba=(selector,property)=>getComputedStyle(document.querySelector(selector))[property].match(/[\\d.]+/g).map(Number);
    const rgb=(selector,property)=>rgba(selector,property).slice(0,3);
    const token=name=>{const e=document.createElement('i');e.style.color='var('+name+')';document.body.append(e);const value=rgba('body > i:last-child','color');e.remove();return value};
    const rail=rgb('.shell-rail','backgroundColor'), tint=token('--ai-soft');
    const soft=tint.slice(0,3).map((channel,i)=>channel*(tint[3]??1)+rail[i]*(1-(tint[3]??1)));
    return {paper:rgb('body','backgroundColor'), ink:rgb('body','color'), chat:rgb('.shell-turn-text','color'),
      rail:rgb('.shell-rail','backgroundColor'), accent:rgb('.map-capture','borderLeftColor'),
      muted:token('--muted'), faint:token('--faint'), button:token('--blue'), buttonInk:token('--blue-ink'), soft};
  })()`);
}

function contrast(a, b) {
  const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}

async function checkExample(scheme) {
  const colors = await palette();
  for (const [name, [r, g, b]] of Object.entries(colors)) assert.ok(r >= g && g >= b, `${scheme} ${name} stays warm`);
  for (const [fg, bg] of [['ink','paper'], ['chat','rail'], ['muted','rail'], ['faint','rail'], ['accent','paper'], ['buttonInk','button'], ['accent','soft']]) {
    assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${scheme} ${fg}/${bg} text contrast: ${contrast(colors[fg], colors[bg]).toFixed(2)}`);
  }
  if (scheme === 'dark') {
    assert.deepEqual(colors.paper, [23, 22, 19], 'existing warm dark paper');
    assert.deepEqual(colors.rail, [37, 34, 28], 'existing dark chat');
    assert.deepEqual(colors.accent, [210, 183, 121], 'existing dark gold');
  } else {
    assert.deepEqual(colors.paper, [247, 242, 235], 'warm paper');
    assert.deepEqual(colors.rail, [245, 238, 229], 'soft chat surface');
    assert.deepEqual(colors.soft, [242, 223, 210], 'quiet peach tint');
  }
  assert.equal(await browser.evaluate('window.micRequests'), 0, 'microphone never requested');
  console.log(`${scheme}: visible example + chat; all text pairs ≥4.5:1; microphone off`);
}

async function capture() {
  await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  return (await browser.page('Page.captureScreenshot', { format: 'png' })).data;
}

async function comparison(shots) {
  await browser.page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await browser.page('Page.navigate', { url: 'about:blank' });
  await browser.evaluate(`document.documentElement.innerHTML=${JSON.stringify(`<head><style>
    *{box-sizing:border-box}body{margin:0;display:flex;font:16px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
    section{width:960px;height:1080px;background:#f7f2eb;color:#35302b}section+section{background:#171613;color:#f1eadc}
    header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px}strong{font-size:20px;font-weight:600}span{opacity:.75}img{display:block;width:960px;height:1016px}
    </style></head><body><section><header><strong>Light · warm paper</strong><span>Example conversation · microphone off</span></header><img src="data:image/png;base64,${shots.light}"></section><section><header><strong>Dark · warm charcoal</strong><span>Example conversation · microphone off</span></header><img src="data:image/png;base64,${shots.dark}"></section></body>`)}`);
  assert.ok(await browser.until('[...document.images].every(i=>i.complete&&i.naturalWidth===960)'), 'both captures decoded');
  const data = Buffer.from(await capture(), 'base64');
  assert.equal(data.readUInt32BE(16), 1920);
  assert.equal(data.readUInt32BE(20), 1080);
  mkdirSync('docs/looks', { recursive: true });
  writeFileSync('docs/looks/light-better.png', data);
}

try {
  const shots = {};
  for (const scheme of ['light', 'dark']) {
    await openExample(scheme);
    await checkExample(scheme);
    shots[scheme] = await capture();
    if (scheme === 'light') { await browser.close(); browser = null; }
  }
  await comparison(shots);
  console.log('PASS light-better: 1920×1080 comparison saved.');
} finally { await browser?.close(); core.close(); }
