// Built UI, synthetic thoughts, isolated Chrome. Never requests microphone access.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ready, standInCore, openPage } from "./headless.mjs";

if (ready()) { console.log(`SKIP spine-look-check: ${ready()}`); process.exit(3); }
const now = Date.now();
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (n, thread_id = "T1") => ({ id: `p${n}`, thread_id, speaker: "you", text: `Thought ${n}: leave room for the next idea.`, point: `Thought ${n}: leave room for the next idea.`, complete: true, placed: true, at_ms: now + n, place_ms: 0 });
const initial = { threads: [topic("T1", "A little room"), topic("T2", "A tangent", "T1")], thoughts: [thought(1), thought(2), thought(3), thought(4, "T2")], active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, notes: {}, recaps: [], proposals: [], positions: {} };
let world = structuredClone(initial);
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [320, 844], [3840, 2160]]) {
    world = structuredClone(initial);
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured','1'); window.errors=[];
      navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone forbidden in this check')};
      addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const navigate = async () => {
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
      assert.ok(await until(`!!document.querySelector('.spine-ready [data-thought="p3"]')`), "Canvas ready");
    };
    const key = async key => { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 27, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); };
    const toggle = async expected => {
      await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
      assert.ok(await until(`!!document.querySelector('[data-row="loose-topics"] [role="switch"]')`));
      await evaluate(`document.querySelector('[data-row="loose-topics"] [role="switch"]').focus()`);
      await key("Enter");
      assert.ok(await until(`document.querySelector('[data-row="loose-topics"] [role="switch"]').getAttribute('aria-checked')==='${expected}'`), "keyboard switches the part");
      await key("Escape");
      assert.ok(await until(`!document.querySelector('.shell-catalog')`));
    };
    const positions = () => evaluate(`Object.fromEntries(['p1','p2','p3'].map(id=>[id, document.querySelector('[data-id="p:'+id+'"]').style.transform]))`);
    await navigate();
    assert.equal(await evaluate(`!!document.querySelector('.spine-loose')`), false, "off by default");
    const ordinary = await positions();
    const straight = await evaluate(`document.querySelector('.spine-link-spine').getAttribute('d')`);
    await toggle(true);
    assert.ok(await until(`!!document.querySelector('.spine-loose')`));
    const loose = await positions();
    assert.notDeepEqual(loose, ordinary, "thoughts have gentle offsets");
    assert.ok(await evaluate(`(() => { const es=['p1','p2','p3'].map(id=>document.querySelector('[data-id="p:'+id+'"]').getBoundingClientRect()); return es.every((r,i)=>!i||r.top>=es[i-1].bottom); })()`), "thoughts read top to bottom without overlap");
    await evaluate(`document.activeElement?.blur(); document.querySelector('.spine-frame').dispatchEvent(new PointerEvent('pointerleave',{bubbles:false}))`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.spine-link-spine')).opacity`), "0", "quiet canvas has no spine line");
    await evaluate(`document.querySelector('[data-thought="p3"] .spine-text').focus()`);
    assert.ok(await until(`+getComputedStyle(document.querySelector('.spine-link-spine')).opacity>0`), "keyboard focus reveals connection");
    assert.match(await evaluate(`document.querySelector('.spine-link-spine').getAttribute('d')`), /C/, "revealed thread curves through markers");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.spine-link-spine')).animationName`), "none", "reduced motion has no thread animation");
    assert.ok(await evaluate(`!!document.querySelector('.spine-link-branch, .spine-tuck-tangent')`), "tangent keeps its connection");
    await evaluate(`document.activeElement?.blur()`);
    const spot = await evaluate(`(() => {const r=document.querySelector('[data-thought="p3"] .spine-text').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...spot });
    assert.ok(await until(`+getComputedStyle(document.querySelector('.spine-link-spine')).opacity>0`), "pointer hover reveals thread too");
    world.thoughts.push(thought(5));
    core.send({ type: "change", change: { type: "thought_added", thought: thought(5) } });
    assert.ok(await until(`!!document.querySelector('[data-thought="p5"]')`));
    assert.deepEqual(await positions(), loose, "arrival leaves earlier thoughts exactly where they were");
    await navigate();
    assert.ok(await evaluate(`!!document.querySelector('.spine-loose')`), "choice survives reload");
    if (width === 3840) {
      const size = await evaluate(`(() => {const e=document.querySelector('[data-thought="p5"] .spine-text');return e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight)*parseFloat(getComputedStyle(e).fontSize)})()`);
      assert.ok(size >= 44, `4K reading size at least 44 screen pixels: ${size}`);
    }
    if (shots) writeFileSync(`${shots}/loose-${width}.png`, Buffer.from((await page("Page.captureScreenshot", { format: "png" })).data, "base64"));
    if (width > 560) {
      await evaluate(`document.querySelector('[data-thread="T2"] .spine-card-face').focus()`);
      await key("Enter");
      assert.ok(await until(`document.querySelector('[data-thread="T2"] .spine-card-face').getAttribute('aria-expanded')==='true'`), "tangent opens by keyboard");
      await key("Enter");
      assert.ok(await until(`document.querySelector('[data-thread="T2"] .spine-card-face').getAttribute('aria-expanded')==='false'`), "tangent folds by keyboard");
      await evaluate(`document.querySelector('.spine-follow').click()`);
      assert.ok(await until(`(() => {const r=document.querySelector('[data-thought="p5"] .spine-text').getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight&&r.left>=0&&r.right<=innerWidth})()`), "Follow returns to the newest thought");
    }
    const beforeReconnect = await positions();
    core.drop();
    for (let tries=0; !core.connected() && tries<200; tries++) await new Promise(resolve=>setTimeout(resolve, 50));
    assert.ok(core.connected(), "core reconnects");
    assert.ok(await until(`!!document.querySelector('.spine-loose [data-thought="p5"]')`));
    assert.deepEqual(await positions(), beforeReconnect, "reconnect keeps thought positions");
    await toggle(false);
    assert.ok(await until(`!document.querySelector('.spine-loose')`));
    world = structuredClone(initial);
    await navigate();
    assert.deepEqual(await positions(), ordinary, "off restores original thought positions");
    assert.equal(await evaluate(`document.querySelector('.spine-link-spine').getAttribute('d')`), straight, "off restores straight spine");
    assert.deepEqual(await evaluate("errors"), []);
    await browser.close(); browser = null;
  }
  console.log("PASS spine-look: defaults, keyboard switch, order, thread, tangent, stable arrival, reload, 320/1440/4K, reduced motion");
} finally { await browser?.close(); core.close(); }
