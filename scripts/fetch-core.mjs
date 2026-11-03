// Explicit, dependency-free installation from an already-published release.
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES = "https://github.com/gaviral/e2a2o-app/releases/download/";
const HELP = `Usage: node scripts/fetch-core.mjs TAG

The GitHub release at TAG must already exist in gaviral/e2a2o-app.
Downloads e2a2o-core-PLATFORM-ARCH and SHA256SUMS from that release.
Supported PLATFORM values: darwin, linux. Supported ARCH values: arm64, x64.
TAG must be one URL path component (no slashes, whitespace, %, ? or #).
SHA256SUMS must use sha256sum format: 64 hex digits, a space, then
a space or * and the exact asset name, with exactly one matching entry.
Verifies SHA-256 before making the binary executable and installs beside run.sh.
An existing destination is never replaced. Each download times out after 30 seconds.
This command does not create or publish a release.
`;

async function download(url, name, fetch, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`download timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
        if (!response.ok) {
          controller.abort();
          throw new Error(`HTTP ${response.status}${response.status === 404
            ? "; the release or asset was not found (it must already exist)" : ""}`);
        }
        return Buffer.from(await response.arrayBuffer());
      })(),
      timeout,
    ]);
  } catch (error) {
    throw new Error(`${name}: ${controller.signal.aborted && error.name === "AbortError"
      ? `download timed out after ${timeoutMs} ms` : error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function expectedDigest(manifest, basename) {
  const matches = [];
  for (const [i, line] of manifest.toString("utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const entry = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line);
    if (!entry) throw new Error(`malformed SHA256SUMS entry on line ${i + 1}`);
    if (entry[2] === basename) matches.push(entry[1].toLowerCase());
  }
  if (matches.length !== 1) {
    throw new Error(`SHA256SUMS must contain exactly one entry for ${basename}; found ${matches.length}`);
  }
  return matches[0];
}

/** Inject fetch and the destination root for offline use; returns the installed path. */
export async function installCore(tag, {
  root, platform = process.platform, arch = process.arch, fetch = globalThis.fetch, timeoutMs = 30_000,
} = {}) {
  if (typeof tag !== "string" || !tag || tag === "." || tag === ".."
      || /[\/\\%?#\s\x00-\x1f\x7f]/u.test(tag)) {
    throw new Error("invalid TAG: expected one URL path component without slashes, whitespace, %, ? or #");
  }
  let encodedTag;
  try { encodedTag = encodeURIComponent(tag); }
  catch { throw new Error("invalid TAG: cannot encode URL path component"); }
  if (!["darwin", "linux"].includes(platform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`unsupported platform/architecture: ${platform}/${arch}; use darwin or linux with arm64 or x64`);
  }
  if (typeof root !== "string" || !root) throw new Error("a destination root is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("timeoutMs must be a positive integer no greater than 2147483647");
  }
  const basename = `e2a2o-core-${platform}-${arch}`;
  const destination = resolve(root, basename);
  try {
    await lstat(destination);
    throw new Error(`${basename} already exists; refusing to overwrite`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const base = `${RELEASES}${encodedTag}/`;
  const digest = expectedDigest(await download(`${base}SHA256SUMS`, "SHA256SUMS", fetch, timeoutMs), basename);
  const bytes = await download(`${base}${basename}`, basename, fetch, timeoutMs);
  if (createHash("sha256").update(bytes).digest("hex") !== digest) {
    throw new Error(`SHA-256 checksum mismatch for ${basename}`);
  }

  // A hard link on the destination filesystem atomically refuses even a concurrent destination.
  const temporary = await mkdtemp(join(resolve(root), ".fetch-core-"));
  try {
    const staged = join(temporary, basename);
    await writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
    await chmod(staged, 0o755);
    try { await link(staged, destination); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error(`${basename} already exists; refusing to overwrite`);
      throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return destination;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP);
  } else {
    try {
      if (args.length !== 1) throw new Error("Usage: node scripts/fetch-core.mjs TAG (see --help)");
      const path = await installCore(args[0], { root: resolve(dirname(fileURLToPath(import.meta.url)), "..") });
      console.log(`fetch-core: installed ${basename(path)}`);
    } catch (error) {
      console.error(`fetch-core: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
