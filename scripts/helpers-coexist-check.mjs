// Isolated mechanics only: coordinated OS children + local HTTP model answers.
// No genuine model, recording, hardware or send evidence. Build Rust tests first
// with the worktree's test runner; pass its executable as HELPERS_TEST_BIN.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { ready, openPage } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

// Reducer regression: IDs are opaque across the helper/connector ranges.
const server = await uiServer();
try {
  const { received } = await server.ssrLoadModule("/src/send-card.ts");
  const msg = (id, state, extra = {}) => ({ type: "send_card", id, state, to: "Reviewer", text: "Sample review", in_ms: 6000, live: false, message: "", ...extra });
  const helper = msg(2 ** 52 + 1, "running", { purpose: "helpers" });
  const email = received(received(null, helper, 0), msg(1, "counting", { channel: "email" }), 1);
  assert.equal(received(email, { ...helper, state: "sent" }, 3), email, "late end cannot obscure email");
} finally { await server.close(); }
if (process.argv.includes("--card-only")) {
  console.log("helpers-coexist-check: card ownership reducer passed; desktop mechanics not run (--card-only)");
  process.exit(0);
}
const why = ready();
if (why) { console.log(`SKIP helpers-coexist-check: ${why}`); process.exit(3); }
assert.ok(process.env.HELPERS_TEST_BIN, "HELPERS_TEST_BIN must name this worktree's freshly built test executable");

