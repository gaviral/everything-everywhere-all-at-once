// No extra dependencies: run with `node scripts/save-file-check.mjs`.
// Saving a file the window made (ui/src/save-file.ts), one copy for both: Export's Markdown and a dated item's
// calendar file are each handed to the browser as a link clicked once, removed, and let go of; nothing else in
// ui/src makes its own.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
const { createObjectURL, revokeObjectURL } = URL;
try {
  const { downloadIcs } = await server.ssrLoadModule("/src/site.ts");
  let clicked = [];
  const page = [];
  const made = [];
  const revoked = [];
  globalThis.document = { createElement: () => ({ click() { clicked.push(this); }, remove() { page.splice(page.indexOf(this), 1); } }),
    body: { appendChild: (el) => page.push(el) } };
  globalThis.window = { setTimeout: (f) => f() };
  URL.createObjectURL = (blob) => { made.push(blob); return `blob:${made.length}`; };
  URL.revokeObjectURL = (url) => revoked.push(url);

  assert.equal(downloadIcs({ id: "ac-1", title: "Demo day", when: "2026-11-30" }), true);
  assert.equal(clicked.length, 1, "clicked once");
  assert.equal(clicked[0].download, "Demo-day.ics");
  assert.equal(made[0].type, "text/calendar;charset=utf-8");
  assert.match(await made[0].text(), /^BEGIN:VCALENDAR\r\n/);
  assert.deepEqual(page, [], "the link leaves the page");
  assert.deepEqual(revoked, ["blob:1"], "the file lets go of its memory");
  assert.equal(downloadIcs({ id: "ac-2", title: "Someday", when: "" }), false, "no day, no file");
  assert.equal(clicked.length, 1, "and nothing clicked");

  const src = new URL("../ui/src/", import.meta.url);
  const own = readdirSync(src).filter((f) => /\.tsx?$/.test(f) && f !== "save-file.ts" && /\.download = /.test(readFileSync(new URL(f, src), "utf8")));
  assert.deepEqual(own, [], "save a file with saveFile (ui/src/save-file.ts), not a copy of it");
  console.log("save-file-check: ok");
} finally {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  await server.close();
}
