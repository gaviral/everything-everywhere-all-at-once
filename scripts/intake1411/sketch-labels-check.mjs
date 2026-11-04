// Isolated synthetic acceptance: no core, microphone, host wiring, or new dependency.
// Run: node scripts/intake1411/sketch-labels-check.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const lane = join(root, 'ui/src/intake1411/sketch-labels');
const artifacts = mkdtempSync(join(tmpdir(), 'sketch-labels-check-'));
const requireUI = createRequire(join(root, 'ui/package.json'));

async function compileParts() {
  const outDir = join(artifacts, 'parts');
  const files = readdirSync(lane).filter(name => /\.tsx?$/.test(name)).map(name => join(lane, name));
  const result = spawnSync(process.execPath, [join(root, 'ui/node_modules/typescript/bin/tsc'), '--ignoreConfig',
    '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
    '--jsx', 'react-jsx', '--strict', '--noUnusedLocals', '--noUnusedParameters', '--skipLibCheck', '--esModuleInterop',
    '--noEmit', join(root, 'ui/node_modules/vite/client.d.ts'), ...files], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `Focused TypeScript compile: ${result.error ?? result.stdout + result.stderr}`);
  const { build } = await import(pathToFileURL(requireUI.resolve('vite')).href);
  const entries = ['controller', 'synthetic', 'StrokeIdentity', 'AnnotationView', 'feature'];
  await build({ configFile: false, logLevel: 'error', build: { outDir, emptyOutDir: false,
    lib: { entry: Object.fromEntries(entries.map(name => [name, join(lane, `${name}.ts`)])), formats: ['cjs'], fileName: (_format, name) => `${name}.cjs` },
  } });
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  return createRequire(join(outDir, 'package.json'));
}

