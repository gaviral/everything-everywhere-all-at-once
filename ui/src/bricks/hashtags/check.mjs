// One focused check: build this brick alone; exercise visible behavior with synthetic data.
// Leaves its artifacts/profile in temporary folders; starts no microphone or model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "../../../node_modules/vite/dist/node/index.js";
import { openPage } from "../../../../scripts/headless.mjs";

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, "../../../..");
const output = mkdtempSync(join(tmpdir(), "hashtags-check-"));
const manifest = JSON.parse(readFileSync(join(folder, "brick.json"), "utf8"));
assert.equal(manifest.id, "hashtags");
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, "view");

const configPath = join(output, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({ extends: join(root, "ui/tsconfig.json"),
  include: [], files: [join(root, "ui/src/vite-env.d.ts"), join(folder, "checks/fixture.tsx")] }));
const compile = spawnSync(process.execPath, [join(root, "ui/node_modules/typescript/bin/tsc"), "--project", configPath], { encoding: "utf8" });
assert.equal(compile.status, 0, compile.stdout + compile.stderr);

await build({ configFile: false, root: join(root, "ui"), logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") }, build: {
  outDir: output, emptyOutDir: false, cssCodeSplit: false,
  lib: { entry: join(folder, "checks/fixture.tsx"), formats: ["es"], fileName: () => "check.js", cssFileName: "check" },
} });
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/check.css"><style>
:root{--bg:#f5f4ef;--card:#fffefa;--ink:#262d2a;--muted:#656e68;--accent:#397858;--line:#dce0d6}
body{margin:0;background:var(--bg);font-family:Arial,sans-serif}button{font-family:inherit}
</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>`;
const server = createServer((request, response) => {
  const name = new URL(request.url, "http://hashtags.test").pathname;
  if (name === "/") response.writeHead(200, { "content-type": "text/html" }).end(html);
  else if (name === "/check.js" || name === "/check.css") response.writeHead(200, {
    "content-type": name.endsWith(".js") ? "text/javascript" : "text/css",
  }).end(readFileSync(join(output, name.slice(1))));
  else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let page;
try {
  page = await openPage(`http://127.0.0.1:${server.address().port}`, { preserveProfile: true });
  const { evaluate, until } = page;
  assert.ok(await until("!!window.hashtagsCheck && !!document.querySelector('.hashtags-thought')"), "Example content opens immediately");
  assert.match(await evaluate("document.body.innerText"), /Example · developer debugging sample/);
  assert.equal(await evaluate("document.querySelectorAll('.hashtags-source-link').length"), 0, "Examples never masquerade as real source links");
  assert.deepEqual(await evaluate(`window.hashtagsCheck.tagsIn("#Rollback #rollback, hashtag REVIEW; #café #東京 #release-2 #under_score user#no reader@example.com https://example.test/#fragment")`),
    ["rollback", "review", "café", "東京", "release-2", "under_score"]);
  assert.deepEqual(await evaluate(`window.hashtagsCheck.tagsIn("no tags or hashtags here")`), []);

  // Use real developer sample sentences with explicit tags attached for this fixture.
  const journal = readFileSync(join(root, "samples/debug-break.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const thoughts = journal.filter(row => row.type === "thought_added").map(row => row.thought);
  const threads = journal.filter(row => row.type === "thread_added").map(row => row.thread);
  const tagged = [
    { ...thoughts[0], text: `${thoughts[0].text} #Rollback #rollback` },
    { ...thoughts[3], text: `${thoughts[3].text} hashtag rollback #review` },
    { ...thoughts[6], text: `${thoughts[6].text} #review` },
    { ...thoughts[1], point: "#summary-only", text: thoughts[1].text },
  ];
  async function set(thoughts, visitKey = "first") {
    await evaluate(`window.hashtagsCheck.set(${JSON.stringify({ thoughts, threads, visitKey })})`);
  }
  async function choose(tag) {
    await evaluate(`[...document.querySelectorAll('.hashtags-chip')].find(button => button.textContent.startsWith(${JSON.stringify(`#${tag}`)})).click()`);
  }
  await set(tagged);
  assert.ok(await until("document.querySelectorAll('.hashtags-thought').length === 3 && !document.querySelector('.hashtags-example')"));
  assert.equal(await evaluate("document.querySelectorAll('.hashtags-chip').length"), 3, "Model summary does not create a tag");
  await choose("rollback");
  assert.ok(await until("document.querySelector('.hashtags-count').textContent === '2 thoughts · 2 topics'"), "Typed and spoken tag gather both topics; repeated spelling counts once");
  assert.equal(await evaluate("document.querySelectorAll('.hashtags-thought').length"), 2);
  await evaluate("document.querySelector('.hashtags-source-link').click()");
  assert.ok(await until("!!document.querySelector('#return-to-hashtags')"));
  assert.deepEqual(await evaluate("window.hashtagsCheck.opened"), [tagged[0].id]);
  await evaluate("document.querySelector('#return-to-hashtags').click()");
  assert.ok(await until("document.querySelector('.hashtags-result-title')?.textContent === '#rollback'"), "Source jump and return retains the visible filter");
  await page.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.ok(await until("document.querySelector('.hashtags-chip[aria-pressed=true]')?.textContent.startsWith('All tagged')"));
  assert.equal(await evaluate("document.activeElement.textContent"), "All tagged 3", "Back restores focus to the tag strip");

  await choose("review");
  await set([...tagged, { ...thoughts[4], text: "Pending #review", thread_id: null, placed: false }]);
  assert.ok(await until("document.querySelector('.hashtags-count').textContent.startsWith('3 thoughts')"), "New thoughts update the active filter");
  assert.equal(await evaluate("[...document.querySelectorAll('.hashtags-thought')].find(card => card.textContent.includes('Pending')).querySelectorAll('button').length"), 0);
  await set(tagged.map(thought => ({ ...thought, text: thought.text.replace(/#review/gi, "") })));
  assert.ok(await until("document.querySelector('.hashtags-no-results')?.textContent.includes('#review')"), "Edited tags disappear from results");
  await set(tagged, "different-map");
  assert.ok(await until("document.querySelector('.hashtags-chip[aria-pressed=true]')?.textContent.startsWith('All tagged')"), "A different map has its own selection");
  await choose("rollback");
  const desktop = await page.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(output, "desktop.png"), Buffer.from(desktop.data, "base64"));

  await page.page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await until("document.querySelector('.hashtags-results').getBoundingClientRect().width <= 390"));
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Phone content fits horizontally");
  const phone = await page.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(output, "phone.png"), Buffer.from(phone.data, "base64"));
  await evaluate("Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw Error('disabled') } }); true");
  await choose("review");
  await evaluate("document.querySelector('.hashtags-source-link').click()");
  assert.ok(await until("!!document.querySelector('#return-to-hashtags')"));
  await evaluate("document.querySelector('#return-to-hashtags').click()");
  assert.ok(await until("document.querySelector('.hashtags-result-title')?.textContent === '#review'"), "Return works when storage is unavailable");
  await set([]);
  assert.ok(await until("!!document.querySelector('.hashtags-example')"));
  assert.equal(await evaluate("document.querySelectorAll('.hashtags-thought').length"), 3);
  console.log(`PASS hashtags: scoped TypeScript, extraction, examples, cross-topic counts, source return, updates, keyboard, phone and storage fallback. Artifacts: ${output}`);
} finally {
  await page?.close();
  await new Promise(resolve => server.close(resolve));
}
