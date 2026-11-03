// A person's Remote is the same person (`?remote`, ui/src/remote/; core/src/call.rs): a phone's page that joins the room by
// its code like any window, under a name of its own, but is a device of the room, not a second person. No Talk opening on
// the laptop, the Work spine lane staying where it is, nobody new "here" in the call; listed once, as "<name> · remote" in
// the room menu, which also offers "Open Remote on your phone" with the link that opens it.
//  1. The rules (talk/call-core.ts and remote/flag.ts, through Vite): a Remote counts for nothing in a call, a count of
//     people or "who hears you", and is listed apart; one from a core that doesn't know them is a person; the link is the
//     invite with `remote=` and the name "<you>'s phone", or "My phone" when that wouldn't fit.
//  2. A laptop in a room (1440, ?shell=2, the Work spine on) and a phone (390) over a stand-in core that keeps the call as
//     core/src/call.rs does: alone, the room menu offers the link and copies exactly it (the invite's copy is as it was); the
//     phone opens it to a name form that already holds "<you>'s phone" and says it's the Remote; it joins saying so on its
//     socket (the laptop's doesn't); the laptop then shows no Talk (not even the pill), keeps the lane and lists the phone as
//     a Remote; an AI helper joining makes the pill and still no rail; the phone answers a held question and the laptop is
//     as it was; a second person makes Talk's rail and the lane gives way (so the check can tell); they leave, it goes back;
//     the phone leaves, its row goes. Light and dark; nothing across or cut off.
// SHOTS=dir saves <scene>-<width>-<scheme>.png. The same on a real core (no key needed): run it in a room, open the
// laptop at `/?shell=2&work-spine`, copy "Open Remote on your phone" from the room menu, open that link on a phone (at the
// room's network address), `node scripts/demo-jobs.mjs --port P --room CODE`, and answer: the script prints
// "Answer from <the phone's name>: <words>" and the laptop's Talk stays closed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP remote-person-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ── 1. The rules, without a page. ──
{
  const server = await uiServer();
  try {
    const C = await server.ssrLoadModule("/src/talk/call-core.ts");
    const F = await server.ssrLoadModule("/src/remote/flag.ts");
    const person = (name, extra = {}) => ({ name, ai: false, remote: false, joined_ms: 1, here: true, left_ms: null, mic: false, speaking: false, read: null, ...extra });
    const call = (...people) => ({ started_ms: 1, level: "speak", level_by: "", people });
    const lone = call(person("Sam"), person("Sam's phone", { remote: true }));
    assert.equal(C.inCall(lone), false, "a person and their Remote are not a call");
    assert.equal(C.inCall(call(person("Sam"), person("Sam's phone", { remote: true }), person("Ana's phone", { remote: true }))), false, "nor are Remotes, however many");
    const helped = call(person("Sam"), person("Sam's phone", { remote: true }), person("agent", { ai: true }));
    assert.equal(C.inCall(helped), true, "a person and an AI helper are, as they were");
    assert.equal(C.peopleHere(helped), 1, "and the Remote is not a second person");
    assert.equal(C.peopleHere(call(person("Sam"), person("Maya"), person("Sam's phone", { remote: true }))), 2, "a second person is");
    assert.deepEqual(C.ordered(helped, "Sam").map((p) => p.name), ["Sam", "agent"], "the people row lists no Remote");
    assert.deepEqual(C.hereNow(helped, "Sam").map((p) => p.name), ["Sam", "agent"]);
    assert.equal(C.heardBy(helped, "Sam"), "agent hears you", "a Remote hears nothing");
    assert.deepEqual(C.remotesHere(helped).map((p) => p.name), ["Sam's phone"], "the Remote is listed apart");
    assert.deepEqual(C.remotesHere(call(person("Sam"), person("Sam's phone", { remote: true, here: false, left_ms: 5 }))), [], "a Remote that closed is gone, not someone who left");
    const old = { started_ms: 1, level: "speak", level_by: "", people: [{ name: "Sam", ai: false, joined_ms: 1, here: true, left_ms: null, mic: false, speaking: false, read: null }, { name: "Maya", ai: false, joined_ms: 2, here: true, left_ms: null, mic: false, speaking: false, read: null }] };
    assert.equal(C.inCall(old), true, "a core that doesn't know Remotes sends people, and they are");
    assert.deepEqual(C.remotesHere(old), []);
    const invite = "http://192.168.1.5:4321/?room=k7m2x9qp";
    assert.equal(F.remoteLink(invite, "Sam"), `${invite}&remote=Sam's%20phone`, "the invite, and the name the phone joins under");
    assert.equal(F.remoteLink(invite, "Maria José"), `${invite}&remote=Maria%20Jos%C3%A9's%20phone`);
    assert.equal(F.remoteLink(invite, "Alexandria-Catherine"), `${invite}&remote=My%20phone`, "a name too long for the room's 24 characters becomes My phone");
    assert.equal(F.remoteLink("https://quiet-river-12.trycloudflare.com", "Sam"), "https://quiet-river-12.trycloudflare.com?remote=Sam's%20phone", "an address with no query gets one");
  } finally { await server.close(); }
}

