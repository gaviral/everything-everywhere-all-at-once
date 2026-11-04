// Built UI, isolated browser storage and synthetic core only. No model, accounts or real microphone.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { ready, standInCore, openPage, sleep } = await import(process.env.FIXTURE_HELPER ?? "./headless.mjs");
if (ready()) throw new Error(ready());
const geometryOnly = process.argv.includes("--geometry");
const label = process.env.LABEL ?? "recovery";
const shots = process.env.SHOTS ?? "data/catalog-switch-discovery/recovery";
mkdirSync(shots, { recursive: true });
const now = 1793750400000;
const world = {
  threads: [{ id: "T1", title: "Synthetic project", parent_id: null, status: "open", last_point: "Third synthetic thought", touched_ms: now, tags: [], picture: null, dropped_by: "" }],
  thoughts: ["First synthetic thought", "Second synthetic thought", "Third synthetic thought"].map((text, i) => ({ id: `p${i + 1}`, speaker: "you", text, point: text, thread_id: "T1", placed: true, complete: true, at_ms: now + i, place_ms: 0 })),
  active: "T1", active_by: { you: "T1" }, stay_here: "T1", anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, recaps: [], proposals: [], ai: [], apps: [], apps_seeded: true,
};
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(![4360, 4399].includes(core.port));
const base = `http://127.0.0.1:${core.port}/`;
const report = [];
let browser;
function geometry() {
  const box = (e) => { const r = e?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };
  const frame = document.querySelector(".spine-frame");
  const visible = (e) => {
    if (!e?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return false;
    const r = e.getBoundingClientRect(), f = frame?.getBoundingClientRect();
    return !!f && f.width > 0 && r.width > 0 && r.height > 0 && r.right > Math.max(0, f.left) && r.left < Math.min(innerWidth, f.right) && r.bottom > Math.max(0, f.top) && r.top < Math.min(innerHeight, f.bottom);
  };
  const topic = document.querySelector('.react-flow__node[data-id="t:T1"] .spine-title');
  return { frame: box(frame), frameVisible: visible(frame), camera: document.querySelector(".react-flow__viewport")?.style.transform,
    topic: { box: box(topic), visible: visible(topic), text: topic?.textContent },
    points: ["p1", "p2", "p3"].map(id => { const e = document.querySelector(`.react-flow__node[data-id="p:${id}"] .spine-text`); return { id, text: e?.textContent, box: box(e), visible: visible(e) }; }),
    focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
    images: [...document.images].map(e => ({ complete: e.complete, width: e.naturalWidth })),
  };
}
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const route of ["", "?shell=2", "?film", "?recording", "?demo", "?shell=1", "?remote"]) {
      const ordinary = ["", "?shell=2"].includes(route);
      for (const organized of ordinary && !geometryOnly ? [false, true] : [false]) {
        const name = `${width}-${route.slice(1).replaceAll("=", "-") || "default"}-${organized ? "organized" : "original"}`;
        browser = await openPage("about:blank", { width, height });
        const { page, evaluate, until } = browser;
        await page("Page.enable");
        await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
        await page("Page.addScriptToEvaluateOnNewDocument", { source: `if(!sessionStorage.getItem('catalog-check-seeded')) { localStorage.clear(); localStorage.setItem('e2a2o.toured','1');
          ${organized || !ordinary ? "localStorage.setItem('e2a2o.catalog-organization','true');" : ""}
          sessionStorage.setItem('catalog-check-seeded','1'); }
          window.checkErrors=[]; window.mediaAttempts=0;
          addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) checkErrors.push(e.message)});
          addEventListener('unhandledrejection',e=>checkErrors.push(String(e.reason)));
          if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.mediaAttempts++;return Promise.reject(new Error('Synthetic check: no microphone'))};` });
        const snap = async (step) => {
          const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          const png = Buffer.from(data, "base64");
          assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
          const file = join(shots, `${name}-${step}.png`);
          writeFileSync(file, png);
          const state = await evaluate(`(${geometry})()`);
          report.push({ name, step, file, ...state });
          return state;
        };
        const click = async (selector, scroll = false) => {
          const at = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing '+${JSON.stringify(selector)});
            ${scroll ? "e.scrollIntoView({block:'nearest',behavior:'instant'});" : ""}
            const r=e.getBoundingClientRect(), x=r.left+r.width/2,y=r.top+r.height/2;
            return {x,y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y)),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}; })()`);
          assert.ok(at.hit && at.inside && at.width > 0 && at.height > 0, `${name}: reachable ${selector}: ${JSON.stringify(at)}`);
          for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
          await sleep(100);
        };
        const type = (selector, value) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        const key = async (key, code, virtual) => { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: virtual }); };
        const draft = () => evaluate(`(()=>{const e=document.querySelector('textarea');return [e.value,e.selectionStart,e.selectionEnd,e.selectionDirection]})()`);
        await page("Page.navigate", { url: base + route });
        assert.ok(await until(`!!document.querySelector(${JSON.stringify(route === "?remote" ? "#root *" : ".spine-ready")})`, 15000), `${name}: ready`);
        await evaluate("document.fonts.ready.then(()=>true)");
        await sleep(800);
        const initial = await snap("initial");
        if (geometryOnly) { await browser.close(); browser = null; continue; }
        const visibleCanvas = async (step, visible = true) => {
          const state = await snap(step);
          assert.equal(state.frameVisible, visible, `${name}: ${step} Canvas visibility`);
          assert.ok(state.frame.width > 0 && state.frame.height > 0, `${name}: ${step} positive Canvas bounds`);
          assert.equal(state.topic.text, "Synthetic project");
          assert.deepEqual(state.points.map(p => [p.id, p.text]), world.thoughts.map(p => [p.id, `you${p.text}`]), `${name}: exact identities (including the screen-reader speaker)`);
          if (visible) assert.ok(state.topic.visible && state.points.every(p => p.visible), `${name}: ${step} visible topic/thought bounds`);
          assert.ok(state.images.every(i => i.complete && i.width > 0), `${name}: loaded images`);
          return state;
        };
        if (!ordinary) {
          assert.equal(await evaluate(`!!document.querySelector('[data-catalog-preference], [data-organized-catalog]')`), false);
          if (route !== "?remote") {
            assert.ok(initial.frame.width > 0 && initial.frameVisible && initial.topic.visible && initial.points.every(p => p.visible), `${name}: excluded route visible Canvas`);
            if (route !== "?shell=1") {
              await click('[data-guide="catalog"]');
              assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]')`));
              assert.equal(await evaluate(`!!document.querySelector('[data-catalog-preference], [data-organized-catalog]')`), false);
              await snap("features");
              await key("Escape", "Escape", 27);
              assert.ok(await until(`!document.querySelector('[data-slot="rail"]')`));
              assert.equal((await visibleCanvas("return")).camera, initial.camera);
            }
          }
          await browser.close(); browser = null; continue;
        }
        await visibleCanvas("visible");
        // A small real pan proves Show/Back retains a chosen place, rather than resetting to the default.
        for (const event of [{type:"mousePressed",x:20,y:120,buttons:1},{type:"mouseMoved",x:35,y:135,buttons:1},{type:"mouseReleased",x:35,y:135,buttons:0}])
          await page("Input.dispatchMouseEvent", { ...event, button:"left", clickCount:1 });
        await sleep(350);
        const before = await evaluate(`(${geometry})()`);
        assert.notEqual(before.camera, initial.camera, `${name}: pan changes camera`);
        await type("textarea", "Keep this synthetic unsent draft exactly.");
        await evaluate(`document.querySelector('textarea').focus();document.querySelector('textarea').setSelectionRange(5,22,'backward')`);
        const expected = await draft();
        const intact = async (step, visible = true) => {
          assert.deepEqual(await draft(), expected, `${name}: ${step} exact draft and selection`);
          const state = await visibleCanvas(step, visible);
          assert.equal(state.camera, before.camera, `${name}: ${step} exact camera/place`);
        };
        await click('[data-guide="catalog"]');
        assert.ok(await until(`!!document.querySelector('[data-catalog-preference] button')`));
        assert.equal(await evaluate(`document.querySelector('[data-catalog-preference] button').getAttribute('aria-checked')`), String(organized));
        assert.equal(await evaluate(`document.querySelector('.shell-tabpanel').scrollTop`), 0, `${name}: initial panel unscrolled`);
        assert.ok(await evaluate(`(()=>{const buttons=document.querySelectorAll('[data-catalog-preference] button');if(buttons.length!==1)return false;
          const e=buttons[0],r=e.getBoundingClientRect();return r.width>0&&r.height>=32&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()`), `${name}: one opening preference, visible and hittable without scrolling`);
        // This click deliberately does not scroll: the opening preference must be in the initial viewport.
        await intact("opening-switch");
        if (!organized) {
          await click('[data-catalog-preference] button');
          assert.ok(await until(`!!document.querySelector('[data-organized-catalog] input')`));
          await click('[data-catalog-preference] button');
          assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]')`));
        } else {
          assert.ok(await until(`!!document.querySelector('[data-organized-catalog] input')`));
          await type('[data-organized-catalog] input', "List view");
          assert.ok(await until(`document.querySelectorAll('[data-organized-catalog] [data-row]').length===1`));
          await click('[data-catalog-focus="inspect-cards"]');
          assert.ok(await until(`!!document.querySelector('[data-detail="cards"]')`));
        }
        const cards = organized ? '.organized-detail' : '[data-row="cards"]';
        await click(`${cards} [role="switch"]`, true);
        assert.ok(await until(`document.querySelector(${JSON.stringify(cards + ' [role="switch"]')})?.getAttribute('aria-checked')==='true'`));
        await intact("cards-on");
        await click(organized ? '.organized-detail .organized-actions button:last-child' : '[data-row="cards"] .shell-link', true);
        assert.ok(await until(`!!document.querySelector('main[aria-label="Cards"]') && !document.querySelector('[data-slot="rail"]')`));
        assert.equal(await evaluate(`document.activeElement===document.querySelector('textarea')`), true);
        await intact("show", false);
        await click('.shell-bl button');
        assert.ok(await until(`!document.querySelector('main[aria-label="Cards"]')`));
        await sleep(700);
        await intact("back-settled");
        assert.equal(await evaluate(`document.activeElement===document.querySelector('textarea')`), true);
        await click('[data-guide="catalog"]');
        assert.ok(await until(`!!document.querySelector(${JSON.stringify(cards + ' [role="switch"]')})`));
        await click(`${cards} [role="switch"]`, true);
        assert.ok(await until(`document.querySelector(${JSON.stringify(cards + ' [role="switch"]')})?.getAttribute('aria-checked')==='false'`));
        if (organized) {
          await click('[data-catalog-focus="back"]');
          assert.ok(await until(`document.activeElement?.dataset.catalogFocus==='inspect-cards'`));
          assert.equal(await evaluate(`document.querySelector('[data-organized-catalog] input').value`), "List view");
          await click('[data-catalog-focus="inspect-cards"]');
          await click('[data-catalog-preference] button');
          assert.ok(await until(`document.activeElement?.closest('[data-row]')?.dataset.row==='cards'`));
        }
        assert.equal(await evaluate(`localStorage.getItem('e2a2o.catalog-organization')`), "false");
        await intact("off-original-restored");
        await key("Escape", "Escape", 27);
        assert.ok(await until(`!document.querySelector('[data-slot="rail"]')`));
        assert.equal(await evaluate(`document.activeElement===document.querySelector('textarea')`), true);
        await intact("keyboard-exit");
        // The same preference survives a reload in each direction; it never replaces fresh-profile defaults.
        await click('[data-guide="catalog"]');
        await click('[data-catalog-preference] button');
        assert.ok(await until(`!!document.querySelector('[data-organized-catalog]')`));
        await page('Page.reload');
        assert.ok(await until(`!!document.querySelector('.spine-ready')`));
        await click('[data-guide="catalog"]');
        assert.ok(await until(`!!document.querySelector('[data-organized-catalog]')`), `${name}: saved organized choice`);
        await click('[data-catalog-preference] button');
        await page('Page.reload');
        assert.ok(await until(`!!document.querySelector('.spine-ready')`));
        await click('[data-guide="catalog"]');
        assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]')`), `${name}: saved original choice`);
        assert.equal(await evaluate("window.mediaAttempts"), 0);
        assert.deepEqual(await evaluate("window.checkErrors"), []);
        console.log(`${name}: visible Canvas; exact camera/draft/selection/IDs; On → Show → Back → Off; focus and hit bounds ok`);
        await browser.close(); browser = null;
      }
    }
  }
  if (process.env.MAIN_GEOMETRY) {
    const main = JSON.parse(readFileSync(process.env.MAIN_GEOMETRY, "utf8"));
    for (const entry of report.filter(r => r.step === "initial")) {
      const reference = main.find(r => r.name === entry.name && r.step === "initial");
      if (!reference || entry.name.endsWith("organized")) continue;
      for (const field of ["frame", "topic", "points"]) assert.deepEqual(entry[field], reference[field], `${entry.name}: main ${field} geometry`);
      assert.equal(entry.camera, reference.camera, `${entry.name}: main camera`);
    }
  }
  assert.deepEqual(core.heard.filter(m => ["text", "compose_app", "run_app", "email_send", "publish", "post"].includes(m.type) || m.type === "listen" && m.on), []);
  console.log(`catalog-switch-discovery-check: ${label} ok; ${report.length} screenshots in ${shots}`);
} finally {
  writeFileSync(join(shots, "geometry.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close(); core.close();
}
