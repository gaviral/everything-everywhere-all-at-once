import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { iconBrowser } from "./browser.mjs";
import { chromeFixture } from "./fixture.mjs";

const root = new URL("../../", import.meta.url);
const dist = new URL("ui/dist/", root).pathname;
const read = path => readFileSync(new URL(path, root));
const browser = await iconBrowser();
const errors = [];
try {
  browser.on("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const path = new URL(request.url).pathname;
      const file = resolve(dist, path === "/" ? "index.html" : "." + path);
      const room = path === "/room";
      const available = file.startsWith(dist) && existsSync(file);
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" }[extname(file)] ?? "text/plain";
      await browser.page("Fetch.fulfillRequest", { requestId, responseCode: room || available ? 200 : 404,
        responseHeaders: [{ name: "content-type", value: room ? "application/json" : type }],
        body: (room ? Buffer.from(JSON.stringify({ room: false, member: true })) : available ? readFileSync(file) : Buffer.from("")).toString("base64") });
    } catch (error) { if (!error.message.includes("Invalid InterceptionId")) errors.push(error.message); }
  });
  await browser.page("Runtime.enable");
  await browser.page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `(${chromeFixture})()` });
  async function until(expression, label) {
    const deadline = Date.now() + 8000;
    do {
      if (await browser.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(`TIMING: ${label}; ${JSON.stringify(await browser.evaluate("({ready:document.readyState, intro:!!document.querySelector('.intro-parts'), seen:sessionStorage.getItem('e2a2o.intro-parts.seen'), enabled:localStorage.getItem('e2a2o.bricks'), reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, errors:document.body.innerText.slice(0,300)})"))}; errors=${JSON.stringify(errors)}`);
  }
  async function appearance(scheme) {
    await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  }
  async function open(query, selector, width = 1440) {
    await browser.page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.page("Page.navigate", { url: `https://icon-set.test/${query}` });
    await until(`!!document.querySelector(${JSON.stringify(selector)})`, `visible ${selector}`);
    await until(`[...document.querySelectorAll('.app-mark img')].every(img => img.complete && img.naturalWidth > 0)`, "all marks decoded");
  }
  await appearance("light");
  await open("", ".shell-wordmark img");
  await until("!!document.querySelector('.intro-parts-word')?.getAnimations().length", "opening animation starts");
  await browser.evaluate("[...document.querySelectorAll('.intro-parts *')].flatMap(e => e.getAnimations()).forEach(a => { a.pause(); a.currentTime = 1200; })");
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.intro-parts-icon')).opacity"), "1", "opening resolves to the icon");
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.intro-parts-word')].every(e => getComputedStyle(e).opacity === '0')"), true, "full name gives way to the icon");
  await browser.evaluate("[...document.querySelectorAll('.intro-parts *')].flatMap(e => e.getAnimations()).forEach(a => { a.currentTime = 1950; })");
  const landing = await browser.evaluate("[document.querySelector('.intro-parts-icon'), document.querySelector('.shell-wordmark')].map(e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width]; })");
  assert.ok(landing[0].every((value, i) => Math.abs(value - landing[1][i]) < 2), "opening icon lands on the chrome icon");
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
  await until("!document.querySelector('.intro-parts')", "opening can be skipped");
  assert.ok((await browser.evaluate("document.title")).includes("E2A2O"), "page title retains the name");
  for (const scheme of ["dark", "light"]) {
    await appearance(scheme);
    const suffix = scheme === "dark" ? "/icons/manifest-dark.webmanifest" : "/manifest.webmanifest";
    await until(`document.querySelector('link[rel=manifest]').href.endsWith(${JSON.stringify(suffix)})`, "manifest follows live appearance");
    const state = await browser.evaluate(`({ image:document.querySelector('.shell-wordmark img').currentSrc, touch:document.querySelector('link[rel=apple-touch-icon]').href, favicon:[...document.querySelectorAll('link[rel=icon]')].find(link => matchMedia(link.media).matches)?.href })`);
    assert.ok(state.image.endsWith(scheme === "dark" ? "/icons/icon-dark.svg" : "/icon.svg"));
    assert.ok(state.favicon.endsWith(scheme === "dark" ? "/icons/icon-dark.svg" : "/icon.svg"));
    assert.ok(state.touch.endsWith(scheme === "dark" ? "/icons/apple-touch-icon-dark.png" : "/icons/apple-touch-icon.png"));
  }
  for (const [query, selector, width] of [["", ".shell-wordmark img", 320], ["?shell=1", ".brand img", 390], ["?remote", ".remote-wordmark img", 390], ["?canvas=code", ".cc-eyebrow img", 1440]]) {
    await open(query, selector, width);
    const mark = await browser.evaluate(`(() => { const img=document.querySelector(${JSON.stringify(selector)}); const r=img.getBoundingClientRect(); return { alt:img.alt, width:r.width, x:r.x, right:r.right, text:img.closest('picture').textContent }; })()`);
    assert.equal(mark.alt, "E2A2O", "accessible icon name");
    assert.equal(mark.text, "", "chrome uses the icon instead of visible letters");
    assert.ok(mark.width >= 24 && mark.x >= 0 && mark.right <= width, "icon stays visible on narrow chrome");
    assert.equal(await browser.evaluate("window.iconMediaRequests"), 0, "no microphone requested");
  }
  for (const path of ["manifest.webmanifest", "icons/manifest-dark.webmanifest"]) {
    const manifest = JSON.parse(read(`ui/public/${path}`));
    assert.equal(manifest.id, "/");
    assert.equal(manifest.name, "E2A2O");
    for (const icon of manifest.icons) assert.ok(existsSync(new URL(`ui/public${icon.src}`, root)), icon.src);
    assert.ok(manifest.icons.some(icon => icon.purpose === "monochrome"));
  }
  // Inspect rendered pixels, including real alpha, rather than source layout.
  const pixels = await browser.evaluate(`(async () => {
    const paths=['apple-touch-icon.png','apple-touch-icon-dark.png','apple-touch-icon-tinted.png','icon-transparent-1024.png','icon-tinted-512.png'];
    const result=[];
    for (const path of paths) {
      const image=new Image(); image.src='/icons/'+path; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const context=canvas.getContext('2d'); context.drawImage(image,0,0);
      const data=context.getImageData(0,0,image.width,image.height).data;
      let alpha=0, color=0; for(let i=0;i<data.length;i+=4) { if(data[i+3]!==255) alpha++; if(data[i+3] && (data[i]!==data[i+1] || data[i+1]!==data[i+2])) color++; }
      result.push({path,width:image.width,alpha,color});
    }
    return result;
  })()`);
  for (const icon of pixels.slice(0, 3)) { assert.equal(icon.width, 180); assert.equal(icon.alpha, 0, "Apple touch icon is opaque"); }
  assert.ok(pixels[3].alpha > 0 && pixels[3].color > 0, "transparent export has alpha and colored foreground");
  assert.equal(pixels[4].color, 0, "tinted pixels are truly monochrome");
  assert.deepEqual(errors, [], "no uncaught errors");
  console.log("PASS icon-set: live light/dark selection; desktop, phone, classic, remote and Agent work marks; opening landing; opaque touch icons; monochrome and transparent exports; no microphone");
} finally { await browser.close(); }
