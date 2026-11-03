// A question another window holds for you that reads "A, or B?" (an agent's: "Mention the pottery class in Mom's card, or keep
// it a surprise?") is a choice, and "Go ahead ↵" fits an AI helper's own offer, not a choice. Asked at your pause, it offers
// A and B as buttons that send `{"type":"answer","to":<the asker>,"text":…}` (the core routes it; the Remote's own reading
// of "A, or B?", remote/ask.ts, decides what is a choice), Answer ↵ for words of your own, Later and Drop it. Everything
// else keeps its Go ahead, Later, Drop it.
//  1. The rules, without a page (guide-core.ts): the box for your own words opens and closes; an answer sent makes the caption
//     say what went and to whom, once (a second press finds nothing to answer); a send that can't go leaves the question
//     as it was; an AI helper's own offer is no choice.
//  2. The page, built UI in headless Chrome over a stand-in core that hears what the window sends, at 1440 × 900 and 390 × 844,
//     light and dark: the asked caption has A and B (1, 2), Answer, Later, Drop it and no Go ahead, whole on screen and not
//     wider than it; a click on A sends it once, even pressed twice; at a laptop, Enter opens the box and sends nothing,
//     1 and 2 and the arrows move to an answer and send nothing, Enter on the answer moved to sends it once; typed words send
//     as typed (Send is off until there are some); Esc closes the box before it drops the question; Enter on a question still
//     in the held stack asks it and answers nothing; an AI helper's own offer and a question that only looks like a choice
//     ("Do you want tea, or coffee?") keep Go ahead; a send with the connection down says so and keeps the question.
//  3. On a real core (no key needed), when E2A2O_CORE names a built core: the agent feed (scripts/demo-jobs.mjs) asks the
//     question, a click on an answer makes the feed print "Answer from …", and the birthday work finishes with it
//     ("Class found · card ready" in the Work spine, and the feed's card done with the chosen words), for each answer. Skipped, said so, without it.
// SHOTS=<folder> also saves a screenshot of each scene there.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP held-choices-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`held-choices-check: ${error.stack ?? error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
// About two minutes alone; four checks at once (the gate's precheck) stretch it, and each step names itself if it sticks.
const timeout = setTimeout(() => { console.error("held-choices-check: timed out"); process.exit(1); }, 600_000);
const quiet = (e) => !/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(e);

const ASK = "Mention the pottery class in Mom's card, or keep it a surprise?";
const A = "Mention the pottery class in Mom's card", B = "Keep it a surprise";

// ── 1. The rules, without a page. ──
/** How long a question asked waits for an answer before it goes back to the stack (guide-core.ts `askMs`). */
let ASK_MS = 0;
{
  const server = await uiServer();
  try {
    const G = await server.ssrLoadModule("/src/guide-core.ts");
    ASK_MS = G.askMs(ASK);
    assert.ok(ASK_MS > 4000 && ASK_MS < 30_000, `a question's time to answer (${ASK_MS} ms)`);
    const hold = (text, by = "agent") => ({ type: "guide", kind: "hold", target: "composer", text, by, at_ms: 1 });
    // The pure steps.
    let state = G.guided(G.NOTHING, hold(ASK), 1);
    state = G.asked(state, 1, 2, 10);
    assert.equal(state.caption.ask.by, "agent", "asked");
    assert.equal(state.caption.typing, undefined, "no box open yet");
    const open = G.answerOpened(state);
    assert.equal(open.caption.typing, true, "the box opens");
    assert.equal(G.answerOpened(open), open, "opening it again changes nothing");
    assert.equal(G.answerClosed(open).caption.typing, false, "and closes");
    assert.equal(G.answerClosed(state), state, "closed already: nothing");
    const sent = G.sentAnswer(open, "Keep it a surprise", 7);
    assert.deepEqual(sent.caption, { text: "sent “Keep it a surprise” to agent", by: "You", n: 7 }, "the caption says what went, to whom, in the sender's own words' form (no ask, no box)");
    assert.equal(sent.point, null, "its arrow goes with the question");
    const line = G.guided(G.NOTHING, { type: "guide", kind: "caption", target: null, text: "Just so you know.", by: "agent", at_ms: 1 }, 3);
    assert.equal(G.answerOpened(line), line, "a line says nothing to answer");
    assert.equal(G.sentAnswer(line, "x", 4), line, "nor does one take an answer");
    // The window's store: once only, nothing sent for no words, and a refused send keeps the question.
    G.receiveGuide(hold(ASK));
    assert.equal(G.askAtPause(), true, "asked at the pause");
    const n = G.current().caption.n;
    const calls = [];
    assert.equal(G.answerAsk(n, "   ", (to, words) => { calls.push([to, words]); return true; }), "empty");
    assert.equal(G.answerAsk(n, B, () => false), "failed", "a send that can't go");
    assert.ok(G.current().caption.ask, "…leaves the question asked");
    assert.equal(G.answerAsk(n + 99, B, (to, words) => { calls.push([to, words]); return true; }), "gone", "another caption's number answers nothing");
    assert.equal(G.answerAsk(n, `  ${B}\n `, (to, words) => { calls.push([to, words]); return true; }), "sent");
    assert.deepEqual(calls, [["agent", B]], "sent to the asker, as words (spaces gone), once");
    assert.equal(G.current().caption.text, "sent “Keep it a surprise” to agent");
    assert.equal(G.answerAsk(n, B, (to, words) => { calls.push([to, words]); return true; }), "gone", "a second press finds nothing to answer");
    assert.equal(calls.length, 1, "and sends nothing");
    // What is a choice is the Remote's reading of the words (remote/ask.ts), nothing more.
    const { options } = await server.ssrLoadModule("/src/remote/ask.ts");
    assert.deepEqual(options(ASK), [A, B]);
    for (const offer of ["Want me to move the study block to Thursday?", "Do you want tea, or coffee?", "Should I book it, or leave it?", "Which seat?"]) assert.deepEqual(options(offer), [], `${offer}: an offer, not a choice`);
  } finally { await server.close(); }
}