// ── 2. The pages. ──
const now = Date.now();
const thread = (n, title) => ({ id: `T${n}`, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, i) => ({ id, speaker: "Sam", text, point: text, thread_id, placed: true, unclear: "", complete: true, at_ms: now - 60_000 + i * 1000, place_ms: 2400 });
const world = {
  threads: [thread(1, "Mom's birthday"), thread(2, "Stats midterm")], active: "T1", active_by: { Sam: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
  thoughts: [thought("a1", "Mom's birthday is Saturday", "T1", 1), thought("a2", "She keeps talking about the pottery class on Main Street", "T1", 2), thought("b1", "My stats midterm is Thursday", "T2", 3)],
};
const ASK = "Mention the pottery class in Mom's card, or keep it a surprise?";
const job = (id, status, extra = {}) => ({ type: "job", id, title: id, status, demo: true, by: "agent", at_ms: Date.now(), ...extra });
const replay = () => [
  job("demo-birthday", "waiting", { title: "Plan Mom's birthday on Saturday", result: "Class found · card drafted · waiting on your answer", at_ms: now - 30_000 }),
  job("demo-card", "waiting", { title: "Draft a birthday card for Mom", parent: "demo-birthday", result: ASK, at_ms: now - 20_000 }),
  job("demo-pottery", "done", { title: "Find the pottery class on Main Street", parent: "demo-birthday", result: "Saturdays at 10 AM · $45 a person", at_ms: now - 40_000 }),
  { type: "guide", kind: "hold", target: null, text: ASK, by: "agent", at_ms: now - 20_000 },
];

/** The call as core/src/call.rs keeps it, as far as a page can tell: who is here, who is a Remote, whether a call began. */
class Calls {
  people = [];
  started = 0;
  join(name, { ai = false, remote = false }) {
    remote = remote && !ai;
    const p = this.people.find((x) => x.name === name);
    if (p) { p.windows++; p.remotes += remote ? 1 : 0; p.here = true; p.left_ms = null; p.ai ||= ai; p.remote = p.remotes === p.windows; }
    else this.people.push({ name, ai, remote, joined_ms: Date.now(), here: true, left_ms: null, mic: false, speaking: false, read: null, windows: 1, remotes: remote ? 1 : 0 });
    this.tell();
  }
  leave(name, remote) {
    const p = this.people.find((x) => x.name === name);
    if (!p) return;
    p.windows--; p.remotes -= remote ? 1 : 0;
    if (p.windows > 0) p.remote = p.remotes === p.windows;
    else { p.here = false; p.left_ms = Date.now(); }
    this.tell();
  }
  tell() { if (!this.started && this.people.filter((p) => p.here && !p.remote).length >= 2) this.started = Date.now(); }
  message() {
    if (!this.started && !this.people.some((p) => p.remote)) return [];
    return [{ type: "call", started_ms: this.started, people: this.people.map(({ windows, remotes, ...p }) => p), level: "speak", level_by: "" }];
  }
}

const quiet = (e) => !/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(e);
const code = "abcd2345";
const invite = `http://192.168.1.5:4321/?room=${code}`;
const calls = new Calls();
const joins = [];
const timeout = setTimeout(() => { console.error("remote-person-check: timed out"); process.exit(1); }, 200_000);
const opened = [];
const closeAll = async () => { for (const closer of opened.splice(0)) await closer().catch(() => {}); };
let core;
core = await standInCore((query) => {
  joins.push(Object.fromEntries(query));
  calls.join(query.get("name") ?? "you", { ai: query.has("ai"), remote: query.has("remote") });
  // The windows already open hear who joined; the new one hears it first thing in its catch-up.
  for (const message of calls.message()) core.send(message);
  return [...calls.message(), { type: "snapshot", world }, ...replay()];
}, {
  door: { room: true, member: true, code, invite },
  onClose: (query) => {
    calls.leave(query.get("name") ?? "you", query.has("remote") && !query.has("ai"));
    for (const message of calls.message()) core.send(message);
  },
});
opened.push(async () => core.close());

/** A page at `width` that has joined, or will, under `joined` (a laptop remembers its name for the visit). */
async function openWindow({ width, height, joined = "" }) {
  const browser = await openPage("about:blank", { width, height });
  opened.push(browser.close);
  const { page, evaluate, until } = browser;
  // Without Page.enable Chrome accepts the script below and never runs it.
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("e2a2o.toured", "1");
    ${joined ? `sessionStorage.setItem("e2a2o.joined", ${JSON.stringify(joined)});` : ""}
    window.copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copied.push(text); } } });
    window.pageErrors = [];
    addEventListener("error", (e) => window.pageErrors.push(e.message));
    addEventListener("unhandledrejection", (e) => window.pageErrors.push(String(e.reason)));
    const error = console.error; console.error = (...args) => { window.pageErrors.push(args.map(String).join(" ")); error(...args); };
  ` });
  const scheme = (value) => page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  await scheme("light");
  const check = async (expression, label, ms = 15_000) => assert.ok(await until(expression, ms), `${width}: ${label}`);
  const settle = async () => {
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    await sleep(250);
  };
  const click = async (selector) => assert.ok(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), `${width}: click ${selector}`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const go = (path) => page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${path}` });
  const shot = async (name, schemeName) => {
    if (!shots) return;
    await settle();
    await sleep(400);
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}-${width}-${schemeName}.png`), Buffer.from(data, "base64"));
  };
  /** Both schemes, light first and light again after. */
  const shotBoth = async (name) => { await shot(name, "light"); await scheme("dark"); await shot(name, "dark"); await scheme("light"); };
  const sound = async (label) => {
    await settle();
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${width} ${label}: the page fits across`);
    assert.deepEqual((await evaluate("window.pageErrors")).filter(quiet), [], `${width} ${label}: no page errors`);
  };
  return { page, evaluate, until, check, settle, click, text, go, shot, shotBoth, sound, scheme, width, close: browser.close };
}

