// No extra dependencies. run.sh calls `node scripts/start.mjs MODE ...` before building, so a missing key or a busy
// port shows up in a second, not after a few minutes of compiling. It answers with what the core itself will see:
// the process environment first, then ../.env and the first .env found from core/ upward, read the way the core's
// dotenvy 0.15 reads them (an `export ` prefix, spaces around `=`, quotes, `#` comments, $VAR), and it probes the
// addresses the core will bind for that mode. Before any of that, it checks what the build needs on this machine (the
// Rust version, a C compiler, OpenSSL's headers on Linux). On success it prints the port; on a problem it says what to
// do, exit 1.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4321;

/** dotenvy's QuotedLines: one logical line each, joined across newlines while a quote is open. */
function* logicalLines(text) {
  const raw = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let buf = "";
  let state = "complete";
  let at = 0;
  for (const [i, piece] of raw.entries()) {
    if (!buf) at = i + 1;
    const start = buf.length;
    buf += piece;
    if (buf.trimStart().startsWith("#")) { yield { line: "", at }; buf = ""; state = "complete"; continue; }
    let cut = -1;
    let pos = 0;
    for (const c of piece) {
      if (state === "white") {
        if (c === "#") { cut = pos; state = "comment"; break; }
        state = c === "\\" ? "escape" : c === '"' ? "weak" : c === "'" ? "strong" : "complete";
      } else if (state === "escape") state = "complete";
      else if (state === "complete") {
        state = /\s/.test(c) && c !== "\n" && c !== "\r" ? "white" : c === "\\" ? "escape" : c === '"' ? "weak" : c === "'" ? "strong" : "complete";
      } else if (state === "weak") state = c === "\\" ? "weakEscape" : c === '"' ? "complete" : "weak";
      else if (state === "weakEscape") state = "weak";
      else if (state === "strong") state = c === "\\" ? "strongEscape" : c === "'" ? "complete" : "strong";
      else if (state === "strongEscape") state = "strong";
      pos += c.length;
    }
    if (state === "comment") { yield { line: buf.slice(0, start + cut), at }; buf = ""; state = "complete"; }
    else if (state === "complete") { yield { line: buf.replace(/\r?\n$/, ""), at }; buf = ""; }
  }
  if (buf) yield { error: true, at };
}

/** dotenvy's parse_value; `lookup` gives $VAR substitutions (the environment as loading has left it). */
function parseValue(input, lookup) {
  let strong = false, weak = false, escaped = false, expectingEnd = false;
  let out = "", mode = "none", name = "";
  const substitute = () => { out += lookup(name) ?? ""; name = ""; };
  for (const c of input) {
    if (expectingEnd) {
      if (c === " " || c === "\t") continue;
      if (c === "#") break;
      return null;
    } else if (escaped) {
      if ("\\'\"$ ".includes(c)) out += c;
      else if (c === "n") out += "\n";
      else return null;
      escaped = false;
    } else if (strong) {
      if (c === "'") strong = false; else out += c;
    } else if (mode !== "none") {
      if (/[\p{L}\p{N}]/u.test(c)) name += c;
      else if (mode === "block") {
        if (c === "{" && !name) mode = "braced";
        else { substitute(); if (c === "$") mode = "block"; else { mode = "none"; out += c; } }
      } else if (c === "}") { mode = "none"; substitute(); }
      else name += c;
    } else if (c === "$") mode = "block";
    else if (weak) {
      if (c === '"') weak = false; else if (c === "\\") escaped = true; else out += c;
    } else if (c === "'") strong = true;
    else if (c === '"') weak = true;
    else if (c === "\\") escaped = true;
    else if (c === " " || c === "\t") expectingEnd = true;
    else out += c;
  }
  if (mode === "braced" || strong || weak) return null;
  substitute();
  return out;
}

/** One .env loaded into `env` the way dotenvy's `load` does: a variable already set (even empty) is kept, the
 *  first occurrence in the file wins, and loading stops at the first line it can't read (earlier lines stay). */
