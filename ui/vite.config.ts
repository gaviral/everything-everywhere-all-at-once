import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the core runs on :4321; Vite proxies its WebSocket and the room check.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/ws": { target: "ws://localhost:4321", ws: true }, "/room": "http://localhost:4321" },
  },
});
