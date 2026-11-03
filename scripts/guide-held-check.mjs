// The built app, real guide messages, and the shell's one held region on desktop and phone.
// SHOTS=dir saves held and expanded scenes, plus the phone question revealed by Enter, in light and dark.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP guide-held-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {},
  apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["Friend"] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
const guide = (text, by = "Friend", urgent = false, kind = "hold") =>
  core.send({ type: "guide", kind, target: null, text, by, urgent, at_ms: Date.now() });
const connected = async () => {
  for (let n = 0; n < 100 && !core.connected(); n++) await sleep(50);
  assert.equal(core.connected(), 1, "one core connection");
};
let browser;
let lifecycleServer;
let fixtureServer;
const timeout = setTimeout(() => { console.error("guide-held-check: timed out"); process.exit(1); }, 120_000);

try {
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const phone = width === 390;
    browser = await openPage("about:blank", { width, height: phone ? 844 : 900 });
    const { page, evaluate, until } = browser;
    // Page.enable is required before a new-document seed: Chrome otherwise accepts but ignores it.
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("e2a2o.toured", "1");' });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
    assert.ok(await until('!!document.querySelector("[data-guide=composer] textarea") && !!window.e2a2oHold && !document.querySelector(".tour-tip")'));
    await connected();
    await evaluate(`document.querySelector('[data-guide="composer"] textarea').focus()`);
    await page("Input.insertText", { text: "A draft still being written" });
    await evaluate("document.activeElement.blur()");
    const click = async (selector) => {
      assert.ok(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), selector);
    };
    const check = async (expression, label) => assert.ok(await until(expression), `${width}/${scheme}: ${label}`);
    const ids = () => evaluate('[...document.querySelectorAll("[data-held-id]")].map(el => el.dataset.heldId)');
    const key = async (key, code, windowsVirtualKeyCode, options = {}) => {
      // Enter carries its character (text), as a real keystroke does: without it Chrome never presses a focused button.
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : {}), ...options });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers: options.modifiers ?? 0 });
    };
    const answerOnce = async (n, label) => {
      await check(`Number(document.querySelector('.guide-caption')?.dataset.n) === ${n + 1}`, `${label} answers`);
      assert.equal(await evaluate(`!!document.querySelector('[data-held-id="guide:${n}"]')`), false, `${label} removes answered entry`);
      // Even an invalid second askNow consumes a sequence number; a real message reveals duplicate calls.
      guide("Keyboard sequence marker?", "Marker");
      if (phone) {
        await check('!!document.querySelector(".shell-held-chip")', `${label} marker chip`);
        await click(".shell-held-chip");
      }
      await check(`!!document.querySelector('[data-held-id="guide:${n + 2}"]')`, `${label} invokes askNow exactly once`);
      assert.equal(await evaluate('Number(document.querySelector(".guide-caption")?.dataset.n)'), n + 1, `${label} marker preserves asked question`);
      guide("", "Marker");
      await click(".guide-asks button:last-of-type");
      await check('!document.querySelector(".guide-caption") && !document.querySelector("[data-slot=held]")', `${label} cleanup`);
    };
    const overflow = async () => {
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "no horizontal page overflow");
      assert.equal(await evaluate(`[...document.querySelectorAll('[data-slot="held"], .guide-held-card')].every(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1;
      })`), true, "held cards fit horizontally");
      assert.equal(await evaluate('document.querySelector("[data-guide=composer] textarea").value'), "A draft still being written", "draft retained");
    };
    const shot = async (scene) => {
      await overflow();
      if (!shots) return;
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `guide-held-${scene}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
    };
    // Use the shell's existing public seam, with no new production test globals.
    await evaluate(`window.e2a2oHold({ id: "other", by: "Alex", main: "A separate question?", rest: "From another feature.",
      answer: () => { document.body.dataset.otherAnswer = String(+(document.body.dataset.otherAnswer || 0) + 1); },
      later: () => { document.body.dataset.otherLater = "yes"; } })`);
    guide("First detail. **Which day?**");
    guide("Second question?", "Sam");
    await check(phone ? 'document.querySelector(".shell-held-chip .shell-count")?.textContent === "3"'
      : 'document.querySelector(".guide-held-text")?.textContent.includes("Which day?")', "FIFO first");
    if (phone) await click(".shell-held-chip");
    await check('document.querySelectorAll(".guide-held-card").length === 1', "one initial card");
    const firstId = (await ids())[0];
    assert.equal(await evaluate('document.querySelector(".guide-held-text strong")?.textContent'), "Which day?", "main words bold");
    assert.equal(await evaluate('document.querySelector(".guide-by[data-ai]")?.textContent.trim()'), "✦ Friend");
    assert.ok(await evaluate('!!document.querySelector(".guide-by[data-ai][data-tip]")'), "AI tip");
    assert.equal(await evaluate('document.querySelector(".guide-held-more").textContent.trim()'), "2 more held");
    guide("Urgent deadline?", "Friend", true);
    await check('document.querySelector(".guide-held-card")?.textContent.includes("Interrupt")', "urgent jumps FIFO");
    const urgentId = (await ids())[0];
    const urgentN = Number(urgentId.slice(6));
    assert.equal(await evaluate('document.querySelectorAll("[data-slot=held]").length'), 1, "one region");
    assert.equal(await evaluate('document.querySelectorAll(".guide-held[data-place]").length'), 0, "no separate guide stack");
    assert.equal(await evaluate('document.querySelectorAll(".shell-held-q, .shell-held-acts").length'), 0, "content replaces duplicate actions");
    if (phone) await click(".shell-held-chip");
    await shot("held");
    if (phone) {
      assert.equal(await evaluate('document.querySelector(".shell-held-chip .shell-count").textContent'), "4", "phone counts every item");
      await click(".shell-held-chip");
    }
    await click(".guide-held-more");
    await check('document.querySelectorAll("[data-held-id]").length === 4', "expanded all items");
    const ordered = await ids();
    assert.deepEqual(ordered.slice(0, 2), [urgentId, firstId]);
    assert.equal(ordered[3], "other", "unrelated entry preserved");
    assert.equal(await evaluate('document.querySelectorAll(".guide-held-card").length'), 3, "one card per guide item");
    await shot("expanded");

    await click(`[data-held-id="${urgentId}"] .guide-held-acts button:first-child`);
    await check('document.querySelector(".guide-caption[data-asking]")?.textContent.includes("Urgent deadline?")', "Answer asks now");
    await check(`!document.querySelector('[data-held-id="${urgentId}"]')`, "asked item removed");
    assert.equal(await evaluate('Number(document.querySelector(".guide-caption").dataset.n)'), urgentN + 1);
    // askNow increments the guide sequence even on an invalid second call. The next real message detects that too.
    guide("Sequence marker?", "Marker");
    await check(`!!document.querySelector('[data-held-id="guide:${urgentN + 2}"]')`, "Answer invokes askNow exactly once");
    guide("", "Marker");
    await click(".guide-asks button:last-of-type");
    await check('!document.querySelector(".guide-caption")', "Drop it closes asked item");
    await click(`[data-held-id="${firstId}"] .guide-held-acts button:last-child`);
    await check(`document.querySelector('[data-held-id="${firstId}"] .guide-held-card')?.dataset.state === "later"`, "Later retained");
    assert.equal((await ids())[0], ordered[2], "waiting second item precedes Later");
    await click(`[data-held-id="${firstId}"] .guide-held-acts button:last-child`);
    await check(`!document.querySelector('[data-held-id="${firstId}"]')`, "Drop it removes held item");
    guide("", "Sam");
    await check('document.querySelectorAll("[data-held-id]").length === 1 && !!document.querySelector("[data-held-id=other]")', "sender withdrawal preserves unrelated entry");
    await click(".shell-held-acts button:first-child");
    await check('!document.querySelector("[data-slot=held]")', "empty region cleaned up");
    assert.equal(await evaluate('document.body.dataset.otherAnswer'), "1", "existing shell Answer callback once");

    // The shell's L callback must update the guide, even while the phone shows only a chip.
    guide("Keyboard question?");
    await check(phone ? '!!document.querySelector(".shell-held-chip")' : '!!document.querySelector(".guide-held-card")', "keyboard item held");
    await evaluate("document.activeElement?.blur()");
    await key("l", "KeyL", 76);
    if (phone) await click(".shell-held-chip");
    await check('document.querySelector(".guide-held-card")?.dataset.state === "later"', "shell L callback retained");
    guide("", "Friend");
    await check('!document.querySelector("[data-slot=held]")', "withdrawn Later cleaned up");

    // A closed phone chip opens with its native Enter click; only the revealed question can be answered.
    for (const focus of phone ? ["chip", "page", "button"] : ["page", "button"]) {
      guide(`Enter from ${focus}?`);
      await check(phone ? '!!document.querySelector(".shell-held-chip")' : '!!document.querySelector(".guide-held-card")', `Enter ${focus} held`);
      if (phone) {
        await evaluate('document.querySelector(".shell-held-chip").focus()');
        await key("Enter", "Enter", 13);
      }
      await check(`document.querySelector(".guide-held-text")?.textContent.includes(${JSON.stringify(`Enter from ${focus}?`)})`, `Enter ${focus} reveals question`);
      assert.equal(await evaluate('!!document.querySelector(".guide-caption")'), false, "reveal does not answer");
      const n = Number((await ids())[0].slice(6));
      if (phone && focus === "chip") await shot("revealed");
      if (phone && focus === "page") {
        await evaluate('document.querySelector(".shell-held-chip").focus()');
        await key("Enter", "Enter", 13);
        await check('!document.querySelector("[data-held-id]") && document.querySelector(".shell-held-chip .shell-count")?.textContent === "1"', "native chip Enter conceals question");
        await evaluate('document.activeElement?.blur()');
        await key("Enter", "Enter", 13);
        assert.equal(await evaluate('!!document.querySelector(".guide-caption") || !!document.querySelector("[data-held-id]")'), false, "body Enter leaves concealed question held");
        await check('document.querySelector(".shell-held-chip .shell-count")?.textContent === "1"', "concealed question retained");
        await evaluate('document.querySelector(".shell-held-chip").focus()');
        await key("Enter", "Enter", 13);
        await check(`!!document.querySelector('[data-held-id="guide:${n}"]')`, "chip reopens the same question");
      }
      if (focus === "button") {
        const unchanged = async (label) => {
          assert.equal(await evaluate(`document.querySelector('[data-held-id="guide:${n}"] .guide-held-card')?.dataset.state`), "waiting", `${label} keeps held state`);
          assert.equal(await evaluate('!!document.querySelector(".guide-caption")'), false, `${label} does not answer`);
        };
        await evaluate('document.activeElement?.blur()');
        for (const options of [{ modifiers: 1 }, { modifiers: 2 }, { modifiers: 4 }, { modifiers: 8 }, { autoRepeat: true }]) {
          await key("Enter", "Enter", 13, options);
          await unchanged(`guarded Enter ${JSON.stringify(options)}`);
        }
        for (const options of [{ modifiers: 1 }, { modifiers: 2 }, { modifiers: 4 }, { autoRepeat: true }]) {
          await key("l", "KeyL", 76, options);
          await unchanged(`guarded L ${JSON.stringify(options)}`);
        }
        for (const tag of ["input", "textarea", "select", "div"]) {
          await evaluate(`(() => { const el = document.createElement(${JSON.stringify(tag)}); el.id = "held-key-field"; if (el.tagName === "DIV") el.contentEditable = "true"; document.body.append(el); el.focus(); })()`);
          await key("Enter", "Enter", 13);
          await key("l", "KeyL", 76);
          await unchanged(`editable ${tag}`);
          await evaluate('document.querySelector("#held-key-field").remove()');
        }
        await evaluate('(() => { const el = document.createElement("dialog"); el.id = "held-key-dialog"; document.body.append(el); el.showModal(); })()');
        await key("Enter", "Enter", 13);
        await key("l", "KeyL", 76);
        await unchanged("open dialog");
        await evaluate('document.querySelector("#held-key-dialog").remove()');
      }
      if (focus === "page") await evaluate('document.activeElement?.blur()');
      else await evaluate('document.querySelector(".guide-held-acts button").focus()');
      await key("Enter", "Enter", 13);
      await answerOnce(n, `Enter ${focus}`);
      await overflow();
    }

    // Ordinary shell cards keep the same chip behavior and native action callbacks.
    for (const action of ["answer", "later"]) {
      await evaluate(`window.e2a2oHold({ id: "ordinary", by: "Alex", main: "An ordinary keyboard question?",
        answer: () => { document.body.dataset.ordinaryAnswer = String(+(document.body.dataset.ordinaryAnswer || 0) + 1); },
        later: () => { document.body.dataset.ordinaryLater = String(+(document.body.dataset.ordinaryLater || 0) + 1); } })`);
      await check(phone ? '!!document.querySelector(".shell-held-chip")' : '!!document.querySelector("[data-held-id=ordinary]")', `ordinary ${action} held`);
      if (phone) {
        await evaluate('document.querySelector(".shell-held-chip").focus()');
        await key("Enter", "Enter", 13);
      }
      await check('document.querySelector("[data-held-id=ordinary] .shell-held-q")?.textContent.includes("An ordinary keyboard question?")', "ordinary chip Enter reveals question");
      const ordinaryCalls = () => evaluate('[+(document.body.dataset.ordinaryAnswer || 0), +(document.body.dataset.ordinaryLater || 0)]');
      assert.deepEqual(await ordinaryCalls(), action === "answer" ? [0, 0] : [1, 0], "ordinary reveal does not invoke callbacks");
      await evaluate(`document.querySelector('.shell-held-acts button:${action === "answer" ? "first" : "last"}-child').focus()`);
      await key("Enter", "Enter", 13);
      await check('!document.querySelector("[data-slot=held]")', `ordinary ${action} removes entry`);
      assert.deepEqual(await ordinaryCalls(), action === "answer" ? [1, 0] : [1, 1], `ordinary ${action} callback exactly once`);
      await overflow();
    }

    {
      // Live words reach a window only while its own mic is on (core.ts): turn it on with a real tap and a stand-in stream.
      await evaluate(`navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(), tone = ctx.createOscillator(), out = ctx.createMediaStreamDestination(); tone.connect(out); tone.start(); return out.stream; }`);
      const mic = await evaluate(`(() => { const r = document.querySelector("button.mic").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...mic, button: "left", clickCount: 1 });
      await check('document.querySelector("button.mic")?.getAttribute("aria-pressed") === "true"', "microphone starts");
      core.send({ type: "status", listening: true });
      await check('document.querySelector("button.mic")?.dataset.state === "listening"', "service listening");
      core.send({ type: "partial", text: "Still speaking while the draft waits" });
      await sleep(100);
      guide("A sentence to continue after being talked over.", "Friend", false, "caption");
      if (phone) {
        await check('!!document.querySelector(".shell-held-chip")', "caption phone chip");
        await click(".shell-held-chip");
      }
      await check('!!document.querySelector(".guide-held-card")', "draft holds a caption too");
      await click(".guide-held-acts button:first-child");
      await check('!!document.querySelector(".guide-caption")', "Go ahead says held line");
      core.send({ type: "partial", text: "I am still explaining something else" });
      if (phone) {
        await check('!!document.querySelector(".shell-held-chip")', "Talked over phone chip");
        await click(".shell-held-chip");
      }
      await check('document.querySelector(".guide-held-card")?.dataset.state === "over" && !document.querySelector(".guide-caption")', "Talked over retained");
      assert.match(await evaluate('document.querySelector(".guide-held-acts button").textContent'), /Continue/);
      const overId = (await ids())[0];
      if (phone) await click(".shell-held-chip");
      await evaluate('document.activeElement?.blur()');
      await key("l", "KeyL", 76);
      if (phone) await click(".shell-held-chip");
      await check(`document.querySelector('[data-held-id="${overId}"] .guide-held-card')?.dataset.state === "over"`, "L preserves Talked over");
      assert.match(await evaluate('document.querySelector(".guide-held-acts").textContent'), /Continue.*Drop it/s);
      await click(".guide-held-acts button:first-child");
      await check('!!document.querySelector(".guide-caption") && !document.querySelector("[data-slot=held]")', "Continue removes held line");
      core.send({ type: "partial", text: "" });
      await check('!document.querySelector(".guide-caption")', "continued line finishes");
    }
    await overflow();
    await browser.close(); browser = null;
  }

  // A checker-only mount fixture exercises effect lifetime and identity changes. It imports production modules;
  // no test hook is added to them. Its WebSocket receives the same real guide protocol as the app above.
  // Serve this fixture through the shared UI module server, with the app's React transforms and dependencies.
  const entry = "/__guide_held_lifecycle__.js";
  lifecycleServer = await uiServer({ plugins: [{ name: "guide-held-lifecycle",
    resolveId: id => id === entry ? entry : null,
    load: id => id !== entry ? null : `
      import React, { StrictMode, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { Guide } from "/src/Guide.tsx";
      import { receiveGuide } from "/src/guide-core.ts";
      import { holdQuestion, useHeld } from "/src/shell/held.ts";
      const socket = new WebSocket("ws://127.0.0.1:${core.port}/ws");
      socket.onmessage = event => receiveGuide(JSON.parse(event.data));
      holdQuestion({ id: "other", by: "Alex", main: "Unrelated" });
      function Fixture() {
        const [mounted, mount] = useState(true), [ai, setAi] = useState(["Friend"]), [tick, setTick] = useState(0);
        const held = useHeld();
        return React.createElement(React.Fragment, null,
          React.createElement("div", { "data-guide": "composer" }, React.createElement("textarea", { defaultValue: "Draft" })),
          React.createElement("button", { id: "unmount", onClick: () => mount(false) }, "Unmount"),
          React.createElement("button", { id: "identities", onClick: () => setAi([]) }, "Change identities"),
          React.createElement("button", { id: "rerender", onClick: () => setTick(tick + 1) }, "Rerender"),
          React.createElement("output", { id: "store" }, JSON.stringify(held.map(q => ({ id: q.id, ai: q.ai })))),
          mounted && React.createElement(Guide, { world: { ai }, view: "map", query: "", focus: false }));
      }
      createRoot(document.getElementById("root")).render(React.createElement(StrictMode, null, React.createElement(Fixture)));
    ` }] });
  fixtureServer = createServer((req, res) => {
    if (new URL(req.url, "http://fixture").pathname !== "/") {
      lifecycleServer.middlewares(req, res, () => { res.writeHead(404).end(); });
      return;
    }
    lifecycleServer.transformIndexHtml(req.url, `<div id="root"></div><script type="module" src="${entry}"></script>`)
      .then(html => res.writeHead(200, { "content-type": "text/html" }).end(html))
      .catch(error => { res.writeHead(500).end(String(error)); });
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", resolve);
  });
  browser = await openPage(`http://127.0.0.1:${fixtureServer.address().port}/?shell=2`);
  assert.ok(await browser.until('!!document.querySelector("#store")'));
  await connected();
  guide("Lifecycle question?");
  assert.ok(await browser.until('JSON.parse(document.querySelector("#store").textContent).some(q => q.id.startsWith("guide:") && q.ai)'));
  await browser.evaluate('document.querySelector("#identities").click()');
  assert.ok(await browser.until('JSON.parse(document.querySelector("#store").textContent).some(q => q.id.startsWith("guide:") && q.ai === false)'));
  // A shell entry added later stays at the front through an unrelated render: no store resync loop.
  await browser.evaluate('window.e2a2oHold({ id: "later-other", by: "Alex", main: "Another" }); document.querySelector("#rerender").click()');
  await sleep(100);
  assert.equal(await browser.evaluate('JSON.parse(document.querySelector("#store").textContent)[0].id'), "later-other");
  await browser.evaluate('document.querySelector("#unmount").click()');
  assert.ok(await browser.until('JSON.parse(document.querySelector("#store").textContent).every(q => !q.id.startsWith("guide:"))'));
  assert.deepEqual(await browser.evaluate('JSON.parse(document.querySelector("#store").textContent).map(q => q.id)'), ["later-other", "other"], "unmount preserves unrelated entries");
  console.log("guide-held-check: ok");
} finally {
  clearTimeout(timeout);
  await browser?.close();
  fixtureServer?.closeAllConnections();
  if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
  await lifecycleServer?.close();
  core.close();
}
