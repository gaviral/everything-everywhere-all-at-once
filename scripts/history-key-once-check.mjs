// History alone keeps a missing-key notice once per window. Exercise the real hook's retention and Undo,
// then the built shell with an original populated map, real socket messages and CDP rail input.
// SHOTS=dir saves History open at laptop and phone sizes in light and dark.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP history-key-once-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`history-key-once-check: ${error.stack || error.message}`); process.exit(1); });

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const world = {
  threads: [thread("T1", "Community supper"), thread("T2", "Balcony seedlings"), thread("T3", "Library afternoon")],
  thoughts: [
    thought("p0", "Bring lentil soup and a loaf to the shared table", "T1"),
    thought("p1", "Ask who can bring bowls", "T1"),
    thought("p2", "Move the basil into the morning sun", "T2"),
    thought("p3", "Return the field guide on Saturday", "T3"),
  ],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], proposals: [],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
const landing = thought("p4", "Save two seats by the window", "T1");
const ordinary = "The supper list is saved.";
const unrelated = "Back to Community supper";

// The same minimal DOM used by notice-check: React mounts a component which draws nothing.
const noop = () => {};
const element = () => ({ nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  style: {}, setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop,
  appendChild: noop, removeChild: noop, ownerDocument: globalThis.document });
globalThis.window = globalThis;
globalThis.document = { nodeType: 9, addEventListener: noop, removeEventListener: noop, createElement: element,
  body: { style: {} }, activeElement: null, getSelection: () => null, querySelector: () => null, defaultView: globalThis };
