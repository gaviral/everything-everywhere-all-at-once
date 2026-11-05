// No extra dependencies: run with `node scripts/phone-check.mjs` (after the UI is built; precheck builds it first).
// A friend opens the hosted link on an iPhone: the built UI (ui/dist) in headless Chrome as a touch phone (no hover,
// a phone's viewport), over a stand-in core (scripts/headless.mjs), in a room, at 320–430 px wide and on its side.
// Each of these broke on a phone and must stay fixed:
//  - no sideways scroll: the page is never wider than the screen (the header ran 14–57 px past it);
//  - no zoom on typing: every field is at least 16 px on touch (iOS zooms into a smaller one and stays zoomed);
//  - the header's parts never overlap or leave the screen: the icon whole, "This session…" not cut, every button whole;
//  - notices (the notice, the message card, a map update) never cover the composer, the header's buttons or each other,
//    scrolled or not, and never the open Room panel;
//  - a tapped point's Delete and Move don't cover its words, and sit 8 px or more apart; once it settles, no notice,
//    header or dock covers them (the stack of notices takes at most half the room above the dock);
//  - the ? list opens below the header's two rows; a long message's Stop stays on screen; the tour on its side is
//    clear of the notices;
//  - the map gets most of the screen once you scroll into it (the tools row no longer pinned on a phone).
// `SHOTS=<folder> node scripts/phone-check.mjs` also saves the map at 390 × 844 and 320 × 568, light and dark, and the
// laptop's 1440 × 900 (to compare before and after a change: the demo video is recorded there).
// Exit 3 (skipped) when this machine has no Chrome or ui/dist.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP phone-check: ${why}`); process.exit(3); }

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
const titles = ["Rent Due Friday", "Garden Plans", "Trip to Lisbon", "Pottery Class", "Recipient's Birthday", "Car Service", "Reading List", "Gym Routine"];
const words = ["Submit the rent form online before Friday noon", "Plant the tomatoes this weekend", "Book the flights for May", "Ask about the glaze firing",
  "Order the cake from the bakery", "Winter tyres before November", "Finish the second chapter", "Three mornings a week"];
const world = {
  threads: titles.map((title, i) => thread(`T${i + 1}`, title)),
  thoughts: words.flatMap((text, i) => [thought(`p${i}`, text, `T${i + 1}`), thought(`q${i}`, `${text.split(" ").slice(0, 3).join(" ")} again, and check it`, `T${i + 1}`)]),
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
const KEY_NOTICE = { type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." };
const SEND_CARD = { type: "send_card", id: 1, to: "Recipient", text: "Hi Recipient, could you confirm what to bring on Saturday?", state: "counting", in_ms: 600000, live: false, message: "" };
const MAP_CHANGE = { type: "change", change: { type: "thread_retitled", thread_id: "T2", was: "Garden Plans", title: "Garden Plan" } };

const failures = [];
const shots = process.env.SHOTS;
let away = false;
const core = await standInCore(() => (away ? null : [{ type: "snapshot", world }]), { door: { room: true, member: true, hosted: true } });
const page = await openPage(`http://127.0.0.1:${core.port}/?cards`, { width: 390, height: 844 });
const { evaluate, until, page: cdp } = page;
const frames = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
const settled = () => until(`[...document.querySelectorAll(".thread")].every((card) => { const c = getComputedStyle(card); return c.opacity === "1" && c.transform === "none"; })`, 5000);
/** A touch phone (no hover, coarse pointer, a phone's viewport), or the laptop. */
const size = async (width, height, phone = true) => {
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: phone });
  await frames();
  await settled();
  await sleep(250);
};
const scheme = (value) => cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value }] });
const shoot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
};
const fail = (where, list) => { for (const f of list ?? []) failures.push(`${where}: ${f}`); };

