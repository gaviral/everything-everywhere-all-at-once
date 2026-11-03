// The Remote (`?remote`, ui/src/remote/): a phone's page with the Work spine full height and, at its foot, the question a
// helper holds for you, a box to answer it and a Send that relays `{"type":"answer","to","text"}` to the asker. Held here
// without a core to ask the way: the rules for what waits and what a question offers (pure); with no room, the page's own
// demo feed under "Demo mode · simulated", answers that stay in the page; in a room, the name form any phone fills in, the
// core's jobs (a waiting job is a question even when its hold never reached this window), each answer sent once to the
// right helper, quick answers for "A, or B?", a refused send when the connection is down, the same page after a reconnect;
// at 390 and 1440, light and dark. SHOTS=dir saves <scene>-<width>-<scheme>.png.
// The same path on a real core (no key needed): run it in a room, `node scripts/demo-jobs.mjs --port P --room CODE`, open
// `/?remote&room=CODE`, join by a name and answer: the script prints "Answer from <name>: <words>".
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP remote-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ── The rules, without a page. ──
{
  const server = await uiServer();
  try {
    const { asksOf, options } = await server.ssrLoadModule("/src/remote/ask.ts");
    const job = (id, status, extra = {}) => ({ id, title: id, status, demo: false, by: "agent", at_ms: 1000, ...extra });
    const hold = (n, by, text, kind = "question") => ({ n, by, text, kind, target: null, state: "waiting", urgent: false });
    // What a question offers: "A, or B?" as two short instructions; nothing it can't stand behind.
    assert.deepEqual(options("Mention the pottery class in Mom's card, or keep it a surprise?"), ["Mention the pottery class in Mom's card", "Keep it a surprise"]);
    assert.deepEqual(options("Blue, or green?"), ["Blue", "Green"]);
    assert.deepEqual(options("  Ship it,  or hold off?? "), ["Ship it", "Hold off"], "spaces and marks are not part of an answer");
    for (const none of ["Window or aisle?", "Do you want tea, or coffee?", "Should I book it, or leave it?", "Pick one: the blue one, or the green one?", "Red, green, or blue?",
      "Which seat, or which row?", "Yes, or yes?", "", "Is it done, or not?", "A, or the same thing from the start of the day to the end of it as the long one goes on?"]) {
      assert.deepEqual(options(none), [], `no quick answers for ${JSON.stringify(none)}`);
    }
    // What waits: each waiting job that asks, oldest first; a parent that waits on its side job doesn't ask; a hold no job says is a question.
    const jobs = [job("late", "waiting", { result: "Later question?", at_ms: 3000 }), job("parent", "waiting", { result: "Summary of it all", at_ms: 1500 }),
      job("kid", "waiting", { parent: "parent", result: "Early question?", at_ms: 2000 }), job("done", "done", { result: "Finished." }), job("running", "running", { result: "Working." }),
      job("nowords", "waiting", { at_ms: 2500 })];
    assert.deepEqual(asksOf(jobs, []).map((ask) => ask.text), ["Early question?", "Later question?"], "questions only, oldest first");
    assert.deepEqual(asksOf(jobs, [hold(7, "agent", "Early question?"), hold(8, "agent", "Held only?"), hold(9, "agent", "A line.", "line")]).map((ask) => [ask.text, ask.held]),
      [["Early question?", [7]], ["Later question?", []], ["Held only?", [8]]], "a hold that says what a job says is one question, and one that only a hold says follows; a caption is no question");
    const early = asksOf(jobs, [])[0];
    assert.deepEqual(asksOf(jobs, [], new Set([early.id])).map((ask) => ask.text), ["Later question?"], "an answered question isn't asked again, though a reconnect replays it as it was");
    assert.deepEqual(asksOf(jobs.map((j) => (j.id === "kid" ? { ...j, at_ms: 9999 } : j)), [], new Set([early.id])).map((ask) => ask.text), ["Later question?", "Early question?"], "the same words asked again, with a new stamp, are asked");
    assert.ok(asksOf([], [hold(8, "agent", "Held only?")])[0].id.endsWith("|n8"), "a hold's asking is its message");
    assert.deepEqual(asksOf([job("a", "waiting", { result: "Same words?", by: "Claude" }), job("b", "waiting", { result: "Same words?", by: "GPT" })], []).map((ask) => ask.by), ["Claude", "GPT"], "two helpers asking the same words are two questions");
    assert.equal(asksOf([job("d", "waiting", { result: "A demo question?", demo: true })], [])[0].demo, true, "a simulated job's question says so");
  } finally { await server.close(); }
}