globalThis.document.documentElement = element();
globalThis.HTMLIFrameElement = class {};
globalThis.location = new URL("http://localhost/");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;
const server = await uiServer();
let keyWords;
try {
  ({ keyWords } = await server.ssrLoadModule("/src/site.ts"));
  const { useHistory, canUndo } = await server.ssrLoadModule("/src/shell/history.ts");
  for (const hosted of [false, true]) {
    let history, mapChange = null, undoId = null;
    const listeners = new Map();
    const on = (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event).delete(fn); };
    const stream = [];
    on("notice", (notice) => stream.push(notice));
    const emit = async (event, payload) => React.act(() => { for (const fn of listeners.get(event) ?? []) fn(payload); });
    let time = now;
    const notice = (text, kind = "notice") => emit("notice", { text, kind, time: ++time });
    const root = createRoot(element());
    function Window() { history = useHistory(on, world, mapChange, undoId); return null; }
    const render = () => React.act(() => root.render(React.createElement(Window)));
    await render();
    try {
      const missing = keyWords(hosted, false, "notice");
      await notice(missing);
      const first = history.entries[0];
      await notice(missing);
      assert.strictEqual(history.entries[0], first, "a duplicate preserves the entry object, id and time");
      undoId = 41; await render();
      assert.deepEqual(history.entries[0].undo, { kind: "turn", id: 41 });
      assert.ok(canUndo(history.entries[0], undoId));
      const held = history.entries[0];
      await notice(missing);
      assert.strictEqual(history.entries[0], held, "a duplicate preserves attached Undo");
      await notice(unrelated);
      const unrelatedEntry = history.entries[0];
      const landed = { thoughtId: "p0", threadId: "T1", mine: true, model: "muse-spark-1.3-contributor", ms: 2000, by: null };
      await emit("landed", landed); await emit("landed", landed);
      await notice(missing);
      undoId = 42; await render();
      let coalesced = history.entries.find((e) => e.n === first.n);
      assert.deepEqual(coalesced.undo, { kind: "turn", id: 42 }, "a coalesced notice gets its latest turn's Undo");
      assert.ok(canUndo(coalesced, undoId), "the coalesced notice's Undo remains available");
      assert.equal(coalesced.at, first.at, "Undo attachment preserves the original notice's time and identity");
      assert.strictEqual(history.entries.find((e) => e.n === unrelatedEntry.n), unrelatedEntry, "Undo must not attach to an unrelated notice without Undo");
      await notice(unrelated);
      undoId = 43; await render();
      const unrelatedWithUndo = history.entries[0];
      assert.deepEqual(unrelatedWithUndo.undo, { kind: "turn", id: 43 }, "ordinary notice Undo still attaches");
      await React.act(() => history.markUndone(first.n));
      await notice(missing);
      undoId = 44; await render();
      coalesced = history.entries.find((e) => e.n === first.n);
      assert.deepEqual(coalesced.undo, { kind: "turn", id: 44 }, "a newer coalesced turn replaces the previous Undo");
      assert.ok(canUndo(coalesced, undoId), "a new Undo is usable even if the earlier coalesced turn was undone");
      assert.strictEqual(history.entries.find((e) => e.n === unrelatedWithUndo.n), unrelatedWithUndo, "an unrelated notice keeps its own Undo");
      assert.ok(!canUndo(unrelatedWithUndo, undoId), "the older unrelated turn is unavailable");
      await notice(ordinary); await notice(ordinary);
      await notice("The connection needs attention.", "error"); await notice("The connection needs attention.", "error");
      for (const refused of [false, true]) {
        const text = keyWords(hosted, refused, "notice", !refused);
        await notice(text); await notice(text);
        assert.equal(history.entries.filter((e) => e.text === text).length, 2, "daily limits and refusals remain separate events");
      }
      const change = { text: "Renamed the supper thread", ai: true, undo: [{ kind: "rename", thread_id: "T1" }], restore: [] };
      mapChange = { ...change, id: 1 }; await render();
      mapChange = { ...change, id: 2 }; await render();
      assert.equal(history.entries.filter((e) => e.kind === "change").length, 2);
      assert.ok(canUndo(history.entries[0], undoId));
      const beforeIgnored = history.entries;
      await notice(change.text, "map-change"); await notice("  ");
      assert.strictEqual(history.entries, beforeIgnored);
      assert.equal(history.entries.filter((e) => e.text === missing).length, 1);
      assert.equal(history.entries.filter((e) => e.text === ordinary).length, 2);
      assert.equal(history.entries.filter((e) => e.kind === "error").length, 2);
      const landings = history.entries.filter((e) => e.kind === "landing");
      assert.equal(landings.length, 2);
      assert.deepEqual(landings[0].undo, { kind: "remove", thoughtId: "p0" });
      assert.ok(canUndo(landings[0], undoId));
      assert.ok(!canUndo(held, 42), "an older turn's Undo is unavailable");
      await React.act(() => history.markUndone(landings[0].n));
      assert.ok(!canUndo(history.entries.find((e) => e.n === landings[0].n), undoId));
      const ids = history.entries.map((e) => e.n);
      assert.deepEqual(ids, [...ids].sort((a, b) => b - a), "newest first, with distinct identities");
      assert.equal(new Set(ids).size, ids.length);
      // No recent-entry search: once per window also holds when the original row has aged out.
      for (let i = 0; i < 81; i++) await notice(`Supper update ${i}`);
      assert.equal(history.entries.length, 80);
      assert.equal(history.entries.at(-1).text, "Supper update 1");
      const bounded = history.entries;
      await notice(missing); await notice(keyWords(!hosted, false, "notice"));
      assert.strictEqual(history.entries, bounded, "neither displayed variant returns after eviction");
      undoId = 45; await render();
      assert.strictEqual(history.entries, bounded, "Undo for an evicted coalesced notice never attaches to another row");
      assert.equal(stream.filter((e) => e.text === missing).length, 6, "other listeners still receive every missing-key event");
    } finally { await React.act(() => root.unmount()); }
  }
} finally { await server.close(); }