export function loadDotenv(text, env) {
  const local = new Map();
  const lookup = (name) => (name in env ? env[name] : local.get(name));
  for (const { line, error, at: n } of logicalLines(text.replace(/^\uFEFF/, ""))) {
    if (error) return { badLine: n };
    let rest = line.trimEnd().trimStart();
    if (!rest || rest.startsWith("#")) continue;
    const keyAt = (s) => (/^[A-Za-z_][A-Za-z0-9_.]*/.exec(s) ?? [""])[0];
    let key = keyAt(rest);
    if (!key) return { badLine: n };
    rest = rest.slice(key.length).trimStart();
    if (key === "export" && !rest.startsWith("=")) {
      key = keyAt(rest);
      if (!key) return { badLine: n };
      rest = rest.slice(key.length).trimStart();
    }
    if (!rest.startsWith("=")) return { badLine: n };
    rest = rest.slice(1).trimStart();
    const value = !rest || rest.startsWith("#") ? "" : parseValue(rest, lookup);
    if (value === null) return { badLine: n };
    local.set(key, value);
    if (!(key in env)) env[key] = value;
  }
  return {};
}

/** The environment the core starts with: `env`, then ../.env (from core/), then the first .env from core/ upward. */
export function coreEnv(env, root) {
  const out = { ...env };
  const notes = [];
  const files = [join(root, ".env")];
  for (let dir = join(root, "core"); ; dir = dirname(dir)) {
    const f = join(dir, ".env");
    if (existsSync(f) && statSync(f).isFile()) { files.push(f); break; }
    if (dirname(dir) === dir) break;
  }
  for (const f of files) {
    if (!existsSync(f)) continue;
    const { badLine } = loadDotenv(readFileSync(f, "utf8"), out);
    if (badLine && !notes.some((x) => x.includes(f))) notes.push(`${f}: line ${badLine} can't be read, so it and the lines after it are ignored.`);
  }
  return { env: out, notes };
}

/** The core's PORT: a whole number up to 65535 (Rust's u16 parse), else 4321. */
export function corePort(env) {
  const p = env.PORT ?? "";
  return /^\+?\d+$/.test(p) && Number(p) <= 65535 ? Number(p) : DEFAULT_PORT;
}

/** The addresses main.rs binds: a room through a tunnel → loopback; an HTTPS room → loopback and the LAN address;
 *  an HTTP room → every address; alone → loopback. */
export function coreAddresses(env, lan) {
  const room = (env.ROOM_CODE ?? "").trim() !== "";
  if (!room) return { addresses: ["127.0.0.1"] };
  if ((env.PUBLIC_URL ?? "").trim() !== "") return { addresses: ["127.0.0.1"] };
  if (env.ROOM_HTTPS === "1") {
    if (!lan) return { error: "A room needs this laptop on a network (no LAN address found): connect to Wi-Fi, then run it again." };
    return { addresses: ["127.0.0.1", lan] };
  }
  return { addresses: ["0.0.0.0"] };
}

/** This laptop's LAN address, found as the core finds it: the route a UDP socket would take (nothing is sent). */
export async function lanIp() {
  for (const [host, port] of [["8.8.8.8", 80], ["192.168.0.1", 80], ["10.0.0.1", 80]]) {
    const ip = await new Promise((resolve) => {
      const s = createSocket("udp4");
      s.on("error", () => { s.close(); resolve(null); });
      s.bind(0, "0.0.0.0", () => s.connect(port, host, (err) => {
        const a = err ? null : s.address().address;
        s.close();
        resolve(a);
      }));
    });
    if (ip && ip !== "0.0.0.0" && !ip.startsWith("127.")) return ip;
  }
  return null;
}

/** Whether `port` can be opened on `host` right now (then closed again). */
export function free(port, host) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

/** What run.sh should do: { code, out, err }. `args` are run.sh's own arguments. */
export async function check(args, env, root, lan = lanIp) {
  const { env: core, notes } = coreEnv(env, root);
  const err = [...notes];
  const mode = args[0] ?? "";
  if ((mode === "demo" || mode === "room") && !(core.MODEL_API_KEY ?? "").trim()) {
    const copy = existsSync(join(root, ".env")) ? "" : "cp .env.example .env, then ";
    err.push(`./run.sh ${mode} needs a Meta Model API key: ${copy}paste the key after MODEL_API_KEY= in .env.`);
    err.push("No key? ./run.sh sample opens a ready-made map without one.");
    return { code: 1, out: "", err: err.join("\n") };
  }
  const port = corePort(core);
  const { addresses, error } = coreAddresses(core, await lan());
  if (error) return { code: 1, out: "", err: [...err, error].join("\n") };
  for (const host of addresses) {
    if (!(await free(port, host))) {
      const where = host === "127.0.0.1" ? "" : ` (on ${host === "0.0.0.0" ? "this laptop's network addresses" : host})`;
      err.push(`Port ${port} is in use${where}. Stop the other app, or use another port: PORT=${Math.min(port + 1, 65535)} ./run.sh${args.length ? " " + args.join(" ") : ""}`);
      return { code: 1, out: "", err: err.join("\n") };
    }
  }
  return { code: 0, out: String(port), err: err.join("\n") };
}

