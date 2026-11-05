// Real keyless core + built UI: caption identity, order, reload/restart and silent catch-up.
// Run after cargo build and npm run build. Only a disposable journal and fake browser voice are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep } from "./headless.mjs";
import { decodeEventLog } from "./event-log-fixture.mjs";

if (ready()) { console.log(`SKIP i-turns-check: ${ready()}`); process.exit(3); }
const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.I_TURNS_PORT ?? 48265);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536 && ![4360, 4399].includes(port));
const data = mkdtempSync(join(tmpdir(), "e2a2o-i-turns-"));
const url = `http://127.0.0.1:${port}`;
let core, browser;
const sockets = [];
const stop = async () => {
  if (core && core.exitCode === null) { const ended = once(core, "exit"); core.kill("SIGTERM"); await ended; }
};
async function start() {
  core = spawn(join(root, "core/target/debug/e2a2o-core"), [], { cwd: root, stdio: "ignore", env: {
    ...process.env, PORT: String(port), MODEL_API_KEY: "", E2A2O_DATA: data,
    E2A2O_UI: join(root, "ui/dist"), E2A2O_HOSTED: "0", ROOM_CODE: "", PUBLIC_URL: "", E2A2O_TRACE: "0",
  } });
  for (let i = 0; i < 100; i++) {
    assert.equal(core.exitCode, null, "isolated core remains running");
    if (await fetch(`${url}/room`).then(r => r.ok).catch(() => false)) return;
    await sleep(100);
  }
  assert.fail("isolated core did not start");
}
async function helper(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${name}&ai=1`);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onmessage = e => { if (JSON.parse(e.data).type === "snapshot") resolve(); };
  });
  return ws;
}
const send = (ws, msg) => ws.send(JSON.stringify(msg));
const journal = () => decodeEventLog(readFileSync(join(data, "journal.jsonl"), "utf8"));
const saved = () => journal().filter(c => c.type === "caption_added").map(c => c.caption);
try {
  await start();
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured','1'); sessionStorage.setItem('e2a2o.talk.open','1');
    window.visit=crypto.randomUUID(); window.spoken=[]; window.wire=[]; window.errors=[];
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(...args) { super(...args); this.addEventListener('message', e=>wire.push(JSON.parse(e.data))); }
    };
    addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
      getVoices:()=>[{name:'Test English',lang:'en-US',default:true,localService:true}],
      speak:u=>spoken.push(u.text),cancel:()=>{}
    })});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
  ` });
  await page("Page.navigate", { url });
  assert.ok(await until(`wire.some(m=>m.type==='snapshot')`), "page connected");
  const a = await helper("Helper");
  const first = { type: "caption", id: "first", text: "A completed answer.", speak: true };
  send(a, first);
  assert.ok(await until(`spoken.length===1`), "new caption speaks once");
  send(a, first);
  send(a, { ...first, id: "second" }); // Identical words are a distinct completed turn.
  assert.ok(await until(`spoken.length===2`), "another identity with identical words speaks");
  send(a, { type: "point", target: "composer", caption: "Transient arrow words." });
  const b = await helper("Other");
  send(b, { type: "caption", id: "first", text: "A second speaker's answer.", speak: true });
  assert.ok(await until(`spoken.length===3`), "caption identity is scoped to its speaker");
  const before = saved();
  assert.deepEqual(before.map(c => [c.by, c.id, c.order]), [["Helper", "first", 1], ["Helper", "second", 2], ["Other", "first", 3]]);
  assert.ok(before.every(c => c.ai && c.at_ms > 0));
  assert.ok(!readFileSync(join(data, "journal.jsonl"), "utf8").includes("Transient arrow words."));
  assert.ok(!before.some(c => "speak" in c), "audio flags are absent from durable records");

  const rows = `[...document.querySelectorAll('[data-caption]')].map(el=>[el.dataset.caption,el.querySelector('.talk-name').textContent,el.querySelector('.talk-words').textContent])`;
  const reload = async () => {
    const previous = await evaluate("visit");
    await page("Page.reload");
    assert.ok(await until(`visit!==${JSON.stringify(previous)} && wire.some(m=>m.type==='snapshot') && document.querySelectorAll('[data-caption]').length===3`), "all caption rows restored");
    assert.deepEqual(await evaluate(rows), [["first", "✦ Helper", first.text], ["second", "✦ Helper", first.text], ["first", "✦ Other", "A second speaker's answer."]]);
    assert.deepEqual(await evaluate("spoken"), [], "reload never speaks old captions");
    assert.deepEqual(await evaluate("errors"), [], "no page errors");
  };
  await reload();
  await sleep(1100); // The guide's existing per-window budget resets.
  send(a, first);
  await sleep(150);
  assert.equal(saved().length, 3, "retry after reload does not journal twice");
  assert.deepEqual(await evaluate("spoken"), [], "retry after reload never replays audio");

  // Reconnect the same loaded page to a restarted core, then reload with no helper present.
  await stop();
  await start();
  assert.ok(await until(`wire.filter(m=>m.type==='snapshot').length>=2`, 10000), "page reconnects after restart");
  assert.equal(await evaluate("document.querySelectorAll('[data-caption]').length"), 3, "reconnect keeps one row per identity");
  assert.deepEqual(await evaluate("spoken"), [], "reconnect is silent");
  await reload();
  const retry = await helper("Helper");
  send(retry, first);
  await sleep(150);
  assert.equal(saved().length, 3, "retry receipt survives core restart");
  assert.deepEqual(await evaluate("spoken"), [], "restart retry stays silent");
  console.log(`i-turns-check: passed (identity, order, exact-once journal, reload, restart, silent catch-up, transient arrows) on :${port}`);
} finally {
  sockets.forEach(ws => ws.close());
  await browser?.close();
  await stop();
  rmSync(data, { recursive: true, force: true });
}
