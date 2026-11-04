// Against an isolated hub started with hub.sh's HUB_PORT/HUB_DATA/BRIDGE_STATE overrides.
// Real built page + real core + real bridge CLIs; only the browser's voice is faked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openPage } from "./headless.mjs";

const port = Number(process.env.HUB_PORT);
const state = process.env.BRIDGE_STATE;
const bridge = process.env.BRIDGE_HOME;
if (!(port >= 4620 && state && bridge)) {
  console.log("SKIP comment-reply-check: set isolated HUB_PORT (4620+), BRIDGE_STATE and BRIDGE_HOME");
  process.exit(3);
}
const env = { ...process.env, BRIDGE_PORT: String(port), BRIDGE_APP: path.resolve(".") };
const read = name => fs.readFileSync(path.join(state, name), "utf8");
const run = (name, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(bridge, name), ...args], { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  child.on("error", reject);
  child.on("close", code => code ? reject(new Error(`${name}: ${code}: ${stderr}`)) : resolve(stdout.trim()));
});
const browser = await openPage(`http://127.0.0.1:${port}/?name=Tester`);
try {
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    sessionStorage.setItem("e2a2o.joined", "Tester");
    localStorage.setItem("e2a2o.name", "Tester"); localStorage.setItem("e2a2o.toured", "1");
    window.spoken = []; window.messages = []; window.mapWorld = null;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: Object.assign(new EventTarget(), {
      getVoices: () => [{ name: "Synthetic English", lang: "en-US", default: true, localService: true }], cancel() {}, speak(u) { spoken.push(u.text); queueMicrotask(() => u.onend?.()); }
    }) });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args); window.mapSocket = this;
        this.addEventListener("message", event => {
          const m = JSON.parse(event.data); messages.push(m);
          if (m.type === "snapshot") mapWorld = m.world;
        });
      }
    };
  ` });
  await page("Page.reload");
  assert.ok(await until("!!mapWorld"), "real page received the hub's map");
  assert.equal(await evaluate("spoken.length"), 0, "snapshot is silent");
  // The fixture's topic is pinned, so the person's words land without a model call.
  await evaluate(`mapSocket.send(JSON.stringify({ type: "stay", thread_id: "T1" }))`);
  const thoughts = ["I want these replies to stay beside my words.", "The newest thing I read should get the answer."];
  for (const text of thoughts) {
    await evaluate(`mapSocket.send(JSON.stringify({ type: "text", text: ${JSON.stringify(text)} }))`);
    assert.ok(await until(`messages.some(m => m.change?.type === "thought_added" && m.change.thought.text === ${JSON.stringify(text)})`));
  }
  const ids = await evaluate(`messages.filter(m => m.change?.type === "thought_added" && ${JSON.stringify(thoughts)}.includes(m.change.thought.text)).map(m => m.change.thought.id)`);
  // Block exit only in this child so it can be killed after printing, before any ack.
  const waiter = spawn(process.execPath, ["--input-type=module", "--eval", `
    const exit = process.exit; process.exit = code => { if (code) exit(code); };
    await import(${JSON.stringify(new URL(`file://${bridge}/wait.mjs`).href)});
  `, "--", "--quiet", "0"], { env });
  const closed = new Promise(resolve => waiter.once("close", resolve));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiter.kill(); reject(new Error("waiter did not read the live thoughts")); }, 5000);
    waiter.stdout.once("data", () => { clearTimeout(timer); waiter.kill("SIGKILL"); resolve(); });
  });
  await closed;
  const again = await run("wait.mjs", ["--quiet", "0", "--timeout", "0"]);
  for (const id of ids) assert.ok(again.includes(`[${id}]`), "killed batch comes back with each thought id");
  assert.ok(!fs.existsSync(path.join(state, "cursor")), "read did not advance the cursor");
  // A later thought is unread and must not steal the reply's target.
  const unread = "This later thought has not been read by Claude.";
  await evaluate(`mapSocket.send(JSON.stringify({ type: "text", text: ${JSON.stringify(unread)} }))`);
  assert.ok(await until(`messages.some(m => m.change?.thought?.text === ${JSON.stringify(unread)})`));
  const text = "Your answer stays beside the words you just shared.";
  const commentId = await run("reply.mjs", [text]);
  assert.ok(await until(`spoken.includes(${JSON.stringify(text)})`), "new Comment reached page-speech");
  assert.deepEqual(await evaluate("spoken"), [text], "only the new Comment speaks");
  assert.ok(await until(`messages.some(m => m.type === "guide" && m.target === ${JSON.stringify(`point:${ids.at(-1)}`)})`), "target was brought into view");
  assert.ok(await until(`document.body.textContent.includes(${JSON.stringify(text)})`), "Comment is visible on the real page");
  const saved = JSON.parse(read("comments.jsonl").trim().split("\n").at(-1));
  assert.equal(saved.id, commentId);
  assert.equal(saved.thought_id, ids.at(-1), "reply attached to the last batch read");
  assert.ok(!fs.existsSync(path.join(state, "pending.json")), "saved reply acknowledged only that batch");
  const later = await run("wait.mjs", ["--quiet", "0", "--timeout", "0"]);
  assert.ok(later.includes(unread) && !later.includes(thoughts[0]), "unread later words are still waiting");
  await run("wait.mjs", ["--ack"]);
  await page("Page.reload");
  assert.ok(await until(`mapWorld?.thoughts.some(t => t.id === ${JSON.stringify(commentId)} && t.placed)`), "Comment survives reload");
  assert.equal(await evaluate("spoken.length"), 0, "saved Comments never replay on reload");
  assert.ok(await until(`document.body.textContent.includes(${JSON.stringify(text)})`), "saved Comment remains visible");
  console.log(`Comment reply passed on hub :${port}: correct thought, visible, spoke once, survived reload silently; killed waiter recovered; ack retained unread words`);
} finally {
  await browser.close();
}