// ── 2. The pages. ──
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now - 60_000, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, i) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now - 60_000 + i * 1000, place_ms: 2400, decided: false });
const world = {
  threads: [thread("T1", "Mom's birthday"), thread("T2", "Stats midterm")], active: "T2", active_by: { you: "T2" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["agent", "Friend"],
  thoughts: [thought("a1", "Mom's birthday is Saturday", "T1", 1), thought("a2", "She keeps talking about the pottery class on Main Street", "T1", 2), thought("b1", "My stats midterm is Thursday", "T2", 3)],
};

/** One scene's tools, over a page on `core`. */
function tools(core, browser, label, { width, scheme }) {
  const { page, evaluate, until } = browser;
  const guide = (text, by = "agent", target = null) => core.send({ type: "guide", kind: "hold", target, text, by, urgent: false, at_ms: Date.now() });
  const withdraw = (by = "agent") => core.send({ type: "guide", kind: "hold", target: null, text: "", by, urgent: false, at_ms: Date.now() });
  const check = async (expression, what, ms = 10_000) => assert.ok(await until(expression, ms), `${label}: ${what}`);
  const answers = () => core.heard.filter((m) => m.type === "answer");
  const key = async (name, code, vk, options = {}) => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: vk, ...(name === "Enter" ? { text: "\r" } : name.length === 1 ? { text: name } : {}), ...options });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, modifiers: options.modifiers ?? 0 });
  };
  const enter = () => key("Enter", "Enter", 13), escape = () => key("Escape", "Escape", 27), digit = (d) => key(String(d), `Digit${d}`, 48 + d);
  const arrow = (name) => key(name, name, { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[name]);
  const rectOf = (selector, nth = 0) => evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
  /** A real press at the middle of an element, as a mouse does. */
  const click = async (selector, nth = 0, count = 1) => {
    const r = await rectOf(selector, nth);
    assert.ok(r, `${label}: ${selector} is there to press`);
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    for (let i = 1; i <= count; i++) for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: i });
  };
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, " ").trim() ?? null`);
  const focused = () => evaluate(`(document.activeElement?.closest(".guide-choice")?.querySelector(".guide-choice-words")?.textContent) ?? (document.activeElement?.className || document.activeElement?.tagName)`);
  const shot = async (scene) => {
    if (!shots) return;
    await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    await sleep(150);
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${scene}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
  };
  const caption = '.guide-caption[data-asking]';
  /** Asked at the pause, with its answers; the caption whole on screen, nothing across. */
  const asked = async (text = ASK, by = "agent") => {
    guide(text, by);
    await check(`!!document.querySelector(${JSON.stringify(caption)})`, "the question is asked at the pause", 14_000);
    await sleep(350); // its own fade in
    const box = await evaluate(`(() => { const r = document.querySelector(".guide-caption").getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight, across: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert.ok(box.left >= 0 && box.right <= box.w && box.top >= 0 && box.bottom <= box.h && !box.across, `${label}: the caption is whole on screen (${JSON.stringify(box)})`);
    return box;
  };
  // A caption the pointer is on stays (it is being read): the pointer goes to a corner first.
  const gone = async (what) => { await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3 }); await check(`!document.querySelector(".guide-caption")`, what, 20_000); };
  return { guide, withdraw, check, answers, key, enter, escape, digit, arrow, rectOf, click, text, focused, shot, asked, gone, evaluate, page, until };
}