const empty = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [] };
const job = (id, status, extra = {}) => ({ type: "job", id, title: id, status, demo: false, by: "agent", at_ms: Date.now(), ...extra });
/** How fast the page's own feed plays: 30 times to check, 3 for shots (its durations then read like a take's). */
const SPEED = shots ? 3 : 30;
const quiet = (e) => !/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(e);
const timeout = setTimeout(() => { console.error("remote-check: timed out"); process.exit(1); }, 240_000);
const opened = [];
const closeAll = async () => { for (const closer of opened.splice(0)) await closer().catch(() => {}); };

/** A page at `width` with a stand-in core behind it. */
async function scene({ width, height = width === 390 ? 844 : 900, door, joinReply, joined = "" }) {
  const core = await standInCore(joinReply ?? (() => [{ type: "snapshot", world: empty }]), door ? { door } : {});
  const browser = await openPage("about:blank", { width, height });
  opened.push(async () => { await browser.close(); core.close(); });
  const { page, evaluate, until } = browser;
  // Without Page.enable Chrome accepts the script below and never runs it.
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    ${joined ? `sessionStorage.setItem("e2a2o.joined", ${JSON.stringify(joined)});` : ""}
    window.remoteErrors = [];
    addEventListener("error", (e) => window.remoteErrors.push(e.message));
    addEventListener("unhandledrejection", (e) => window.remoteErrors.push(String(e.reason)));
    const error = console.error; console.error = (...args) => { window.remoteErrors.push(args.map(String).join(" ")); error(...args); };
  ` });
  const scheme = (value) => page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  await scheme("light");
  const check = async (expression, label, ms = 8000) => assert.ok(await until(expression, ms), `${width}: ${label}`);
  const settle = async () => {
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    await sleep(250);
  };
  const rect = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; })()`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const click = async (selector) => assert.ok(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), `${width}: click ${selector}`);
  const type = async (selector, words) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page("Input.insertText", { text: words });
  };
  const enter = async () => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const shot = async (name, schemeName) => {
    if (!shots) return;
    await settle();
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}-${width}-${schemeName}.png`), Buffer.from(data, "base64"));
  };
  const sound = async (label) => {
    await settle();
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${width} ${label}: the page fits across`);
    assert.deepEqual((await evaluate("window.remoteErrors")).filter(quiet), [], `${width} ${label}: no page errors`);
  };
  const go = (query) => page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${query}` });
  return { core, page, evaluate, until, check, settle, rect, text, click, type, enter, shot, sound, scheme, go, width };
}

/** What a phone's page must keep: the Work spine above the dock, the dock at the foot, every touch target 44 px, in view. */
async function laidOut(s, { dock = true } = {}) {
  const geo = await s.evaluate(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    const at = (s) => { const el = document.querySelector(s); return el ? box(el) : null; };
    return { main: at(".remote"), spine: at(".remote-spine"), list: at(".work-spine-scroll"), dock: at(".remote-dock"), controls: [...document.querySelectorAll(".remote-quick-button, .remote-field, .remote-send")].map(box), h: innerHeight, w: innerWidth };
  })()`);
  assert.ok(Math.abs(geo.main.bottom - geo.h) < 1 && geo.main.top >= 0, `${s.width}: the page is the window's height: ${JSON.stringify(geo.main)}`);
  assert.ok(Math.abs(geo.dock.bottom - geo.h) < 1, `${s.width}: what waits for you is at the foot`);
  assert.ok(geo.list.bottom <= geo.dock.top + 1 && geo.list.height >= 100, `${s.width}: the Work spine's list has room and ends above the dock: ${JSON.stringify({ list: geo.list, dock: geo.dock })}`);
  if (dock) for (const control of geo.controls) assert.ok(control.height >= 43.5 && control.left >= 0 && control.right <= geo.w && control.top >= 0 && control.bottom <= geo.h, `${s.width}: a control is 44 px and in view: ${JSON.stringify(control)}`);
  const sizes = await s.evaluate(`[...new Set([...document.querySelectorAll(".remote *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => parseFloat(getComputedStyle(el).fontSize)))].sort((a, b) => a - b)`);
  assert.ok(sizes.every((size) => [13, 15, 16, 18].includes(size)), `${s.width}: type on the shell's scale (13, 15, 18, and 16 for the box): ${sizes}`);
}

