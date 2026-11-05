// Offline film admission check. No browser, microphone, account, or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../ui/node_modules/vite/dist/node/index.js';

const root = new URL('../ui', import.meta.url).pathname;
for (const [flag, query, expected] of [[undefined, '?film', false], ['0', '?film', false], ['1', '', false], ['1', '?film', true]]) {
  globalThis.location = new URL(`http://localhost/${query}`);
  globalThis.window = {};
  const server = await createServer({
    root, configFile: false, envPrefix: 'SURFACE_CHECK_UNUSED_',
    cacheDir: mkdtempSync(join(tmpdir(), 'surface-ui-')),
    define: { 'import.meta.env.VITE_E2A2O_FILM': flag === undefined ? 'undefined' : JSON.stringify(flag) },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const film = await server.ssrLoadModule('/src/film.ts');
    assert.equal(film.FILM, expected, `film flag ${flag}, query ${query}`);
    if (!expected) {
      // A disabled build returns before accessing the DOM or publishing synthetic input.
      film.startFilm();
      assert.equal(globalThis.window.e2a2oFilm, undefined);
    }
  } finally { await server.close(); }
}
console.log('PASS surface UI: synthetic film input requires the build switch and film URL.');
