// The window's own modules for the offline checks (scripts/*-check.mjs): Vite loads each as the page would, with no
// browser and no extra dependencies. Load with `server.ssrLoadModule("/src/…")`; `server.close()` when done.
// `config` adds plugins; an explicit port also serves browser module checks on loopback.
// The root and shared no-watcher/no-HMR settings remain the same in both modes.
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

export function uiServer(config = {}, { port } = {}) {
  return createServer({ ...config, root: new URL("../ui", import.meta.url).pathname,
    server: { ...(port === undefined ? { middlewareMode: true } : { host: "127.0.0.1", port, strictPort: true }), hmr: false, ws: false, watch: null }, appType: "custom" });
}