/** The oldest Rust the core builds with: core/Cargo.toml's rust-version (the highest any locked crate needs). */
export function rustFloor(root) {
  return /^rust-version\s*=\s*"([\d.]+)"/m.exec(readFileSync(join(root, "core", "Cargo.toml"), "utf8"))?.[1] ?? null;
}

/** Whether a command runs and exits 0 (a missing command is a no); `pkg-config openssl` asks for OpenSSL's headers. */
function runs(cmd) {
  const [file, args] = {
    rustc: ["rustc", ["--version"]],
    rustup: ["rustup", ["--version"]],
    cc: ["cc", ["--version"]],
    "pkg-config": ["pkg-config", ["--version"]],
    "pkg-config openssl": ["pkg-config", ["--exists", "openssl"]],
    "xcode-select -p": ["xcode-select", ["-p"]],
  }[cmd];
  const r = spawnSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 });
  return { ok: !r.error && r.status === 0, out: r.stdout ?? "" };
}

/** The one line that installs a C compiler, pkg-config and OpenSSL's headers, from /etc/os-release. */
function linuxInstall(osRelease) {
  const ids = (/^ID_LIKE=(.*)$/m.exec(osRelease)?.[1] ?? "") + " " + (/^ID=(.*)$/m.exec(osRelease)?.[1] ?? "");
  const has = (id) => ids.replace(/"/g, "").split(/\s+/).includes(id);
  if (has("debian") || has("ubuntu")) return "sudo apt install build-essential pkg-config libssl-dev";
  if (has("fedora") || has("rhel")) return "sudo dnf install gcc pkgconf-pkg-config openssl-devel";
  if (has("arch")) return "sudo pacman -S --needed base-devel openssl";
  return "sudo apt install build-essential pkg-config libssl-dev (Debian or Ubuntu; elsewhere, your system's C compiler, pkg-config and OpenSSL development packages)";
}

/** What this machine lacks to build the core, as what to say (the fix last, one command), or null. run.sh has already
 *  checked that cargo exists. */
export function toolchainProblem({ floor, platform = process.platform, run = runs, env = process.env, osRelease } = {}) {
  const problems = [];
  const rustc = run("rustc");
  const [have, need] = [/rustc (\d+)\.(\d+)/.exec(rustc.out)?.slice(1).map(Number), floor?.split(".").map(Number)];
  if (rustc.ok && have && need && (have[0] < need[0] || (have[0] === need[0] && have[1] < need[1]))) {
    const v = /rustc (\S+)/.exec(rustc.out)[1];
    problems.push(run("rustup").ok
      ? `Rust ${floor} or newer is needed; this is rustc ${v}.\nRun: rustup update`
      : `Rust ${floor} or newer is needed; this is rustc ${v}, from the system rather than rustup. Install rustup's, then open a new terminal and run this again.\nRun: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`);
  }
  if (platform === "darwin" && !run("xcode-select -p").ok) {
    problems.push("The Rust core's build needs Apple's command-line tools (its C compiler and linker).\nRun: xcode-select --install");
  } else if (platform === "linux") {
    const missing = [];
    if (!run("cc").ok) missing.push("a C compiler");
    if (!(env.OPENSSL_DIR ?? "").trim()) {
      if (!run("pkg-config").ok) missing.push("pkg-config");
      if (!run("pkg-config openssl").ok) missing.push("OpenSSL's headers");
    }
    if (missing.length) {
      let os = osRelease;
      if (os === undefined) { try { os = readFileSync("/etc/os-release", "utf8"); } catch { os = ""; } }
      problems.push(`The Rust core's build needs a C compiler, pkg-config and OpenSSL's headers; missing: ${missing.join(", ")}.\nRun: ${linuxInstall(os)}`);
    }
  }
  return problems.length ? problems.join("\n") : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const lacks = toolchainProblem({ floor: rustFloor(root) });
  if (lacks) { console.error(lacks); process.exit(1); }
  const { code, out, err } = await check(process.argv.slice(2), process.env, root);
  if (err) console.error(err);
  if (out) console.log(out);
  process.exit(code);
}