// In-page helpers, defined once per page load.
const HELPERS = `(() => {
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  const cross = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  // The header's parts as a person reads them: the icon, "This session…", each control.
  const headerParts = () => {
    const brand = document.querySelector(".brand");
    const icon = brand.querySelector('img[alt="E2A2O"]');
    const parts = [["App icon", icon.getBoundingClientRect()]];
    const count = document.querySelector(".session-count");
    if (count && shown(count)) parts.push(["This session…", count.getBoundingClientRect()]);
    for (const el of document.querySelector(".header-actions").children) if (el.tagName !== "DIALOG" && shown(el)) parts.push([name(el), el.getBoundingClientRect()]);
    return parts;
  };
  window.__phone = { name, cross, shown, headerParts };
})()`;

// What a phone's page must hold, wherever it's scrolled: no sideways scroll, every field 16 px or more, the header's parts
// whole, on screen and apart.
const PAGE = `(() => {
  const { cross, shown, headerParts, name } = window.__phone;
  const out = [], w = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > w) out.push("scrolls sideways: the page is " + document.documentElement.scrollWidth + " px on a " + w + " px screen");
  for (const field of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select")) {
    if (!field.getClientRects().length) continue;
    const px = parseFloat(getComputedStyle(field).fontSize);
    if (px < 16) out.push(name(field) + (field.placeholder ? " (" + field.placeholder + ")" : "") + " is " + px + " px: iOS zooms in on it");
  }
  const parts = headerParts();
  for (const [n, r] of parts) if (r.left < -0.5 || r.right > w + 0.5) out.push(n + " runs off the screen (" + Math.round(r.left) + " to " + Math.round(r.right) + " of " + w + ")");
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++)
    if (cross(parts[i][1], parts[j][1])) out.push(parts[i][0] + " and " + parts[j][0] + " overlap");
  const count = document.querySelector(".session-count");
  if (count && shown(count) && count.scrollWidth > count.clientWidth + 1) out.push('"This session…" is cut: ' + count.clientWidth + " of " + count.scrollWidth + " px show");
  // The name and each control are on top where they're drawn (nothing sticky or fixed over them).
  for (const [n, r] of parts) {
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    if (y < 0 || y > innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !hit.closest("header")) out.push(n + " is covered by " + name(hit));
  }
  return out;
})()`;

// Notices: none covers the composer, the header's controls or another notice, and each one's buttons are on top.
const NOTICES = `(() => {
  const { cross, shown, headerParts, name } = window.__phone;
  const out = [];
  const notices = [...document.querySelectorAll(".notice, .send-card, .map-change")].filter(shown).map((e) => [name(e).split(".")[1], e]);
  const composer = document.querySelector(".composer");
  const others = [...(composer ? [["the composer", composer.getBoundingClientRect()]] : []), ...headerParts().filter(([, r]) => r.bottom > 0)];
  // A lane that scrolls (a phone, a short window) shows only what's inside it: what it clips isn't drawn over anything.
  const clip = (e) => {
    const lane = e.closest(".notice-lane"), r = e.getBoundingClientRect();
    if (!lane || getComputedStyle(lane).overflowY === "visible") return r;
    const l = lane.getBoundingClientRect();
    return { left: Math.max(r.left, l.left), right: Math.min(r.right, l.right), top: Math.max(r.top, l.top), bottom: Math.min(r.bottom, l.bottom) };
  };
  // The first in the lane shows whole (on a phone the message card comes first: its Stop can't wait for a scroll).
  if (notices.length) {
    const first = [...notices].sort(([, a], [, b]) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const r = first[1].getBoundingClientRect(), v = clip(first[1]);
    if (r.top >= 0 && r.top < innerHeight && (v.bottom < r.bottom - 1 || v.top > r.top + 1)) out.push(first[0] + ", first in the stack, is cut off");
  }
  for (const [n, e] of notices) {
    // Its parts stay inside it (the message card's countdown bar ran the screen's width once the card lost its place).
    const own = e.getBoundingClientRect();
    for (const part of e.querySelectorAll("*")) {
      const p = part.getBoundingClientRect();
      if (p.width && p.height && (p.left < own.left - 1 || p.right > own.right + 1 || p.top < own.top - 1 || p.bottom > own.bottom + 1)) { out.push(n + "'s " + name(part) + " lies outside it"); break; }
    }
    const r = clip(e);
    if (r.bottom <= r.top || r.bottom <= 0 || r.top >= innerHeight) continue;
    for (const [m, s] of others) if (cross(r, s)) out.push(n + " covers " + m);
    for (const button of e.querySelectorAll("button")) {
      const b = button.getBoundingClientRect(), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
      if (y < Math.max(0, r.top) || y > Math.min(innerHeight, r.bottom)) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && !button.contains(hit)) out.push(n + "'s " + (button.getAttribute("aria-label") || button.textContent.trim()) + " is covered by " + name(hit));
    }
  }
  for (let i = 0; i < notices.length; i++) for (let j = i + 1; j < notices.length; j++)
    if (cross(clip(notices[i][1]), clip(notices[j][1]))) out.push(notices[i][0] + " and " + notices[j][0] + " overlap");
  return out;
})()`;

