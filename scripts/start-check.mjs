// No extra dependencies: run with `node scripts/start-check.mjs`.
// run.sh's pre-build check (scripts/start.mjs) must agree with the core: it reads .env as dotenvy 0.15 does, lets the
// process environment win, takes PORT from either, and probes every address the core binds for the mode, so a
// missing key or a busy port stops the run before the build, never after it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, coreAddresses, corePort, free, lanIp, loadDotenv } from "./start.mjs";

const load = (text, env = {}) => { const out = { ...env }; const r = loadDotenv(text, out); return { ...out, ...r }; };

// dotenvy's own test file (iter.rs test_parse_line_env) reads to these values.
const vectors = load(`
KEY=1
KEY2="2"
KEY3='3'
KEY4='fo ur'
KEY5="fi ve"
KEY6=s\\ ix
KEY7=
KEY8=
KEY9=   # foo
KEY10  ="whitespace before ="
KEY11=    "whitespace after ="
export="export as key"
export   SHELL_LOVER=1
`);
assert.deepEqual(vectors, {
  KEY: "1", KEY2: "2", KEY3: "3", KEY4: "fo ur", KEY5: "fi ve", KEY6: "s ix", KEY7: "", KEY8: "", KEY9: "",
  KEY10: "whitespace before =", KEY11: "whitespace after =", export: "export as key", SHELL_LOVER: "1",
});

// The key: what dotenvy accepts counts, a quoted empty value doesn't, the process environment wins (even empty).
assert.equal(load("export MODEL_API_KEY=valid-key\n").MODEL_API_KEY, "valid-key");
assert.equal(load("MODEL_API_KEY = valid-key\n").MODEL_API_KEY, "valid-key");
assert.equal(load("MODEL_API_KEY=valid-key # mine\n").MODEL_API_KEY, "valid-key");
assert.equal(load('MODEL_API_KEY=""\n').MODEL_API_KEY, "");
assert.equal(load("MODEL_API_KEY='  '\n").MODEL_API_KEY, "  ");
assert.equal(load("MODEL_API_KEY=from-file\n", { MODEL_API_KEY: "from-env" }).MODEL_API_KEY, "from-env");
assert.equal(load("MODEL_API_KEY=from-file\n", { MODEL_API_KEY: "" }).MODEL_API_KEY, "");
assert.equal(load("MODEL_API_KEY=first\nMODEL_API_KEY=second\n").MODEL_API_KEY, "first");
assert.equal(load("A=k1\nMODEL_API_KEY=${A}\n").MODEL_API_KEY, "k1");
assert.equal(load('MODEL_API_KEY="multi\nline"\n').MODEL_API_KEY, "multi\nline");
// A line dotenvy can't read stops loading there; lines before it still count.
const bad = load("PORT=4400\nnot a line\nMODEL_API_KEY=late\n");
assert.equal(bad.PORT, "4400");
assert.equal(bad.MODEL_API_KEY, undefined);
assert.equal(bad.badLine, 2);

// The port: PORT as Rust's u16 parse reads it, else 4321.
assert.equal(corePort({}), 4321);
assert.equal(corePort({ PORT: "4400" }), 4400);
assert.equal(corePort({ PORT: "+4400" }), 4400);
assert.equal(corePort({ PORT: "70000" }), 4321);
assert.equal(corePort({ PORT: "44 00" }), 4321);

// The addresses, as main.rs binds them.
assert.deepEqual(coreAddresses({}, "192.168.1.5").addresses, ["127.0.0.1"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1" }, "192.168.1.5").addresses, ["127.0.0.1", "192.168.1.5"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345" }, "192.168.1.5").addresses, ["0.0.0.0"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "0" }, "192.168.1.5").addresses, ["0.0.0.0"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1", PUBLIC_URL: "https://x.trycloudflare.com" }, null).addresses, ["127.0.0.1"]);
assert.ok(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1" }, null).error);
assert.deepEqual(coreAddresses({ ROOM_CODE: "  " }, "192.168.1.5").addresses, ["127.0.0.1"]);

// End to end on real sockets, in a throwaway folder (an empty core/.env stops the upward .env search there).
const repo = (dotenv) => {
  const dir = mkdtempSync(join(tmpdir(), "e2a2o-start-"));
  mkdirSync(join(dir, "core"));
  writeFileSync(join(dir, "core", ".env"), "");
  if (dotenv !== undefined) writeFileSync(join(dir, ".env"), dotenv);
  return dir;
};
const hold = (host) => new Promise((resolve) => { const s = createServer(); s.listen(0, host, () => resolve(s)); });
const close = (s) => new Promise((resolve) => s.close(resolve));
const noLan = async () => null;

// No key anywhere, or only an empty one: demo and room stop; the copy hint only when .env is missing.
let r = await check(["demo"], {}, repo());
assert.equal(r.code, 1);
assert.match(r.err, /cp \.env\.example \.env, then paste/);
r = await check(["room"], {}, repo('MODEL_API_KEY=""\n'));
assert.equal(r.code, 1);
assert.doesNotMatch(r.err, /cp \.env\.example/);
assert.match(r.err, /No key\? \.\/run\.sh sample/);
// A key written the ways dotenvy accepts passes.
const spare = await hold("127.0.0.1");
const sparePort = spare.address().port;
await close(spare);
r = await check(["demo"], {}, repo(`export MODEL_API_KEY=valid-key\nPORT=${sparePort}\n`), noLan);
assert.equal(r.code, 0, r.err);
assert.equal(r.out, String(sparePort));
// The sample needs no key.
r = await check(["sample"], { PORT: String(sparePort) }, repo(), noLan);
assert.equal(r.code, 0, r.err);

// PORT from .env is the one probed; the environment's PORT wins over it.
const busy = await hold("127.0.0.1");
const busyPort = busy.address().port;
r = await check(["sample"], {}, repo(`PORT=${busyPort}\n`), noLan);
assert.equal(r.code, 1);
assert.match(r.err, new RegExp(`Port ${busyPort} is in use\\. .*PORT=${busyPort + 1} \\./run\\.sh sample$`));
r = await check(["sample"], { PORT: String(sparePort) }, repo(`PORT=${busyPort}\n`), noLan);
assert.equal(r.code, 0, r.err);
assert.equal(r.out, String(sparePort));
await close(busy);

// A room: a port taken only on the LAN address (loopback free) is caught too.
const lan = await lanIp();
if (lan) {
  const onLan = await hold(lan);
  const lanPort = onLan.address().port;
  assert.ok(await free(lanPort, "127.0.0.1"), "loopback is free, so a loopback-only probe would have missed it");
  r = await check(["room"], { MODEL_API_KEY: "k", ROOM_CODE: "abcd2345", ROOM_HTTPS: "1", PORT: String(lanPort) }, repo());
  assert.equal(r.code, 1);
  assert.match(r.err, new RegExp(`Port ${lanPort} is in use \\(on ${lan.replace(/\./g, "\\.")}\\)`));
  await close(onLan);
} else console.log("start-check: no LAN address here; skipped the LAN-port case");
r = await check(["room"], { MODEL_API_KEY: "k", ROOM_CODE: "abcd2345", ROOM_HTTPS: "1", PORT: String(sparePort) }, repo(), noLan);
assert.equal(r.code, 1);
assert.match(r.err, /needs this laptop on a network/);

console.log("start-check: all passed");