try {
  for (const width of [1440, 390]) {
    const phone = width === 390;
    for (const scheme of ["light", "dark"]) {
      const label = `${width} ${scheme}`;
      let away = false; // a core that is gone refuses the window's try to come back
      const core = await standInCore(() => (away ? null : [{ type: "snapshot", world }]));
      const browser = await openPage("about:blank", { width, height: phone ? 844 : 900 });
      const { page, evaluate, until } = browser;
      try {
        // Without Page.enable Chrome accepts the script below and never runs it.
        await page("Page.enable");
        await page("Page.addScriptToEvaluateOnNewDocument", { source: `
          localStorage.setItem("e2a2o.toured", "1");
          window.heldErrors = [];
          addEventListener("error", (e) => window.heldErrors.push(e.message));
          addEventListener("unhandledrejection", (e) => window.heldErrors.push(String(e.reason)));
          const error = console.error; console.error = (...args) => { window.heldErrors.push(args.map(String).join(" ")); error(...args); };
        ` });
        await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
        await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
        assert.ok(await until('!!document.querySelector("[data-guide=composer] textarea") && !document.querySelector(".tour-tip")', 10000), `${label}: the page opens`);
        for (let n = 0; n < 100 && !core.connected(); n++) await sleep(50);
        assert.equal(core.connected(), 1, `${label}: one connection to the core`);
        const t = tools(core, browser, label, { width, scheme });

        // ── A. The question, asked: its answers, no Go ahead. ──
        const box = await t.asked();
        assert.deepEqual(await evaluate(`[...document.querySelectorAll(".guide-caption .guide-btn")].map((b) => (b.querySelector(".guide-choice-words") ?? b.childNodes[0]).textContent.trim())`),
          [A, B, "Answer", "Later", "Drop it"], `${label}: the answers, then Answer, Later and Drop it, and no Go ahead`);
        assert.deepEqual(await evaluate(`[...document.querySelectorAll(".guide-caption .guide-btn kbd")].map((k) => k.textContent)`), ["1", "2", "↵", "L", "esc"], `${label}: each with its key (a phone hides them: no keyboard)`);
        assert.deepEqual(await evaluate(`[...document.querySelectorAll(".guide-choice")].map((b) => b.querySelector(".guide-choice-words").textContent)`), [A, B], `${label}: A and B, from the question's own words`);
        assert.equal(await evaluate(`document.querySelector(".guide-caption .guide-text")?.textContent`), ASK, `${label}: the question is still said in full above them`);
        const buttons = await evaluate(`[...document.querySelectorAll(".guide-caption .guide-btn")].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, wraps: b.scrollWidth > b.clientWidth + 1 }; })`);
        for (const b of buttons) assert.ok(b.left >= 0 && b.right <= width && !b.wraps, `${label}: each button is whole on screen and holds its words (${JSON.stringify(b)})`);
        assert.ok(box.bottom <= (await t.rectOf('[data-guide="composer"] textarea')).top + 1, `${label}: the caption sits above where you type`);
        await t.shot("asked-choices");

        // ── B. A click sends the answer once, even pressed twice. ──
        await t.click(".guide-choice", 0, 2);
        await t.check(`document.querySelector(".guide-caption")?.textContent.includes("sent")`, "the caption says it went");
        assert.deepEqual(t.answers(), [{ type: "answer", to: "agent", text: A }], `${label}: the first answer, to the asker, once for two presses`);
        assert.match(await t.text(".guide-caption"), /^You sent “Mention the pottery class in Mom's card” to agent$/, `${label}: what went, to whom`);
        assert.equal(await evaluate(`!!document.querySelector(".guide-caption .guide-btn")`), false, `${label}: nothing left to press on it`);
        await t.shot("sent");
        t.withdraw();
        await t.gone("the line and the question go");

        if (!phone && scheme === "light") {
          // ── C. Keys: Enter opens a box and sends nothing; digits and arrows move; Enter on the answer sends it once. ──
          await t.asked();
          await t.enter();
          await t.check(`document.activeElement?.classList.contains("guide-answer-field")`, "Enter opens the box for words of your own, and you're in it");
          assert.deepEqual(t.answers().length, 1, `${label}: Enter on the page answered nothing`);
          assert.equal(await evaluate(`document.querySelector(".guide-answer .guide-btn").disabled`), true, `${label}: Send waits for words`);
          await t.shot("typing");
          await t.escape();
          await t.check(`!document.querySelector(".guide-answer-field") && !!document.querySelector(".guide-caption[data-asking]")`, "Esc closes the box and the question stays");
          await t.digit(2);
          assert.equal(await t.focused(), B, `${label}: 2 moves to the second answer`);
          assert.equal(t.answers().length, 1, `${label}: and sends nothing`);
          await t.shot("focused");
          await t.arrow("ArrowLeft");
          assert.equal(await t.focused(), A, `${label}: left moves to the first`);
          await t.arrow("ArrowRight");
          assert.equal(await t.focused(), B, `${label}: right to the second`);
          await t.arrow("ArrowRight");
          assert.equal(await t.focused(), B, `${label}: and no further`);
          await t.digit(9);
          assert.equal(await t.focused(), B, `${label}: 9 is no answer`);
          assert.equal(t.answers().length, 1, `${label}: still nothing sent`);
          await t.enter();
          await t.check(`document.querySelector(".guide-caption")?.textContent.includes("sent")`, "Enter on the answer sent it");
          await t.enter();
          assert.deepEqual(t.answers().slice(1), [{ type: "answer", to: "agent", text: B }], `${label}: exactly one answer, the one moved to`);
          t.withdraw();
          await t.gone("gone again");

          // ── D. Your own words: typed, sent as typed; Esc closes the box first and drops the question second. ──
          await t.asked();
          await t.click(".guide-asks:not(.guide-choices) .guide-btn", 0);
          await t.check(`document.activeElement?.classList.contains("guide-answer-field")`, "Answer opens the box too");
          await page("Input.insertText", { text: "  Keep it   a surprise,\tthanks  " });
          assert.equal(await evaluate(`document.querySelector(".guide-answer .guide-btn").disabled`), false, `${label}: with words, Send is on`);
          await t.enter();
          await t.check(`document.querySelector(".guide-caption")?.textContent.includes("sent")`, "Enter in the box sent it");
          assert.deepEqual(t.answers().slice(2), [{ type: "answer", to: "agent", text: "Keep it a surprise, thanks" }], `${label}: the words as typed, spaces tidied, once`);
          t.withdraw();
          await t.gone("gone");
          await t.asked();
          await t.enter();
          await t.check(`!!document.querySelector(".guide-answer-field")`, "the box is open");
          await t.escape();
          await t.check(`!document.querySelector(".guide-answer-field") && !!document.querySelector(".guide-caption[data-asking]")`, "the first Esc closes the box");
          await t.escape();
          await t.gone("the second Esc drops the question");
          assert.equal(t.answers().length, 3, `${label}: no answer sent by either`);

          // ── F. An AI helper's own offer, and a question that only looks like a choice, keep Go ahead. ──
          for (const [text, by] of [["Want me to move the study block to Thursday?", "Friend"], ["Do you want tea, or coffee?", "agent"]]) {
            await t.asked(text, by);
            assert.deepEqual(await evaluate(`[...document.querySelectorAll(".guide-caption .guide-btn")].map((b) => b.textContent.replace(/\\s+/g, " ").trim())`), ["Go ahead ↵", "Later L", "Drop it esc"], `${label}: ${text}`);
            assert.equal(await evaluate(`!!document.querySelector(".guide-choice, .guide-answer-field")`), false, `${label}: no choice on an offer`);
            if (by === "Friend") await t.shot("offer-go-ahead");
            await t.enter(); // Go ahead, as it always was
            await t.check(`!document.querySelector(".guide-caption[data-asking]")`, "Go ahead answers it, as it did");
            assert.equal(t.answers().length, 3, `${label}: and sends no answer`);
            t.withdraw(by);
            await t.gone("gone");
          }
          // ── D2. A key's focus on an answer keeps the question up while it's weighed; with focus gone it goes back to the stack. ──
          await t.asked();
          await t.digit(1);
          assert.equal(await t.focused(), A, `${label}: 1 moves to the first answer`);
          await sleep(ASK_MS + 1500);
          assert.equal(await evaluate(`!!document.querySelector(".guide-caption[data-asking]")`), true, `${label}: with a key on an answer, the question outlasts its ${ASK_MS} ms`);
          await evaluate("document.activeElement.blur()");
          await t.check(`!document.querySelector(".guide-caption") && document.querySelector(".guide-held-card")?.dataset.state === "later"`, "with focus gone, it goes back to the stack as Later", 8000);
          t.withdraw();
          await t.check(`!document.querySelector("[data-held-id]")`, "the stack is clear");
          // …and a box closed by Esc, where the focus left with it, leaves nothing holding the question up.
          await t.asked();
          await t.enter();
          await t.check(`document.activeElement?.classList.contains("guide-answer-field")`, "the box is open and focused");
          await t.escape();
          await t.check(`!document.querySelector(".guide-answer-field") && !!document.querySelector(".guide-caption[data-asking]")`, "Esc closed the box");
          await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3 });
          await t.check(`!document.querySelector(".guide-caption")`, "nothing holds it up now: it goes back to the stack at its time", ASK_MS + 4000);
          t.withdraw();
          await t.check(`!document.querySelector("[data-held-id]")`, "the stack is clear again");

          // ── E. Enter on a question still in the held stack asks it; it answers nothing. ──
          await evaluate(`document.querySelector('[data-guide="composer"] textarea').focus()`);
          await page("Input.insertText", { text: "A draft still being written" });
          await evaluate("document.activeElement.blur()");
          t.guide(ASK);
          await t.check(`!!document.querySelector(".guide-held-card") && !document.querySelector(".guide-caption")`, "the question waits in the held stack while a draft stands");
          await t.shot("held");
          await t.enter();
          await t.check(`!!document.querySelector(".guide-caption[data-asking] .guide-choice")`, "Enter on the held question asks it");
          assert.equal(t.answers().length, 3, `${label}: asking it answered nothing`);
          await t.enter();
          await t.check(`!!document.querySelector(".guide-answer-field")`, "a second Enter opens the box, and still sends nothing");
          assert.equal(t.answers().length, 3, `${label}: no answer from Enter`);
          await t.escape(); await t.escape();
          t.withdraw();
          await t.check(`!document.querySelector(".guide-caption")`, "cleared");
          // The draft goes (select all, delete: the box's own events), so the next question is asked at once.
          await evaluate(`(() => { const box = document.querySelector('[data-guide="composer"] textarea'); box.focus(); document.execCommand("selectAll"); document.execCommand("delete"); box.blur(); })()`);
          assert.equal(await evaluate(`document.querySelector('[data-guide="composer"] textarea').value`), "", `${label}: the draft is gone`);

        }

        // ── G. The connection down: it says so, and the question stays. ──
        await t.asked();
        const before = t.answers().length;
        away = true;
        core.drop();
        await t.check(`document.querySelector(".guide-caption") !== null`, "still up");
        await t.click(".guide-choice", 1);
        await t.check(`!!document.querySelector(".guide-problem")`, "it says it wasn't sent");
        assert.match(await t.text(".guide-problem"), /^Not sent: the connection is down/, `${label}: Not sent, and why`);
        assert.equal(await evaluate(`document.querySelectorAll(".guide-choice").length`), 2, `${label}: the answers are still there to press again`);
        assert.equal(t.answers().length, before, `${label}: nothing went`);
        await t.shot("not-sent");
        assert.deepEqual((await evaluate("window.heldErrors")).filter(quiet), [], `${label}: no page errors`);
      } finally { await browser.close(); core.close(); }
    }
  }
} catch (error) {
  console.error(`held-choices-check failed: ${error.stack ?? error.message}`);
  process.exit(1);
}

