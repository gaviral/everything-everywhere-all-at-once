// No extra dependencies: run with `node scripts/ui-server-check.mjs`.
// The offline checks load the window's modules through one Vite setup, scripts/ui-server.mjs (24 copies became one,
// 2026-11-01). A script that starts its own Vite server is a copy that drifts: load modules with `uiServer()` instead.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const scripts = new URL("./", import.meta.url);
const copies = readdirSync(scripts).filter((f) => f.endsWith(".mjs") && f !== "ui-server.mjs")
  .filter((f) => /\bvite\/dist\/node\b|from\s*["']vite["']/.test(readFileSync(new URL(f, scripts), "utf8")));
assert.deepEqual(copies, [], "start Vite with uiServer() from scripts/ui-server.mjs, not a copy of its setup");
console.log("ui-server-check: ok");
