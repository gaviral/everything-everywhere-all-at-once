// Isolated synthetic browser acceptance. Artifacts are retained; no host app, core or microphone starts.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const feature = join(repo, 'ui/src/features/worktree-map');
const artifacts = mkdtempSync(join(tmpdir(), 'worktree-map-check-'));
const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
const dependencies = process.env.WORKTREE_MAP_NODE_MODULES || join(dirname(resolve(repo, common)), 'ui/node_modules');
const requireDependency = createRequire(join(dependencies, '../package.json'));

async function buildPreview() {
  const typeConfig = {
    compilerOptions: {
      target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
      jsx: 'react-jsx', strict: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
      isolatedModules: true, noEmit: true, types: ['react', 'react-dom', join(dependencies, 'vite/client.d.ts')], typeRoots: [join(dependencies, '@types')],
      paths: { react: [join(dependencies, '@types/react/index.d.ts')], 'react/*': [join(dependencies, '@types/react/*')],
        'react-dom/*': [join(dependencies, '@types/react-dom/*')] },
    }, include: [join(feature, '*.ts'), join(feature, '*.tsx')],
  };
  const configPath = join(artifacts, 'tsconfig.json');
  writeFileSync(configPath, JSON.stringify(typeConfig));
  execFileSync(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', configPath], { stdio: 'pipe' });
  const { build } = await import(pathToFileURL(requireDependency.resolve('vite')).href);
  const { default: react } = await import(pathToFileURL(requireDependency.resolve('@vitejs/plugin-react')).href);
  await build({ configFile: false, root: feature, logLevel: 'error',
    plugins: [{ name: 'injected-react', enforce: 'pre', resolveId(id) {
      if (id === 'react' || id.startsWith('react/') || id === 'react-dom' || id.startsWith('react-dom/')) return requireDependency.resolve(id);
    } }, react()],
    build: { outDir: join(artifacts, 'dist'), emptyOutDir: false, rollupOptions: { input: join(feature, 'preview.html') } },
  });
}

async function servePreview() {
  const dist = join(artifacts, 'dist');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(dist, `.${pathname === '/' ? '/preview.html' : pathname}`);
    if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}

async function launchBrowser(url) {
  const executable = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executable, 'Chrome is required for visible acceptance');
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(artifacts, 'browser-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--use-mock-keychain', '--password-store=basic', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  writeFileSync(join(artifacts, 'browser-pid.txt'), String(child.pid));
  const exit = once(child, 'exit');
  let socket;
  async function close() {
    socket?.close();
    if (child.exitCode === null) child.kill('SIGTERM'); // Only this lane's recorded child PID.
    await exit;
    child.stderr.destroy();
  }
  try {
    const address = await new Promise((done, fail) => {
      let output = '';
      const deadline = setTimeout(() => fail(new Error('Chrome startup timed out')), 15000);
      child.once('exit', () => { clearTimeout(deadline); fail(new Error('Chrome exited before ready')); });
      child.stderr.on('data', bytes => {
        output += bytes;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(deadline); done(match[1]); }
      });
    });
    socket = new WebSocket(address);
    await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
    const requests = new Map();
    let sequence = 0;
    socket.onmessage = event => {
      const response = JSON.parse(event.data), request = requests.get(response.id);
      if (request) { requests.delete(response.id); response.error ? request.fail(new Error(response.error.message)) : request.done(response.result); }
    };
    const command = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence;
      requests.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, message) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(done => setTimeout(done, 25)); // Bounded polling on a visible condition.
      }
      const state = await evaluate(`({ focus: document.activeElement?.outerHTML, selected: document.querySelector('.wm-branches button[aria-pressed="true"]')?.outerHTML, errors: window.previewErrors, documentFocus: document.hasFocus() })`);
      assert.fail(`${message}: ${JSON.stringify(state)}`);
    };
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.previewErrors = []; addEventListener('error', e => previewErrors.push(e.message)); addEventListener('unhandledrejection', e => previewErrors.push(String(e.reason)));` });
    await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    return { page, evaluate, waitFor, close };
  } catch (error) { await close(); throw error; }
}

async function validateContracts(evaluate) {
  assert.equal(await evaluate(`(() => {
    const {validateVersionSnapshot: validate, syntheticSnapshot: sample, branchRelationships: rows} = worktreeMapPreview;
    const rejected = value => { try { validate(value); return false; } catch { return true; } };
    const input = sample(), copy = validate(input); input.branches[0].name = 'mutated';
    const duplicate = sample(); duplicate.branches.push(duplicate.branches[0]);
    const cycle = sample(); cycle.branches[0].parentId = cycle.branches[1].id;
    const unknown = sample(); unknown.branches[0].parentId = 'missing';
    const partial = sample(); partial.branches[0].build = { id: 'partial' };
    return copy.branches[0].name === 'orchard-layout' && Object.isFrozen(copy.branches[0]) && rejected(duplicate)
      && rejected({...sample(), observedAt: 'bad'}) && rejected({...sample(), schemaVersion: 2})
      && rejected({...sample(), branches: Array(501).fill(sample().branches[0])})
      && rows(validate(cycle)).every(row => row.unknownBase)
      && rows(validate(unknown))[0].unknownBase && rows(validate(unknown))[1].depth === 1
      && validate(partial).branches[0].build === null;
  })()`), true, 'snapshot validation rejects ambiguity, isolates input, and retains safe parent/child links');
}

async function visibleAcceptance(browser) {
  const { page, evaluate, waitFor } = browser;
  const text = label => `document.body.textContent.includes(${JSON.stringify(label)})`;
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw Error('Missing fixture button'); button.click(); })()`);
  };
  const selected = `document.querySelector('.wm-branches button[aria-pressed="true"]')`;
  await waitFor(text('Code canvas host'), 'fresh profile renders host');
  assert.deepEqual(await evaluate('({id: worktreeMapPreview.descriptor.id, defaultEnabled: worktreeMapPreview.descriptor.defaultEnabled})'),
    { id: 'intake1411-worktree-map', defaultEnabled: false }, 'exported feature switch is off by default');
  assert.deepEqual(await evaluate('worktreeMapPreview.stats()'), { reads: 0, subscriptions: 0 }, 'off by default does no owner work');
  await validateContracts(evaluate);
  await click('Open worktree map');
  await waitFor(text('orchard-layout'), 'owner snapshot renders');
  assert.equal(await evaluate(`document.querySelector('.wm-root').textContent.includes('main-r10') && ${text('From orchard-layout')}`), true, 'supplied main and child relationship are visible');
  await evaluate(`document.querySelector('.wm-branches button').focus()`);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(`${selected}?.textContent.includes('orchard-layout')`, 'keyboard selects branch');
  for (const label of ['Orchard lane', 'Orchard workspace', 'worktree-orchard', 'orchard-build-7', 'orchard-r11', 'orchard-r12']) {
    assert.equal(await evaluate(`document.querySelector('.wm-identity').textContent.includes(${JSON.stringify(label)})`), true, `${label} belongs to selected branch`);
  }
  await click('Inspect Git branch');
  await waitFor(`document.activeElement?.tagName === 'H3' && ${text('Back to map')}`, 'detail receives keyboard focus');
  await click('Publish updated snapshot');
  await waitFor(text('orchard-build-8'), 'updated build appears in detail');
  await click('Back to map');
  await waitFor(`${selected}?.textContent.includes('orchard-layout') && document.activeElement === ${selected}`, 'return preserves visible selection and focus despite reordered snapshot');
  assert.equal(await evaluate(text('Stale snapshot')), true, 'owner freshness is explicit');
  await click('Restore sample');
  await evaluate(`document.querySelectorAll('.wm-branches button')[1].click()`);
  await waitFor(`document.querySelector('.wm-identity')?.textContent.includes('river-build-3')`, 'other branch has its own build');
  assert.equal(await evaluate(`document.querySelector('.wm-identity').textContent.includes('River workspace') && !document.querySelector('.wm-identity').textContent.includes('orchard-build-7')`), true, 'worktree and build do not leak between branches');
  await click('Publish unknown data');
  await waitFor(text('sample-unknown'), 'unknown snapshot arrives');
  assert.equal(await evaluate(`[...document.querySelectorAll('.wm-branches button')].every(b => b.textContent.includes('Base: Unknown')) && [...document.querySelectorAll('.wm-fields dd')].filter(dd => dd.textContent === 'Unknown').length === 3`), true, 'missing base, build and build revision are visibly unknown');
  await click('Remove Git branches');
  await waitFor(text('Selected Git branch unavailable'), 'removed selection is explicitly unavailable');
  await click('Restore sample');
  await waitFor(`${selected}?.textContent.includes('river-notes')`, 'returning stable ID restores visible selection');
  await click('Publish invalid snapshot');
  await waitFor(text('Snapshot unavailable'), 'invalid input is visibly unavailable');
  assert.equal(await evaluate(`document.querySelectorAll('.wm-branches button').length`), 0, 'invalid input never presents an old snapshot as current');
  await click('Restore sample');
  await waitFor(`${selected}?.textContent.includes('river-notes')`, 'valid input recovers selection');
  await click('Return to host');
  await waitFor(text('The worktree map is off.'), 'off returns to host');
  const stopped = await evaluate('worktreeMapPreview.stats()');
  assert.equal(stopped.subscriptions, 0, 'off removes owner subscription');
  await click('Publish updated snapshot');
  assert.deepEqual(await evaluate('worktreeMapPreview.stats()'), stopped, 'owner publication while off does no map work');
  await click('Open worktree map');
  await waitFor(`${selected}?.textContent.includes('river-notes')`, 'disable/enable retains stable selection');
  const screenshot = async name => {
    const result = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  await screenshot('desktop');
  await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor('document.documentElement.clientWidth === 320', 'narrow viewport applied');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 320'), true, 'narrow layout has no horizontal clipping');
  assert.equal(await evaluate(`[...document.querySelectorAll('.wm button')].every(button => button.getBoundingClientRect().height >= 44)`), true, 'map controls remain reachable touch targets');
  await screenshot('narrow');
  await evaluate(`document.querySelector('.wm').style.fontSize = '200%'`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 320'), true, 'enlarged text wraps at narrow width');
  await click('Inspect Git branch');
  await waitFor(text('Back to map'), 'enlarged detail reachable');
  await screenshot('enlarged-detail');
  assert.deepEqual(await evaluate('previewErrors'), [], 'no browser runtime errors');
}

let server, browser;
try {
  await buildPreview();
  server = await servePreview();
  browser = await launchBrowser(server.url);
  await visibleAcceptance(browser);
  console.log('PASS worktree-map: strict types, synthetic ancestry/identity, keyboard detail/return, snapshot updates/unknown/recovery, disable cleanup, 320px/enlarged layout');
  console.log(`Artifacts: ${artifacts}`);
} catch (error) {
  if (browser) {
    const result = await browser.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, 'failure.png'), Buffer.from(result.data, 'base64'));
  }
  console.error(error.stdout?.toString() || error.stack || error);
  console.error(`Artifacts: ${artifacts}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}
