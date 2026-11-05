// Focused, offline check: replay the shipped map and run the launcher with harmless local stubs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { uiServer } from './ui-server.mjs';

const root = new URL('../', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'developer-sample-check-'));
const read = path => readFileSync(join(root, path), 'utf8');

async function checkMap() {
  globalThis.location = new URL('http://localhost/');
  const server = await uiServer({ configFile: false });
  try {
    const { apply } = await server.ssrLoadModule('/src/core.ts');
    const { searchFields, searchMatches } = await server.ssrLoadModule('/src/search-rules.ts');
    const { palaceCopy } = await server.ssrLoadModule('/src/pictures.ts');
    const changes = read('samples/developer-day.jsonl').trim().split('\n').map(JSON.parse);
    const initial = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {} };
    const world = changes.reduce(apply, initial);
    assert.equal(world.threads.length, 6, 'six release topics are visible');
    assert.equal(world.active, 'T1', 'opens on the release overview');
    assert.match(world.thoughts[0].text, /fictional.*No real payments or deployments/s);
    assert.ok(world.thoughts.every(t => t.placed && t.point && world.threads.some(thread => thread.id === t.thread_id)));
    const unfinished = world.thoughts.filter(t => !t.complete);
    assert.equal(unfinished.length, 1);
    assert.equal(world.threads.find(t => t.id === unfinished[0].thread_id).status, 'dropped');
    assert.match(unfinished[0].text, /different amount/);
    assert.equal(world.thoughts.filter(t => t.decided).length, 1);
    assert.match(world.thoughts.find(t => t.decided).point, /stable response shape/);
    const of = (items, id) => items.filter(item => item.thread_id === id);
    const index = world.threads.map(thread => ({ id: thread.id, fields: searchFields(thread, of(world.thoughts, thread.id), [], of(world.actions, thread.id)) }));
    for (const [query, title] of [
      ['5% 25%', 'Rollout · sandbox → 5% → 25% → all'],
      ['rollback-payments.sh', 'Rollback · flag off first'],
      ['primary backup', 'On-call · a clear handoff'],
      ['ledger', 'Smoke tests · one charge'],
      ['release note', 'Release note · say what changed'],
    ]) assert.equal(world.threads.find(t => t.id === [...searchMatches(index, query)][0])?.title, title, query);
    const manifest = JSON.parse(read('scripts/fixture-provenance.json')).fixtures;
    for (const path of ['samples/developer-day.jsonl', ...world.threads.map(t => `samples/images/developer-day/${t.picture.split('/').at(-1)}`)]) {
      assert.equal(createHash('sha256').update(read(path)).digest('hex'), manifest[path].sha256, `${path}: recorded original fixture`);
    }
    for (const thread of world.threads) {
      assert.equal(palaceCopy(thread.picture), thread.picture, 'vector art works at both picture sizes');
      assert.match(read(`samples/images/developer-day/${thread.picture.split('/').at(-1)}`), /<svg.*aria-label="Example payments API:/);
    }
  } finally { await server.close(); }
}

function executable(path, content) { writeFileSync(path, content); chmodSync(path, 0o755); }
function checkLauncher() {
  const dir = join(scratch, 'launcher');
  for (const part of ['scripts', 'bin', 'core', 'ui/node_modules']) mkdirSync(join(dir, part), { recursive: true });
  copyFileSync(join(root, 'run.sh'), join(dir, 'run.sh'));
  symlinkSync(process.execPath, join(dir, 'bin/node'));
  symlinkSync('/usr/bin/dirname', join(dir, 'bin/dirname'));
  executable(join(dir, 'bin/npm'), '#!/bin/sh\nexit 0\n');
  executable(join(dir, 'fake-core'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(dir, 'scripts/start.mjs'), `import { appendFileSync } from 'node:fs';
const [command, , fixture] = process.argv.slice(2);
if (command === '--bundled-core') console.log(process.cwd() + '/fake-core');
if (command === '--data-path') console.log(process.cwd() + '/synthetic-map');
if (command === '--selected-core') console.log('0');
if (command === '--open-url') console.log('http://localhost:0/?sample');
if (command === '--seed-sample') appendFileSync(process.env.SAMPLE_RECEIPT, fixture + '\\n');
`);
  for (const [args, expected] of [[[], 'developer-day'], [['developer'], 'developer-day'], [['student'], 'student-week'], [['founder'], 'founder-day']]) {
    const receipt = join(scratch, `selected-${expected}-${args.length}.txt`);
    const result = spawnSync('/bin/sh', [join(dir, 'run.sh'), 'sample', ...args], {
      cwd: dir, env: { PATH: join(dir, 'bin'), SAMPLE_RECEIPT: receipt }, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(receipt, 'utf8'), `${expected}\n`, `sample ${args.join(' ')} selects its fixture`);
  }
  const invalid = spawnSync('/bin/sh', [join(dir, 'run.sh'), 'sample', 'unknown'], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unknown sample/);
}

await checkMap();
checkLauncher();
console.log('developer-sample-check: PASS (map replay, content, search, artwork, provenance, default and named launcher choices)');
console.log(`Synthetic check artifacts retained: ${scratch}`);
