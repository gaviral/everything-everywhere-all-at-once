// The window's own modules for the offline checks (scripts/*-check.mjs): Vite loads each as the page would, with no
// browser and no extra dependencies. Load with `server.ssrLoadModule("/src/…")`; `server.close()` when done.
// `config` adds to the setup (a check's stand-in plugins); the root and server options stay as they are.
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

export function uiServer(config = {}) {
  return createServer({ ...config, root: new URL("../ui", import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
}
