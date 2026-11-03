// Install to the Dock and a phone's home screen: the manifest, its icons, the page's links to them, the core letting a
// guest's browser fetch them, and when the one-time hint may show. No extra dependencies: `node scripts/install-check.mjs`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { uiServer } from "./ui-server.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const manifest = JSON.parse(read("ui/public/manifest.webmanifest"));
const html = read("ui/index.html");
const styles = read("ui/src/styles.css");

// The page's background in each theme, as styles.css sets it: the shell's paper (--space), the page that opens.
const light = /\nhtml\.shell2 \{[^}]*?--space: (#[0-9a-f]{6})/.exec(styles)[1];
const dark = /prefers-color-scheme: dark\) \{\s*html\.shell2 \{[^}]*?--space: (#[0-9a-f]{6})/.exec(styles)[1];

// What Chrome needs to offer Install, and what keeps one installed app however it was opened.
assert.ok(manifest.name && manifest.short_name.length <= 12, "a name, and a short one that fits under an icon");
assert.equal(manifest.id, "/", "one app whatever page it was installed from");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.theme_color, light);
assert.equal(manifest.background_color, light, "the splash is the page's own paper, so opening doesn't flash");

/** Width, height and a pixel reader for a PNG in ui/public: 8-bit RGB or RGBA, no interlace, any row filter (Chrome
 *  picks one per row). A PNG with no alpha channel reads as opaque. */
function png(path) {
  const bytes = readFileSync(new URL(`ui/public${path}`, root));
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", path);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const channels = { 2: 3, 6: 4 }[bytes[25]];
  assert.ok(bytes[24] === 8 && channels && bytes[28] === 0, `${path}: 8-bit RGB or RGBA, not interlaced`);
  const data = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") data.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? rows[y * stride + i - channels] : 0;
      const up = y ? rows[(y - 1) * stride + i] : 0;
      const upLeft = y && i >= channels ? rows[(y - 1) * stride + i - channels] : 0;
      const [pa, pb, pc] = [Math.abs(up - upLeft), Math.abs(left - upLeft), Math.abs(left + up - 2 * upLeft)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, left, up, (left + up) >> 1, paeth][filter]) & 255;
    }
  }
  const pixel = (x, y) => { const i = y * stride + x * channels; return [rows[i], rows[i + 1], rows[i + 2], channels === 4 ? rows[i + 3] : 255]; };
  return { width, height, pixel };
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (p, q, within) => [0, 1, 2].every((k) => Math.abs(p[k] - q[k]) <= within);

// One icon in three places (the tab, the Dock, the home screen): every PNG paints the plate icon.svg paints, a blue
// that is lighter at the top and deeper at the bottom (its two gradient stops).
const svg = read("ui/public/icon.svg");
const plate = [...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => rgb(m[1]));
assert.equal(plate.length, 2, "icon.svg's plate runs between two stops");
const plateMiddle = plate[0].map((v, k) => (v + plate[1][k]) / 2);

