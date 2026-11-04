import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Reserve a new directory so rename can never replace an older backup.
function seed(fixture, journal) {
  let backup;
  let originalExists = false;
  try {
    const bytes = readFileSync(fixture);
    mkdirSync(dirname(journal), { recursive: true });
    try {
      lstatSync(journal);
      originalExists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (originalExists) {
      const stamp = new Date().toISOString().replaceAll(':', '-');
      const directory = join(dirname(journal), `backup-${stamp}-${randomUUID()}`);
      mkdirSync(directory, { mode: 0o700 });
      const destination = join(directory, 'journal.jsonl');
      renameSync(journal, destination);
      backup = destination;
    }
    const fd = openSync(journal, 'wx', 0o600);
    try {
      writeFileSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
    return backup;
  } catch (error) {
    const preserved = backup
      ? `Prior journal preserved at: ${backup}.`
      : `No backup was made; any prior journal remains at: ${journal}.`;
    throw new Error(`Sample seeding stopped (${error.code || 'error'}). ${preserved} Any failed output is left at: ${journal}.`, { cause: error });
  }
}

function check() {
  const root = mkdtempSync(join(tmpdir(), 'sample-seed-check-'));
  const fixture = join(root, 'fixture.jsonl');
  const journal = join(root, 'data', 'sample', 'journal.jsonl');
  const fixtureBytes = Buffer.from('{"thought":"synthetic example"}\n');
  const priorBytes = Buffer.from('{"thought":"synthetic prior"}\n\x00\xff', 'latin1');
  const addedBytes = Buffer.from('{"thought":"synthetic addition"}\n');
  let held;
  try {
    mkdirSync(dirname(journal), { recursive: true });
    writeFileSync(fixture, fixtureBytes, { flag: 'wx' });
    writeFileSync(journal, priorBytes, { flag: 'wx' });
    held = openSync(journal, 'r');
    const first = seed(fixture, journal);
    assert.ok(readFileSync(journal).equals(fixtureBytes));
    assert.ok(readFileSync(first).equals(priorBytes));
    assert.equal(fstatSync(held).ino, statSync(first).ino);
    assert.ok(readFileSync(held).equals(priorBytes));
    assert.match(first, /backup-\d{4}-\d{2}-\d{2}T[\d.-]+Z-[0-9a-f-]+/);

    appendFileSync(journal, addedBytes);
    const secondPrior = Buffer.concat([fixtureBytes, addedBytes]);
    const second = seed(fixture, journal);
    assert.notEqual(first, second);
    assert.ok(readFileSync(journal).equals(fixtureBytes));
    assert.ok(readFileSync(first).equals(priorBytes));
    assert.ok(readFileSync(second).equals(secondPrior));
    assert.ok(existsSync(first) && existsSync(second));
    console.log(`seeds=2 backups=2 backup_bytes=${priorBytes.length + secondPrior.length}`);
    console.log(`root=${root}\nbackup_1=${first}\nbackup_2=${second}`);
  } catch (error) {
    console.error(`root=${root}`);
    throw error;
  } finally {
    if (held !== undefined) closeSync(held);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    check();
  } else if (args.length === 2) {
    seed(resolve(args[0]), resolve(args[1]));
  } else {
    throw new Error('Usage: node scripts/sample-seed.mjs FIXTURE JOURNAL');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
