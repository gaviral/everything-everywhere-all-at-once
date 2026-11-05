// Synthetic launcher integration: real Rust resolver/seed, stub runtime/build/tunnel; no account or service.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync('cargo', ['build', '--quiet', '--manifest-path', join(root, 'core/Cargo.toml')], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'core/target');
const binary = join(target, 'debug', process.platform === 'win32' ? 'e2a2o-core.exe' : 'e2a2o-core');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'e2a2o-storage-check-')));
const caller = join(scratch, 'caller with spaces'); mkdirSync(caller);
const baseEnv = { PATH: process.env.PATH, HOME: join(scratch, 'synthetic home'), LOCALAPPDATA: join(scratch, 'local'), XDG_DATA_HOME: join(scratch, 'xdg'), MODEL_API_KEY: '', PORT: '0' };
const core = (args, env = {}, cwd = caller) => spawnSync(binary, args, { cwd, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 30_000 });
const initial = readdirSync(scratch);
let r = core(['--data-path', 'sample']);
assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.ok(isAbsolute(r.stdout.trim()));
assert.deepEqual(readdirSync(scratch), initial); assert.ok(!existsSync(r.stdout.trim()));
for (const mode of ['', 'sample', 'demo', 'room', 'named map']) {
  r = core(['--data-path', ...(mode ? [mode] : [])], { E2A2O_DATA: 'external map' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), join(caller, 'external map'));
}
const repo = join(scratch, 'checkout'); mkdirSync(repo); mkdirSync(join(repo, '.git'));
const link = join(scratch, 'alias'); symlinkSync(caller, link);
r = core(['--data-path', 'demo'], { E2A2O_DATA: '../external sibling' }, repo);
assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), join(scratch, 'external sibling'));
mkdirSync(join(repo, 'core')); writeFileSync(join(repo, 'core/Cargo.toml'), 'synthetic manifest'); mkdirSync(join(repo, 'data'));
r = core(['--data-path', 'sample'], {}, repo);
assert.notEqual(r.status, 0); assert.match(r.stderr, /legacy checkout data.*migration/);
assert.deepEqual(readdirSync(join(repo, 'data')), []);
for (const bad of [join(repo, 'new/map'), join(link, 'new/map'), '']) {
  r = core(['--data-path', 'sample'], { E2A2O_DATA: bad });
  assert.notEqual(r.status, 0); assert.equal(r.stdout, '');
}
assert.ok(!existsSync(join(repo, 'new'))); assert.ok(!existsSync(join(caller, 'new')));
for (const bad of [join(repo, 'runtime'), join(link, 'runtime')]) {
  for (const args of [[], ['--seed-sample', 'student-week']]) {
    const runtimeBad = core(args, { E2A2O_DATA: bad });
    assert.notEqual(runtimeBad.status, 0); assert.ok(!existsSync(join(repo, 'runtime'))); assert.ok(!existsSync(join(caller, 'runtime')));
  }
}
const unknown = join(scratch, 'unknown map'); mkdirSync(unknown); writeFileSync(join(unknown, 'journal.jsonl'), 'synthetic existing map');
r = core(['--seed-sample', 'student-week'], { E2A2O_DATA: unknown });
assert.notEqual(r.status, 0); assert.deepEqual(readdirSync(unknown), ['journal.jsonl']);
assert.equal(readFileSync(join(unknown, 'journal.jsonl'), 'utf8'), 'synthetic existing map');
const executable = (p, text) => { writeFileSync(p, text); chmodSync(p, 0o755); };
const fixture = (index) => {
  const dir = join(scratch, `app-${index}`);
  for (const sub of ['.git', 'core', 'scripts', 'ui', 'bin', 'samples/images/student-week', 'samples/images/founder-day', 'samples/images/developer-day']) mkdirSync(join(dir, sub), { recursive: true });
  for (const file of ['run.sh', 'scripts/start.mjs', 'scripts/trial.sh']) copyFileSync(join(root, file), join(dir, file));
  chmodSync(join(dir, 'run.sh'), 0o755);
  writeFileSync(join(dir, 'core/.env'), '');
  for (const sample of ['student-week', 'founder-day', 'developer-day']) {
    writeFileSync(join(dir, `samples/${sample}.jsonl`), `synthetic ${sample}\n`);
    writeFileSync(join(dir, `samples/images/${sample}/picture.webp`), `synthetic ${sample} image`);
  }
  symlinkSync(process.execPath, join(dir, 'bin/node'));
  const stub = `#!${process.execPath}
const fs=require('node:fs'), cp=require('node:child_process'), path=require('node:path');
const args=process.argv.slice(2), at=args.findIndex(x=>['--data-path','--seed-sample'].includes(x));
if(at>=0){ const r=cp.spawnSync(${JSON.stringify(binary)},args.slice(at),{env:process.env,encoding:'utf8'}); process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||''); process.exit(r.status??1); }
if(args[0]==='build') process.exit(0);
const p=process.env.E2A2O_DATA; fs.mkdirSync(p,{recursive:true});
for(const dir of ['images','tls']) fs.mkdirSync(path.join(p,dir),{recursive:true});
for(const f of ['journal.jsonl','trace.jsonl','tls/identity.json','images/synthetic.webp']) fs.appendFileSync(path.join(p,f),'synthetic runtime\\n');
console.log(JSON.stringify({data:p,mode:process.env.E2A2O_MODE,fixture:fs.existsSync(path.join(p,'.sample-map.json'))?JSON.parse(fs.readFileSync(path.join(p,'.sample-map.json'))).fixture:null}));
`;
  executable(join(dir, `e2a2o-core-${process.platform}-${process.arch}`), stub);
  executable(join(dir, 'bin/cargo'), stub);
  executable(join(dir, 'bin/npm'), '#!/bin/sh\nmkdir -p node_modules dist\necho synthetic > dist/index.html\n');
  executable(join(dir, 'bin/cloudflared'), `#!${process.execPath}\nconsole.log('https://synthetic.trycloudflare.com'); setInterval(()=>{}, 1000);\n`);
  executable(join(dir, 'bin/nc'), '#!/bin/sh\nexit 1\n');
  executable(join(dir, 'bin/curl'), '#!/bin/sh\necho \'{"tunnel":true}\'\n');
  // trial.sh's fixed release path is a stub too, so it cannot start a real server or tunnel.
  mkdirSync(join(dir, 'core/target/release'), { recursive: true });
  executable(join(dir, 'core/target/release/e2a2o-core'), stub);
  return dir;
};
let index = 0;
for (const mode of ['', 'sample', 'sample developer', 'sample student', 'sample founder', 'demo', 'room', 'named map', 'trial']) {
  for (const override of [false, true]) {
    const dir = fixture(index++), data = join(caller, `chosen map ${index}`);
    const env = { ...baseEnv, PATH: join(dir, 'bin') + ':' + process.env.PATH,
      MODEL_API_KEY: 'synthetic-key', ROOM_CODE: 'synthetic-room', ROOM_HTTPS: '0',
      ...(override ? { E2A2O_DATA: `chosen map ${index}` } : {}) };
    const args = mode === 'trial' ? [join(dir, 'scripts/trial.sh'), 'tester', '--no-key']
      : [join(dir, 'run.sh'), ...(mode === 'named map' ? [mode] : mode.split(' ').filter(Boolean))];
    r = spawnSync('/bin/sh', args, { cwd: caller, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, `${mode}: ${r.stderr}\n${r.stdout}`);
    let selected;
    if (mode === 'trial') {
      const match = /Trial ended\. tester's map: (.+)/.exec(r.stdout); assert.ok(match, r.stdout); selected = match[1];
      for (const f of ['tunnel.log', 'core.log', 'link.txt', '.trial-claim/launcher', '.port-0/launcher']) assert.ok(existsSync(join(selected, f)), f);
      const payload = JSON.parse(readFileSync(join(selected, 'core.log'), 'utf8').trim()); assert.equal(payload.data, selected);
    } else {
      const payload = JSON.parse(r.stdout.trim().split('\n').at(-1)); selected = payload.data;
      assert.equal(payload.mode, mode.startsWith('sample') ? 'sample' : mode);
      if (mode.startsWith('sample')) {
        assert.equal(payload.fixture, mode.includes('founder') ? 'founder-day' : mode.includes('student') ? 'student-week' : 'developer-day');
        assert.match(r.stdout, /\/\?sample/);
      }
    }
    assert.ok(isAbsolute(selected)); assert.ok(!selected.startsWith(dir + '/'));
    if (override) assert.equal(selected, data);
    for (const f of ['journal.jsonl', 'trace.jsonl', 'tls/identity.json', 'images/synthetic.webp']) assert.ok(existsSync(join(selected, f)), `${mode}: ${f}`);
    assert.ok(!existsSync(join(dir, 'data')));
  }
}
// Unknown destinations are refused through the actual shell entry, before any sample replacement.
const dir = fixture(index++);
r = spawnSync('/bin/sh', [join(dir, 'run.sh'), 'sample'], { cwd: caller, env: { ...baseEnv, PATH: join(dir, 'bin') + ':' + process.env.PATH, E2A2O_DATA: unknown }, encoding: 'utf8', timeout: 60_000 });
assert.notEqual(r.status, 0); assert.match(r.stderr, /non-sample\/unknown map/);
assert.deepEqual(readdirSync(unknown), ['journal.jsonl']);
console.log('storage-check: keyless no-write resolver, unsafe refusals and 18 synthetic launcher cases passed');
console.log(`Synthetic receipts retained: ${scratch}`);
