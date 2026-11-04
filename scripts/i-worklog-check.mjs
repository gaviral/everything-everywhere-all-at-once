// Synthetic local files only. No model, account, private filesystem service or source mutation.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready, standInCore } from "./headless.mjs";

const text = '\ufeff# Synthetic work\r\n- [ ] Q-002 P1 Prepare launch — reason: waiting for review\r\n  - [x] Q-012 P2 Nested check — reason: verified\r\n    Detail: keep every word, café, ID and priority.\r\n    ```ts\r\n    const checked = "[ ] not a task";\r\n    ```\r\n  - [ ] Q-013 P3 Another child with `inline code`\r\n- [x] Q-014 P0 Complete\r\n' + 'Long line: original wording remains available. '.repeat(30) + '\r\n<script>window.untrusted = true</script>\r\n';
const artifacts = mkdtempSync(join(tmpdir(), "i-worklog-check-"));
const file = join(artifacts, "synthetic-work.md");
writeFileSync(file, text);
const invalid = join(artifacts, "invalid.txt");
writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
const settings = "e2a2o.work-list.preferences";
let browser;
const server = await uiServer();
try {
  const { outlineOf } = await server.ssrLoadModule("/src/bricks/work-list/outline.tsx");
  const rows = outlineOf(text);
  const all = rows.flatMap(function walk(row) { return [row, ...row.children.flatMap(walk)]; });
  assert.deepEqual(all.filter(r => r.status).map(r => [r.id, r.status]), [[1, "pending"], [2, "checked"], [7, "pending"], [8, "checked"]]);
  assert.equal(rows[1].children[0].id, 2, "real parent-child nesting");
  assert.ok(all.some(r => r.kind === "code" && r.text.includes('"[ ] not a task"')));
  const { loadLocalText } = await server.ssrLoadModule("/src/bricks/work-list/index.tsx");
  assert.equal(await loadLocalText(new File([text], "synthetic.md")), text, "UTF-8 including BOM and CRLF preserved");
  await assert.rejects(loadLocalText(new File([new Uint8Array([0xc3, 0x28])], "invalid.txt")));
} finally { await server.close(); }
if (ready()) { console.log(`SKIP i-worklog-check pages: ${ready()}`); process.exitCode = 3; }
else {
  const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], recaps: [], notes: {}, proposals: [] };
  let shown = world;
  const core = await standInCore(() => [{ type: "snapshot", world: shown }, { type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." }]);
  const click = (selector) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const wait = async (expression, label) => assert.ok(await browser.until(expression), label);
  const key = async (name, code, n) => {
    await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: n, ...(name === "Enter" ? { text: "\r" } : {}) });
    await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: n });
  };
  const pick = async (path) => {
    const { root } = await browser.page("DOM.getDocument");
    const { nodeId } = await browser.page("DOM.querySelector", { nodeId: root.nodeId, selector: '.work-list-picker input[type="file"]' });
    await browser.page("DOM.setFileInputFiles", { nodeId, files: [path] });
  };
  const screenshot = async (name) => writeFileSync(join(artifacts, name + ".png"), Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const sourceText = () => browser.evaluate('document.querySelector(".work-list-panel .work-list-source")?.textContent');
  try {
    for (const width of [1440, 390]) {
      shown = world;
      browser = await openPage("about:blank", { width, height: 900 });
      await browser.page("Page.enable");
      await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");
        window.workTraffic = []; window.workErrors = [];
        window.addEventListener("error", e => window.workErrors.push(e.message));
        const send = WebSocket.prototype.send; WebSocket.prototype.send = function(data) { window.workTraffic.push(String(data)); return send.call(this, data); };` });
      await browser.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?sample` });
      await wait('!!document.querySelector("[data-guide=composer] textarea")', "ordinary page mounts");
      assert.equal(await browser.evaluate('!!document.querySelector(".work-list")'), false, "fresh profile defaults off");
      await key("c", "KeyC", 67);
      await wait('!!document.querySelector(\'[role="switch"][aria-label="Work list"]\')', "Features discovers Work list");
      const feature = '[role="switch"][aria-label="Work list"]';
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(feature)}).getAttribute("aria-checked")`), "false");
      await click(feature);
      await wait('!!document.querySelector(".work-list-launcher")', "enable mounts panel brick");
      // Leave Features before opening the panel; keyboard acts through the real app.
      await key("Escape", "Escape", 27);
      shown = { ...world, threads: [{ id: "canvas-synthetic", title: "Synthetic canvas", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null }] };
      core.send({ type: "snapshot", world: shown });
      await wait('!!document.querySelector(".react-flow__viewport")', "synthetic canvas mounts");
      await click(".work-list-launcher");
      await wait('!!document.querySelector(".work-list-panel")', "launcher opens panel");
      assert.match(await browser.evaluate('document.querySelector(".work-list-origin").textContent'), /Choose the file again/);
      const before = core.heard.filter(m => m.type !== "heartbeat").length;
      const sent = await browser.evaluate('window.workTraffic.length');
      await pick(file);
      await wait('document.querySelectorAll(".work-list-panel [role=checkbox]").length === 4', "picker loads real synthetic file");
      assert.match(await browser.evaluate('document.querySelector(".work-list-origin").textContent'), /synthetic-work.md/);
      assert.equal(await browser.evaluate('document.querySelectorAll(".work-list-panel .work-list-outline .work-list-outline").length >= 2'), true);
      assert.equal(await browser.evaluate('document.querySelectorAll(".work-list-panel [role=checkbox][aria-readonly=true]").length'), 4);
      assert.equal(await browser.evaluate('document.querySelectorAll(".work-list-panel [role=checkbox][aria-checked=true]").length'), 2);
      assert.equal(await browser.evaluate('!!window.untrusted'), false, "source HTML is inert");
      const statusBefore = await browser.evaluate('document.querySelector(".work-list-status").outerHTML');
      await click(".work-list-status");
      assert.equal(await browser.evaluate('document.querySelector(".work-list-status").outerHTML'), statusBefore, "status has no mutation handler");
      await browser.evaluate('document.querySelector(".work-list-fold").focus()');
      await key("Enter", "Enter", 13);
      await wait('document.querySelector(".work-list-fold").getAttribute("aria-expanded") === "false"', "keyboard folds detail");
      await click('[aria-label="Close Work list"]');
      assert.equal(await browser.evaluate('document.activeElement === document.querySelector(".work-list-launcher")'), true);
      await click(".work-list-launcher");
      assert.equal(await browser.evaluate('document.querySelector(".work-list-fold").getAttribute("aria-expanded")'), "false", "close and reopen retains fold");
      await click(".work-list-fold");
      await click(".work-list-options label:nth-child(2) input");
      assert.equal(await sourceText(), text, "complete source byte-for-byte text (CRLF, BOM, Unicode)");
      assert.deepEqual(Buffer.from(await sourceText(), "utf8"), readFileSync(file));
      await click(".work-list-options label:nth-child(2) input");
      await screenshot(`panel-${width}`);
      await click(".work-list-read");
      await wait('!!document.querySelector(".work-list-reader[open]")', "Read here opens native modal");
      const dimensions = () => browser.evaluate('(() => { const r=document.querySelector(".work-list-reader").getBoundingClientRect(); return [r.width,r.height]; })()');
      const size = await dimensions();
      // Zoom the actual canvas viewport; the reader is a body portal in the top layer.
      assert.equal(await browser.evaluate('!!document.querySelector(".react-flow__viewport")'), true, "actual canvas viewport available");
      await browser.evaluate('{ const canvas=document.querySelector(".react-flow__viewport"); window.canvasTransform = canvas.style.transform; canvas.style.transform="translate(0px, 0px) scale(0.2)"; }');
      assert.deepEqual(await dimensions(), size, "canvas reduction does not scale reading surface");
      await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await browser.evaluate('document.documentElement.style.fontSize="200%"');
      assert.equal(await browser.evaluate('parseFloat(getComputedStyle(document.querySelector(".work-list-reader .work-list-words")).fontSize) >= 32'), true, "200% browser text preference inherited");
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "phone page fits at 200% text");
      await screenshot(`reader-200-${width}`);
      await browser.evaluate(`document.querySelector('.work-list-reader [data-line="1"]').scrollIntoView({block:"start"})`);
      await screenshot(`reader-tasks-200-${width}`);
      await click(".work-list-reader .work-list-options label:first-child input");
      assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".work-list-reader .work-list-words")).whiteSpace'), "pre", "optional no wrap");
      await click(".work-list-reader .work-list-options label:first-child input");
      await click(".work-list-reader .work-list-options label:nth-child(2) input");
      assert.equal(await browser.evaluate('document.querySelector(".work-list-reader .work-list-source").textContent'), text);
      await key("Escape", "Escape", 27);
      await wait('!document.querySelector(".work-list-reader")', "Escape exits reading");
      assert.equal(await browser.evaluate('document.activeElement === document.querySelector(".work-list-read")'), true, "reader returns focus");
      await browser.evaluate('{ document.documentElement.style.fontSize=""; const canvas=document.querySelector(".react-flow__viewport"); canvas.style.transform=window.canvasTransform; }');
      assert.equal(await browser.evaluate('window.workTraffic.length'), sent, "panel interaction sends no socket messages");
      assert.equal(core.heard.filter(m => m.type !== "heartbeat").length, before, "core receives no file interaction");
      assert.equal(readFileSync(file, "utf8"), text, "source file unchanged");
      const stored = await browser.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(settings)}))`);
      assert.deepEqual(Object.keys(stored).sort(), ["folded", "open"], "only open and fold preferences persisted");
      assert.equal(await browser.evaluate('Object.values(localStorage).some(v => v.includes("Q-002") || v.includes("synthetic-work.md"))'), false, "no filename/content in storage");
      await click(".work-list-options label:nth-child(2) input");
      await click(".work-list-fold");
      await browser.page("Page.reload");
      await wait('!!document.querySelector(".work-list-panel")', "open preference survives reload");
      assert.equal(await browser.evaluate('document.querySelectorAll(".work-list-row").length'), 0, "no stale content on reload");
      assert.match(await browser.evaluate('document.querySelector(".work-list-origin").textContent'), /Choose the file again/);
      await pick(file);
      await wait('!!document.querySelector(".work-list-fold")', "reselection loads source");
      assert.equal(await browser.evaluate('document.querySelector(".work-list-fold").getAttribute("aria-expanded")'), "false", "fold preference survives reload and reselection");
      await pick(invalid);
      await wait('!!document.querySelector(".work-list-panel [role=alert]")', "invalid UTF-8 rejected");
      assert.equal(await browser.evaluate('document.querySelectorAll(".work-list-row").length'), 0, "failed read clears old snapshot");
      await pick(file);
      await wait('!!document.querySelector(".work-list-fold")', "deliberate refresh works");
      await click('[aria-label="Close Work list"]');
      await key("c", "KeyC", 67);
      await wait('!!document.querySelector(\'[role="switch"][aria-label="Work list"]\')', "Features reopens");
      await click(feature);
      await wait('!document.querySelector(".work-list")', "disable unmounts feature");
      await key("Escape", "Escape", 27);
      assert.equal(await browser.evaluate('!!document.querySelector("[data-guide=composer] textarea")'), true, "ordinary page restored");
      assert.deepEqual(await browser.evaluate('window.workErrors'), [], "no UI errors");
      await browser.close(); browser = null;
    }
  } finally { await browser?.close(); browser = null; core.close(); }

  // Mount the same panel with an injected loader. No production hook, endpoint or alternate implementation.
  const seam = await uiServer({ plugins: [{ name: "work-list-seam-check", configureServer(vite) {
    vite.middlewares.use("/work-list-check.html", async (_req, res) => {
      const html = await vite.transformIndexHtml("/work-list-check.html", `<html><body style="--card:white;--ink:#222;--line:#ddd;--muted:#555;--accent:#246"><div id="test"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {WorkListPanel} from '/src/bricks/work-list/index.tsx';
        window.loadCount=0; createRoot(document.getElementById('test')).render(React.createElement(WorkListPanel, {loadText: async () => { window.loadCount++; return ${JSON.stringify(text).replaceAll("<", "\\u003c")}; }}));
      </script></body></html>`);
      res.setHeader("Content-Type", "text/html"); res.end(html);
    });
  } }] }, { port: 0 });
  try {
    await seam.listen();
    const port = seam.httpServer.address().port;
    browser = await openPage(`http://127.0.0.1:${port}/work-list-check.html`);
    await wait('!!document.querySelector(".work-list-launcher")', "injected panel mounts");
    await click(".work-list-launcher");
    await pick(file);
    await wait('document.querySelectorAll(".work-list-status").length === 4', "injected loader renders tasks");
    assert.equal(await browser.evaluate('window.loadCount'), 1);
    await click(".work-list-options label:nth-child(2) input");
    assert.equal(await sourceText(), text, "injected seam retains exact content");
  } finally { await browser?.close(); await seam.close(); }
  console.log(`i-worklog-check: ok (picker + injected loader, nesting, read-only, exact source, folds, reload, Features off/on/off, desktop/390px, 200% text, reduced motion, no writes/sends). Artifacts: ${artifacts}`);
}
