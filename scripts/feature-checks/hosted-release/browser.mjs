import { spawn, execFileSync } from 'node:child_process';
import { access, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

function descendants(parent) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  const found = new Set([parent]);
  for (let pass = 0; pass < rows.length; pass++) {
    const before = found.size;
    for (const [pid, ppid] of rows) if (found.has(ppid)) found.add(pid);
    if (before === found.size) break;
  }
  return [...found];
}

function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function waitForExit(pids) {
  const deadline = Date.now() + 5000;
  while (pids.some(running)) {
    if (Date.now() > deadline) throw new Error(`Owned browser PIDs still running: ${pids.filter(running).join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function openBrowser(directory) {
  const binary = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(binary);
  const profile = await mkdtemp(join(directory, 'browser-profile-'));
  const child = spawn(binary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-extensions', '--mute-audio', '--use-mock-keychain', '--password-store=basic',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Started isolated browser PID ${child.pid}`);
  let socket;
  async function close() {
    const owned = descendants(child.pid);
    socket?.close();
    for (const pid of owned.reverse()) if (running(pid)) process.kill(pid, 'SIGTERM');
    await waitForExit(owned);
    child.stderr.destroy();
    console.log(`Confirmed browser PIDs exited: ${owned.join(', ')}`);
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Browser did not expose DevTools within 15 seconds.')), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Browser exited during startup.')); });
      child.stderr.on('data', bytes => { output += bytes.toString(); const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let serial = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data);
      const item = pending.get(result.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(result.id);
      if (result.error) item.reject(new Error(result.error.message)); else item.resolve(result.result);
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = expression => evaluate(`new Promise((resolve, reject) => { const deadline = performance.now() + 8000;
      function inspect() { if (${expression}) resolve(true); else if (performance.now() > deadline) reject(new Error('Visible condition did not arrive'));
        else requestAnimationFrame(inspect); } inspect(); })`);
    return { page, evaluate, until, close };
  } catch (error) { await close(); throw error; }
}