const app = spawn(process.env.HELPERS_TEST_BIN, ["--ignored", "--exact", "helpers::tests::coexist_app", "--nocapture"], {
  cwd: new URL("../core/", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
});
let output = "", url, trace, browser;
app.stdout.on("data", s => { output += s; });
app.stderr.on("data", s => { output += s; });
try {
  ({ url, trace } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mechanics app did not start: ${output.slice(-1200)}`)), 15000);
    const started = () => {
      const url = output.match(/COEXIST_APP (http:\/\/[^\s]+)/)?.[1];
      const trace = output.match(/COEXIST_TRACE ([^\r\n]+)/)?.[1];
      if (url && trace) { clearTimeout(timer); app.stdout.off("data", started); resolve({ url, trace }); }
    };
    app.stdout.on("data", started);
    app.once("exit", code => { clearTimeout(timer); reject(new Error(`mechanics app exited ${code}: ${output.slice(-1200)}`)); });
    started();
  }));
  assert.ok(![4360, 4399].includes(Number(new URL(url).port)), "OS assigned an allowed port");
  browser = await openPage("about:blank", { width: 1440, height: 1000 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("e2a2o.toured", "1");
    localStorage.setItem("e2a2o.features", JSON.stringify({email:true}));
    window.coexistErrors = []; window.coexistSeen = []; window.coexistSockets = []; window.coexistCards = []; window.coexistLayoutNotices = 0;
    addEventListener("error", e => {
      if (e.message === "ResizeObserver loop completed with undelivered notifications.") coexistLayoutNotices++;
      else coexistErrors.push(e.message);
    });
    addEventListener("unhandledrejection", e => coexistErrors.push(String(e.reason)));
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); coexistSockets.push(this);
        this.addEventListener("message", e => { try {
          const message = JSON.parse(e.data); coexistSeen.push(message);
          if (message.type === "send_card") setTimeout(() => coexistCards.push({id:message.id, state:message.state,
            shown:[...document.querySelectorAll(".send-card")].map(e => ({label:e.getAttribute("aria-label"), id:e.dataset.actionId, stop:!!e.querySelector(".send-card-stop")}))}),100);
        } catch {} });
      }
    };
  ` });
  await page("Page.navigate", { url });
  const check = async (expression, label, ms = 25000) => {
    const passed = await until(expression, ms);
    const detail = passed ? "" : await evaluate(`JSON.stringify({
      cards: [...document.querySelectorAll(".send-card")].map(e => ({text:e.innerText, label:e.getAttribute("aria-label"), id:e.dataset.actionId})),
      sends: coexistSeen.filter(m => m.type === "send_card").slice(-4), errors: coexistErrors.slice(-3),
      samples: coexistCards.slice(-6),
      draft: document.querySelector("[data-guide=composer] textarea")?.value
    })`);
    assert.ok(passed, `${label}${detail ? ": " + detail : ""}`);
  };
  await check('!!document.querySelector("[data-guide=composer] textarea")', "desktop composer ready");
  await check('coexistSeen.some(m => m.type === "snapshot")', "core handshake complete");
  const rendered = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await rendered();
  const key = async (key) => {
    const n = key === "Enter" ? 13 : key === "Escape" ? 27 : 0;
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: n, ...(key === "Enter" ? { text: "\r" } : {}) });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: n });
  };
  const type = async (text) => {
    await evaluate('document.querySelector("[data-guide=composer] textarea").focus()');
    await page("Input.insertText", { text }); await rendered(); await key("Enter");
    await check('document.querySelector("[data-guide=composer] textarea")?.value === ""', "typed turn submitted", 3000);
  };
  const current = () => evaluate('Number(document.querySelector(".send-card")?.dataset.actionId)');
  const running = parent => `coexistSeen.filter(m => m.type === "job" && m.parent === ${JSON.stringify(parent)}).reduce((a,m)=>(a[m.id]=m,a),{})`;
  const count = parent => `Object.values(${running(parent)}).filter(m => m.started_ms && !m.ended_ms).length`;
  await type("A sample draft before");
  await check('coexistSeen.some(m => m.type === "change" && m.change.type === "thought_placed")', "source placed");
  const source = await evaluate('coexistSeen.find(m => m.type === "change" && m.change.type === "thought_added" && m.change.thought.text === "A sample draft before").change.thought.id');
  await type("put three helpers on coding the sample");
  await check('document.querySelector(".send-card")?.innerText.includes("3 helpers")', "coding countdown visible");
  const codeId = await current(), codeParent = `helpers:${codeId}`;
  await check(`${count(codeParent)} === 3`, "three actual OS children started");
  await type("get two helpers on the review question");
  await check('document.querySelector(".send-card")?.innerText.includes("2 helpers")', "thinking parent admitted");
  const thinkId = await current(), thinkParent = `helpers:${thinkId}`;
  assert.equal(await evaluate(count(codeParent)), 3, "all coders active at second admission");
  await check(`${count(thinkParent)} === 2`, "thinking HTTP children overlap code");
  await type("The sample needs a clear decision.");
  await check('coexistSeen.some(m => m.type === "change" && m.change.type === "thought_placed" && m.change.point === "The sample needs a clear decision.")', "decision placed while jobs execute");
  await type("where was I?");
  await check(`coexistSeen.some(m => m.type === "returned" && m.anchor?.thought_id === ${JSON.stringify(source)})`, "return names the exact original source");
  for (const mode of ["button", "escape", "draft", "dry"]) {
    await type("email Reviewer that the sample needs review");
    await check('!!document.querySelector(".send-card[aria-label^=\\"Email to Reviewer\\"] .send-card-stop")', `${mode}: email countdown visible`);
    const emailId = await current();
    // A real disconnect/reconnect, followed by a fresh snapshot with both parents.
    const before = await evaluate('coexistSockets.length');
    await evaluate('coexistSockets.at(-1).close()');
    await check(`coexistSockets.length > ${before} && coexistSockets.at(-1).readyState === 1`, `${mode}: reconnected`);
    await check(`document.querySelector(".send-card")?.dataset.actionId === ${JSON.stringify(String(emailId))} && document.querySelector(".send-card")?.getAttribute("aria-label")?.startsWith("Email to Reviewer")`, `${mode}: reconnect keeps email ownership`, 3000);
    if (mode === "button") await evaluate('document.querySelector(".send-card-stop").click()');
    else if (mode === "escape") await key("Escape");
    else if (mode === "draft") await fetch(`${url}/__mechanics/stop`, { method: "POST" });
    await check(`document.querySelector(".send-card")?.innerText.includes(${JSON.stringify(mode === "dry" ? "Dry run: nothing sent" : "Stopped: not sent")})`, `${mode}: email outcome visible`);
    assert.equal(await evaluate(count(codeParent)), 3, `${mode}: coders survive`);
    assert.equal(await evaluate(count(thinkParent)), 2, `${mode}: thinkers survive`);
  }
  await fetch(`${url}/__mechanics/release`, { method: "POST" });
  for (const parent of [codeParent, thinkParent]) {
    await check(`coexistSeen.some(m => m.type === "job" && m.id === ${JSON.stringify(parent)} && m.status === "done" && m.result)`, "parent retains its own output");
  }
  await check('document.querySelectorAll("[data-job-id][data-parent][data-status=done]").length === 5', "all five child outputs remain in Work");
  assert.deepEqual(await evaluate("coexistErrors"), [], "no unexpected browser errors");
  const rows = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  const executions = rows.filter(r => r.kind === "helpers_execution");
  const coders = executions.filter(r => r.phase === "start" && r.helper_kind === "coding");
  assert.equal(coders.length, 3);
  assert.ok(coders.every(r => r.provider === "test-only" && Number.isInteger(r.pid)), "explicit test-only processes");
  for (const start of executions.filter(r => r.phase === "start")) {
    assert.ok(executions.some(end => end.phase === "end" && end.child_id === start.child_id && end.at >= start.at && end.outcome === "done"));
  }
  assert.ok(!rows.some(r => r.kind === "delivery" && r.event === "sent"), "zero external sends");
  assert.ok(rows.some(r => r.kind === "delivery" && r.event === "dry_run"), "email actually reached dry-run completion");
  console.log(`helpers-coexist-check: passed desktop + reconnect ownership, overlap, placement, exact return, button/Esc/draft Stop, dry email, retained outputs; ${await evaluate("coexistLayoutNotices")} ResizeObserver scheduling notices; isolated mechanics only, no filming evidence`);
} finally {
  try {
    if (url && app.exitCode === null) {
      const response = await fetch(`${url}/__mechanics/cleanup`, { method: "POST", signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, "fixture reaped its owned children");
    }
  } finally {
    await browser?.close();
    if (app.exitCode === null) {
      const exited = new Promise(resolve => app.once("exit", resolve));
      app.kill("SIGTERM"); // Only the PID this harness started.
      await exited;
    }
  }
}
