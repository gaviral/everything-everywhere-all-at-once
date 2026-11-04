// Isolated preview, separate from the host feature registry and runtime.
import { createServer } from "../../../node_modules/vite/dist/node/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = await createServer({
  root: new URL("../../../", import.meta.url).pathname,
  cacheDir: mkdtempSync(join(tmpdir(), "workflow-inspector-preview-")),
  server: { host: "127.0.0.1", port: 4478, strictPort: true, hmr: false, ws: false, watch: null },
});
await server.listen();
console.log(`Workflow inspector preview: http://127.0.0.1:4478/src/msg1351/workflow-inspector/preview.html (PID ${process.pid})`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
