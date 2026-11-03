// Hold the new shell (?shell=2) to its small type scale, keys on controls, one copy of each sentence and state,
// honest mode stamps, AI-only purple, stop-only red, and regions that fit the window. Check first opens and maps
// on a laptop and phone, light and dark (also reduced motion on your map), so features cannot quietly break the
// shell's shared rules. The Catalog and History must also open and close from their keys.
// No dependencies; uses ui/dist and headless.mjs. SHOTS=dir saves shell-<scene>-<width>-<scheme>.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP shell-check: ${why}`); process.exit(3); }

const message = (error) => String(error.message || error).replace(/\s+/g, " ").slice(0, 240);
// A server bind or Chrome startup can fail outside a promise (headless.mjs uses Node's server events).
// Keep those setup failures to the same plain, single-line format as rule failures.
process.once("uncaughtException", (error) => { console.log(`setup: ${message(error)}`); process.exit(1); });

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
const threads = [thread("T1", "Garden plans"), thread("T2", "Weekend picnic"), thread("T3", "Demo recording")];
const empty = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const world = { ...empty, threads, thoughts: threads.map((t, i) => thought(`p${i}`, `A distinct point about ${t.title.toLowerCase()}`, t.id)), active: "T1", active_by: { you: "T1" } };
const scenes = [
  { name: "guest", world: empty, stamp: "GUEST", state: "Mic off", door: { room: false, member: true, hosted: true, sample: true } },
  { name: "no-key", world: empty, stamp: null, state: "No AI key", notice: { type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." } },
  { name: "map", world, stamp: null, state: "Mic off" },
  { name: "sample", world, stamp: "SAMPLE", state: "Mic off", query: "&sample" },
  { name: "demo", world, stamp: "DEMO", state: "Mic off", query: "&demo" },
];

// Kept in the page: measure actual text and controls, not guesses from source files or class names.
function inspect({ stamp, state, width, controlsOnly = false }) {
  const out = new Set();
  const normal = (s) => s.replace(/\s+/g, " ").trim();
  const short = (s) => normal(s).slice(0, 90);
  const slots = ["top-left", "top-right", "stage", "status", "bottom-right", "bottom-left", "rail", "held"];
  const scope = slots.map((s) => `[data-slot="${s}"]`).join(",") + ",.shell-welcome";
  const all = (s) => [...document.querySelectorAll(s)];
  const name = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + ` ${JSON.stringify(short(e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.textContent))}`;
  const where = (e) => e.closest("[data-slot]")?.getAttribute("data-slot") || "welcome";
  const fail = (e, message) => out.add(`${where(e)}: ${message}`);
  const allowed = (e) => !e.closest('.sr-only,[aria-hidden="true"],script,style,template');
  // A rendered rectangle must intersect the viewport and every ancestor that clips it. In particular, the rail's
  // scrolled-away rows and a phone's hidden labels are not visible text or controls.
  const shown = (e, rects = e.getClientRects()) => {
    if (!allowed(e)) return false;
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || Number(s.opacity) === 0 || s.contentVisibility === "hidden") return false;
      if (p === e && (s.visibility === "hidden" || s.visibility === "collapse")) return false;
      if (p !== e) {
        const r = p.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
        if (/(hidden|clip|auto|scroll)/.test(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
      }
    }
    return [...rects].some((r) => r.width > 0 && r.height > 0 && r.right > left && r.left < right && r.bottom > top && r.top < bottom);
  };
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, e = node.parentElement;
    if (!e || !normal(node.textContent) || !allowed(e)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    if (shown(e, range.getClientRects())) textNodes.push(node);
  }
  const type = (e, text) => {
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 11 || ![11, 13, 15, 18, 24, 32].includes(Math.round(px))) fail(e, `type ${px}px on ${JSON.stringify(short(text))}`);
  };
  for (const node of textNodes) if (node.parentElement.closest(scope)) type(node.parentElement, node.textContent);
  for (const e of all("input,textarea")) if (e.closest(scope) && shown(e) && (e.value || e.placeholder)) type(e, e.value || e.placeholder);
  for (const e of all('button,a[href],summary,[role="button"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],input,textarea')) {
    if (!e.closest(scope) || !shown(e) || e.matches(":disabled") || e.closest('[aria-disabled="true"], [inert]')) continue;
    // Keycaps may be aria-hidden: they are a visual key, with a separate accessible control name.
    if (!e.querySelector(".keycap,kbd") && !e.getAttribute("aria-keyshortcuts")?.trim() && !e.closest("[data-key]")) fail(e, `no key on ${name(e)}`);
  }
  if (controlsOnly) return [...out];

  const sentences = new Map();
  for (const node of textNodes) {
    const text = normal(node.textContent).toLowerCase();
    if (text.split(" ").length >= 3) sentences.set(text, (sentences.get(text) || 0) + 1);
  }
  for (const [text, count] of sentences) if (count > 1) out.add(`page: sentence repeated ${count} times ${JSON.stringify(short(text))}`);

  const stamps = all("[data-stamp]");
  if (stamps.length !== (stamp ? 1 : 0)) out.add(`stamp: expected ${stamp || "none"}, found ${stamps.length}`);
  for (const e of stamps) {
    if (!shown(e)) out.add("stamp: hidden");
    if (normal(e.textContent) !== stamp || e.getAttribute("data-stamp") !== stamp) out.add(`stamp: expected ${stamp || "none"}, got ${JSON.stringify(short(e.textContent))}`);
    if (!e.closest('[data-slot="top-left"]')) out.add("stamp: outside top-left");
  }

  // Resolve custom properties as real browser colors (the tokens may use color functions or other variables).
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true"); document.body.append(probe);
  const resolve = (token) => {
    if (!getComputedStyle(probe).getPropertyValue(token).trim()) return null;
    probe.style.color = `var(${token})`; return getComputedStyle(probe).color;
  };
  const ai = resolve("--ai"), red = resolve("--red"); probe.remove();
  if (!ai) out.add("color: missing --ai token");
  if (!red) out.add("color: missing --red token");
  for (const e of all("*")) {
    if (!e.closest(scope) || !shown(e)) continue;
    const color = getComputedStyle(e).color;
    if (ai && color === ai && !e.closest(".ai-mark") && !normal(e.textContent).startsWith("✦")) fail(e, `AI purple outside an AI mark on ${name(e)}`);
    if (red && color === red && !e.closest('[data-level="stop"]')) fail(e, `red outside a stop on ${name(e)}`);
  }

  for (const slot of ["top-left", "top-right", "stage", "status", "bottom-right"]) {
    const count = all(`[data-slot="${slot}"]`).length;
    if (count !== 1) out.add(`${slot}: expected one region, found ${count}`);
  }
  if (all('[data-slot="rail"]').length) out.add("rail: present at rest");
  // These scenes all start on the map with no held question.
  if (all('[data-slot="bottom-left"]').length) out.add("bottom-left: present on the map");
  if (all('[data-slot="held"]').length) out.add("held: present without a question");
  const status = document.querySelector('[data-slot="status"]');
  if (status) {
    const r = status.getBoundingClientRect();
    if (Math.abs(r.height - 24) > 0.5) out.add(`status: height ${r.height}px, expected 24px`);
    if (Math.abs(r.bottom - innerHeight) > 0.5) out.add(`status: bottom ${r.bottom}px, expected ${innerHeight}px`);
    const inside = normal(textNodes.filter((n) => status.contains(n)).map((n) => n.textContent).join(" ")).toLowerCase();
    if (!inside.startsWith(state.toLowerCase())) out.add(`status: expected first state ${JSON.stringify(state)}, got ${JSON.stringify(short(inside))}`);
    // Count words across inline elements as well as within a single text node.
    const words = state.toLowerCase().split(/\s+/);
    const occurrences = (text) => {
      const tokens = normal(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
      return tokens.filter((_, i) => words.every((word, j) => tokens[i + j] === word)).length;
    };
    if (occurrences(inside) !== 1) out.add(`status: ${JSON.stringify(state)} must be named once`);
    const outside = textNodes.filter((n) => !status.contains(n)).map((n) => n.textContent).join(" ");
    const copies = occurrences(outside);
    if (copies) out.add(`page: ${JSON.stringify(state)} repeated outside status (${copies})`);
  }
  if (width === 390) {
    for (const e of [document.documentElement, document.body]) if (e.scrollWidth > e.clientWidth + 1) out.add(`page: ${e.tagName.toLowerCase()} scrollWidth ${e.scrollWidth} exceeds clientWidth ${e.clientWidth}`);
    for (const e of all(slots.map((s) => `[data-slot="${s}"]`).join(","))) {
      if (!allowed(e) || getComputedStyle(e).display === "none") continue;
      const r = e.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth) fail(e, `region past window sides (${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth})`);
    }
  }
  return [...out];
}

const failures = new Set();
const record = (where, lines) => { for (const line of lines) failures.add(`${where} ${line}`); };
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let runs = 0;
for (const scene of scenes) {
  const core = await standInCore(() => [{ type: "snapshot", world: scene.world }, ...(scene.notice ? [scene.notice] : [])], scene.door ? { door: scene.door } : {});
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      let browser;
      const url = `http://127.0.0.1:${core.port}/?shell=2${scene.query || ""}`;
      const base = `${scene.name} ${width}x${height}`;
      try {
        // Another worker can replace dist while we load it. Retry one fresh page after three seconds.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            browser = await openPage("about:blank", { width, height });
            await browser.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
            await browser.page("Page.navigate", { url });
            if (!await browser.until(`document.readyState === "complete" && !!document.querySelector(".app.shell")`, 10000)) throw new Error("shell page did not load");
            const content = scene.world.threads.length ? ".spine-frame" : ".shell-welcome";
            if (!await browser.until(`(() => { const e = document.querySelector(${JSON.stringify(content)}); if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility === "visible" && Number(s.opacity) >= 0.99; })()`, 10000)) throw new Error(scene.world.threads.length ? "map canvas did not show" : "first open did not show");
            await browser.evaluate("document.fonts.ready.then(() => true)");
            await sleep(300);
            break;
          } catch (error) {
            if (browser) { await browser.close(); browser = null; }
            if (attempt) throw error;
            await sleep(3000);
          }
        }
        const { page, evaluate, until } = browser;
        const settle = () => evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
        const check = async (where, controlsOnly = false) => record(where, await evaluate(`(${inspect.toString()})(${JSON.stringify({ stamp: scene.stamp, state: scene.state, width, controlsOnly })})`));
        const key = async (value) => {
          await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(value)}, bubbles: true }))`);
          await settle();
        };
        for (const scheme of ["light", "dark"]) {
          for (const motion of scene.name === "map" ? ["no-preference", "reduce"] : ["no-preference"]) {
            const where = `${base} ${scheme}${motion === "reduce" ? " reduced-motion" : ""}`;
            await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: motion }] });
            await settle(); await sleep(200);
            await check(where); runs++;
            if (shots && motion === "no-preference") {
              const { data } = await page("Page.captureScreenshot", { format: "png" });
              writeFileSync(join(shots, `shell-${scene.name}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
            }
            if (scene.name === "map" && width === 1440 && scheme === "dark" && motion === "no-preference") {
              const rail = '[data-slot="rail"]';
              const selected = (tab) => `(() => { const r = document.querySelector(${JSON.stringify(rail)}); const t = r?.querySelector('[role="tab"][aria-selected="true"]'); return !!r && r.getBoundingClientRect().height > 0 && t?.textContent.trim().startsWith(${JSON.stringify(tab)}); })()`;
              await key("c");
              if (!await until(selected("Catalog"), 2000)) record(where, ["rail: C did not show Catalog selected"]);
              if (!await evaluate(`!!document.querySelector('${rail} [role="switch"]')`)) record(where, ["rail: Catalog has no switch rows"]);
              await key("Escape");
              if (!await until(`!document.querySelector('${rail}')`, 2000)) record(where, ["rail: Escape did not close Catalog"]);
              await key("y");
              if (!await until(selected("History"), 2000)) record(where, ["rail: Y did not show History selected"]);
              await key("Escape");
              if (!await until(`!document.querySelector('${rail}')`, 2000)) record(where, ["rail: Escape did not close History"]);
              await key("c");
              if (!await until(selected("Catalog"), 2000)) record(where, ["rail: C did not reopen Catalog"]);
              await check(`${where} rail open`, true);
              await key("Escape");
            }
          }
        }
      } catch (error) { record(base, [`setup: ${message(error)}`]); }
      finally { if (browser) await browser.close(); }
    }
  } finally { core.close(); }
}

if (failures.size) {
  for (const failure of failures) console.log(failure);
  process.exitCode = 1;
} else console.log(`shell-check: ok (${scenes.length} scenes, ${runs} size/color/motion runs; type, keys, sentences, stamps, colors, regions, status and rail)`);
