// No extra dependencies: run with `node scripts/onscreen-check.mjs` (after the UI is built; precheck builds it first).
// Popovers stay whole on screen (ui/src/onscreen.ts): the Room menu, the "?" list and a point's Move list, opened in
// headless Chrome over a stand-in core (scripts/headless.mjs) at phone and laptop widths, under the laptop's header and
// the hosted site's. Each must lie inside the screen with a 16 px side gutter, be on top where it's drawn, survive a
// resize while open, and still close on Esc with focus back on its button. On an iPhone the Room menu ran 120 px past
// the screen's left edge, anchored to a button that sits near the left there.
// `SHOTS=<folder> node scripts/onscreen-check.mjs` also saves the Room menu at 390 × 844, light and dark.
// Exit 3 (skipped) when this machine has no Chrome or ui/dist.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP onscreen-check: ${why}`); process.exit(3); }

const GUTTER = 16;
const WIDTHS = [320, 375, 390, 430, 1440];
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
const world = {
  threads: [thread("T1", "Rent Due Friday"), thread("T2", "Garden Plans"), thread("T3", "Trip to Lisbon")],
  thoughts: [thought("a", "Rent is due Friday", "T1"), thought("b", "Plant the tomatoes this weekend", "T2"), thought("c", "Book the flights", "T3")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};

// Every popover: how to open it, the panel, and its button (where Esc must put focus back).
const POPOVERS = {
  room: { panel: ".room-panel", button: ".room-menu summary", open: `document.querySelector(".room-menu summary").click()` },
  help: { panel: ".keyboard-hint", button: ".shortcuts summary", open: `document.querySelector(".shortcuts summary").click()` },
  move: {
    panel: ".move-menu", button: "#thread-T1 .move-button:not(.delete-button)",
    open: `(() => { const b = document.querySelector("#thread-T1 .move-button:not(.delete-button)"); b.closest("li").scrollIntoView({ block: "center" }); b.click(); })()`,
  },
};

const failures = [];
const shots = process.env.SHOTS;

for (const hosted of [false, true]) {
  const header = hosted ? "hosted" : "local";
  const core = await standInCore(() => [{ type: "snapshot", world }], { door: { room: true, member: true, hosted } });
  const page = await openPage(`http://127.0.0.1:${core.port}/`, { width: 1440, height: 900 });
  const { evaluate, until, page: cdp } = page;
  const size = async (width, height) => {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await settled();
  };
  // The map's cards glide and fade into place after a resize (motion's layout animations): measure once they rest, as
  // a person opening a menu would.
  const settled = () => until(`[...document.querySelectorAll(".thread")].every((card) => { const c = getComputedStyle(card); return c.opacity === "1" && c.transform === "none"; })`, 5000);
  // Where a popover lies, after the frame it opened in and the one after (what a person sees).
  const measure = (selector) => evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return resolve(null);
    const r = el.getBoundingClientRect(), w = document.documentElement.clientWidth, h = innerHeight;
    const probe = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, Math.min(r.bottom, h) - 4], [(r.left + r.right) / 2, (r.top + Math.min(r.bottom, h)) / 2]];
    const over = probe.map(([x, y]) => x < 0 || x > w || y < 0 || y > h ? null : document.elementFromPoint(x, y))
      .find((hit) => hit && !el.contains(hit));
    const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").filter(Boolean).join(".") : "");
    const by = over ? [over, ...(function* () { for (let e = over.parentElement; e && e !== document.body; e = e.parentElement) yield e; })()].slice(0, 3).map(name).join(" < ") : "";
    resolve({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, w, h, by });
  })))`);
  const check = (what, box) => {
    if (!box) return failures.push(`${what}: didn't open`);
    const out = [];
    if (box.left < 0 || box.right > box.w || box.top < 0 || box.bottom > box.h) out.push(`outside the screen (left ${box.left.toFixed(0)}, right ${box.right.toFixed(0)} of ${box.w}, top ${box.top.toFixed(0)}, bottom ${box.bottom.toFixed(0)} of ${box.h})`);
    // Within a pixel: a panel as wide as the screen less both gutters lands on a fractional left edge.
    else if (box.left < GUTTER - 1 || box.right > box.w - GUTTER + 1) out.push(`inside the ${GUTTER} px gutter (left ${box.left.toFixed(0)}, right ${box.right.toFixed(0)} of ${box.w})`);
    if (box.by) out.push(`covered where it's drawn, by ${box.by}`);
    for (const o of out) failures.push(`${what}: ${o}`);
  };
  // Esc closes it and puts focus back on its button (the popovers' own keys, unchanged by the shift).
  const escape = async (name) => {
    const { panel, button } = POPOVERS[name];
    await evaluate(`(() => { const t = document.querySelector(${JSON.stringify(panel)} + " input") ?? document.querySelector(${JSON.stringify(button)});
      t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); })()`);
    const closed = await until(`(() => { const el = document.querySelector(${JSON.stringify(panel)}); return !el || !el.checkVisibility(); })()`, 2000);
    const back = await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button)})`);
    if (!closed || !back) failures.push(`${header} ${name}: Esc ${closed ? "closes it but focus isn't back on its button" : "doesn't close it"}`);
  };
  try {
    // In a room, as a window that already joined.
    assert.ok(await until(`document.readyState === "complete"`, 10000));
    await evaluate(`sessionStorage.setItem("e2a2o.joined", "Sam"); location.reload()`).catch(() => {});
    await sleep(300);
    assert.ok(await until(`!!document.querySelector(".room-menu summary") && !!document.querySelector("#thread-T1 .move-button")`, 10000), `${header}: the map loads in a room, with points`);

    for (const width of WIDTHS) {
      const height = width < 768 ? 844 : 900;
      await size(width, height);
      for (const name of Object.keys(POPOVERS)) {
        await evaluate(`scrollTo(0, 0)`);
        await settled();
        await evaluate(POPOVERS[name].open);
        check(`${header} ${width}px ${name}`, await measure(POPOVERS[name].panel));
        await escape(name);
      }
    }
    // Open on a laptop, then the window narrows to a phone's: it follows.
    await size(1440, 900);
    await evaluate(POPOVERS.room.open);
    await measure(POPOVERS.room.panel);
    await size(320, 640);
    check(`${header} room, resized 1440 → 320 while open`, await measure(POPOVERS.room.panel));
    await escape("room");

    if (shots && !hosted) {
      mkdirSync(shots, { recursive: true });
      for (const scheme of ["light", "dark"]) {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: scheme }] });
        await size(390, 844);
        await evaluate(`scrollTo(0, 0)`);
        await evaluate(POPOVERS.room.open);
        await measure(POPOVERS.room.panel);
        await sleep(400);
        const { data } = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `room-menu-390x844-${scheme}.png`), Buffer.from(data, "base64"));
        await escape("room");
      }
    }
  } finally {
    await page.close();
    core.close();
  }
}

if (failures.length) {
  console.log(`onscreen-check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`onscreen-check: ok (${Object.keys(POPOVERS).length} popovers × ${WIDTHS.length} widths × 2 headers)`);
