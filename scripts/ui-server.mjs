// The window's own modules for the offline checks (scripts/*-check.mjs): Vite loads each as the page would, with no
// browser and no extra dependencies. Load with `server.ssrLoadModule("/src/…")`; `server.close()` when done.
// `config` adds plugins; an explicit port also serves browser module checks on loopback.
// The root and shared no-watcher/no-HMR settings remain the same in both modes.
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function uiServer(config = {}, { port } = {}) {
  // Concurrent checks have different plugins. Sharing Vite's optimizer cache can invalidate
  // another check's browser imports while that page is still loading.
  const cacheDir = mkdtempSync(join(tmpdir(), "e2a2o-ui-check-"));
  try {
    const server = await createServer({ ...config, cacheDir, root: new URL("../ui", import.meta.url).pathname,
      // SSR-only checks do not serve client modules and need no browser dependency scan.
      ...(port === undefined ? { optimizeDeps: { noDiscovery: true, include: [] } } : {}),
      server: { ...(port === undefined ? { middlewareMode: true } : { host: "127.0.0.1", port, strictPort: true }), hmr: false, ws: false, watch: null }, appType: "custom" });
    const close = server.close.bind(server);
    server.close = async () => {
      try { await close(); }
      finally { rmSync(cacheDir, { recursive: true, force: true }); }
    };
    return server;
  } catch (error) {
    rmSync(cacheDir, { recursive: true, force: true });
    throw error;
  }
}