// ── 3. On a real core: the agent feed asks, a press answers, the work finishes. ──
const bin = process.env.E2A2O_CORE;
if (!bin) console.log("held-choices-check: the real-core part is skipped (set E2A2O_CORE to a built core to run it)");
else {
  for (const [which, choice, said, result] of [[0, A, "Mention the pottery class in Mom's card", "Mentions the pottery class"], [1, B, "Keep it a surprise", "Keeps the class a surprise"]]) {
    const port = 4741 + which;
    const data = mkdtempSync(join(tmpdir(), "held-choices-core-"));
    mkdirSync(join(data, "images"), { recursive: true });
    // The map the pitch has by then, as the core's own journal: Mom's birthday and the stats midterm.
    writeFileSync(join(data, "journal.jsonl"), [...world.threads.map((t) => ({ type: "thread_added", thread: t })), { type: "active_changed", thread_id: "T2" },
      ...world.thoughts.map((t) => ({ type: "thought_added", thought: t }))].map((line) => JSON.stringify(line)).join("\n") + "\n");
    const env = { ...process.env, PORT: String(port), E2A2O_DATA: data, E2A2O_UI: new URL("../ui/dist", import.meta.url).pathname, PICTURES: "off" };
    for (const k of ["MODEL_API_KEY", "ROOM_CODE"]) delete env[k];
    const core = spawn(bin, [], { cwd: data, env, stdio: "ignore" });
    let feed, browser;
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/room`)).ok) break; } catch { /* not up yet */ } await sleep(100); }
      browser = await openPage("about:blank", { width: 1440, height: 900 });
      const { page, evaluate, until } = browser;
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");` });
      await page("Page.navigate", { url: `http://127.0.0.1:${port}/?shell=2` });
      assert.ok(await until('!!document.querySelector("[data-guide=composer] textarea") && !!document.querySelector(".spine-ready")', 10000), "real core: the page opens");
      // The Work spine is a feature with a switch in the Catalog: on, so the birthday job is on screen.
      await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
      assert.ok(await until(`!!document.querySelector('[data-row="work-spine"] [role="switch"]')`), "real core: the Catalog lists the Work spine");
      await evaluate(`document.querySelector('[data-row="work-spine"] [role="switch"]').click()`);
      await evaluate(`document.querySelector(".shell-rail-close")?.click()`);
      assert.ok(await until(`!!document.querySelector(".work-spine-lane")`), "real core: the Work spine is on");
      let log = "";
      feed = spawn(process.execPath, [new URL("./demo-jobs.mjs", import.meta.url).pathname, "--port", String(port), "--speed", "8"], { stdio: ["ignore", "pipe", "pipe"] });
      feed.stdout.on("data", (d) => { log += d; });
      feed.stderr.on("data", (d) => { log += d; });
      assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking] .guide-choice")`, 20000), `real core: the agent's question is asked with its answers (${log.trim().split("\n").slice(-3).join(" / ")})`);
      assert.equal(await evaluate(`[...document.querySelectorAll(".guide-choice-words")].map((el) => el.textContent).join("|")`), `${A}|${B}`, "real core: A and B");
      const snap = async (scene) => {
        if (!shots) return;
        await sleep(400);
        const { data } = await page("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `real-${scene}-1440-light.png`), Buffer.from(data, "base64"));
      };
      await sleep(400);
      await snap(`asked-${which + 1}`);
      const pick = await evaluate(`(() => { const r = document.querySelectorAll(".guide-choice")[${which}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...pick, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      for (let i = 0; i < 100 && !/Answer from/.test(log); i++) await sleep(100);
      assert.match(log, new RegExp(`Answer from you: ${said}`), `real core: the feed printed the answer (${log.trim().split("\n").slice(-3).join(" / ")})`);
      assert.ok(await until(`document.querySelector(".work-spine-lane")?.textContent.includes("Class found · card ready")`, 8000), "real core: the birthday work finished in the Work spine");
      assert.match(log, new RegExp(`done demo-card: Draft a birthday card for Mom — ${result}`), "real core: the feed finished the card with the chosen words");
      await snap(`done-${which + 1}`);
      console.log(`held-choices-check: real core: "${choice}" → feed: ${log.split("\n").find((l) => /Answer from/.test(l))} → "Class found · card ready", card: ${result}`);
    } finally {
      feed?.kill();
      await browser?.close();
      core.kill("SIGTERM");
    }
  }
}
clearTimeout(timeout);
console.log("held-choices-check: a question that reads \"A, or B?\" offers A and B (1, 2, arrows, Enter on one; a click), Answer, Later and Drop it; an answer goes once to the asker; Enter never sends one; an AI helper's own offer keeps Go ahead");
