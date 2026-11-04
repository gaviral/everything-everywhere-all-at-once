// No extra dependencies: run with `node scripts/start-check.mjs`.
// run.sh's pre-build check (scripts/start.mjs) must agree with the core: it reads .env as dotenvy 0.15 does, lets the
// process environment win, takes PORT from either, and probes every address the core binds for the mode, so a
// missing key or a busy port stops the run before the build, never after it.
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledCore, check, coreAddresses, corePort, free, lanIp, launchUrl, loadDotenv, rustFloor, toolchainProblem } from "./start.mjs";

// A launch starts several Node processes; allow for parallel precheck builds on a busy machine.
const LAUNCH_TIMEOUT_MS = 60000;
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
assert.equal(launchUrl(4321, "sample"), "http://localhost:4321/?sample");
assert.equal(launchUrl(4411, "sample"), "http://localhost:4411/?sample");
assert.equal(launchUrl(4411, "demo"), "http://localhost:4411/");
assert.equal(launchUrl(4411), "http://localhost:4411/");

// The addresses, as main.rs binds them.
assert.deepEqual(coreAddresses({}, "192.168.1.5").addresses, ["127.0.0.1"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1" }, "192.168.1.5").addresses, ["127.0.0.1", "192.168.1.5"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345" }, "192.168.1.5").addresses, ["0.0.0.0"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "0" }, "192.168.1.5").addresses, ["0.0.0.0"]);
assert.deepEqual(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1", PUBLIC_URL: "https://x.trycloudflare.com" }, null).addresses, ["127.0.0.1"]);
assert.ok(coreAddresses({ ROOM_CODE: "abcd2345", ROOM_HTTPS: "1" }, null).error);
assert.deepEqual(coreAddresses({ ROOM_CODE: "  " }, "192.168.1.5").addresses, ["127.0.0.1"]);

// End to end on real sockets, in a throwaway folder (an empty core/.env stops the upward .env search there).
// Each throwaway folder goes when the check ends (the temp folder held 1,952 of them on 2026-11-02).
const made = [];
process.on("exit", () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const repo = (dotenv) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "e2a2o-start-")));
  made.push(dir);
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

// Another machine: before a few minutes of compiling, run.sh names what the build will lack, with the one command
// that fixes it. The floor is core/Cargo.toml's rust-version (the highest any locked crate needs: uuid 1.29, 1.89).
// fileURLToPath, not .pathname: a clone under a folder with a space would read "%20" and miss core/Cargo.toml.
const root = fileURLToPath(new URL("..", import.meta.url));
const floor = rustFloor(root);
assert.equal(floor, "1.89");
assert.match(readFileSync(join(root, "README.md"), "utf8"), new RegExp(`Needs Rust ${floor.replace(".", "\\.")} or newer`));
// A fake machine: `has` lists the commands that run; rustc answers `rustc`.
const machine = ({ platform = "linux", rustc = "rustc 1.91.0 (abc 2025-10-30)", has = [], os = "ID=ubuntu\nID_LIKE=debian\n", env = {} }) =>
  toolchainProblem({ platform, floor, osRelease: os, env, run: (cmd) => cmd === "rustc" ? (rustc ? { ok: true, out: rustc } : { ok: false, out: "" }) : { ok: has.includes(cmd), out: "" } });