const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const KEYS = { y: ["y", "KeyY", 89, "y"], Escape: ["Escape", "Escape", 27] };
let browser = null;
let core = null;
let runs = 0;
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ["light", "dark"]) {
      // Both deployed wordings are exercised on a real page; each size still has light and dark captures.
      const hosted = scheme === "dark";
      const label = `${width}x${height} ${scheme} (${hosted ? "hosted" : "local"})`;
      let shown = world;
      const move = (id) => {
        shown = { ...shown, active: id, active_by: { you: id } };
        core.send({ type: "change", change: { type: "active_changed", thread_id: id, speaker: "you" } });
      };
      core = await standInCore(() => [{ type: "snapshot", world: shown }], {
        door: { room: false, member: true, hosted },
        onMessage: (message) => { if (message.type === "focus") move(message.thread_id); },
      });
      const base = `http://127.0.0.1:${core.port}/`;
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      await page("Page.enable");
      const received = [];
      browser.on("Network.webSocketFrameReceived", ({ response }) => {
        try { const message = JSON.parse(response.payloadData); if (["notice", "error", "undoable"].includes(message.type)) received.push(message); } catch { /* non-JSON frame */ }
      });
      await page("Network.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.clear(); sessionStorage.clear();
        localStorage.setItem("e2a2o.toured", "1");
        localStorage.setItem("e2a2o.install-hint", "1");
        window.__errors = [];
        addEventListener("error", e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src); }, true);
        addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
      ` });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      const press = async (name) => {
        const [key, code, keyCode, text] = KEYS[name];
        await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
      };
      const tapAt = async ({ x, y }) => {
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      };
      // Where the first match can be tapped: scrolled to the middle of its window, shown, whole inside the window, and
      // the thing at its centre is itself (not the stage, a corner or the rail on top of it); else why not.
      const where = (selector) => evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return "not there";
        el.scrollIntoView({ block: "center", behavior: "instant" });
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return "not shown";
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return "outside the window";
        const hit = document.elementFromPoint(x, y);
        return hit && el.contains(hit) ? { x, y } : "covered by " + (hit?.closest("[class]")?.getAttribute("class") ?? hit?.tagName);
      })()`);
      const reach = async (selector, what) => {
        let found = await where(selector);
        for (let waited = 0; typeof found !== "object" && waited < 4000; waited += 100) { await sleep(100); found = await where(selector); }
        assert.equal(typeof found, "object", `${label}: ${what} is on screen and takes a tap (${found})`);
        return found;
      };
      const tap = async (selector, what) => { await tapAt(await reach(selector, what)); await sleep(150); };
      const rail = '[data-slot="rail"]';
      const rows = () => evaluate(`[...document.querySelectorAll(".shell-history-text")].map(e => e.textContent)`);
      const railIs = async (open) => {
        assert.ok(await until(`!!document.querySelector('${rail}') === ${open}`, 3000), `${label}: rail ${open ? "opens" : "closes"}`);
        if (open) assert.ok(await until(`document.querySelector('${rail} [role="tab"][aria-selected="true"]')?.dataset.tab === "history"`), `${label}: History tab is active`);
        await sleep(350);
        await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
      };
      const live = async (message, type = "notice", keyState = null) => {
        core.send({ type, message });
        // The shell already shows key problems in its status line; ordinary notices use the live lane.
        const seen = keyState
          ? `document.querySelector('.shell-status-word')?.textContent === ${JSON.stringify(keyState)}`
          : `document.querySelector('.notice')?.textContent.includes(${JSON.stringify(message)})`;
        assert.ok(await until(seen, 3000), `${label}: live feedback still displays ${keyState ?? message}; stage=${await evaluate('document.querySelector(".shell-stage")?.textContent')} errors=${JSON.stringify(await evaluate('__errors'))}`);
        // Read each visible answer before the next scene. History must retain it after dismissal.
        if (!keyState) {
          await tap('.notice [aria-label="Dismiss notice"]', "read the live answer");
          assert.ok(await until('!document.querySelector(".notice")', 3000), "the answer was read");
        }
        // Separate deliveries, including identical text, must each reach the app's notice effect.
        await sleep(100);
      };
      await page("Page.navigate", { url: `${base}?shell=2` });
      assert.ok(await until(`document.readyState === "complete" && !!document.querySelector(".app.shell .spine-frame.spine-ready")`, 10000), `${label}: populated Canvas opens`);
      await evaluate("document.fonts.ready.then(() => true)");
      await sleep(350);
      // A real key dismisses Keys' first-use hint before any layout measurement or screenshot.
      await press("Escape");
      assert.ok(await until(`!document.querySelector('.keys-panel, .tour-tip')`), `${label}: first-use hints dismissed`);
      const missing = keyWords(hosted, false, "notice");
      const rawMissing = "MODEL_API_KEY is not set: listening and placement are off.";
      await live(rawMissing, "notice", hosted ? "Listening unavailable" : "No AI key");
      await live(rawMissing, "notice", hosted ? "Listening unavailable" : "No AI key");
      await live(unrelated);
      shown = { ...shown, thoughts: [...shown.thoughts, landing] };
      core.send({ type: "change", change: { type: "thought_added", thought: landing } });
      assert.ok(await until(`!!document.querySelector('.spine-frame [data-thought="p4"]')`, 3000), `${label}: the new thought lands on the populated Canvas`);
      await sleep(100);
      await live(rawMissing, "notice", hosted ? "Listening unavailable" : "No AI key");
      await live(ordinary); await live(ordinary);
      const refusal = keyWords(hosted, true, "notice");
      await live("The AI key was refused. Check MODEL_API_KEY in .env, then restart.", "error", hosted ? "Service error" : "AI key refused");
      await press("y");
      await railIs(true);
      const expected = [refusal, ordinary, ordinary, `“${landing.text}” → Community supper`, unrelated, missing];
      assert.ok(await until(`document.querySelectorAll('.shell-history-entry').length === ${expected.length}`, 3000), `${label}: all retained activity arrives`);
      assert.deepEqual(await rows(), expected, `${label}: exactly one missing-key row, all unrelated activity, newest first`);
      // Every row can be brought into view without being covered, including the oldest missing-key notice.
      for (let i = 1; i <= expected.length; i++) await reach(`.shell-history-entry:nth-child(${i}) .shell-history-text`, `History row ${i}`);
      const undo = await evaluate(`(() => { const row = [...document.querySelectorAll('.shell-history-entry')].find(e => e.textContent.includes(${JSON.stringify(landing.text)})); return [...row.querySelectorAll('button')].map(e => e.textContent); })()`);
      assert.ok(undo.includes("Show") && undo.includes("Undo"), `${label}: landing keeps Show and Undo`);
      await reach(`${rail} .shell-rail-close`, "History's close control");
      await evaluate(`document.querySelector('.shell-tabpanel').scrollTop = 0; window.scrollTo(0, 0)`);
      await sleep(350);
      assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
      assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI`);
      assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: no sideways overflow`);
      if (shots) {
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `history-open-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      }
      // The next answer repeats the missing-key notice after unrelated activity. Its Undo belongs to that older
      // retained row, not to the newest refusal; exercise attachment and the real button through the socket.
      await live(rawMissing, "notice", hosted ? "Listening unavailable" : "No AI key");
      core.send({ type: "undoable", id: 201 });
      const missingUndo = ".shell-history-entry:last-child .shell-history-meta button";
      const attached = await until(`!!document.querySelector(${JSON.stringify(missingUndo)})`, 3000);
      if (!attached) console.error("history Undo diagnostic", JSON.stringify({ received: received.slice(-6), rows: await evaluate(`[...document.querySelectorAll('.shell-history-entry')].map(row=>({text:row.querySelector('.shell-history-text')?.textContent,buttons:[...row.querySelectorAll('button')].map(button=>({label:button.textContent,disabled:button.disabled}))}))`) }));
      assert.ok(attached, `${label}: the coalesced notice gets Undo`);
      assert.deepEqual(await rows(), expected, `${label}: attaching Undo does not move or duplicate the missing-key row`);
      assert.equal(await evaluate(`document.querySelector('.shell-history-entry:first-child .shell-history-meta button') === null`), true, `${label}: refusal does not receive the coalesced notice's Undo`);
      await tap(missingUndo, "the coalesced notice's Undo");
      for (let waited = 0; waited < 2000 && !core.heard.some((m) => m.type === "undo" && m.id === 201); waited += 50) await sleep(50);
      assert.ok(core.heard.some((m) => m.type === "undo" && m.id === 201), `${label}: the coalesced row's Undo reaches the core`);
      await tap(`${rail} .shell-rail-close`, "History's close control");
      await railIs(false);
      await press("y"); await railIs(true);
      assert.deepEqual(await rows(), expected, `${label}: reopening retains the same entries`);
      await press("Escape"); await railIs(false);
      runs++;
      await browser.close(); browser = null;
      core.close(); core = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core?.close();
}
console.log(`history-key-once-check: ok (${runs} page runs; local and hosted, laptop and phone, light and dark; retention, ordering, Undo and live notices)`);