// Share of the screen's height that shows the map, down its middle: what a pinned header, tools row or dock leaves.
const MAP_SHARE = `(() => {
  const x = document.documentElement.clientWidth / 2;
  let map = 0, n = 0;
  for (let y = 2; y < innerHeight; y += 4, n++) {
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.closest(".map, .points, .thread") && !hit.closest(".map-tools, header, .dock")) map++;
  }
  return map / n;
})()`;

try {
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await size(390, 844);
  assert(await until(`document.readyState === "complete"`, 10000), "the page loads");
  // The join page first: its fields are typed into on a phone too.
  assert(await until(`!!document.querySelector(".join-field input")`, 10000), "the room's join page shows");
  await evaluate(HELPERS);
  for (const field of await evaluate(`[...document.querySelectorAll(".join-field input")].map((f) => [f.placeholder || f.name, parseFloat(getComputedStyle(f).fontSize)])`))
    if (field[1] < 16) failures.push(`join page: the ${field[0] || "name"} field is ${field[1]} px: iOS zooms in on it`);
  await evaluate(`sessionStorage.setItem("e2a2o.joined", "Colleague"); location.reload()`).catch(() => {});
  await sleep(300);
  assert(await until(`!!document.querySelector("#thread-T1") && !!document.querySelector(".session-count")`, 10000), "the map loads in a room, with this session's count");
  await evaluate(HELPERS);
  await settled();

  // The map's room, before any notice: scrolled into the map, portrait (390 × 664, Safari's bars up) and on its side.
  for (const [w, h, least] of [[390, 664, 0.7], [844, 390, 0.6]]) {
    await size(w, h);
    // A card in the map's middle brought to the top, as a person scrolling to it would.
    await evaluate(`document.querySelector("#thread-T3").scrollIntoView({ block: "start" })`);
    await frames();
    const share = await evaluate(MAP_SHARE);
    if (share < least) failures.push(`${w}×${h}: the map gets ${Math.round(share * 100)}% of the screen scrolled into it (at least ${least * 100}%)`);
    await evaluate(`scrollTo(0, 0)`);
  }

  // The page at every phone width, with no key (the longest status but one) and while connecting.
  core.send(KEY_NOTICE);
  for (const width of [320, 360, 375, 390, 430]) {
    await size(width, 844);
    fail(`${width}px`, await evaluate(PAGE));
  }
  away = true; core.drop();
  assert(await until(`document.querySelector(".status")?.textContent.includes("Connecting")`, 5000), "the header says it's connecting");
  for (const width of [320, 375]) { await size(width, 844); fail(`${width}px connecting`, await evaluate(PAGE)); }
  away = false;
  assert(await until(`!!document.querySelector(".dot.ok, .dot.warn")`, 15000), "it reconnects");
  await settled();

  // The countdown interrupts the earlier notice; other cards then resume in arrival order.
  // Check every card against
  // the same phone sizes, scroll positions, controls and Room panel.
  core.send({ type: "notice", message: "The mic stopped. Tap it to keep talking." }); core.send(SEND_CARD); core.send(MAP_CHANGE);
  for (const [kind, selector] of [["message", ".send-card"], ["notice", ".notice"], ["map update", ".map-change"]]) {
    assert(await until(`!!document.querySelector('${selector}')`, 5000), `${kind} takes its queue turn`);
    assert(await until('document.querySelectorAll(".notice, .send-card, .map-change").length === 1', 3000), `${kind}: only the current notice remains after the exit transition`);
    await evaluate(`document.querySelector('${selector} button').focus()`);
  // With the Apps panel open (a map with no apps yet opens it, and holds the lane in view) and closed.
  for (const apps of ["Apps open", "Apps closed"]) {
    if (apps === "Apps open" && !await evaluate('!!document.querySelector(".apps-panel.is-open")')) {
      await evaluate('document.querySelector(".apps-title").click()');
    }
    if (apps === "Apps closed") {
      await evaluate(`document.querySelector(".apps-panel.is-open .apps-title")?.click()`);
      assert(await until(`!document.querySelector(".apps-panel.is-open")`, 3000), "the Apps panel closes");
    }
    for (const [w, h] of [[320, 568], [390, 844], [844, 390]]) {
      await size(w, h);
      for (const y of [0, 40, 400]) {
        await evaluate(`scrollTo(0, ${y})`);
        await frames();
        fail(`${w}×${h} ${apps} scrolled ${y}`, [...await evaluate(PAGE), ...await evaluate(NOTICES)]);
      }
      await evaluate(`scrollTo(0, 0)`);
    }
  }

  // The Room panel opened with every notice up: nothing draws over it.
  for (const width of [320, 390]) {
    await size(width, 844);
    await evaluate(`document.querySelector(".room-menu summary").click()`);
    await frames(); await frames();
    const covered = await evaluate(`(() => {
      const el = document.querySelector(".room-panel"); if (!el) return ["didn't open"];
      const r = el.getBoundingClientRect(), bottom = Math.min(r.bottom, innerHeight);
      // 16 px in from each corner: the panel's own rounded corner (14 px) isn't part of it where it's drawn.
      const probe = [[r.left + 16, r.top + 16], [r.right - 16, r.top + 16], [r.left + 16, bottom - 16], [r.right - 16, bottom - 16], [(r.left + r.right) / 2, (r.top + bottom) / 2]];
      const { name } = window.__phone;
      return probe.map(([x, y]) => [x, y, document.elementFromPoint(x, y)]).filter(([, , hit]) => hit && !el.contains(hit))
        .map(([x, y, hit]) => "covered at " + Math.round(x) + "," + Math.round(y) + " by " + name(hit) + " < " + (hit.parentElement ? name(hit.parentElement) : ""));
    })()`);
    fail(`${width}px open Room panel`, covered);
    await evaluate(`document.querySelector(".room-menu summary").click()`);
    await frames();
  }

    if (kind === "notice") await evaluate(`document.querySelector('[aria-label="Dismiss notice"]').click()`);
    else if (kind === "message") {
      await evaluate('document.querySelector("#type-a-thought").focus()');
      core.send({ ...SEND_CARD, state: "stopped", message: "Stopped: not sent" });
      assert(await until('!document.querySelector(".send-card")', 20000), "the ended message is read before the map update");
    } else await evaluate(`document.querySelector('[aria-label="Dismiss map update"]').click()`);
  }
  core.send({ type: "notice", message: "The mic stopped. Tap it to keep talking." });
  assert(await until('!!document.querySelector(".notice")'), "a notice remains during point and popover clearance checks");

  // A tapped point: Delete and Move show, beside or under its words, never over them, 8 px or more apart.
  for (const [width, height] of [[320, 844], [375, 844], [390, 844], [320, 568], [844, 390]]) {
    await size(width, height);
    const out = await evaluate(`(async () => {
      const { cross, shown } = window.__phone;
      const li = document.querySelector("#point-p0");
      li.scrollIntoView({ block: "center" });
      li.focus();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const out = [];
      const text = [...li.children].find((e) => e.tagName === "SPAN" && e.textContent.startsWith("Submit"));
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = [...range.getClientRects()];
      const buttons = [...li.querySelectorAll(".move-button")].filter(shown);
      if (buttons.length < 2) out.push("Delete and Move don't both show after a tap");
      const box = li.getBoundingClientRect();
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        if (lines.some((line) => cross(line, r))) out.push(b.textContent + " covers the point's words");
        if (r.top < box.top - 1 || r.bottom > box.bottom + 1) out.push(b.textContent + " hangs outside its point (onto the next one)");
      }
      if (buttons.length === 2) {
        const [a, b] = buttons.map((e) => e.getBoundingClientRect());
        const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
        if (gap < 8) out.push("Delete is " + Math.round(gap) + " px from Move: a slip deletes");
      }
      // Once the page has moved it into view: its words and buttons are on top, under no notice, header or dock.
      await new Promise((r) => setTimeout(r, 900));
      const { name } = window.__phone;
      for (const [what, r] of [...[...range.getClientRects()].map((line) => ["its words", line]), ...buttons.map((b) => [b.textContent, b.getBoundingClientRect()])]) {
        const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
        const hit = y >= 0 && y <= innerHeight ? document.elementFromPoint(x, y) : null;
        if (!hit || !li.contains(hit)) { out.push(what + " covered by " + (hit ? name(hit) : "the screen's edge") + " at y " + Math.round(y)); break; }
      }
      li.blur();
      return out;
    })()`);
    fail(`${width}×${height} tapped point`, out);
  }

  // The ? list opens under the header's two rows, not over its buttons (its old top, 58 px, was the one-row header's).
  for (const width of [320, 390]) {
    await size(width, 844);
    await evaluate(`scrollTo(0, 0)`);
    await evaluate(`document.querySelector(".shortcuts summary").click()`);
    await frames();
    fail(`${width}px open ? list`, await evaluate(`(() => {
      const hint = document.querySelector(".keyboard-hint"); if (!hint || !window.__phone.shown(hint)) return ["didn't open"];
      const h = hint.getBoundingClientRect();
      return window.__phone.headerParts().filter(([, r]) => window.__phone.cross(h, r)).map(([n]) => "covers " + n);
    })()`));
    await evaluate(`document.querySelector(".shortcuts summary").click()`);
    await frames();
  }

  await evaluate(`document.querySelector('[aria-label="Dismiss notice"]').click()`);
  assert(await until('!document.querySelector(".notice")'), "read the notice before the message-size scenes");

  // A long message counting down: its words scroll in the card and its Stop shows, on top, wherever the page is.
  core.send({ ...SEND_CARD, id: 2, text: "Hi Recipient, could you confirm what to bring on Saturday? ".repeat(12) });
  assert(await until(`document.querySelector(".send-card-text")?.textContent.length > 300`, 5000), "the long message shows");
  for (const [w, h] of [[320, 568], [390, 844], [844, 390]]) {
    await size(w, h);
    for (const y of [0, 400]) {
      await evaluate(`scrollTo(0, ${y})`);
      await frames(); await frames();
      fail(`${w}×${h} long message scrolled ${y}`, await evaluate(`(() => {
        const stop = document.querySelector(".send-card-stop"); if (!stop) return ["no Stop"];
        const r = stop.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
        const hit = y >= 0 && y <= innerHeight ? document.elementFromPoint(x, y) : null;
        return hit && stop.contains(hit) ? [] : ["Stop isn't on screen: " + (hit ? "under " + window.__phone.name(hit) : "off it") + " at y " + Math.round(y)];
      })()`));
    }
  }
  core.send({ ...SEND_CARD, id: 2 });
  assert(await until(`document.querySelector(".send-card-text")?.textContent.length < 100`, 5000), "the short message is back");

  // The tour on its side with every notice up: a step on the map's page (not the composer's, in the dock) brings its
  // tip to the top, and the notices go under it. A populated map's steps: the map, the composer, the tools.
  if (await evaluate(`!!document.querySelector(".tour-tip")`)) {
    await size(844, 390);
    for (let step = 0; step < 2; step++) { await evaluate(`document.querySelector(".tour-next").click()`); await frames(); }
    await frames(); await sleep(250);
    fail("844×390 tour with notices", await evaluate(`(() => {
      const tip = document.querySelector(".tour-tip"); if (!tip) return ["the tour ended"];
      if (tip.closest(".dock")) return ["the tour's last step is in the dock, not on the page"];
      const out = [];
      for (const part of tip.querySelectorAll("strong, p, button")) {
        const r = part.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
        const hit = y >= 0 && y <= innerHeight ? document.elementFromPoint(x, y) : null;
        if (!hit || !tip.contains(hit)) out.push(window.__phone.name(part) + " is " + (hit ? "under " + window.__phone.name(hit) : "off screen"));
      }
      return out;
    })()`));
  } else failures.push("setup: the tour isn't up on a fresh page");

  if (shots) {
    for (const value of ["light", "dark"]) {
      await scheme(value);
      for (const [w, h] of [[390, 844], [320, 568]]) {
        await size(w, h);
        await evaluate(`scrollTo(0, 0)`); await frames(); await sleep(300);
        await shoot(`phone-${w}x${h}-${value}`);
        await evaluate(`scrollTo(0, 420)`); await frames(); await sleep(300);
        await shoot(`phone-${w}x${h}-scrolled-${value}`);
        await evaluate(`(() => { const li = document.querySelector("#point-q0"); li.scrollIntoView({ block: "center" }); li.focus(); })()`);
        await frames(); await sleep(300);
        await shoot(`phone-${w}x${h}-point-tapped-${value}`);
        await evaluate(`document.activeElement?.blur()`);
      }
    }
    await scheme("light");
  }
} catch (error) {
  failures.push(error.message);
} finally {
  await page.close();
  core.close();
}

