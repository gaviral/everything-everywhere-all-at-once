// Real keyless core and built canvas; fake only the browser voice, so no microphone or model is needed.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, openPage, sleep } from "./headless.mjs";

if (ready()) { console.log(`SKIP recovery-speech-check: ${ready()}`); process.exit(3); }
const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.RECOVERY_PORT ?? 48264);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536 && ![4360, 4399].includes(port));
execFileSync("cargo", ["build", "--quiet", "--manifest-path", join(root, "core/Cargo.toml"),
  "--target-dir", join(root, "core/target")], { cwd: root, stdio: "pipe" });
for (const completed of [false, true]) {
const data = mkdtempSync(join(tmpdir(), "e2a2o-recovery-"));
const now = Date.now() - 10_000;
const original = completed ? "Before the demo I need to" : "Before booking the workshop I need to choose";
// Joined ideas use their first part's ID on the canvas; Found must still name the relevant last part.
const target = "unfinished";
const quote = completed ? "finish the script." : original;
const threads = ["Workshop", "Supplies"].map((id, i) => ({ id, title: id, parent_id: null,
  status: i ? "open" : "dropped", dropped_by: i ? "" : "you", last_point: "", touched_ms: now + i,
  tags: [], picture: null }));
const thoughts = [
  { id: "unfinished", speaker: "you", text: original, point: "Book workshop", thread_id: "Workshop", complete: false, at_ms: now },
  ...(completed ? [{ id: "completion", speaker: "you", text: quote, point: "Finish the demo script", thread_id: "Workshop", complete: true, at_ms: now + 500 }] : []),
  { id: "detour", speaker: "you", text: "Bring extra pencils", point: "Extra pencils", thread_id: "Supplies", complete: true, at_ms: now + 1000 },
].map(t => ({ placed: true, unclear: "", guess: "", heard: "", fixed: "", decided: false, place_ms: 0, ...t }));
const changes = [...threads.map(thread => ({ type: "thread_added", thread })),
  ...thoughts.map(thought => ({ type: "thought_added", thought })),
  ...(completed ? [{ type: "thought_noted", thought_id: "completion", note: { continues: "unfinished" } }] : []),
  { type: "active_changed", thread_id: "Supplies", speaker: "you" }];
writeFileSync(join(data, "journal.jsonl"), changes.map(c => JSON.stringify(c)).join("\n") + "\n");
const server = spawn(join(root, "core/target/debug/e2a2o-core"), [], { cwd: root, stdio: "ignore", env: {
  ...process.env, PORT: String(port), MODEL_API_KEY: "", E2A2O_DATA: data, E2A2O_UI: join(root, "ui/dist"),
  E2A2O_HOSTED: "0", ROOM_CODE: "", PUBLIC_URL: "", E2A2O_TRACE: "0",
} });
let browser;
try {
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${port}/room`).then(r => r.ok).catch(() => false);
    if (!up) { assert.equal(server.exitCode, null, "isolated core remains running"); await sleep(100); }
  }
  assert.ok(up, "isolated keyless core started");
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured','1'); window.spoken=[]; window.errors=[]; window.found=[];
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(...args) { super(...args); this.addEventListener('message',e=>{
        const message=JSON.parse(e.data); if(message.type==='found') found.push(message);
      }); }
    };
    addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
      getVoices:()=>[{name:'Test English',lang:'en-US',default:true}],
      speak:u=>spoken.push(u.text),cancel:()=>{}
    })});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
  ` });
  await page("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000));
  const ask = async () => {
    await evaluate(`document.querySelector('#type-a-thought').focus()`);
    await page("Input.insertText", { text: "Where was I?" });
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  await ask();
  assert.ok(await until(`document.querySelector('[data-thought="${target}"] .spine-words')?.textContent.includes(${JSON.stringify(quote)})`), "recovery opens the relevant original words");
  assert.equal(await evaluate("found.at(-1)?.thought_id"), completed ? "completion" : "unfinished", "recovery targets the relevant part");
  assert.deepEqual(await evaluate("spoken"), [], "same feature setting defaults speech off");
  await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Conversation partner"]')`));
  await evaluate(`document.querySelector('[role="switch"][aria-label="Conversation partner"]').click(); document.querySelector('[data-guide="catalog"]').click()`);
  await sleep(150);
  // Pan away to ensure the second recovery actually brings the canvas back.
  const drag = async (x, y) => page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x: 1000, y: 300, button: "left", clickCount: 1 });
  await drag(1100, 400); await drag(1300, 650);
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1300, y: 650, button: "left", clickCount: 1 });
  await ask();
  assert.ok(await until(`spoken.length === 1`), "repeated recovery speaks without a model key");
  assert.equal(await evaluate("spoken[0]"), `You're on Workshop: “${quote}”`);
  await sleep(3200);
  const rect = await evaluate(`(() => { const r=document.querySelector('[data-thought="${target}"] .spine-text').getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight}; })()`);
  assert.ok(rect.top >= 0 && rect.bottom < rect.height - 100 && rect.left >= 0 && rect.right <= rect.width,
    `anchored words in the viewport: ${JSON.stringify(rect)}`);
  await page("Page.reload");
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000));
  await sleep(300);
  assert.deepEqual(await evaluate("spoken"), [], "reload never replays recovery audio");
  assert.deepEqual(await evaluate("errors"), []);
  assert.ok(!readFileSync(join(data, "journal.jsonl"), "utf8").includes("command_reply"));
  console.log(`PASS recovery speech (${completed ? "completed continuation" : "unfinished"}): real keyless core, setting off/on, original words, canvas return after pan, reload stays silent`);
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM"); await stopped;
  }
  rmSync(data, { recursive: true, force: true });
}
}