const purposes = new Set();
for (const icon of manifest.icons) {
  assert.ok(existsSync(new URL(`ui/public${icon.src}`, root)), `${icon.src} exists`);
  purposes.add(`${icon.purpose} ${icon.sizes}`);
  if (icon.type !== "image/png") continue;
  const { width, height, pixel } = png(icon.src);
  assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} is the size it claims`);
  if (icon.purpose === "maskable") {
    // Full bleed (a mask cuts it, so no see-through corner) with the plate's bottom blue in its corner, and the glyph
    // inside the safe circle (40 % radius): outside it only plate, the row's own blue give or take the glyph's soft
    // shadow (24 of 255; the worst measured is 21). A ribbon or pearl out there would be 100 or more off.
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) assert.equal(pixel(x, y)[3], 255, `${icon.src} corners are opaque`);
    assert.ok(near(pixel(0, height - 1), plate[1], 8), `${icon.src} is icon.svg's blue at the bottom`);
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
      if (Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > width * 0.4) assert.ok(near(pixel(x, y), pixel(0, y), 24), `${icon.src} (${x}, ${y}) outside the safe circle is plate`);
    }
  } else {
    // The Dock shows it as is: the tile with see-through corners, the plate's blue inside (the middle of its ramp).
    assert.equal(pixel(0, 0)[3], 0, `${icon.src} corner is see-through`);
    const inside = pixel(Math.round(width * 0.15), Math.round(height / 2));
    assert.equal(inside[3], 255, `${icon.src} tile is opaque`);
    assert.ok(near(inside, plateMiddle, 24), `${icon.src} tile is icon.svg's blue`);
  }
}
for (const needed of ["any 192x192", "any 512x512", "maskable 512x512"]) assert.ok(purposes.has(needed), `manifest has ${needed}`);
// The hosted sign-in page inlines icon.svg beside its own ids, under a policy that allows styles by hash only: no
// <style>, no script, no outside reference, every id prefixed; and it's fetched with every page, so it stays small.
assert.match(svg, /^<svg [^>]*viewBox="0 0 32 32"/, "icon.svg is drawn on a 32 px grid");
assert.doesNotMatch(svg, /<style|<script|<image|href=/, "icon.svg is self-contained: no style, script or outside reference");
for (const [, id] of svg.matchAll(/\bid="([^"]+)"/g)) assert.ok(id.startsWith("e2a2o-"), `icon.svg's id ${id} is prefixed e2a2o-`);
assert.ok(svg.length <= 2048, `icon.svg is ${svg.length} bytes; at most 2 KB`);

// The page links them, with both themes' bar colors.
const tag = (pattern) => html.match(new RegExp(`<(?:link|meta)[^>]*${pattern}[^>]*>`))?.[0] ?? "";
const manifestLink = tag('rel="manifest"');
assert.match(manifestLink, /href="\/manifest\.webmanifest"/);
// A sign-in in front of the core (the hosted link) needs its cookie, or the manifest fetch is sent to a login page.
assert.match(manifestLink, /crossorigin="use-credentials"/);
assert.match(tag('content="' + light + '"'), /name="theme-color".*media="\(prefers-color-scheme: light\)"/);
assert.match(tag('content="' + dark + '"'), /name="theme-color".*media="\(prefers-color-scheme: dark\)"/);
const touch = tag('rel="apple-touch-icon"').match(/href="([^"]+)"/)[1];
const touchIcon = png(touch);
assert.equal(touchIcon.width, 180, "iPhone's home-screen size");
assert.equal(touchIcon.pixel(0, 0)[3], 255, "iOS fills see-through corners with black, so the touch icon is full bleed");
const favicon = tag('rel="icon"').match(/href="([^"]+)"/)[1];

