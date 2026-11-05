import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadCandidateParts, buildPreview, outputDirectory, requireOptIn, repo } from './toolchain.mjs';
import { writeCandidatePackage } from './package.mjs';
import { servePreview } from './local-server.mjs';
import { openBrowser } from './browser.mjs';

async function modelCheck(parts, output) {
  const { prior, candidate } = await parts.syntheticCandidates();
  assert.equal(parts.hostedReleaseFeature.id, 'intake1422-hosted-release');
  assert.equal(parts.hostedReleaseFeature.defaultEnabled, false);
  for (const enabled of [undefined, false, null, 1, 'true']) assert.equal(parts.inspectionEnabled(enabled), false);
  assert.equal(parts.inspectionEnabled(true), true);
  assert.notEqual(candidate.fingerprint, prior.fingerprint);
  assert.equal(candidate.manifest.source.revision, '2'.repeat(40));
  assert.equal(prior.manifest.source.revision, '1'.repeat(40));
  assert.deepEqual(await parts.createCandidate(candidate.manifest.source), candidate, 'package is deterministic');
  assert(candidate.manifest.switches.every(item => item.defaultEnabled === false && item.enabled === false));
  assert.equal(candidate.manifest.capabilities.find(row => row.id === 'native-calendar').hosted, 'unsupported');
  assert.equal(candidate.manifest.capabilities.find(row => row.id === 'candidate-inspection').local, 'available');
  assert.equal(candidate.manifest.capabilities.find(row => row.id === 'candidate-inspection').hosted, 'prerequisite-missing');
  assert.deepEqual(candidate.manifest.deployment, { revision: 'MISSING', phone: 'MISSING', tls: 'MISSING' });
  const plan = await writeCandidatePackage(parts, candidate, prior, output);
  const manifest = await readFile(join(output, 'manifest.json'));
  assert.equal(`sha256:${createHash('sha256').update(manifest).digest('hex')}`, candidate.fingerprint, 'fingerprint matches exact written manifest bytes');
  assert.deepEqual(plan.rollback, parts.artifactIdentity(prior));
  assert.deepEqual(plan.from, plan.rollback);
  assert.equal(plan.mode, 'dry-run');
  const reverse = await parts.promotionPlan(prior, candidate, parts.artifactIdentity(candidate));
  assert.deepEqual(reverse.rollback, parts.artifactIdentity(candidate));
  await assert.rejects(parts.promotionPlan(candidate, prior, parts.artifactIdentity(candidate)), /Current identity/);
  await assert.rejects(parts.promotionPlan(prior, prior, parts.artifactIdentity(prior)), /different candidate/);
  const git = await parts.createCandidate({ revision: '3'.repeat(40), kind: 'git-commit' });
  await assert.rejects(parts.promotionPlan(git, prior, parts.artifactIdentity(prior)), /cannot be mixed/);
  for (const source of [{ revision: 'abc', kind: 'synthetic' }, { revision: 'a'.repeat(40), kind: 'deployed' },
    { revision: 'a'.repeat(40), kind: 'synthetic', unexpected: 'extra payload' }, null]) {
    await assert.rejects(parts.createCandidate(source), /exact full revision/);
  }
  await assert.rejects(parts.validateCandidate(null), /missing/);
  await assert.rejects(parts.validateCandidate({ ...candidate, fingerprint: prior.fingerprint }), /fingerprint/);
  for (const mutate of [value => { value.manifest.switches[0].enabled = true; },
    value => { value.manifest.capabilities.find(row => row.id === 'native-calendar').hosted = 'available'; },
    value => { value.manifest.deployment.revision = '3'.repeat(40); },
    value => { value.manifest.fixture.notes.push('extra content'); },
    value => { value.manifest.schemaVersion = 2; }]) {
    const altered = structuredClone(candidate); mutate(altered);
    altered.fingerprint = await parts.fingerprintOf(altered.manifest);
    await assert.rejects(parts.validateCandidate(altered), /contract is invalid/);
  }
  console.log('PASS package: exact bytes, two revisions, determinism, availability, defaults, rollback, identity drift and invalid candidate controls');
  return { prior, candidate };
}

async function visibleCheck(output, fixtures) {
  const directory = await buildPreview();
  const server = await servePreview(directory);
  let browser;
  try {
    browser = await openBrowser(output);
    const { page, until, evaluate } = browser;
    await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: server.url });
    await until(`document.querySelector('input[type=checkbox]')`);
    assert.equal(await evaluate(`document.querySelector('article') === null`), true, 'fresh profile starts off');
    const click = index => evaluate(`document.querySelectorAll('input[type=checkbox]')[${index}].click()`);
    await click(0);
    await until(`document.querySelector('article h3')?.textContent === 'Candidate artifact'`);
    const text = () => evaluate(`document.querySelector('article').innerText`);
    let words = await text();
    for (const expected of [fixtures.candidate.manifest.source.revision, fixtures.candidate.fingerprint,
      fixtures.prior.manifest.source.revision, fixtures.prior.fingerprint, 'unsupported', 'default OFF', 'packaged OFF',
      'Local', 'Hosted', 'Rollback restores prior identity', 'Live hosted SHA: MISSING', 'Phone: MISSING', 'TLS: MISSING']) assert(words.includes(expected), expected);
    const native = await evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(row => row.innerText.includes('Native calendar')).innerText`);
    assert(native.includes('unsupported'));
    await writeFile(join(output, 'desktop.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
    await click(1);
    await until(`document.querySelector('[role=alert]')?.textContent.includes('fingerprint')`);
    assert.equal(await evaluate(`document.querySelector('article h3') === null`), true, 'invalid artifact hides old plan');
    await click(1); await click(2);
    await until(`document.querySelector('[role=alert]')?.textContent.includes('Current identity')`);
    await click(2);
    await evaluate(`const select = document.querySelector('select'); select.value = 'reverse'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
    await until(`document.querySelector('article h3')?.textContent === 'Candidate artifact'`);
    assert.equal(await evaluate(`document.querySelector('article dd').innerText`), fixtures.prior.manifest.source.revision);
    await click(0);
    await until(`!document.querySelector('article')`);
    assert.equal(await evaluate(`document.querySelector('select').value`), 'reverse', 'disable preserves selections');
    await click(0);
    await until(`document.querySelector('article h3')?.textContent === 'Candidate artifact'`);
    assert.equal(await evaluate(`document.querySelector('article dd').innerText`), fixtures.prior.manifest.source.revision);
    await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await until(`window.innerWidth === 390`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'phone page fits viewport; table scroll is scoped');
    await writeFile(join(output, 'phone.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
    console.log('PASS rendered preview: fresh off, exact identities, availability, invalid/stale rejection, reverse plan, disable/return and phone layout');
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}

async function main() {
  requireOptIn();
  const output = await outputDirectory('check-');
  const parts = await loadCandidateParts();
  const fixtures = await modelCheck(parts, output);
  await visibleCheck(output, fixtures);
  console.log(`Evidence: ${relative(repo, output)}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
