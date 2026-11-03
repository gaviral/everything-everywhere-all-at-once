// The shell calls a map shared only while two humans are present. Talk still counts AI participants.
// A populated synthetic map, real socket joins/leaves, both sizes and themes. SHOTS=dir saves the driven states.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
assert.equal(why, "", `shell-people-check requires a built UI and Chrome: ${why}`);
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const server = await uiServer();
let names;
try { names = (await server.ssrLoadModule("/src/shell/names.ts")).NAMES; }
finally { await server.close(); }

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", complete: true, at_ms: now - 60_000, place_ms: 2400 });
const world = {
  threads: [thread("T1", "Community garden"), thread("T2", "Tool library")], active: "T1", active_by: {},
  suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
  thoughts: [thought("a1", "Plant herbs along the sunny fence", "T1"), thought("a2", "Leave a wide path for the watering cart", "T1"), thought("b1", "Label the shared tools before opening day", "T2")],
};
const person = (name, extra = {}) => ({ name, ai: false, remote: false, joined_ms: now, here: true, left_ms: null, mic: false, speaking: false, read: null, ...extra });
const quiet = (error) => !/^ResizeObserver loop (limit exceeded|completed with undelivered notifications)\.?$/.test(error);
const timeout = setTimeout(() => { console.error("shell-people-check: timed out"); process.exit(1); }, 180_000);

// As in remote-person-check: a window opens its socket and closing it tells the other windows who left.
async function raw(core, query) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(core.port, "127.0.0.1");
    socket.once("data", () => resolve({ close: () => socket.destroy() }));
    socket.once("error", reject);
    socket.write(`GET /ws?${query} HTTP/1.1\r\nHost: 127.0.0.1:${core.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
}

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const host of ["you", "Sam"]) {
      const people = [];
      let started = 0;
      const messages = () => started || people.some((p) => p.remote)
        ? [{ type: "call", started_ms: started, people, level: "speak", level_by: "" }] : [];
      let core;
      core = await standInCore((query) => {
        people.push(person(query.get("name") ?? "you", { ai: query.has("ai"), remote: query.has("remote") }));
        if (!started && people.filter((p) => p.here && !p.remote).length >= 2) started = Date.now();
        for (const message of messages()) core.send(message);
        return [...messages(), { type: "snapshot", world }];
      }, {
        door: { room: host !== "you", member: true, code: "abcd2345" },
        onClose: (query) => {
          const p = people.find((p) => p.name === (query.get("name") ?? "you"));
          if (p) { p.here = false; p.left_ms = Date.now(); }
          for (const message of messages()) core.send(message);
        },
      });
      const opened = [];
      try {
        const browser = await openPage("about:blank", { width, height });
        opened.push(browser);
        const { page, evaluate, until } = browser;
        await page("Page.enable");
        await page("Page.addScriptToEvaluateOnNewDocument", { source: `
          localStorage.setItem("e2a2o.toured", "1");
          ${host !== "you" ? `sessionStorage.setItem("e2a2o.joined", ${JSON.stringify(host)});` : ""}
          window.pageErrors = [];
          addEventListener("error", (e) => window.pageErrors.push(e.message));
          addEventListener("unhandledrejection", (e) => window.pageErrors.push(String(e.reason)));
          const error = console.error;
          console.error = (...args) => { window.pageErrors.push(args.map(String).join(" ")); error(...args); };
        ` });
        await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
        const check = async (expression, label) => assert.ok(await until(expression, 10_000), `${width} ${host}: ${label}`);
        await check('!!document.querySelector(".spine-ready") && !!document.querySelector("[data-guide=composer] textarea")', "populated map loaded");
        await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()');
        await evaluate("document.fonts.ready.then(() => true)");
        // Dismiss first-use hints on bare canvas, without selecting a thought or a control.
        const bare = await evaluate(`(() => {
          for (let y = 120; y < innerHeight - 180; y += 40) for (let x = 20; x < innerWidth - 20; x += 40) {
            const el = document.elementFromPoint(x, y);
            if (el?.matches(".react-flow__pane")) return { x, y };
          }
          return null;
        })()`);
        assert.ok(bare, "bare canvas is available");
        await page("Input.dispatchMouseEvent", { type: "mousePressed", ...bare, button: "left", clickCount: 1 });
        await page("Input.dispatchMouseEvent", { type: "mouseReleased", ...bare, button: "left", clickCount: 1 });
        await sleep(700); // Normal entrance motion finishes before geometry or screenshots.

        const seen = () => evaluate(`(${seenExpression.toString()})()`);
        const state = async (label, shared, capture = false) => {
          const expected = { map: shared ? names.map.call : names.map.alone,
            badges: shared ? [[names.stamp.call, names.stamp.call]] : [],
            composer: shared ? names.composer.call : names.composer.idle };
          await check(`JSON.stringify((${seenExpression.toString()})()) === ${JSON.stringify(JSON.stringify(expected))}`, label);
          for (const scheme of ["light", "dark"]) {
            await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
            await sleep(650);
            assert.deepEqual(await seen(), expected, `${width} ${host} ${scheme}: ${label}`);
            assert.equal(await evaluate(`(() => {
              const selectors = [".shell-mapname", "[data-guide=composer] textarea", ${JSON.stringify(shared ? "[data-stamp]" : ".shell-identity")}];
              return document.documentElement.scrollWidth <= innerWidth && selectors.every((s) => {
                const e = document.querySelector(s), r = e?.getBoundingClientRect();
                return r && r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
              });
            })()`), true, `${width} ${scheme}: shell copy is visible and fits`);
            assert.deepEqual((await evaluate("window.pageErrors")).filter(quiet), [], `${width} ${scheme}: no page errors`);
            if (shots && capture && host === "you") {
              const { data } = await page("Page.captureScreenshot", { format: "png" });
              writeFileSync(join(shots, `${label}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
            }
          }
        };
        await state("host-alone", false);
        opened.push(await raw(core, "name=Helper&ai=1"));
        await check('!!document.querySelector(".talk-pill")', "the AI still participates in Talk");
        await state("helper-only", false, true);
        opened.push(await raw(core, "name=Phone&remote=1"));
        await state("with-remote", false);
        opened.push(await raw(core, "name=Helper2&ai=1"));
        opened.push(await raw(core, "name=Phone2&remote=1"));
        await state("several-helpers-and-remotes", false);
        const human = await raw(core, "name=Maya");
        opened.push(human);
        await state("two-human", true, true);
        human.close();
        await state("human-left", false);
        assert.equal(people.find((p) => p.name === "Maya").here, false, "absent human remains in call history");
      } finally {
        for (const window of opened.reverse()) await window.close();
        core.close();
      }
    }
  }
  console.log("shell-people-check: ok");
} finally { clearTimeout(timeout); }

function seenExpression() {
  return {
    map: document.querySelector(".shell-mapname")?.textContent,
    badges: [...document.querySelectorAll("[data-stamp]")].map((e) => [e.textContent, e.dataset.stamp]),
    composer: document.querySelector("[data-guide=composer] textarea")?.placeholder,
  };
}