function checkModel(load) {
  const { SketchLabelsController } = load('./controller.cjs');
  const { syntheticSketch } = load('./synthetic.cjs');
  const { orderedSession } = load('./StrokeIdentity.cjs');
  const { annotationView } = load('./AnnotationView.cjs');
  const { sketchLabelsFeature } = load('./feature.cjs');
  const drawing = syntheticSketch();
  let reads = 0, writes = 0, active = 0, subscription;
  let rejectSave = false;
  const adapters = {
    ...drawing.adapters,
    strokes: {
      read: () => { reads++; return drawing.adapters.strokes.read(); },
      subscribe: changed => { active++; subscription = changed; const stop = drawing.adapters.strokes.subscribe(changed); return () => { active--; stop(); }; },
    },
    annotations: {
      read: id => drawing.adapters.annotations.read(id),
      replace: (id, labels) => { if (rejectSave) throw new Error('Synthetic save failure'); writes++; drawing.adapters.annotations.replace(id, labels); },
    },
  };
  const controller = new SketchLabelsController(adapters);
  assert.equal(sketchLabelsFeature.defaultEnabled, false);
  assert.equal(controller.read().enabled, false);
  assert.equal(reads, 0, 'fresh/off does not read the drawing');
  assert.equal(active, 0, 'fresh/off does not subscribe');
  assert.throws(() => controller.selectIds(['mark-1']), /Enable/);
  controller.setEnabled(true);
  drawing.drawThree();
  const originals = structuredClone(drawing.adapters.strokes.read());
  const reference = { id: 'typed-ref-1', text: 'The two peaks', source: 'typed', utteranceTime: { startMs: 4100, endMs: 4500 } };
  assert.throws(() => controller.add('Ambiguous target', reference), /Unresolved target/);
  assert.equal(controller.read().annotations.length, 0);
  controller.lasso([{ x: 50, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 200 }, { x: 50, y: 200 }]);
  assert.deepEqual(controller.read().selection.strokeIds, ['mark-1', 'mark-2']);
  const first = controller.add('Two peaks', reference);
  assert.deepEqual(first.anchor.strokeTime, { startMs: 1000, endMs: 2300 });
  assert.deepEqual(first.anchor.reference.utteranceTime, { startMs: 4100, endMs: 4500 });
  assert.equal(first.anchor.uncertainty, 'separate-times');
  reference.text = 'Changed external input';
  reference.utteranceTime.startMs = 9999;
  assert.equal(first.anchor.reference.text, 'The two peaks', 'saved reference is isolated from caller mutations');
  assert.equal(first.anchor.reference.utteranceTime.startMs, 4100);
  controller.highlight({ x: 330, y: 200 }, { x: 510, y: 270 });
  const second = controller.add('Context', { id: 'typed-ref-2', text: 'This area', source: 'typed', utteranceTime: null });
  assert.equal(second.anchor.target.kind, 'region');
  assert.equal(second.anchor.strokeTime, null);
  assert.equal(second.anchor.uncertainty, 'reference-time-missing');
  controller.revise(first.id, 'Revised peaks', { ...first.anchor.reference, utteranceTime: { startMs: 4200, endMs: 4600 } });
  assert.equal(controller.read().annotations[0].id, first.id, 'revision keeps canonical identity');
  assert.equal(controller.read().annotations[0].label, 'Revised peaks');
  controller.undo();
  assert.deepEqual(controller.read().annotations, [first, second], 'undo restores label and both original time references');
  controller.remove(first.id);
  assert.deepEqual(controller.read().annotations.map(annotation => annotation.id), [second.id]);
  controller.undo();
  assert.deepEqual(controller.read().annotations, [first, second]);
  rejectSave = true;
  assert.throws(() => controller.remove(first.id), /Synthetic save failure/);
  assert.deepEqual(controller.read().annotations, [first, second], 'failed save does not change view or history');
  rejectSave = false;
  const beforeOff = { reads, writes };
  controller.setEnabled(false);
  assert.equal(active, 0);
  assert.throws(() => controller.revise(first.id, 'Blocked'), /Enable/);
  subscription(); // Even a queued callback after unsubscribe is inert.
  assert.deepEqual({ reads, writes }, beforeOff, 'off stops reads and saves');
  assert.deepEqual(drawing.adapters.strokes.read(), originals);
  controller.setEnabled(true);
  assert.deepEqual(controller.read().annotations, [first, second]);
  controller.undo(); // undo highlight creation
  controller.undo(); // undo group creation
  assert.equal(controller.read().annotations.length, 0);
  assert.deepEqual(drawing.adapters.strokes.read(), originals, 'all annotation undo recovers the original drawing');
  controller.lasso([{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 12 }]);
  assert.equal(controller.read().selection, null, 'empty lasso never guesses');
  assert.throws(() => controller.selectIds(['missing']), /existing mark/);
  assert.throws(() => controller.highlight({ x: 10, y: 10 }, { x: 10, y: 12 }), /visible width/);
  controller.selectIds(['mark-3']);
  assert.throws(() => controller.add('Bad time', { ...first.anchor.reference, utteranceTime: { startMs: 10, endMs: 5 } }), /ordered/);
  assert.throws(() => orderedSession({ id: 'bad', strokes: [...originals.strokes, originals.strokes[0]] }), /unique/);
  assert.throws(() => orderedSession({ id: 'bad', strokes: [{ id: 's', points: [{ x: 0, y: 0, atMs: 2 }, { x: 1, y: 1, atMs: 1 }] }] }), /ordered/);
  assert.match(annotationView(first, { id: originals.id, strokes: [] }).status, /Unresolved: missing marks/);
  controller.dispose();
  assert.equal(active, 0);
  const reopened = new SketchLabelsController(adapters);
  reopened.setEnabled(true);
  assert.equal(reopened.read().annotations.length, 0, 'undo was persisted in the injected store');
  reopened.dispose();
  console.log('PASS model: exact IDs, separate times, uncertainty, revision/removal/undo, atomic saves, inert off, intact originals');
}

async function buildPreview() {
  const { build } = await import(pathToFileURL(requireUI.resolve('vite')).href);
  const { default: react } = await import(pathToFileURL(requireUI.resolve('@vitejs/plugin-react')).href);
  const outDir = join(artifacts, 'preview');
  await build({ configFile: false, root: join(root, 'ui'), plugins: [react()], logLevel: 'error', build: { outDir, emptyOutDir: false, rolldownOptions: { input: join(lane, 'preview.html') } } });
  return outDir;
}

