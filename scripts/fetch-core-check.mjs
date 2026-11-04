// Offline fixtures only; downloaded bytes are inspected, never executed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installCore } from "./fetch-core.mjs";
import { bundledCore } from "./start.mjs";

globalThis.fetch = () => { throw new Error("network forbidden in fetch-core-check"); };
const temporary = await mkdtemp(join(tmpdir(), "fetch-core-check-"));
const bytes = Buffer.from("fixture bytes, not a program\n\x00\xff", "latin1");
const digest = createHash("sha256").update(bytes).digest("hex");
const tag = "v1.2.3+fixture";
let next = 0;

async function fixture(platform = "linux", arch = "x64") {
  const root = join(temporary, String(next++));
  await mkdir(root);
  const basename = `e2a2o-core-${platform}-${arch}`;
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.credentials, "omit");
    assert.equal(url, `https://github.com/gaviral/e2a2o-app/releases/download/${encodeURIComponent(tag)}/${calls.length === 1 ? "SHA256SUMS" : basename}`);
    assert.ok(calls.length <= 2);
    return new Response(calls.length === 1 ? `${digest}  ${basename}\n` : bytes);
  };
  return { root, basename, calls, options: { root, platform, arch, fetch }, destination: join(root, basename) };
}

async function unchanged(f, action, pattern) {
  const before = await readdir(f.root);
  await assert.rejects(action, pattern);
  assert.deepEqual(await readdir(f.root), before, "failure must not install or leave temporary files");
  assert.equal(bundledCore(f.root, f.options.platform, f.options.arch), null);
}

