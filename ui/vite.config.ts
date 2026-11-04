import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the core runs on :4321; Vite proxies its WebSocket, the room check and the import upload.
// The bricks playground (bricks.html, docs/bricks.md) reads the sample maps in ../samples, the one folder outside ui/
// the dev server may serve. `npm run build` builds it second (`--mode bricks`) into the same dist, on its own: as a
// second input of one build, the code both pages share went into a chunk of its own, and the app's stylesheets with
// it, which put styles.css ahead of the rules it used to follow (a phone's Map and Palace buttons lost their 40 px).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: mode === "bricks" ? { emptyOutDir: false, rolldownOptions: { input: "bricks.html" } } : {},
  server: {
    proxy: { "/terse": "http://localhost:4321", "/ws": { target: "ws://localhost:4321", ws: true }, "/room": "http://localhost:4321", "/import": "http://localhost:4321" },
    fs: { allow: [".", "../samples"] },
  },
}));
