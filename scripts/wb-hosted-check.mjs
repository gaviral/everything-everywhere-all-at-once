// Initial Room lookup only: synthetic HTTP responses, controlled retry clock, isolated Chrome profile.
import assert from "node:assert/strict";
import { openPage, ready } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP wb-hosted-check: ${why}`); process.exit(3); }

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Room, useMe } from "/src/room.tsx";

const timers = new Map();
const nativeTimeout = window.setTimeout.bind(window);
const nativeClear = window.clearTimeout.bind(window);
let nextTimer = -1;
window.requests = [];
window.scheduled = [];
window.cancelled = [];
window.lateUpdates = 0;
window.fixtureUnmounted = false;
window.setTimeout = (callback, ms, ...args) => {
  if (ms !== 1500) return nativeTimeout(callback, ms, ...args);
  const id = nextTimer--;
  window.scheduled.push(ms);
  timers.set(id, () => callback(...args));
  return id;
};
window.clearTimeout = (id) => {
  if (timers.delete(id)) window.cancelled.push(id);
  else nativeClear(id);
};
window.fetch = (url) => {
  if (!String(url).startsWith("/room")) throw Error("Unexpected fixture fetch: " + url);
  return new Promise((resolve, reject) => window.requests.push({ url, resolve, reject }));
};
window.reply = (index, status, door) => window.requests[index].resolve(
  new Response(JSON.stringify(door), { status, headers: { "content-type": "application/json" } }));
window.retry = () => {
  if (timers.size !== 1) throw Error("Expected exactly one retry");
  const [id, run] = timers.entries().next().value;
  timers.delete(id);
  run();
};
window.pendingRetries = () => timers.size;
const root = createRoot(document.getElementById("root"));
function MapFixture() { return React.createElement("main", { id: "synthetic-map" }, "Synthetic map · " + useMe()); }
window.unmountRoom = () => {
  flushSync(() => root.unmount());
  window.fixtureUnmounted = true;
};
flushSync(() => root.render(React.createElement(Room, null, React.createElement(MapFixture))));
window.fixtureReady = true;
`;

// Observe setters in the actual Room module so React silently ignoring an unmounted update cannot hide a failure.
const server = await uiServer({ plugins: [{
  name: "wb-hosted-fixture",
  enforce: "pre",
  resolveId(id) { if (id === "/wb-hosted-fixture.mjs") return id; },
  load(id) { if (id === "/wb-hosted-fixture.mjs") return fixture; },
  transform(source, id) {
    if (!id.endsWith("/src/room.tsx")) return;
    assert.ok(source.includes("useState, type FormEvent"), "Room state observer attaches");
    return source.replace("useState, type FormEvent", "useState as reactUseState, type FormEvent") + `
function useState(...args) {
  const [value, set] = reactUseState(...args);
  return [value, (next) => {
    if (window.fixtureUnmounted) window.lateUpdates++;
    set(next);
  }];
}
`;
  },
  configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url !== "/wb-hosted-fixture") return next();
      try {
        const html = await vite.transformIndexHtml(req.url,
          '<div id="root"></div><script type="module" src="/wb-hosted-fixture.mjs"></script>');
        res.writeHead(200, { "content-type": "text/html" }).end(html);
      } catch (error) { next(error); }
    });
  },
}] }, { port: 0 });

let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  assert.ok(port !== 4360 && port !== 4399, "fixture uses an ephemeral unreserved port");
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  const errors = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.text));
  await page("Runtime.enable");
  const door = { room: false, member: true, hosted: true, calendar_file: true, models: [] };
  const status = () => evaluate('document.querySelector(".join-loading[role=status]")?.textContent ?? null');
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const start = async () => {
    await page("Page.navigate", { url: `http://127.0.0.1:${port}/wb-hosted-fixture` });
    assert.ok(await until("window.fixtureReady && window.requests.length === 1", 15000), "initial request starts");
    assert.equal(await status(), "Loading…", "healthy pending load is unchanged");
    assert.deepEqual(await evaluate("window.scheduled"), []);
  };
  const reply = (index, code, value = door) => evaluate(`window.reply(${index}, ${code}, ${JSON.stringify(value)})`);
  const failFirst = async () => {
    await start();
    await reply(0, 503);
    assert.ok(await until('document.querySelector("[role=status]")?.textContent === "Connection unavailable. Retrying…"'), "HTTP failure explains recovery");
    assert.deepEqual(await evaluate("window.scheduled"), [1500], "one retry at the existing cadence");
    assert.equal(await evaluate("window.requests.length"), 1, "no immediate duplicate request");
    assert.equal(await evaluate("window.pendingRetries()"), 1);
    assert.equal(await evaluate('document.querySelectorAll("button").length'), 0, "no new Retry control");
  };

  await failFirst();
  await evaluate("window.retry()");
  assert.equal(await evaluate("window.requests.length"), 2, "scheduled retry makes exactly one request");
  assert.equal(await status(), "Connection unavailable. Retrying…", "explanation stays while retry is pending");
  await reply(1, 200);
  assert.ok(await until('!!document.querySelector("#synthetic-map")'), "valid Door enters normally");
  const recovered = await evaluate('document.getElementById("root").innerHTML');
  assert.equal(recovered, '<main id="synthetic-map">Synthetic map · you</main>', "baseline alone seat and child are unchanged");
  assert.equal(await status(), null, "failure status clears on success");
  assert.equal(await evaluate("window.pendingRetries()"), 0);
  assert.deepEqual(await evaluate("window.scheduled"), [1500]);

  await start();
  await reply(0, 200);
  assert.ok(await until('!!document.querySelector("#synthetic-map")'));
  assert.equal(await evaluate('document.getElementById("root").innerHTML'), recovered, "ordinary successful first response matches recovered entry");
  assert.deepEqual(await evaluate("window.scheduled"), [], "healthy entry has no retry");

  await failFirst();
  await evaluate("window.unmountRoom()");
  await settle();
  assert.equal(await evaluate("window.pendingRetries()"), 0, "unmount clears scheduled retry");
  assert.equal(await evaluate("window.cancelled.length"), 1);
  assert.equal(await evaluate("window.requests.length"), 1);
  assert.equal(await evaluate("window.lateUpdates"), 0);

  // An already in-flight retry can settle either way after cleanup; neither may update state or schedule again.
  for (const outcome of ["success", "failure"]) {
    await failFirst();
    await evaluate("window.retry(); window.unmountRoom()");
    if (outcome === "success") await reply(1, 200);
    else await evaluate('window.requests[1].reject(new Error("Synthetic offline"))');
    await settle();
    assert.equal(await evaluate("window.lateUpdates"), 0, `late ${outcome} does not update state`);
    assert.equal(await evaluate("window.pendingRetries()"), 0, `late ${outcome} does not retry`);
    assert.deepEqual(await evaluate("window.scheduled"), [1500]);
    assert.equal(await evaluate("window.requests.length"), 2);
    assert.equal(await evaluate('document.getElementById("root").innerHTML'), "");
  }
  assert.deepEqual(errors, [], "no page exceptions");
  console.log("wb-hosted-check: initial failure/status, single 1500ms retry, recovery, healthy entry and unmount cleanup pass (synthetic only)");
} finally {
  await browser?.close();
  await server.close();
}