try {
  for (const platform of ["darwin", "linux"]) {
    for (const arch of ["arm64", "x64"]) {
      const f = await fixture(platform, arch);
      // Another invocation's temporary directory must never be cleaned up.
      const neighbor = join(f.root, ".fetch-core-unrelated");
      await mkdir(neighbor);
      await writeFile(join(neighbor, "keep"), "keep");
      assert.equal(await installCore(tag, f.options), f.destination);
      assert.deepEqual(await readFile(f.destination), bytes);
      assert.equal((await lstat(f.destination)).mode & 0o777, 0o755);
      assert.equal(bundledCore(f.root, platform, arch), f.destination);
      assert.deepEqual((await readdir(f.root)).sort(), [".fetch-core-unrelated", f.basename].sort());
      assert.equal(await readFile(join(neighbor, "keep"), "utf8"), "keep");
      assert.equal(f.calls.length, 2);
    }
  }

  // sha256sum's binary marker, uppercase hex and CRLF are valid too.
  const binaryMarker = await fixture();
  binaryMarker.options.fetch = async (url) => url.endsWith("SHA256SUMS")
    ? new Response(`${"0".repeat(64)}  other-asset\r\n${digest.toUpperCase()} *${binaryMarker.basename}\r\n`)
    : new Response(bytes);
  await installCore(tag, binaryMarker.options);
  assert.deepEqual(await readFile(binaryMarker.destination), bytes);

  for (const invalid of [undefined, "", ".", "..", "../v1", "v1/asset", "v1\\asset", "v1?x", "v1#x", "%2e%2e", "v1\n", "a b", "\0", "\ud800"]) {
    const f = await fixture();
    await unchanged(f, () => installCore(invalid, f.options), /invalid TAG/);
    assert.equal(f.calls.length, 0);
  }
  for (const [platform, arch] of [["win32", "x64"], ["linux", "ia32"], ["darwin", "../x64"], ["../linux", "x64"]]) {
    const f = await fixture();
    await unchanged(f, () => installCore(tag, { ...f.options, platform, arch }), /unsupported platform\/architecture/);
    assert.equal(f.calls.length, 0);
  }

  for (const [manifest, pattern] of [
    ["not a checksum\n", /malformed SHA256SUMS/],
    [`${"g".repeat(64)}  NAME\n`, /malformed SHA256SUMS/],
    [`${digest} NAME\n`, /malformed SHA256SUMS/],
    ["", /exactly one.*found 0/],
    [`${digest}  other-asset\n`, /exactly one.*found 0/],
    [`${digest}  ./NAME\n`, /exactly one.*found 0/],
    [`${digest}  NAME\n${digest} *NAME\n`, /exactly one.*found 2/],
    [`${digest}  NAME\n${"0".repeat(64)}  NAME\n`, /exactly one.*found 2/],
  ]) {
    const f = await fixture();
    let calls = 0;
    await unchanged(f, () => installCore(tag, { ...f.options, fetch: async () => {
      calls++;
      return new Response(manifest.replaceAll("NAME", f.basename));
    } }), pattern);
    assert.equal(calls, 1, "bad manifest must stop before downloading the executable");
  }

  const wrong = await fixture();
  let wrongCalls = 0;
  await unchanged(wrong, () => installCore(tag, { ...wrong.options, fetch: async () =>
    new Response(++wrongCalls === 1 ? `${"0".repeat(64)}  ${wrong.basename}\n` : bytes),
  }), /SHA-256 checksum mismatch/);
  assert.equal(wrongCalls, 2);

  // Failures in either request or either body must be bounded and leave no executable.
  for (const stage of [1, 2]) {
    for (const kind of ["404", "503", "fetch failure", "body failure", "fetch timeout", "body timeout"]) {
      const f = await fixture();
      let calls = 0;
      let signal;
      const fetch = async (url, options) => {
        calls++;
        if (calls !== stage) return f.options.fetch(url, options);
        signal = options.signal;
        if (kind === "404" || kind === "503") return new Response("absent", { status: Number(kind) });
        if (kind === "fetch failure") throw new Error("fixture connection failed");
        if (kind === "body failure") return new Response(new ReadableStream({
          start(controller) { controller.enqueue(bytes); },
          pull(controller) { controller.error(new Error("fixture body interrupted")); },
        }));
        // Intentionally ignore abort in the fake: the installer must still settle.
        if (kind === "fetch timeout") return new Promise(() => {});
        return { ok: true, arrayBuffer: () => new Promise(() => {}) };
      };
      const pattern = kind.includes("timeout") ? /timed out/ : kind === "fetch failure"
        ? /fixture connection failed/ : kind === "body failure" ? /fixture body interrupted/ : new RegExp(`HTTP ${kind}`);
      await unchanged(f, () => installCore(tag, { ...f.options, fetch, timeoutMs: 20 }), pattern);
      assert.equal(calls, stage);
      if (kind.includes("timeout")) assert.equal(signal.aborted, true);
    }
  }

  // Existing files, directories and dangling symlinks all count as occupied.
  for (const kind of ["file", "directory", "symlink"]) {
    const f = await fixture();
    if (kind === "file") await writeFile(f.destination, "existing bytes", { mode: 0o640 });
    if (kind === "directory") await mkdir(f.destination);
    if (kind === "symlink") await symlink("missing-target", f.destination);
    const before = await lstat(f.destination);
    await assert.rejects(() => installCore(tag, f.options), /already exists; refusing to overwrite/);
    assert.deepEqual(await lstat(f.destination), before);
    if (kind === "file") assert.equal(await readFile(f.destination, "utf8"), "existing bytes");
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await readdir(f.root), [f.basename]);
  }

  // A destination created after the initial check is protected by the atomic install.
  const raced = await fixture();
  const racedFetch = raced.options.fetch;
  await assert.rejects(() => installCore(tag, { ...raced.options, fetch: async (url, options) => {
    const response = await racedFetch(url, options);
    if (!url.endsWith("SHA256SUMS")) await writeFile(raced.destination, "concurrent bytes", { mode: 0o600 });
    return response;
  } }), /already exists; refusing to overwrite/);
  assert.equal(await readFile(raced.destination, "utf8"), "concurrent bytes");
  assert.equal((await lstat(raced.destination)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(raced.root), [raced.basename]);

  // Exercise CLI output and exit status in a copied repository with injected fetch.
  const cli = await fixture(process.platform, process.arch);
  await mkdir(join(cli.root, "scripts"));
  const script = join(cli.root, "scripts/fetch-core.mjs");
  await copyFile(join(dirname(fileURLToPath(import.meta.url)), "fetch-core.mjs"), script);
  const shim = join(cli.root, "offline.mjs");
  await writeFile(shim, `
    import { createHash } from 'node:crypto';
    const bytes = Buffer.from('CLI fixture bytes');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const failure = process.env.FIXTURE_FAILURE;
    if (failure === 'timeout') {
      const nativeTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback) => nativeTimeout(callback, 20);
    }
    globalThis.fetch = async (url) => {
      if (failure === '404') return new Response('absent', { status: 404 });
      if (failure === 'timeout') return new Promise(() => {});
      if (failure === 'body') return { ok: true, arrayBuffer: async () => { throw new Error('body interrupted'); } };
      return new Response(url.endsWith('/SHA256SUMS')
        ? (failure === 'digest' ? '0'.repeat(64) : digest)
          + '  e2a2o-core-' + process.platform + '-' + process.arch + '\\n' : bytes);
    };
  `);
  const run = (args, env = {}) => spawnSync(process.execPath, ["--import", shim, script, ...args],
    // Leave room for cold Node startup during parallel gate runs; fetch timeouts are tested separately above.
    { cwd: temporary, env, encoding: "utf8", timeout: 60_000 });
  let result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TAG/);
  assert.match(result.stdout, /e2a2o-core-PLATFORM-ARCH/);
  assert.match(result.stdout, /SHA256SUMS/);
  assert.match(result.stdout, /must already exist/);
  assert.equal(result.stderr, "");
  for (const args of [[], [tag, "extra"], ["../invalid"]]) {
    result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^fetch-core: /);
  }
  for (const [failure, pattern] of [["404", /SHA256SUMS: HTTP 404.*not found/],
    ["digest", /SHA-256 checksum mismatch/], ["body", /body interrupted/], ["timeout", /timed out/]]) {
    result = run([tag], { FIXTURE_FAILURE: failure });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^fetch-core: /);
    assert.match(result.stderr, pattern);
    await assert.rejects(() => lstat(cli.destination), { code: "ENOENT" });
    assert.equal((await readdir(cli.root)).some((name) => name.startsWith(".fetch-core-")), false);
  }
  result = run([tag]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `fetch-core: installed ${cli.basename}\n`);
  assert.equal(result.stderr, "");
  assert.equal(bundledCore(cli.root), cli.destination);
  assert.equal(await readFile(cli.destination, "utf8"), "CLI fixture bytes");
  result = run([tag]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /already exists/);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("fetch-core-check: ok");
