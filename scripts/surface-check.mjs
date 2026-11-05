// Offline film admission check. No browser, microphone, account, or model calls.
import assert from 'node:assert/strict';
import { uiServer } from './ui-server.mjs';

for (const [flag, query, expected] of [[undefined, '?film', false], ['0', '?film', false], ['1', '', false], ['1', '?film', true]]) {
  globalThis.location = new URL(`http://localhost/${query}`);
  globalThis.window = {};
  const server = await uiServer({
    configFile: false, envPrefix: 'SURFACE_CHECK_UNUSED_',
    define: { 'import.meta.env.VITE_E2A2O_FILM': flag === undefined ? 'undefined' : JSON.stringify(flag) },
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