/** What the laptop shows of the call: Talk's rail or its pill, the Work spine as a lane or a card in the dock. */
const seen = (laptop) => laptop.evaluate(`(() => ({
  rail: !!document.querySelector(".talk-rail"), pill: !!document.querySelector(".talk-pill"),
  lane: !!document.querySelector(".work-spine-lane"), card: !!document.querySelector(".work-spine-card"),
  room: document.documentElement.style.getPropertyValue("--room-right"),
}))()`);
/** The room menu's list of who is here now, each row as it reads. */
const hereRows = (laptop) => laptop.evaluate(`[...document.querySelectorAll(".room-panel li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
/** A window of someone else's, as another person's page or an AI helper's opens its socket; `close` drops it as a page
 *  closing does (the stand-in core ends a connection when it ends, and takes no part in the close handshake). */
const raw = (query) => new Promise((resolve, reject) => {
  const socket = net.connect(core.port, "127.0.0.1");
  socket.once("data", () => resolve({ close: () => socket.destroy() }));
  socket.once("error", () => reject(new Error(`could not open ${query}`)));
  socket.write(`GET /ws?${query} HTTP/1.1\r\nHost: 127.0.0.1:${core.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});

try {
  // The laptop, in a room under its own name, the Work spine on.
  const laptop = await openWindow({ width: 1440, height: 900, joined: "Sam" });
  await laptop.go("?shell=2&bricks=work-spine");
  await laptop.check('!!document.querySelector("[data-guide=composer] textarea") && !!document.querySelector(".spine-ready")', "the map and the composer are up", 15_000);
  await laptop.evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()');
  await laptop.check('!document.querySelector(".tour-tip") && !!document.querySelector(".work-spine-lane")', "no hint is up and the Work spine's lane is beside the map");
  assert.deepEqual(joins.map((j) => [j.name, "remote" in j]), [["Sam", false]], "the laptop's socket is a person's: it does not say Remote");
  const alone = await seen(laptop);
  assert.deepEqual([alone.rail, alone.pill, alone.lane, alone.card], [false, false, true, false], "alone: the lane, and no Talk");
  assert.notEqual(alone.room, "", "the lane has its room");

  // The room menu offers the link, and copies exactly it; the invite's own copy is as it was.
  await laptop.click(".room-menu summary");
  await laptop.check('!!document.querySelector(".room-remote")', "the room menu offers the Remote");
  assert.equal(await laptop.evaluate('document.querySelector(".room-remote").firstChild.textContent.trim()'), "Open Remote on your phone");
  assert.equal(await laptop.text(".room-remote .room-copy"), "Copy link");
  assert.equal(await laptop.evaluate('document.querySelectorAll(".room-code").length'), 2, "the join code, and the Remote beneath it");
  assert.equal(await laptop.evaluate('new Set([...document.querySelectorAll(".room-copy")].map((b) => b.getAttribute("aria-label") ?? b.textContent)).size'), 2, "the two buttons tell a screen reader apart");
  await laptop.click(".room-code:not(.room-remote) .room-copy");
  await laptop.click(".room-remote .room-copy");
  await laptop.check('window.copied.length === 2', "both copied");
  const [copiedInvite, copiedRemote] = await laptop.evaluate("window.copied");
  assert.equal(copiedInvite, invite, "the join code's copy is the invite, as before");
  assert.equal(copiedRemote, `${invite}&remote=Sam's%20phone`, "the Remote's copy is the invite with the Remote and a name for the phone");
  await laptop.check('document.querySelector(".room-remote .room-copy")?.textContent === "Link copied"', "and says so");
  assert.equal(await laptop.evaluate('(() => { const r = document.querySelector(".room-panel").getBoundingClientRect(), b = document.querySelector(".room-remote .room-copy").getBoundingClientRect(); return b.right <= r.right && b.left >= r.left && b.bottom <= r.bottom; })()'), true, "the button is inside the panel");
  assert.equal(await laptop.evaluate('document.querySelectorAll(".room-link").length'), 0, "copied, so no link is spelled out");
  await laptop.shotBoth("laptop-offer");
  await laptop.click(".room-menu summary");

  // The phone opens it: the name form already holds the name, says it's the Remote, and asks for nothing else.
  const phone = await openWindow({ width: 390, height: 844 });
  const link = new URL(copiedRemote);
  await phone.go(link.search);
  await phone.check('!!document.querySelector(".join input")', "a phone in a room is asked its name");
  assert.equal(await phone.evaluate('document.querySelectorAll(".join input").length'), 1, "only its name: the link carried the code");
  assert.equal(await phone.evaluate('document.querySelector(".join input").value'), "Sam's phone", "the name is already there");
  assert.equal(await phone.text(".join-kicker"), "Remote");
  assert.equal(await phone.text(".join h1"), "Answer from your phone.");
  assert.equal(await phone.text("#name-hint"), "Your helpers see this next to your answers.");
  await phone.shotBoth("phone-join");
  await phone.click(".join-card > button");
  await phone.check('!!document.querySelector(".remote")', "joined: the Remote");
  await phone.check('document.querySelector(".remote-status")?.textContent === "On the shared map as Sam\'s phone"', "connected, under its name");
  const mine = joins.findLast((j) => j.name === "Sam's phone");
  assert.deepEqual([mine.room, mine.remote], [code, "1"], `its socket comes in by name and room and says it is a Remote: ${JSON.stringify(mine)}`);

  // The laptop: nothing new. No Talk (not even its pill), the lane where it was, the phone listed as a device.
  await laptop.click(".room-menu summary");
  await laptop.check('document.querySelectorAll(".room-panel li").length === 1', "one row in the room menu");
  assert.deepEqual(await hereRows(laptop), ["◇ Sam's phone · remote"], "the phone is listed once, as a Remote");
  assert.equal(await laptop.evaluate('document.querySelector(".room-panel").textContent.includes("oined")'), false, "and nothing says anyone joined");
  assert.equal(await laptop.evaluate('document.querySelector(".room-panel-label").textContent'), "Here now");
  const withPhone = await seen(laptop);
  assert.deepEqual([withPhone.rail, withPhone.pill, withPhone.lane, withPhone.card], [false, false, true, false], "no Talk, the lane in place");
  assert.equal(withPhone.room, alone.room, "and the Canvas has the room it had");
  await laptop.shotBoth("laptop-phone-joined");
  await laptop.click(".room-menu summary");

  // An AI helper joins: Talk is a pill (as it is for a person and a helper), still no rail, the lane stays.
  const agent = await raw(`name=agent&ai=true&room=${code}`);
  await laptop.check('!!document.querySelector(".talk-pill")', "an AI helper makes the call: Talk's pill");
  const withAgent = await seen(laptop);
  assert.deepEqual([withAgent.rail, withAgent.pill, withAgent.lane, withAgent.card], [false, true, true, false], "Talk is a pill and the lane stays");
  assert.equal(await laptop.evaluate('(() => { const p = document.querySelector(".talk-pill").getBoundingClientRect(), b = document.querySelector(".work-spine-badge").getBoundingClientRect(); return b.top >= p.bottom; })()'), true, "the lane's words start below the pill");

  // The phone answers the held question; the laptop is as it was.
  await phone.check('document.querySelector(".remote-ask-text")?.textContent === ' + JSON.stringify(ASK), "the phone holds the question");
  assert.deepEqual(await phone.evaluate('[...document.querySelectorAll(".remote-quick-button")].map((b) => b.textContent)'), ["Mention the pottery class in Mom's card", "Keep it a surprise"]);
  await phone.shotBoth("phone-ask");
  await phone.click(".remote-quick-button:last-child");
  await phone.check('document.querySelector(".remote-sent")?.textContent === "Sent to agent: “Keep it a surprise” (simulated)"', "one tap sent it: the feed is simulated, and says so");
  assert.deepEqual(core.heard.filter((m) => m.type === "answer"), [{ type: "answer", to: "agent", text: "Keep it a surprise" }]);
  await phone.shotBoth("phone-sent");
  const answered = await seen(laptop);
  assert.deepEqual([answered.rail, answered.pill, answered.lane, answered.card], [false, true, true, false], "the laptop is as it was");
  await laptop.click(".room-menu summary");
  assert.deepEqual(await hereRows(laptop), ["✦ agent · here", "◇ Sam's phone · remote"], "the people first, the phone last");
  await laptop.shotBoth("laptop-helper-phone");
  await laptop.click(".room-menu summary");
  await laptop.sound("laptop with the phone");
  await phone.sound("phone");

  // A second person is a different thing: Talk's rail opens and the lane gives way to its card.
  const maya = await raw(`name=Maya&room=${code}`);
  await laptop.check('!!document.querySelector(".talk-rail") && !document.querySelector(".work-spine-lane") && !!document.querySelector(".work-spine-card")', "a second person: Talk's rail, and the Work spine is the card");
  await laptop.shotBoth("laptop-second-person");
  maya.close();
  await laptop.check('!document.querySelector(".talk-rail") && !!document.querySelector(".work-spine-lane") && !!document.querySelector(".talk-pill")', "they leave: the lane is back");

  // The phone closes: its row goes (a Remote is a device, not someone who left), and the call goes on for the helper.
  await laptop.click(".room-menu summary");
  agent.close();
  await laptop.check('!document.querySelector(".talk-pill")', "the helper leaves: no call");
  await phone.close();
  await laptop.check('document.querySelectorAll(".room-panel li").length === 0', "the phone's row is gone");
  assert.equal(await laptop.evaluate('document.querySelector(".room-panel").textContent.includes("left")'), false, "and it didn't leave anything behind as someone who left");
  await laptop.sound("laptop after");
  console.log("remote-person-check: ok");
} finally {
  clearTimeout(timeout);
  await closeAll();
}