async function servePreview(dist) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(dist, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(dist + sep) || !existsSync(file) || !extname(file)) { response.writeHead(404).end(); return; }
    response.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/src/intake1411/sketch-labels/preview.html` };
}

async function openBrowser(url) {
  const executable = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!executable) throw new Error('MISSING: Chrome for visible acceptance');
  const profile = join(artifacts, 'browser-profile');
  const processHandle = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  const closed = new Promise(resolve => processHandle.once('exit', resolve));
  const close = async () => {
    socket?.close();
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
    let timer;
    await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => { if (processHandle.exitCode === null) processHandle.kill('SIGKILL'); resolve(); }, 5000); })]);
    clearTimeout(timer);
    await closed;
    processHandle.stderr.destroy();
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
      processHandle.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      processHandle.once('error', error => { clearTimeout(timer); reject(error); });
      processHandle.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited before startup')); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => { const result = JSON.parse(event.data); if (pending.has(result.id)) { const { resolve, reject } = pending.get(result.id); pending.delete(result.id); result.error ? reject(new Error(result.error.message)) : resolve(result.result); } };
    const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params = {}) => command(method, params, sessionId);
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async expression => assert.equal(await evaluate(`new Promise(resolve => { const deadline = performance.now() + 5000; const tick = () => { if (${expression}) resolve(true); else if (performance.now() > deadline) resolve(false); else requestAnimationFrame(tick); }; tick(); })`), true, expression);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url });
    await until('!!document.querySelector(".sketch-labels-switch input")');
    return { cdp, evaluate, until, close };
  } catch (error) { await close(); throw error; }
}

async function checkVisible(browser) {
  const { evaluate, cdp, until } = browser;
  const click = async text => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)}); button.click(); })()`);
  };
  const setField = (name, value) => evaluate(`(() => { const input = document.querySelector('[name=${JSON.stringify(name)}]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const drag = async points => {
    const matrix = await evaluate(`(() => { const m = document.querySelector('svg').getScreenCTM(); return { a:m.a, b:m.b, c:m.c, d:m.d, e:m.e, f:m.f }; })()`);
    for (let i = 0; i < points.length; i++) await cdp('Input.dispatchMouseEvent', { type: i === 0 ? 'mousePressed' : i === points.length - 1 ? 'mouseReleased' : 'mouseMoved', x: matrix.a * points[i][0] + matrix.c * points[i][1] + matrix.e, y: matrix.b * points[i][0] + matrix.d * points[i][1] + matrix.f, button: 'left', buttons: i === points.length - 1 ? 0 : 1, clickCount: i === 0 || i === points.length - 1 ? 1 : 0 });
  };
  const screenshot = async name => { const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64')); };
  assert.equal(await evaluate('document.querySelector(".sketch-labels-switch input").checked'), false);
  assert.equal(await evaluate('!!document.querySelector("svg")'), false);
  await evaluate('document.querySelector(".sketch-labels-switch input").click()');
  await until('!!document.querySelector("svg")');
  await click('Draw three sample strokes');
  await until('document.querySelectorAll("[data-mark-id]").length === 3');
  const originalMarks = await evaluate('[...document.querySelectorAll(".sketch-labels-original-mark")].map(mark => mark.getAttribute("points"))');
  await setField('label', 'Two peaks');
  await setField('reference', 'The two peaks');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Attach label").disabled'), true, 'ambiguous target cannot save');
  await drag([[50, 50], [300, 50], [300, 200], [50, 200], [50, 50], [50, 50]]);
  await until('document.querySelectorAll("[data-mark-id][data-selected=true]").length === 2');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-mark-id][data-selected=true]")].map(mark => mark.dataset.markId)'), ['mark-1', 'mark-2']);
  await setField('start', 4100); await setField('end', 4500);
  await click('Attach label');
  await until('document.querySelectorAll(".sketch-labels-list li").length === 1');
  const first = await evaluate('({ id: document.querySelector(".sketch-labels-list li").dataset.annotationId, text: document.querySelector(".sketch-labels-list li").textContent })');
  assert.match(first.text, /Marks: mark-1, mark-2/);
  assert.match(first.text, /1000–2300 ms/); assert.match(first.text, /4100–4500 ms/);
  assert.equal(await evaluate(`!!document.querySelector('svg [data-annotation-id="${first.id}"]')`), true, 'surface and label share canonical identity');
  await click('Highlight region');
  await drag([[330, 200], [510, 270], [510, 270]]);
  await until('document.querySelector("[data-selection]").textContent.startsWith("Region:")');
  await setField('label', 'Context'); await setField('reference', 'This area');
  await click('Attach label');
  await until('document.querySelectorAll(".sketch-labels-list li").length === 2');
  assert.match(await evaluate('document.querySelectorAll(".sketch-labels-list li")[1].textContent'), /No stroke time \(region\).*Reference timeNot supplied/);
  await click('Revise Two peaks');
  await until('document.activeElement?.name === "label"');
  await setField('label', 'Revised peaks'); await setField('start', 4200); await setField('end', 4600);
  await click('Save revision');
  await until('document.querySelector(".sketch-labels-list li strong").textContent === "Revised peaks"');
  assert.equal(await evaluate('document.querySelector(".sketch-labels-list li").dataset.annotationId'), first.id);
  await click('Undo annotation change');
  await until('document.querySelector(".sketch-labels-list li strong").textContent === "Two peaks"');
  assert.match(await evaluate('document.querySelector(".sketch-labels-list li").textContent'), /4100–4500 ms/);
  await screenshot('desktop');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 960, deviceScaleFactor: 1, mobile: false });
  await until('window.innerWidth === 360');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 360'), true, 'narrow viewport has no horizontal overflow');
  await screenshot('phone');
  const textSize = await evaluate('parseFloat(getComputedStyle(document.querySelector(".sketch-labels h2")).fontSize)');
  await evaluate('document.documentElement.style.fontSize = "200%"');
  assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector(".sketch-labels h2")).fontSize)') >= textSize * 1.9, 'enlarged text is actually twice its original size');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 360'), true, 'enlarged text stays within viewport');
  await screenshot('phone-enlarged');
  await evaluate('document.documentElement.style.fontSize = ""');
  await click('Remove Context');
  await until('document.querySelectorAll(".sketch-labels-list li").length === 1');
  await click('Undo annotation change');
  await until('document.querySelectorAll(".sketch-labels-list li").length === 2');
  await evaluate('document.querySelector(".sketch-labels-switch input").click()');
  await until('!document.querySelector("svg")');
  await evaluate('document.querySelector(".sketch-labels-switch input").focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await until('!!document.querySelector("svg")');
  assert.equal(await evaluate('document.querySelectorAll(".sketch-labels-list li").length'), 2, 'toggle retains labels');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".sketch-labels-original-mark")].map(mark => mark.getAttribute("points"))'), originalMarks, 'toggle retains original drawing');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.textContent'), 'Lasso marks', 'keyboard navigation reaches the first selection action');
  await evaluate('document.querySelectorAll(".sketch-labels-mark-choice input")[2].focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await until('document.querySelector("[data-selection]").textContent === "Marks: mark-3"');
  await click('Undo annotation change'); await click('Undo annotation change');
  await until('document.querySelectorAll(".sketch-labels-list li").length === 0');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".sketch-labels-original-mark")].map(mark => mark.getAttribute("points"))'), originalMarks);
  await click('Highlight region');
  await evaluate('document.querySelector("svg").scrollIntoView({ block: "center" })');
  const touchMatrix = await evaluate('(() => { const m = document.querySelector("svg").getScreenCTM(); return { a:m.a, b:m.b, c:m.c, d:m.d, e:m.e, f:m.f }; })()');
  const touchAt = (x, y) => [{ x: touchMatrix.a * x + touchMatrix.c * y + touchMatrix.e, y: touchMatrix.b * x + touchMatrix.d * y + touchMatrix.f, id: 1 }];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchAt(320, 190) });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchAt(520, 280) });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until('document.querySelector("[data-selection]").textContent.startsWith("Region:")');
  assert.equal(await evaluate('Math.round(Number(document.querySelector(".sketch-labels-selected-region").getAttribute("width")))'), 200, 'touch selects the intended region');
  await cdp('Page.reload');
  await until('!!document.querySelector(".sketch-labels-switch input")');
  assert.equal(await evaluate('document.querySelector(".sketch-labels-switch input").checked'), false, 'fresh synthetic profile starts off');
  console.log('PASS visible: lasso two/three, typed label/reference, highlight, revise/undo, remove/undo, disable/retain, keyboard/touch, 360px and 200% text');
}

let browser, host;
try {
  checkModel(await compileParts());
  const dist = await buildPreview();
  host = await servePreview(dist);
  browser = await openBrowser(host.url);
  await checkVisible(browser);
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ model: 'PASS', visible: 'PASS', preview: 'synthetic only' }, null, 2));
  console.log(`Artifacts retained: ${artifacts}`);
} catch (error) {
  console.error(error.stack ?? error);
  console.error(`Artifacts retained: ${artifacts}`);
  process.exitCode = error.message?.startsWith('MISSING:') ? 3 : 1;
} finally {
  await browser?.close();
  if (host) await new Promise(resolve => host.server.close(resolve));
}