// A guest's browser fetches all of these before typing the room's code; the core's gate must let each one through.
const main = read("core/src/main.rs");
const gate = /fn public\(path: &str\) -> bool \{([^]*?)\n\}/.exec(main)[1];
const exact = [...gate.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
const prefixes = [...gate.matchAll(/starts_with\("([^"]+)"\)/g)].map((m) => m[1]);
for (const path of ["/manifest.webmanifest", favicon, touch, ...manifest.icons.map((i) => i.src)]) {
  assert.ok(exact.includes(path) || prefixes.some((p) => path.startsWith(p)), `the core serves ${path} to a guest without the code`);
}

const server = await uiServer();
try {
  const { installWay, hintText, temporaryAddress, eligible, placedSince, shownBefore, rememberShown } = await server.ssrLoadModule("/src/Install.tsx");
  const { buildInTheWay } = await server.ssrLoadModule("/src/Apps.tsx");
  const ua = {
    chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    safariOldMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
    firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
    edgeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  };
  assert.equal(installWay(ua.chromeMac, 0, true), "prompt");
  assert.equal(installWay(ua.chromeMac, 0, false), null, "Chrome without its prompt (installed already, or not a secure page): nothing to say");
  assert.equal(installWay(ua.edgeMac, 0, false), null);
  assert.equal(installWay(ua.safariMac, 0, false), "mac-safari");
  assert.equal(installWay(ua.safariOldMac, 0, false), null, "Safari before 17 has no Add to Dock");
  assert.equal(installWay(ua.safariMac, 5, false), "ios-safari", "an iPad asking for the desktop site");
  assert.equal(installWay(ua.iphone, 5, false), "ios-safari");
  assert.equal(installWay(ua.chromeIphone, 5, false), null);
  assert.equal(installWay(ua.firefoxMac, 0, false), null);
  assert.match(hintText("mac-safari", false), /File › Add to Dock/);
  assert.match(hintText("ios-safari", true), /Share › Add to Home Screen/);
  assert.match(hintText("prompt", false), /Dock/);
  assert.match(hintText("prompt", true), /home screen/);

  for (const host of ["localhost", "127.0.0.1", "[::1]", "e2a2o.example.com"]) assert.equal(temporaryAddress(host), false, host);
  for (const host of ["192.168.1.5", "10.0.0.2", "[fe80::1]", "quiet-river-12.trycloudflare.com"]) assert.equal(temporaryAddress(host), true, host);

  const page = { search: "", hostname: "localhost", standalone: false, toured: true, shownBefore: false };
  assert.equal(eligible(page), true);
  assert.equal(eligible({ ...page, search: "?recording" }), false, "never in a demo take");
  assert.equal(eligible({ ...page, standalone: true }), false, "never in the installed app");
  assert.equal(eligible({ ...page, toured: false }), false, "never over the first tour");
  assert.equal(eligible({ ...page, shownBefore: true }), false, "once per browser");
  assert.equal(eligible({ ...page, hostname: "192.168.1.5" }), false, "never for a room guest's temporary address");

  // Earned by a thought placed in this visit, by id: one taken back and a new one leave the count where it was.
  assert.equal(placedSince(null, ["t1"]), false, "nothing counts before the map arrives");
  assert.equal(placedSince(new Set(["t1"]), ["t1"]), false, "what was on the map at load doesn't count");
  assert.equal(placedSince(new Set(["t1"]), []), false, "scratch that: one fewer, nothing new");
  assert.equal(placedSince(new Set(["t1"]), ["t2"]), true, "scratch that, then a new thought: earned");
  assert.equal(placedSince(new Set(), ["t1", "t2"]), true);

  // Once per browser, read at the moment it would show: another tab that showed it first counts.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  assert.equal(shownBefore(), false, "a fresh browser");
  rememberShown(); // tab A shows it
  assert.equal(shownBefore(), true, "tab B, open since before, sees it was shown");
  globalThis.localStorage = { getItem() { throw new Error("off"); }, setItem() { throw new Error("off"); }, removeItem() {} };
  assert.equal(shownBefore(), true, "storage off: never, since once can't be kept");
  delete globalThis.localStorage;

  // A build is in the way only while it wants the person; the core keeps the last one after it's decided.
  const b = (stage) => ({ id: "build-1", stage });
  assert.equal(buildInTheWay({ build: null, inPanel: false }, null), false);
  assert.equal(buildInTheWay({ build: b("composing"), inPanel: false }, null), true, "its card in the dock");
  assert.equal(buildInTheWay({ build: b("kept"), inPanel: false }, null), true, "its confirmation still showing");
  assert.equal(buildInTheWay({ build: b("kept"), inPanel: false }, "build-1"), false, "kept, and its card gone");
  assert.equal(buildInTheWay({ build: b("declined"), inPanel: false }, "build-1"), false, "dismissed");
  assert.equal(buildInTheWay({ build: b("ready"), inPanel: true }, null), true, "waiting for Keep in the panel");
  assert.equal(buildInTheWay({ build: b("discarded"), inPanel: true }, null), false, "decided in the panel");
} finally {
  await server.close();
}
console.log("install-check: manifest, icons, links, core gate and hint rules hold");
