// Bounded shell regression check: built UI, synthetic map, throwaway browser profiles and a stand-in core only.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.error(`SKIP wb-features-check: ${why}`); process.exit(3); }
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, thread_id, text) => ({ id, thread_id, text, point: text, speaker: "you", placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const world = {
  threads: [thread("T1", "Fixture plan"), thread("T2", "Fixture picnic")],
  thoughts: [thought("p1", "T1", "Review the synthetic plan"), thought("p2", "T1", "Bring the fixture notes"), thought("p3", "T2", "Pack the folding chairs")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], ai: ["Fixture helper"],
};
const core = await standInCore(() => [{ type: "snapshot", world }]);
const timeout = setTimeout(() => { console.error("wb-features-check: timed out"); process.exit(1); }, 120_000);
try {
  for (const [host, phone] of [["127.0.0.1", false], ["wb-features.test", false], ["127.0.0.1", true]]) {
    const browser = await openPage("about:blank", { width: phone ? 390 : 1440, height: phone ? 844 : 900,
      chromeArgs: ["--no-proxy-server", "--host-resolver-rules=MAP wb-features.test 127.0.0.1"] });
    try {
      const { page, evaluate, until } = browser;
      const check = async (expression, message) => assert.ok(await until(expression, 8000), `${host}/${phone ? "phone" : "desktop"}: ${message}`);
      const key = async (key, code, vk) => {
        for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
      };
      const focusBody = () => evaluate('(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); document.activeElement?.blur(); })()');
      const catalog = async () => {
        await evaluate('document.querySelector("[data-guide=catalog]").click()');
        await check('!!document.querySelector(".shell-rail .shell-catalog")', "Features opens");
      };
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.setItem("e2a2o.toured", "1");
        localStorage.setItem("e2a2o.brick.keys.hinted", "1");
        localStorage.setItem("e2a2o.features", JSON.stringify({ import: true, recap: true }));
        localStorage.setItem("e2a2o.bricks", JSON.stringify({ keys: false }));
        window.wb = { errors: [], later: 0 };
        addEventListener("error", e => { if (!e.message?.startsWith("ResizeObserver loop")) wb.errors.push(e.message); });
        addEventListener("unhandledrejection", e => wb.errors.push(String(e.reason)));
      ` });
      await page("Emulation.setDeviceMetricsOverride", { width: phone ? 390 : 1440, height: phone ? 844 : 900, deviceScaleFactor: 1, mobile: phone });
      await page("Page.navigate", { url: `http://${host}:${core.port}/?shell=2` });
      await check('!!document.querySelector(".app.shell .spine-ready .spine-text") && !!window.e2a2oHold', "mounted populated shell");
      await evaluate('document.querySelector(".tour-skip")?.click()');

      if (phone) {
        // Generic fallback card: opening must neither invoke Later nor remove its question.
        await evaluate('e2a2oHold({ id: "wb-generic", by: "Fixture", main: "Which fixture day?", later: () => wb.later++ })');
        await check('!!document.querySelector(".shell-held-chip[aria-expanded=false]")', "generic phone chip closed");
        assert.match(await evaluate('document.querySelector(".shell-held-chip").getAttribute("aria-label")'), /1 waiting/);
        await focusBody();
        await key("l", "KeyL", 76);
        await check('!!document.querySelector("[data-held-id=wb-generic]")', "L opens generic stack");
        assert.equal(await evaluate('wb.later'), 0, "opening generic stack does not call Later");
        assert.match(await evaluate('document.querySelector("[data-held-id=wb-generic]").textContent'), /Which fixture day/);
        await key("l", "KeyL", 76);
        await check('!document.querySelector("[data-held-id=wb-generic]")', "visible generic Later removes card");
        assert.equal(await evaluate('wb.later'), 1, "generic Later acts once");

        // Supplied Guide card: use its existing state machine and public synthetic hold message.
        await evaluate(`(() => {
          const field = document.querySelector('.shell-composer textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'fixture draft');
          field.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        core.send({ type: "guide", kind: "hold", target: null, text: "Keep the fixture date, or move it?", by: "Fixture helper", at_ms: now });
        await check('!!document.querySelector(".shell-held-chip[aria-expanded=false]")', "supplied phone chip closed");
        await focusBody();
        await key("l", "KeyL", 76);
        await check('document.querySelector(".guide-held-card")?.dataset.state === "waiting"', "L reveals supplied card without Later");
        const id = await evaluate('document.querySelector("[data-held-id]").dataset.heldId');
        await key("l", "KeyL", 76);
        await check('document.querySelector(".guide-held-card")?.dataset.state === "later"', "visible supplied Later retains its contract");
        assert.equal(await evaluate('document.querySelector("[data-held-id]").dataset.heldId'), id, "supplied question retained");
        assert.equal(core.heard.filter(m => m.type === "answer").length, 0, "neither Later answers");
      } else {
        await catalog();
        const local = host === "127.0.0.1";
        assert.deepEqual(await evaluate(`(() => {
          const row = document.querySelector('.shell-rail [data-row=import]'), control = row.querySelector('[role=switch]');
          return [control.disabled, control.getAttribute('aria-checked'), row.querySelector('[id=reason-import]')?.textContent ?? null,
            !!document.querySelector('[data-guide=import]'), JSON.parse(localStorage.getItem('e2a2o.features')).import];
        })()`), local ? [false, "true", null, true, true] : [true, "false", "Available on the computer running E2A2O", false, true], "Import effective state, entry, reason and stored preference");
        if (!local) {
          const readableImport = async width => {
            await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
            await evaluate('(async () => { const row = document.querySelector(".shell-rail [data-row=import]"); row.scrollIntoView({ block: "center" }); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); })()');
            const geometry = await evaluate(`(() => {
              const row = document.querySelector('.shell-rail [data-row=import]');
              const name = row.querySelector('.shell-catalog-name'), reason = row.querySelector('#reason-import');
              const range = document.createRange(); range.selectNodeContents(name.firstChild);
              const a = name.getBoundingClientRect(), b = range.getBoundingClientRect(), c = reason.getBoundingClientRect(), d = row.getBoundingClientRect();
              return { name: a.width, text: b.width, reasonRight: c.right, nameRight: a.right, reasonBottom: c.bottom, rowBottom: d.bottom };
            })()`);
            assert.ok(geometry.name >= geometry.text - 1, `${width}px: complete Import name remains visible: ${JSON.stringify(geometry)}`);
            assert.ok(geometry.reasonRight <= geometry.nameRight + 1 && geometry.reasonBottom <= geometry.rowBottom + 1, `${width}px: complete reason fits inside its row`);
            if (process.env.WB_FEATURES_SCREENSHOTS) {
              mkdirSync(process.env.WB_FEATURES_SCREENSHOTS, { recursive: true });
              const screenshot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
              writeFileSync(join(process.env.WB_FEATURES_SCREENSHOTS, `import-${width}.png`), Buffer.from(screenshot.data, "base64"));
            }
          };
          await readableImport(1440);
          await readableImport(390);
          await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        }
        const count = () => evaluate('document.querySelector(".shell-rail .shell-lead").textContent');
        const before = await count();
        await evaluate(`localStorage.setItem('e2a2o.features', JSON.stringify({ import: false, recap: true })); dispatchEvent(new StorageEvent('storage', { key: 'e2a2o.features' }))`);
        await check(`document.querySelector('.shell-rail [data-row=import] [role=switch]').getAttribute('aria-checked') === 'false'`, "stored-off reflected");
        const after = await count();
        const enabled = text => Number(text.match(/(\d+) of \d+ on/)[1]);
        assert.equal(enabled(before) - enabled(after), local ? 1 : 0, "unavailable Import never contributes to enabled count");
        await evaluate(`localStorage.setItem('e2a2o.features', JSON.stringify({ import: true, recap: true })); dispatchEvent(new StorageEvent('storage', { key: 'e2a2o.features' }))`);
        await check(`document.querySelector('.shell-rail .shell-lead').textContent === ${JSON.stringify(before)}`, "preference restored in fixture");
        assert.equal(await evaluate('document.querySelectorAll(".shell-rail [id^=reason-]").length'), local ? 0 : 1, "only unavailable Import gets a reason");

        // Every reference term carries the actual key in DOM and the accessibility tree.
        await evaluate('document.querySelector("[data-tab=settings]").click()');
        await check('document.querySelectorAll(".shell-keys dt").length > 0', "shortcut reference mounted");
        const terms = await evaluate('[...document.querySelectorAll(".shell-keys dt")].map(dt => ({ text: dt.textContent, key: dt.querySelector("kbd")?.textContent, hidden: !!dt.querySelector("[aria-hidden=true]") }))');
        const ax = await page("Accessibility.getFullAXTree");
        for (const term of terms) {
          assert.ok(term.key && term.text === term.key && !term.hidden, "each shortcut term has accessible kbd text");
          assert.ok(ax.nodes.some(n => !n.ignored && n.name?.value === term.key), `accessibility tree contains ${term.key}`);
        }
        if (!local) {
          assert.deepEqual(await evaluate('wb.errors'), [], "no nonloopback fixture page errors");
          continue;
        }

        await evaluate('document.querySelector(".shell-rail-close").click()');
        await check('!document.querySelector(".shell-rail")', "rail closes");
        const recaps = () => core.heard.filter(m => m.type === "recap").length;
        const initialRecaps = recaps();
        await evaluate('document.querySelector(".spine-text").focus()');
        await key("r", "KeyR", 82);
        await check('!!document.querySelector(".spine-reply-field")', "point R opens Reply");
        await sleep(100);
        assert.equal(recaps(), initialRecaps, "consumed R emits no Recap request");
        await key("Escape", "Escape", 27);
        await check('!document.querySelector(".spine-reply-field")', "Reply closes");
        await focusBody();
        await evaluate('document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true, isComposing: true }))');
        await sleep(100);
        assert.equal(recaps(), initialRecaps, "composing R emits nothing");

        // Switch on the existing Keys brick only in this throwaway profile.
        await evaluate(`localStorage.setItem('e2a2o.bricks', JSON.stringify({ keys: true })); dispatchEvent(new StorageEvent('storage', { key: 'e2a2o.bricks' }))`);
        // The lazy brick may remain in Suspense briefly after its wrapper mounts.
        await sleep(500);
        await focusBody();
        await key("?", "Slash", 191);
        await check('!!document.querySelector(".keys-panel")', "Keys listener mounted");
        await key("Escape", "Escape", 27);
        await catalog();
        await evaluate('document.querySelector("[data-tab=catalog]").focus()');
        await key("ArrowRight", "ArrowRight", 39);
        await check('document.activeElement?.dataset.tab === "settings"', "rail tab arrows stay in rail");
        assert.equal(await evaluate('!!document.querySelector(".keys-panel")'), false, "tab arrow does not select map");
        await evaluate('document.querySelector("[data-tab=catalog]").click()');
        await evaluate('document.querySelector(".shell-rail [role=switch]:not(:disabled)").focus()');
        const first = await evaluate('document.activeElement.getAttribute("aria-label")');
        await key("ArrowDown", "ArrowDown", 40);
        assert.notEqual(await evaluate('document.activeElement.getAttribute("aria-label")'), first, "rail switch arrow moves focus");
        assert.equal(await evaluate('!!document.querySelector(".keys-panel")'), false, "switch arrow leaves map selection unchanged");

        // Keep the existing Cards row's order/text and On -> Show -> close sequence.
        const rowOrder = await evaluate('[...document.querySelectorAll(".shell-rail [data-row]")].map(r => r.dataset.row)');
        const cardsName = await evaluate('document.querySelector(".shell-rail [data-row=cards] .shell-catalog-name").textContent');
        await evaluate('document.querySelector(".shell-rail [data-row=cards] [role=switch]").click()');
        await check('!!document.querySelector(".shell-rail [data-row=cards] button.shell-link")', "Cards On exposes Show");
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".shell-rail [data-row]")].map(r => r.dataset.row)'), rowOrder, "row order unchanged");
        assert.equal(await evaluate('document.querySelector(".shell-rail [data-row=cards] .shell-catalog-name").textContent'), cardsName, "Cards row text unchanged");
        await evaluate('document.querySelector(".shell-rail [data-row=cards] button.shell-link").click()');
        await check('!!document.querySelector("main.map[aria-label=Cards]") && !document.querySelector(".shell-rail")', "Show opens Cards and closes rail");
        await focusBody();
        await key("ArrowDown", "ArrowDown", 40);
        await check('!!document.querySelector(".keys-panel")', "outside rail Keys navigation remains");
        await key("Escape", "Escape", 27);
        await focusBody();
        await key("r", "KeyR", 82);
        await sleep(100);
        assert.equal(recaps(), initialRecaps + 1, "unconsumed R still requests Recap once");
      }
      assert.deepEqual(await evaluate('wb.errors'), [], "no fixture page errors");
    } finally { await browser.close(); }
  }
  console.log("wb-features-check: ok (Reply/Recap, composition, phone Held supplied/fallback, rail Keys, Import availability/count, shortcut accessibility, Cards Show)");
} finally { clearTimeout(timeout); core.close(); }