const linuxAll = ["rustup", "cc", "pkg-config", "pkg-config openssl"];
assert.equal(machine({ has: linuxAll }), null);
// Rust: older than the floor stops with the fix; rustup or not decides which fix. Versions compare as numbers.
assert.match(machine({ rustc: "rustc 1.75.0 (82e1608df 2023-12-21) (built from a source tarball)", has: linuxAll }), /Rust 1\.89 or newer.*rustc 1\.75\.0[\s\S]*Run: rustup update$/);
assert.match(machine({ rustc: "rustc 1.75.0", has: ["cc", "pkg-config", "pkg-config openssl"] }), /Run: curl .*https:\/\/sh\.rustup\.rs \| sh$/);
assert.equal(machine({ rustc: "rustc 1.89.0 (29483883e 2025-08-04)", has: linuxAll }), null);
assert.equal(machine({ rustc: "rustc 1.100.0", has: linuxAll }), null);
assert.equal(machine({ rustc: "rustc 1.90.0-nightly (abc 2025-07-01)", has: linuxAll }), null);
assert.equal(machine({ rustc: null, has: linuxAll }), null, "no rustc: run.sh's own cargo check already says so");
// Linux: a C compiler (the linker cargo calls is cc), pkg-config and OpenSSL's headers; one install line for all.
const apt = "Run: sudo apt install build-essential pkg-config libssl-dev";
let m = machine({ has: ["rustup"] });
assert.match(m, /a C compiler, pkg-config, OpenSSL's headers/);
assert.ok(m.endsWith(apt), m);
m = machine({ has: ["rustup", "cc", "pkg-config"] });
assert.match(m, /missing: OpenSSL's headers/);
assert.ok(m.endsWith(apt), m);
assert.ok(machine({ has: ["rustup", "pkg-config", "pkg-config openssl"] }).endsWith(apt));
assert.equal(machine({ has: ["rustup", "cc"], env: { OPENSSL_DIR: "/opt/ssl" } }), null, "OPENSSL_DIR points openssl-sys past pkg-config");
assert.equal(machine({ has: ["rustup", "cc"], env: { OPENSSL_LIB_DIR: "/opt/ssl/lib", OPENSSL_INCLUDE_DIR: "/opt/ssl/include" } }), null, "both directory variables point openssl-sys past pkg-config");
assert.match(machine({ has: ["rustup", "cc"], env: { OPENSSL_LIB_DIR: "/opt/ssl/lib" } }), /missing: pkg-config, OpenSSL's headers/, "the lib directory alone still needs pkg-config for the headers");
assert.ok(machine({ has: ["rustup"], os: 'ID=fedora\n' }).endsWith("Run: sudo dnf install gcc pkgconf-pkg-config openssl-devel"));
assert.ok(machine({ has: ["rustup"], os: 'ID="rocky"\nID_LIKE="rhel centos fedora"\n' }).endsWith("Run: sudo dnf install gcc pkgconf-pkg-config openssl-devel"));
assert.ok(machine({ has: ["rustup"], os: "ID=arch\n" }).endsWith("Run: sudo pacman -S --needed base-devel openssl"));
assert.match(machine({ has: ["rustup"], os: "ID=gentoo\n" }), /sudo apt install build-essential pkg-config libssl-dev \(Debian or Ubuntu/);
// Both wrong: the Rust fix comes first, then the rest, so one read fixes both.
assert.match(machine({ rustc: "rustc 1.75.0", has: ["rustup"] }), /rustup update\n[\s\S]*apt install/);
// A Mac: Apple's command-line tools hold the C compiler and linker; OpenSSL isn't used there (native TLS).
assert.equal(machine({ platform: "darwin", has: ["rustup", "xcode-select -p"] }), null);
assert.ok(machine({ platform: "darwin", has: ["rustup"] }).endsWith("Run: xcode-select --install"));
// Windows (Git Bash): only the Rust check; rustup's own installer sets up the C++ build tools.
assert.equal(machine({ platform: "win32", has: ["rustup"] }), null);
// This machine passes, as run.sh will ask it.
assert.equal(toolchainProblem({ floor }), null, "this machine can't build the core");

// A Windows clone (core.autocrlf=true) keeps every shell script LF, or run.sh dies on its first line.
const sh = execFileSync("git", ["ls-files", "*.sh"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
assert.ok(sh.includes("run.sh"));
for (const line of execFileSync("git", ["check-attr", "eol", "--", ...sh], { cwd: root, encoding: "utf8" }).trim().split("\n"))
  assert.match(line, /: eol: lf$/, `${line}: a Windows checkout would give it CRLF line endings`);
assert.match(readFileSync(join(root, "README.md"), "utf8"), /\*\*Windows:\*\* .*WSL2/);

// Run the real shell entry point in isolated trees, with only Node, basic file commands and harmless stubs.
// No inherited credentials, developer tools or runtime data; even the sample is a tiny invented fixture.
const executable = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const fixture = () => {
  const dir = repo("PORT=0\nMODEL_API_KEY=file-key\n");
  for (const sub of ["scripts", "ui", "bin", "samples/images/student-week"]) mkdirSync(join(dir, sub), { recursive: true });
  for (const file of ["run.sh", "scripts/start.mjs"]) copyFileSync(join(root, file), join(dir, file));
  chmodSync(join(dir, "run.sh"), 0o755);
  symlinkSync(process.execPath, join(dir, "bin/node"));
  for (const cmd of ["dirname", "mkdir", "cp"]) {
    const path = execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).trim();
    symlinkSync(path, join(dir, "bin", cmd));
  }
  executable(join(dir, "bin/npm"), `#!/bin/sh
echo "npm $*" >> "$FIXTURE_LOG"
case "$1" in
  install)
    [ "\${INSTALL_EXIT:-0}" = 0 ] || exit "$INSTALL_EXIT"
    mkdir -p node_modules ;;
  run)
    [ "\${BUILD_EXIT:-0}" = 0 ] || exit "$BUILD_EXIT"
    mkdir -p dist; echo fixture-ui > dist/index.html ;;
esac
exit 0
`);
  executable(join(dir, "fixture-core"), `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync(process.env.FIXTURE_LOG, 'core\\n');
console.log(JSON.stringify({ cwd: process.cwd(), data: process.env.E2A2O_DATA,
  port: process.env.PORT, key: process.env.MODEL_API_KEY, marker: process.env.FIXTURE_MARKER,
  room: process.env.ROOM_CODE, https: process.env.ROOM_HTTPS, publicUrl: process.env.PUBLIC_URL,
  openssl: process.env.OPENSSL_DIR, ui: readFileSync('../ui/dist/index.html', 'utf8'),
  sample: process.env.E2A2O_DATA === '../data/sample' ? readFileSync('../data/sample/journal.jsonl', 'utf8') : null }));
process.exit(Number(process.env.CORE_EXIT ?? 0));
`);
  writeFileSync(join(dir, "samples/student-week.jsonl"), "fixture sample\n");
  writeFileSync(join(dir, "samples/images/student-week/picture.txt"), "fixture picture\n");
  const env = { PATH: join(dir, "bin"), PORT: "0", MODEL_API_KEY: "fixture-env-key",
    FIXTURE_LOG: join(dir, "events"), FIXTURE_MARKER: "kept value", E2A2O_DATA: "../fixture-data",
    OPENSSL_DIR: "/fixture/ssl" };
  const run = (args = [], extra = {}) => spawnSync(join(dir, "run.sh"), args,
    { cwd: tmpdir(), env: { ...env, ...extra }, encoding: "utf8", timeout: LAUNCH_TIMEOUT_MS });
  const events = () => { try { return readFileSync(env.FIXTURE_LOG, "utf8"); } catch { return ""; } };
  const binary = join(dir, `e2a2o-core-${process.platform}-${process.arch}`);
  return { dir, env, run, events, binary };
};
const addBundle = (f) => { copyFileSync(join(f.dir, "fixture-core"), f.binary); chmodSync(f.binary, 0o755); };
const launched = (f, result, status = 0) => {
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr);
  const payload = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(payload.cwd, join(f.dir, "core"));
  assert.equal(payload.ui, "fixture-ui\n");
  assert.equal(payload.key, "fixture-env-key");
  assert.equal(payload.marker, "kept value");
  assert.equal(payload.openssl, "/fixture/ssl");
  assert.equal(payload.port, "0");
  return payload;
};

const bundle = fixture();
assert.equal(bundledCore(bundle.dir), null);
addBundle(bundle);
assert.equal(bundledCore(relative(process.cwd(), bundle.dir)), bundle.binary, "selection is absolute even for a relative root");
assert.equal(bundledCore(bundle.dir, process.platform, "other-arch"), null);
// A directory with execute bits is not an executable regular file.
const directory = fixture();
mkdirSync(directory.binary);
assert.equal(bundledCore(directory.dir), null);
// Selector works without Cargo.toml and with unreadable-as-dotenv .env paths; no check() or build side effects.
rmSync(join(directory.dir, ".env"));
mkdirSync(join(directory.dir, ".env"));
let selected = spawnSync(process.execPath, [join(directory.dir, "scripts/start.mjs"), "--bundled-core"], { env: directory.env, encoding: "utf8" });
assert.equal(selected.status, 0, selected.stderr);
assert.equal(selected.stdout, "");
assert.equal(directory.events(), "");
selected = spawnSync(process.execPath, [join(bundle.dir, "scripts/start.mjs"), "--bundled-core"], { env: bundle.env, encoding: "utf8" });
assert.equal(selected.status, 0, selected.stderr);
assert.equal(selected.stdout, bundle.binary + "\n");
assert.equal(selected.stderr, "");
assert.equal(bundle.events(), "");
const preflight = spawnSync(process.execPath,
  [join(bundle.dir, "scripts/start.mjs"), "--selected-core", bundle.binary, "sample"],
  { env: bundle.env, encoding: "utf8", timeout: LAUNCH_TIMEOUT_MS });
assert.equal(preflight.status, 0, preflight.stderr);
assert.equal(preflight.stdout, "0\n", "preflight stdout stays a machine-readable port");
assert.equal(preflight.stderr, "");
assert.equal(bundle.events(), "");

// There are no Rust, Xcode or Linux build tools in PATH, nor a Cargo manifest to read.
assert.equal(launched(bundle, bundle.run()).data, "../fixture-data");
assert.equal(bundle.events(), "npm install --no-audit --no-fund --no-update-notifier\nnpm run build\ncore\n");
const sampleRun = bundle.run(["sample"]);
const sampled = launched(bundle, sampleRun);
assert.match(sampleRun.stdout, /sample fixture \(no key or mic\): http:\/\/localhost:0\/\?sample\n/);
assert.match(sampleRun.stdout, /Building UI\.\.\.\nUI build complete\.\n[\s\S]*Starting bundled core\.\.\./);
const customSample = bundle.run(["sample"], { PORT: String(sparePort) });
assert.equal(customSample.status, 0, customSample.stderr);
assert.ok(customSample.stdout.includes(`sample fixture (no key or mic): http://localhost:${sparePort}/?sample\n`));
assert.equal(JSON.parse(customSample.stdout.trim().split("\n").at(-1)).port, String(sparePort));
assert.equal(sampled.data, "../data/sample");
assert.equal(sampled.sample, "fixture sample\n");
assert.equal(readFileSync(join(bundle.dir, "data/sample/images/picture.txt"), "utf8"), "fixture picture\n");
const room = launched(bundle, bundle.run(["room"], { ROOM_CODE: "fixture-room", PUBLIC_URL: "https://fixture.invalid" }));
assert.equal(room.data, "../data/room");
assert.equal(room.room, "fixture-room");
assert.equal(room.https, "1");
assert.equal(room.publicUrl, "https://fixture.invalid");

// Key, mode, port and UI checks still stop a bundled launch before it reaches the core.
const blocked = fixture();
addBundle(blocked);
r = blocked.run(["demo"], { MODEL_API_KEY: "" });
assert.equal(r.status, 1);
assert.match(r.stderr, /needs a Meta Model API key/);
assert.equal(blocked.events(), "");
r = blocked.run(["--unknown"]);
assert.equal(r.status, 2);
assert.match(r.stderr, /Unknown option/);
r = blocked.run(["sample", "unknown"]);
assert.equal(r.status, 2);
assert.match(r.stderr, /Unknown sample/);
const occupied = await hold("127.0.0.1");
try {
  r = blocked.run(["sample"], { PORT: String(occupied.address().port) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Port .* is in use/);
} finally { await close(occupied); }
assert.equal(blocked.events(), "");
r = blocked.run([], { INSTALL_EXIT: "9" });
assert.equal(r.status, 1);
assert.match(r.stderr, /The UI dependency install failed/);
assert.equal(blocked.events(), "npm install --no-audit --no-fund --no-update-notifier\n");
// Installation now succeeds; only npm run build fails, so both failure stages are exercised.
r = blocked.run([], { BUILD_EXIT: "9" });
assert.equal(r.status, 1);
assert.match(r.stderr, /The UI build failed/);
assert.doesNotMatch(r.stdout, /UI build complete|Starting bundled core|Building and starting Rust core/);
assert.equal(blocked.events(), "npm install --no-audit --no-fund --no-update-notifier\nnpm install --no-audit --no-fund --no-update-notifier\nnpm run build\n");
assert.doesNotMatch(blocked.events(), /core/);

// A started core's failure is final; no source launch or toolchain probe follows it.
const failing = fixture();
addBundle(failing);
executable(join(failing.dir, "bin/cargo"), '#!/bin/sh\necho unexpected-cargo >> "$FIXTURE_LOG"\nexit 0\n');
for (const cmd of ["rustc", "rustup", "cc", "pkg-config", "xcode-select"]) {
  executable(join(failing.dir, "bin", cmd), '#!/bin/sh\necho unexpected-probe >> "$FIXTURE_LOG"\nexit 1\n');
}
launched(failing, failing.run([], { CORE_EXIT: "23" }), 23);
assert.doesNotMatch(failing.events(), /unexpected/);

for (const kind of ["missing", "non-executable", "other-architecture", "directory"]) {
  const f = fixture();
  if (kind === "non-executable") { addBundle(f); chmodSync(f.binary, 0o644); }
  if (kind === "other-architecture") {
    const other = join(f.dir, `e2a2o-core-${process.platform}-other-arch`);
    copyFileSync(join(f.dir, "fixture-core"), other);
    chmodSync(other, 0o755);
  }
  if (kind === "directory") mkdirSync(f.binary);
  assert.equal(bundledCore(f.dir), null, kind);
  r = f.run(["sample"]);
  assert.equal(r.status, 1, kind);
  assert.match(r.stderr, /Rust is needed: https:\/\/rustup.rs/);
  assert.equal(f.events(), "");
  // Supply a fake source toolchain; its cargo invocation must keep the same cwd, env and exit status.
  writeFileSync(join(f.dir, "core/Cargo.toml"), 'rust-version = "1.89"\n');
  for (const cmd of ["rustc", "rustup", "cc", "pkg-config", "xcode-select"]) {
    executable(join(f.dir, "bin", cmd), `#!/bin/sh\necho "probe ${cmd} $*" >> "$FIXTURE_LOG"\necho 'rustc 1.100.0'\n`);
  }
  executable(join(f.dir, "bin/cargo"), '#!/bin/sh\necho "cargo $*" >> "$FIXTURE_LOG"\nexec ../fixture-core\n');
  const sourceRun = f.run(["sample"], { CORE_EXIT: "17" });
  const payload = launched(f, sourceRun, 17);
  assert.match(sourceRun.stdout, /Building UI\.\.\.\nUI build complete\.\n[\s\S]*Building and starting Rust core \(cold source build: about 4 min\)\.\.\./);
  assert.equal(payload.data, "../data/sample");
  assert.match(f.events(), /probe rustc --version/);
  assert.match(f.events(), /cargo run --release\ncore\n$/);
}
// Help needs neither Node nor Rust and never starts a build.
const help = fixture();
rmSync(join(help.dir, "bin/node"));
r = help.run(["--help"]);
assert.equal(r.status, 0);
assert.equal(r.stderr, "");
assert.match(r.stdout, /^Usage:/);
assert.equal(help.events(), "");

console.log("start-check: all passed");