try {
  // ── With no room: the page's own feed, from the start (30 times faster here), simulated, and answers that stay in the page. ──
  {
    const s = await scene({ width: 390 });
    await s.go(`?remote&speed=${SPEED}`);
    await s.check('!!document.querySelector(".remote")', "the page is up");
    assert.equal(await s.text(".remote-name"), "Remote");
    assert.equal(await s.evaluate("document.title"), "E2A2O Remote");
    assert.equal(await s.evaluate('document.documentElement.classList.contains("shell2")'), true, "it takes the shell's look");
    await s.check('document.querySelectorAll(".work-spine-list > [data-job-id]").length === 3', "the feed's three top-level jobs", 40_000);
    await s.check('!!document.querySelector(".remote-ask")', "its question is held for you", 40_000);
    assert.equal(s.core.connected(), 0, "alone, the page opens no connection: the feed is its own");
    assert.equal(await s.text(".remote-ask-state"), "Waiting for you");
    assert.equal(await s.text(".remote-ask-text"), "Mention the pottery class in Mom's card, or keep it a surprise?");
    assert.equal(await s.text(".remote-ask-by"), "✦ agent", "from whom, an AI's mark on it");
    assert.deepEqual(await s.evaluate('[...document.querySelectorAll(".remote-quick-button")].map((b) => b.textContent)'), ["Mention the pottery class in Mom's card", "Keep it a surprise"], "one tap for either half of it");
    assert.equal(await s.evaluate('document.querySelectorAll(".work-spine-demo").length'), 2, "simulated, and it says so: at the head of the Work spine and on the question");
    assert.equal(await s.evaluate('[...document.querySelectorAll(".work-spine-demo")].every((el) => el.textContent === "Demo mode · simulated")'), true);
    assert.equal(await s.evaluate('document.querySelector(".remote-send").disabled'), true, "Send waits for words");
    assert.equal(await s.evaluate('document.querySelector(".remote-more") === null'), true);
    // The Work spine is the page: the feed's own jobs, the waiting parent's summary plain.
    await s.check('document.querySelector(\'[data-job-id="demo-study"] .work-spine-word\')?.textContent.startsWith("Done")', "the feed's jobs end", 40_000);
    await s.check(`!document.querySelector('[data-job-id="demo-birthday"] > .work-spine-bubble .work-spine-question') && !!document.querySelector('[data-job-id="demo-birthday"] > .work-spine-bubble .work-spine-result')`, "the waiting parent says its summary in plain words", 40_000);
    if (shots) await sleep(2800); // the last landing's glow is over
    await laidOut(s);
    await s.shot("ask", "light");
    await s.scheme("dark");
    await s.shot("ask", "dark");
    await s.scheme("light");
    // Typing arms Send; the box takes a few words.
    await s.type(".remote-field", "keep it a surprise, thanks");
    await s.check('!document.querySelector(".remote-send").disabled', "Send takes words");
    await s.shot("typing", "light");
    await s.scheme("dark");
    await s.shot("typing", "dark");
    await s.scheme("light");
    await s.click(".remote-send");
    await s.check('!!document.querySelector(".remote-sent")', "sent");
    assert.equal(await s.text(".remote-sent"), "Sent to agent: “keep it a surprise, thanks” (simulated)");
    assert.equal(await s.evaluate('!document.querySelector(".remote-ask")'), true, "the question is answered: it leaves");
    assert.equal(await s.text(".remote-quiet"), "Nothing is waiting for you.");
    assert.equal(s.core.heard.filter((m) => m.type === "answer").length, 0, "simulated: nothing is sent anywhere");
    await s.shot("sent", "light");
    await s.scheme("dark");
    await s.shot("sent", "dark");
    await s.sound("demo");
    await closeAll();
  }

  // The one-tap answer, with no room too, and a window as wide as a laptop's: a column down the middle.
  {
    const s = await scene({ width: 1440 });
    await s.go(`?remote&speed=${SPEED}`);
    await s.check('!!document.querySelector(".remote-ask")', "its question is held for you", 40_000);
    await s.check(`!!document.querySelector('[data-job-id="demo-birthday"] > .work-spine-bubble .work-spine-result')`, "the feed has played to its end", 40_000);
    const main = await s.rect(".remote");
    assert.ok(main.width <= 480 && Math.abs((main.left + main.right) / 2 - 720) < 1, `a laptop's window gets a column, centered: ${JSON.stringify(main)}`);
    if (shots) await sleep(2800);
    await laidOut(s);
    await s.shot("ask", "light");
    await s.scheme("dark");
    await s.shot("ask", "dark");
    await s.scheme("light");
    await s.click(".remote-quick-button:last-child");
    await s.check('!!document.querySelector(".remote-sent")', "one tap sent it");
    assert.equal(await s.text(".remote-sent"), "Sent to agent: “Keep it a surprise” (simulated)");
    await s.shot("sent", "light");
    await s.scheme("dark");
    await s.shot("sent", "dark");
    await s.sound("demo wide");
    await closeAll();
  }

  // ── In a room: the name form any phone fills in, then the core's jobs and questions; answers go to the one that asked. ──
  {
    let away = false;
    const joins = [];
    let replay = [
      job("trip", "waiting", { title: "Plan the trip", result: "Route found · hotel held · waiting on your answer", at_ms: Date.now() - 40_000 }),
      job("seat", "waiting", { title: "Pick a seat", parent: "trip", result: "Window or aisle?", at_ms: Date.now() - 30_000 }),
      job("map", "done", { title: "Find the route", result: "Ten minutes by bus.", at_ms: Date.now() - 20_000 }),
    ];
    const s = await scene({ width: 390, door: { room: true, member: true, code: "abcd2345" },
      joinReply: (query) => { joins.push(Object.fromEntries(query)); return away ? null : [{ type: "snapshot", world: empty }, ...replay]; } });
    await s.go("?remote&room=abcd2345");
    // The name form, as on any phone: no account, no code to type (the link carried it).
    await s.check('!!document.querySelector(".join input")', "a phone in a room is asked its name");
    assert.equal(await s.evaluate('document.querySelectorAll(".join input").length'), 1, "only its name: the link carried the code");
    assert.equal(await s.evaluate('!document.querySelector(".remote")'), true);
    await s.shot("join", "light");
    await s.scheme("dark");
    await s.shot("join", "dark");
    await s.scheme("light");
    await s.type(".join input", "Maya");
    await s.click(".join-card > button");
    await s.check('!!document.querySelector(".remote")', "joined: the Remote");
    await s.check('document.querySelector(".remote-status")?.textContent === "In the room as Maya"', "connected, under its name");
    assert.ok(joins.length >= 1 && joins.at(-1).name === "Maya" && joins.at(-1).room === "abcd2345", `its socket came in by name and room: ${JSON.stringify(joins)}`);
    // The replay: a waiting job is a question though no hold reached this window; the summary above it is not one.
    await s.check('!!document.querySelector(".remote-ask")', "the question waiting in the replay is held for you");
    assert.equal(await s.text(".remote-ask-text"), "Window or aisle?");
    assert.equal(await s.evaluate('document.querySelectorAll(".remote-quick-button").length'), 0, "no quick answers for a question that isn't \"A, or B?\"");
    assert.equal(await s.evaluate('document.querySelectorAll(".work-spine-demo").length'), 0, "real jobs: no simulated label");
    assert.equal(await s.evaluate('(() => { const t = document.querySelector(\'[data-job-id="trip"] > .work-spine-bubble\'); return !t.querySelector(".work-spine-question") && !!t.querySelector(".work-spine-result"); })()'), true, "the parent's words are its summary, plain");
    await laidOut(s);
    await s.shot("room", "light");
    await s.scheme("dark");
    await s.shot("room", "dark");
    await s.scheme("light");
    // An answer in words: Enter sends it, once, to the one that asked.
    await s.type(".remote-field", "window please");
    await s.enter();
    await s.check('document.querySelector(".remote-sent")?.textContent === "Sent to agent: “window please”"', "Enter sends it");
    const answers = () => s.core.heard.filter((m) => m.type === "answer");
    assert.deepEqual(answers(), [{ type: "answer", to: "agent", text: "window please" }], "one answer, to the helper that asked, in the words typed");
    assert.equal(await s.evaluate('!document.querySelector(".remote-ask")'), true, "answered: the question leaves");
    assert.equal(await s.evaluate('!!document.querySelector(\'[data-job-id="trip"]\')'), true, "the work stays in the Work spine until the helper moves on");

    // Another helper asks, "A, or B?": one tap, to that helper.
    const color = job("color", "waiting", { by: "Claude", title: "Pick a color", result: "Blue, or green?" });
    s.core.send(color);
    await s.check('document.querySelector(".remote-ask-text")?.textContent === "Blue, or green?"', "the next helper's question");
    assert.equal(await s.text(".remote-ask-by"), "Claude", "a human-looking name carries no AI mark unless the call says so");
    assert.deepEqual(await s.evaluate('[...document.querySelectorAll(".remote-quick-button")].map((b) => b.textContent)'), ["Blue", "Green"]);
    await s.click(".remote-quick-button:last-child");
    await s.check('document.querySelector(".remote-sent")?.textContent === "Sent to Claude: “Green”"', "one tap sent it");
    assert.deepEqual(answers().at(-1), { type: "answer", to: "Claude", text: "Green" }, "to Claude, in the words of the choice");

    // A hold no job says is a question too; the same words as a job are one question; more than one waits behind a count.
    s.core.send({ type: "guide", kind: "hold", target: null, text: "Ship it today?", by: "agent", at_ms: Date.now() });
    s.core.send({ type: "guide", kind: "hold", target: null, text: "Name the file?", by: "agent", at_ms: Date.now() });
    await s.check('document.querySelector(".remote-ask-text")?.textContent === "Ship it today?" && document.querySelector(".remote-more")?.textContent === "1 more waiting"', "holds are questions, one at a time, the rest counted");
    s.core.send(job("ship", "waiting", { title: "Ship", result: "Ship it today?" }));
    await sleep(300);
    assert.equal(await s.text(".remote-more"), "1 more waiting", "the job and the hold that say the same words are one question");
    await s.type(".remote-field", "yes");
    await s.enter();
    await s.check('document.querySelector(".remote-ask-text")?.textContent === "Name the file?"', "the next one comes up");
    assert.deepEqual(answers().at(-1), { type: "answer", to: "agent", text: "yes" });
    assert.equal(await s.evaluate('document.querySelector(".remote-more") === null'), true);
    // Send needs words; spaces are not words; the box holds 280.
    await s.type(".remote-field", "   ");
    assert.equal(await s.evaluate('document.querySelector(".remote-send").disabled'), true, "spaces are not an answer");
    assert.equal(await s.evaluate('document.querySelector(".remote-field").maxLength'), 280);
    await s.evaluate('(() => { const f = document.querySelector(".remote-field"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(f, ""); f.dispatchEvent(new Event("input", { bubbles: true })); })()');

    // The connection goes: Send is refused and keeps the words; the same page is there after; what was answered stays answered.
    away = true;
    s.core.drop();
    await s.check('document.querySelector(".remote-status")?.textContent === "Connecting…"', "told the connection is down");
    await s.type(".remote-field", "report.txt");
    await s.enter();
    await s.check('!!document.querySelector(".remote-problem")', "refused");
    assert.equal(await s.text(".remote-problem"), "Not sent: the connection is down. Try again in a moment.");
    assert.equal(await s.evaluate('document.querySelector(".remote-field").value'), "report.txt", "the words are kept");
    assert.equal(answers().length, 3, "nothing went");
    // The core replays each job as it was stamped.
    replay = [...replay, color, job("name", "waiting", { title: "Name", result: "Name the file?", at_ms: Date.now() - 5_000 })];
    away = false;
    await s.check('document.querySelector(".remote-status")?.textContent === "In the room as Maya"', "back in the room", 30_000);
    await s.check('document.querySelector(".remote-ask-text")?.textContent === "Name the file?"', "the replay brings back what still waits, and not what was answered", 12_000);
    assert.equal(await s.evaluate('document.querySelector(".remote-field").value'), "report.txt", "the words typed while it was down are still there");
    await s.enter();
    await s.check('document.querySelector(".remote-sent")?.textContent === "Sent to agent: “report.txt”"', "sent once it's back");
    assert.deepEqual(answers().at(-1), { type: "answer", to: "agent", text: "report.txt" });
    assert.equal(answers().length, 4);
    await s.check('!document.querySelector(".remote-sent")', "“Sent” is put away after a few seconds", 9000);
    assert.equal(await s.text(".remote-quiet"), "Nothing is waiting for you.");
    // The helper asks the same words again once its first ask is over: that's a new question.
    s.core.send(job("seat", "running", { title: "Pick a seat", parent: "trip" }));
    await sleep(200);
    s.core.send(job("seat", "waiting", { title: "Pick a seat", parent: "trip", result: "Window or aisle?" }));
    await s.check('document.querySelector(".remote-ask-text")?.textContent === "Window or aisle?"', "the same words asked again, after the helper moved on, are asked");
    await s.sound("room");
    await closeAll();
  }
  console.log("remote-check: ok");
} finally {
  clearTimeout(timeout);
  await closeAll();
}