// The laptop, for comparing a change before and after: the demo video is recorded here. A fresh page, as it first
// opens, with nothing to say (no notice).
if (shots) {
  const desk = await standInCore(() => [{ type: "snapshot", world }], { door: { room: true, member: true, hosted: true } });
  const laptop = await openPage(`http://127.0.0.1:${desk.port}/?cards`, { width: 1440, height: 900 });
  try {
    await laptop.until(`document.readyState === "complete"`, 10000);
    await laptop.evaluate(`sessionStorage.setItem("e2a2o.joined", "Colleague"); location.reload()`).catch(() => {});
    await sleep(300);
    await laptop.until(`!!document.querySelector("#thread-T1")`, 10000);
    for (const value of ["light", "dark"]) {
      await laptop.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value }] });
      await sleep(800);
      const { data } = await laptop.page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `laptop-1440x900-${value}.png`), Buffer.from(data, "base64"));
    }
    // And with every notice up, where the laptop's lane puts them.
    desk.send({ type: "notice", message: "The mic stopped. Tap it to keep talking." }); desk.send(SEND_CARD); desk.send(MAP_CHANGE);
    await laptop.until(`!!document.querySelector(".notice") && !!document.querySelector(".send-card") && !!document.querySelector(".map-change")`, 5000);
    await laptop.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    await sleep(800);
    const { data } = await laptop.page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, "laptop-1440x900-notices-light.png"), Buffer.from(data, "base64"));
  } finally {
    await laptop.close();
    desk.close();
  }
}

function assert(ok, what) { if (!ok) throw new Error(`setup: ${what}`); }

if (failures.length) {
  console.log(`phone-check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("phone-check: ok (no sideways scroll, 16 px fields, header whole, notices clear, tapped points readable, map room, ? list, long message's Stop, tour clear)");
