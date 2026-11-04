// One focused check: core transactions and the real phone control in an isolated browser.
// Leaves disposable build/browser data under core/target; never touches a personal profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from '../ui/node_modules/vite/dist/node/index.js';
import react from '../ui/node_modules/@vitejs/plugin-react/dist/index.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, ...options });
    let output = '', errors = '';
    child.stdout?.on('data', data => { output += data; });
    child.stderr?.on('data', data => { errors += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}: ${errors.slice(-2000)}`)));
  });
}
await run('cargo', ['test', '--manifest-path', 'core/Cargo.toml', 'moves::correction_tests::', '--', '--nocapture'], { stdio: 'inherit' });
await run(join(repo, 'ui/node_modules/.bin/tsc'), ['--noEmit', '-p', join(repo, 'ui/tsconfig.json')], { stdio: 'inherit' });
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(chrome, 'Chrome is needed for the focused phone check');
const output = join(repo, 'core/target/correction-check', randomUUID());
const site = join(output, 'site');
mkdirSync(site, { recursive: true });
await build({ configFile: false, root: join(repo, 'ui'), plugins: [react()], logLevel: 'warn',
  resolve: { alias: { 'react-dom': join(repo, 'ui/node_modules/react-dom'), react: join(repo, 'ui/node_modules/react') } }, build: {
  outDir: site, emptyOutDir: false, minify: false,
  rollupOptions: { input: join(repo, 'scripts/correction/phone-check.js'), output: { entryFileNames: 'check.js' } },
} });
const styles = readdirSync(join(site, 'assets')).filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('');
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body style="margin:0"><div id="app"></div><pre id="result"></pre><script type="module" src="/check.js"></script></body></html>`;
const frame = `<!doctype html><html><body><iframe id="phone" src="/phone" width="390" height="844" style="border:0"></iframe><pre id="result"></pre><script>addEventListener('message', e => { if (e.source === document.getElementById('phone').contentWindow) document.getElementById('result').textContent = e.data; });</script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/' || path === '/phone') { response.setHeader('Content-Type', 'text/html'); response.end(path === '/' ? frame : html); return; }
  if (!/^\/(check\.js|assets\/[\w.-]+)$/.test(path)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
  response.end(readFileSync(join(site, path)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const dom = await run(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--mute-audio', '--disable-gpu', '--window-size=800,1000', `--user-data-dir=${join(output, 'browser')}`, '--dump-dom', '--timeout=20000', '--virtual-time-budget=10000', `http://127.0.0.1:${server.address().port}/`]);
  const result = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? dom;
  assert.match(result, /^PASS:/, result);
  console.log(result);
  console.log('correction: PASS (2 core tests, TypeScript, phone browser)');
} finally {
  await new Promise(resolve => server.close(resolve));
}
