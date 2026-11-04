// A new browser opens the working canvas with optional features off; no microphone or model calls.
import assert from 'node:assert/strict';
import { ready, standInCore, openPage } from './headless.mjs';

const unavailable = ready();
if (unavailable) { console.log(`SKIP optional-defaults-check: ${unavailable}`); process.exit(3); }

const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], questions: [] };
const core = await standInCore(() => [{ type: 'snapshot', world }]);
// Existing base capabilities remain available. Every add-on, including presentation choices, starts off.
const baseCapabilities = new Set(['listening', 'recap', 'helpers', 'email', 'built-in-speech']);
try {
  for (const route of ['/', '/?flow&rehearse']) {
    const browser = await openPage('about:blank', { width: 1920, height: 1080 });
    try {
      const { page, evaluate, until } = browser;
      await page('Page.enable');
      await page('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.microphoneRequests = 0;
        navigator.mediaDevices.getUserMedia = () => {
          window.microphoneRequests++;
          return Promise.reject(new Error('Microphone prohibited in this check'));
        };
      ` });
      await page('Page.navigate', { url: `http://127.0.0.1:${core.port}${route}` });
      assert.ok(await until(`!!document.querySelector('.spine-ready') && !!document.querySelector('#type-a-thought')`), 'first screen has the canvas and typing input');
      assert.equal(await evaluate(`!!document.querySelector('.intro-parts,.film-layer,[data-organized-catalog]')`), false, 'no optional opening, filming overlay or organized catalog');
      assert.equal(await evaluate(`document.querySelector('button.mic').getAttribute('aria-pressed')`), 'false', 'microphone starts off');
      await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
      assert.ok(await until(`document.querySelectorAll('[data-row] [role=switch]').length > 15`), 'all feature choices are inspectable');
      const enabled = await evaluate(`Array.from(document.querySelectorAll('[data-row] [role=switch][aria-checked="true"]')).map(b => b.closest('[data-row]').dataset.row)`);
      const requested = route.includes('?flow') ? ['flow-canvas'] : [];
      assert.deepEqual(enabled.filter(id => !baseCapabilities.has(id)).sort(), requested, 'only explicitly requested optional features are on');
      assert.equal(await evaluate(`document.querySelector('[data-catalog-preference] [role=switch]')?.getAttribute('aria-checked') ?? 'false'`), 'false', 'catalog organization starts off');
      assert.equal(await evaluate('microphoneRequests'), 0, 'opening and inspection never request the microphone');
      console.log(`PASS optional defaults ${route}: fresh canvas, add-ons off, microphone untouched`);
    } finally { await browser.close(); }
  }
} finally { core.close(); }
