import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const server = await createServer({ root, configFile: false, plugins: [react()],
  server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { StatsCard } = await server.ssrLoadModule("/src/bricks/memory/StatsCard.tsx");
  const { EXAMPLE, readStats, pollStats } = await server.ssrLoadModule("/src/bricks/memory/stats.ts");
  const manifest = JSON.parse(await readFile(new URL("./brick.json", import.meta.url), "utf8"));
  assert.equal(manifest.defaultOn, false);
  const render = (stats, live) => renderToStaticMarkup(createElement(StatsCard, { stats, live }));
  const example = render(null, false);
  assert.ok(example.includes("Example · waiting for core"));
  for (const visible of ["Memory statistics", "10,000", "180 µs", "96.0 KB", "Thoughts indexed", "Answers reused"]) {
    assert.ok(example.includes(visible), `card shows ${visible}`);
  }
  const actual = { ...EXAMPLE, thoughts_indexed: 17, cache_hits: 9, lookup_us: 24 };
  assert.deepEqual(readStats(actual), actual);
  assert.throws(() => readStats({ ...actual, lookup_us: -1 }));
  assert.throws(() => readStats({ enabled: true }));
  assert.ok(render(actual, true).includes("Live · in this core"));
  assert.ok(render(actual, false).includes("Last reading · disconnected"));
  assert.ok(render({ ...actual, enabled: false }, true).includes("Memory is off"));

  const received = [];
  const queued = [];
  let signal;
  let nextResult;
  const waiting = () => new Promise(resolve => { nextResult = resolve; });
  const request = async (url, options) => {
    assert.equal(url, "/memory/stats");
    assert.equal(options.cache, "no-store");
    signal = options.signal;
    return { ok: true, json: async () => ({ ...actual, cache_hits: received.length + 1 }) };
  };
  const first = waiting();
  const stop = pollStats(value => { received.push(value); nextResult(); }, request,
    task => { queued.push(task); return queued.length; }, id => { queued[id - 1] = null; });
  await first;
  assert.equal(received[0].cache_hits, 1);
  const second = waiting();
  await queued[0]();
  await second;
  assert.equal(received[1].cache_hits, 2, "a later poll displays the new live value");
  stop();
  assert.equal(signal.aborted, true);
  assert.equal(queued.at(-1), null);

  const failed = waiting();
  const stopFailed = pollStats(value => { assert.equal(value, null); nextResult(); },
    async () => ({ ok: false }), task => { queued.push(task); return queued.length; }, () => {});
  await failed;
  stopFailed();
  console.log("PASS memory card: default off, labelled example, live values, stale/off states, polling and cancellation");
} finally { await server.close(); }
