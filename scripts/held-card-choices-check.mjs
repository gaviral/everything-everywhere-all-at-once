// The held stack's card for a question that reads "A, or B?" (an agent's: "Mention the pottery class in Mom's card, or keep it a
// surprise?") offers its two answers, as the stage's caption does when the question is asked (held-choices-check.mjs): until now
// the card said Answer ↵ · Later L and nothing else, so the question could only be answered after it was asked.
//  1. The rules, without a page (guide-core.ts `answerHeld`): an answer from the stack goes to the asker once, the card is done
//     and a line says what went and to whom; a send that can't go keeps the question; a line (not a question) has nothing to
//     answer; one question being asked goes back to wait while another is answered from the stack.
//  2. The pages, built UI in headless Chrome over a stand-in core that hears what the window sends: the shell (the default page)
//     at 1440 × 900 and 390 × 844 (the stack is a "Held" chip there), light and dark, and the classic page (?shell=1) once.
//     A question held while a draft stands in the box shows A and B above Answer ↵ and Later L, whole in the card; a click
//     sends the answer once (pressed twice too), the card goes, the stage says "You sent “…” to agent" and the draft is
//     untouched; a question put off with Later still offers them; the connection down says "Not sent" in the card and keeps
//     it; an AI helper's own offer and a question that only looks like a choice ("Do you want tea, or coffee?") have no
//     answers; answering one question leaves the next held.
// SHOTS=<folder> also saves a screenshot of each scene there.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

const why = ready();
if (why) { console.log(`SKIP held-card-choices-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`held-card-choices-check: ${error.stack ?? error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const timeout = setTimeout(() => { console.error("held-card-choices-check: timed out"); process.exit(1); }, 420_000);
const quiet = (e) => !/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(e);

const ASK = "Mention the pottery class in Mom's card, or keep it a surprise?";
const A = "Mention the pottery class in Mom's card", B = "Keep it a surprise";
const OFFER = "Want me to move the study block to Thursday?";
const LOOKALIKE = "Do you want tea, or coffee?";
const NOT_SENT = /^Not sent: the connection is down/;

// ── 1. The rules, without a page. ──
{
  const server = await uiServer();
  try {
    const G = await server.ssrLoadModule("/src/guide-core.ts");
    const hold = (text, by = "agent") => ({ type: "guide", kind: "hold", target: null, text, by, at_ms: 1 });
    const sent = [];
    const send = (to, words) => { sent.push([to, words]); return true; };
    G.receiveGuide(hold(ASK));
    const n = G.current().held[0].n;
    assert.equal(G.answerHeld(n, "   ", send), "empty", "no words, nothing to answer with");
    assert.equal(G.answerHeld(n, B, () => false), "failed", "a send that can't go");
    assert.equal(G.current().held.length, 1, "…keeps the question held");
    assert.equal(G.current().caption, null, "…and says nothing itself (the card does)");
    assert.equal(G.answerHeld(n + 99, B, send), "gone", "another card's number answers nothing");
    assert.equal(G.answerHeld(n, `  ${B}\n `, send), "sent");
    assert.deepEqual(sent, [["agent", B]], "sent to the asker, as words (spaces gone), once");
    assert.equal(G.current().held.length, 0, "the question is done: it leaves the stack");
    assert.deepEqual({ ...G.current().caption, n: 0 }, { text: "sent “Keep it a surprise” to agent", by: "You", n: 0 }, "a line says what went, and to whom, as the stage's does");
    assert.equal(G.answerHeld(n, B, send), "gone", "a second press finds nothing to answer");
    assert.equal(sent.length, 1, "and sends nothing");
    // A line held is nothing to answer.
    G.captionRead(G.current().caption.n);
    G.busy();
    G.receiveGuide({ type: "guide", kind: "caption", target: null, text: "Just so you know.", by: "agent", at_ms: 1 });
    const line = G.current().held.find((h) => h.kind === "line");
    assert.ok(line, "a caption said while you are busy waits as a line in the stack");
    assert.equal(G.answerHeld(line.n, "x", send), "gone", "a held line takes no answer");
    assert.equal(sent.length, 1, "and sends nothing");
    // A question being asked goes back to wait while another is answered from the stack.
    for (const h of [...G.current().held]) G.dropHeld(h.n);
    G.receiveGuide(hold(ASK, "agent"));
    G.receiveGuide(hold("Keep the budget, or raise it?", "planner"));
    G.askAtPause();
    assert.equal(G.current().caption.ask.by, "agent", "agent's question is asked");
    const other = G.current().held.find((h) => h.by === "planner");
    assert.equal(G.answerHeld(other.n, "Keep the budget", send), "sent");
    assert.deepEqual(sent.at(-1), ["planner", "Keep the budget"], "the answer went to planner");
    assert.equal(G.current().caption.text, "sent “Keep the budget” to planner", "its line takes the caption's place");
    assert.deepEqual(G.current().held.map((h) => [h.by, h.state]), [["agent", "waiting"]], "agent's question went back to wait, planner's is done");
  } finally { await server.close(); }
}

// ── 2. The pages. ──
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now - 60_000, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, i) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now - 60_000 + i * 1000, place_ms: 2400, decided: false });
const world = {
  threads: [thread("T1", "Mom's birthday"), thread("T2", "Stats midterm")], active: "T2", active_by: { you: "T2" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["agent", "Friend", "planner"],
  thoughts: [thought("a1", "Mom's birthday is Saturday", "T1", 1), thought("a2", "She keeps talking about the pottery class on Main Street", "T1", 2), thought("b1", "My stats midterm is Thursday", "T2", 3)],
};

const DRAFT = "so about the card";
const RUNS = [[1440, 900, "light", ""], [1440, 900, "dark", ""], [390, 844, "light", ""], [390, 844, "dark", ""], [1440, 900, "light", "?shell=1"]];
try {
  for (const [width, height, scheme, flag] of RUNS) {
    const phone = width < 560;
    const label = `${width} ${scheme}${flag ? ` ${flag}` : ""}`;
    let away = false; // a core that is gone refuses the window's try to come back
    const core = await standInCore(() => (away ? null : [{ type: "snapshot", world }]));
    const browser = await openPage("about:blank", { width, height });
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
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: phone });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${flag}` });
      assert.ok(await until('!!document.querySelector("[data-guide=composer] textarea") && !document.querySelector(".tour-tip")', 10000), `${label}: the page opens`);
      for (let n = 0; n < 100 && !core.connected(); n++) await sleep(50);
      assert.equal(core.connected(), 1, `${label}: one connection to the core`);

      const check = async (expression, what, ms = 8000) => {
        const passed = await until(expression, ms);
        if (!passed) console.error(`${label}: ${what}`, { answers: answers(), page: await evaluate(`({ caption: document.querySelector(".guide-caption")?.outerHTML, held: document.querySelector(".guide-held-card")?.outerHTML, errors: window.heldErrors })`) });
        assert.ok(passed, `${label}: ${what}`);
      };
      const answers = () => core.heard.filter((m) => m.type === "answer");
      const hold = (text, by = "agent") => core.send({ type: "guide", kind: "hold", target: null, text, by, urgent: false, at_ms: Date.now() });
      const withdraw = (by = "agent") => core.send({ type: "guide", kind: "hold", target: null, text: "", by, urgent: false, at_ms: Date.now() });
      const rectOf = (selector, nth = 0) => evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
      /** A real press at the middle of an element, as a mouse does (`count` presses in a row). */
      const click = async (selector, nth = 0, count = 1) => {
        // The shell measures its shelf after mounting. Don't reuse a position while that corner is moving:
        // a down on B followed by an up on Later is no choice click, and cannot produce an acknowledgement.
        if (!flag) await check(`(() => {
          const shelf = document.querySelector('[data-slot="shelf"]')?.getBoundingClientRect();
          const expected = shelf?.height && shelf.top > innerHeight / 2 ? Math.round(innerHeight - shelf.top + 12) : 36;
          return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--shelf-top")) === expected;
        })()`, "the shelf reservation is measured before the press");
        let r = await rectOf(selector, nth);
        assert.ok(r, `${label}: ${selector} is there to press`);
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
        let stable = false, settled = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
          await sleep(50);
          const next = await rectOf(selector, nth);
          const hit = next && await evaluate(`(() => {
            const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
            return !!el && el.contains(document.elementFromPoint(${next.x}, ${next.y}));
          })()`);
          settled = next && hit && ["left", "right", "top", "bottom"].every((edge) => Math.abs(next[edge] - r[edge]) < 0.5) ? settled + 1 : 0;
          r = next;
          assert.ok(r, `${label}: ${selector} stays available before the press`);
          if (settled >= 4) { stable = true; break; }
        }
        assert.ok(stable, `${label}: ${selector} settles before the press`);
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
        for (let i = 1; i <= count; i++) for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: i });
      };
      const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, " ").trim() ?? null`);
      const shot = async (scene) => {
        if (!shots) return;
        await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
        await sleep(200);
        const { data } = await page("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `${scene}-${width}-${scheme}${flag ? "-classic" : ""}.png`), Buffer.from(data, "base64"));
      };
      const draft = async (words) => {
        await evaluate(`(() => { const box = document.querySelector('[data-guide="composer"] textarea'); box.focus(); document.execCommand("selectAll"); document.execCommand("delete"); })()`);
        if (words) await page("Input.insertText", { text: words });
        await evaluate("document.activeElement.blur()");
      };
      const draftNow = () => evaluate(`document.querySelector('[data-guide="composer"] textarea').value`);
      /** The held card in view: on a phone the stack is a chip, opened for the card. */
      const cardShown = async (what) => {
        await check(`!!document.querySelector(".guide-held-card") || !!document.querySelector(".shell-held-chip")`, `${what} is held`);
        // The chip fades in; a tap on it opens the card.
        if (phone && await evaluate(`!document.querySelector(".guide-held-card")`)) { await sleep(400); await click(".shell-held-chip"); }
        await check(`!!document.querySelector(".guide-held-card")`, `${what}: its card is in the stack`);
        await sleep(250); // its own fade in
      };
      const labels = () => evaluate(`[...document.querySelectorAll(".guide-held-acts .guide-btn")].map((b) => b.childNodes[0].textContent.trim())`);
      const keys = () => evaluate(`[...document.querySelectorAll(".guide-held-acts kbd")].map((k) => k.textContent)`);
      const choicesOf = () => evaluate(`[...document.querySelectorAll(".guide-held-card .guide-choice .guide-choice-words")].map((el) => el.textContent)`);
      const wholeCard = async (what) => {
        const box = await evaluate(`(() => {
          const card = document.querySelector(".guide-held-card").getBoundingClientRect();
          const buttons = [...document.querySelectorAll(".guide-held-card .guide-btn")].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, over: b.scrollWidth > b.clientWidth + 1 }; });
          return { left: card.left, right: card.right, top: card.top, bottom: card.bottom, buttons, w: innerWidth, h: innerHeight, across: document.documentElement.scrollWidth > innerWidth };
        })()`);
        assert.ok(box.left >= 0 && box.right <= box.w && box.top >= 0 && box.bottom <= box.h && !box.across, `${label}: ${what}: the card is whole on screen (${JSON.stringify({ ...box, buttons: undefined })})`);
        for (const b of box.buttons) assert.ok(b.left >= box.left && b.right <= box.right + 0.5 && !b.over, `${label}: ${what}: each button is inside the card and holds its words (${JSON.stringify(b)})`);
        return box;
      };

      // ── A. Held while a draft stands: the card offers A and B above Answer and Later. ──
      await draft(DRAFT);
      hold(ASK);
      await cardShown("the question");
      assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, `${label}: with a draft in the box it is not asked`);
      assert.deepEqual(await choicesOf(), [A, B], `${label}: the card offers A and B, from the question's own words`);
      assert.deepEqual(await labels(), ["Answer", "Later"], `${label}: Answer and Later stay as they were`);
      assert.deepEqual(await keys(), flag ? [] : ["↵", "L"], `${label}: …with their keys (the classic page has none)`);
      assert.equal(await evaluate(`!!document.querySelector(".guide-held-choices kbd")`), false, `${label}: the answers carry no keys (1 and 2 zoom the canvas until a question is asked)`);
      assert.equal(await text(".guide-held-text"), ASK, `${label}: the question is still there in full above them`);
      assert.equal(await evaluate(`document.querySelector(".guide-held-choices").getAttribute("role") + "|" + document.querySelector(".guide-held-choices").getAttribute("aria-label")`), "group|Answers to agent", `${label}: named for a screen reader`);
      await wholeCard("A and B");
      await shot("held-choices");

      // ── B. A press sends the answer once (pressed twice too); the card goes, the stage says what went, the draft stays. ──
      await click(".guide-held-card .guide-choice", 1, 2);
      await check(`!!document.querySelector(".guide-caption")`, "the stage says it went");
      assert.deepEqual(answers(), [{ type: "answer", to: "agent", text: B }], `${label}: the answer, to the asker, once for two presses`);
      assert.match(await text(".guide-caption"), /^You sent “Keep it a surprise” to agent$/, `${label}: what went, to whom`);
      await check(`(() => { const el = document.querySelector(".guide-caption"), r = el?.getBoundingClientRect(); return el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`, "the acknowledgement is visible and whole on screen");
      await check(`!document.querySelector(".guide-held-card") && !document.querySelector("[data-held-id]")`, "the card has left the stack");
      assert.equal(await draftNow(), DRAFT, `${label}: the draft in the box is untouched`);
      await shot("sent");
      withdraw();

      // ── C. One question answered, the next stays held. ──
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3 });
      await check(`!document.querySelector(".guide-caption")`, "the line goes", 20_000);
      hold("Keep the budget, or raise it?", "planner");
      hold(ASK);
      await cardShown("two questions");
      // The next in line is the first that came: planner's.
      assert.deepEqual(await choicesOf(), ["Keep the budget", "Raise it"], `${label}: the next in line offers its own two answers`);
      await click(".guide-held-card .guide-choice", 0);
      await check(`document.querySelector(".guide-caption")?.textContent.includes("You sent")`, "its line");
      assert.deepEqual(answers().slice(1), [{ type: "answer", to: "planner", text: "Keep the budget" }], `${label}: to planner, and only planner`);
      await cardShown("agent's question");
      assert.deepEqual(await choicesOf(), [A, B], `${label}: agent's question is still held, with its answers`);
      withdraw("planner");
      withdraw();
      await check(`!document.querySelector("[data-held-id]")`, "the stack is clear");

      // ── D. Put off with Later, it still waits for you: still with its answers. ──
      hold(ASK);
      await cardShown("the question");
      await click(".guide-held-acts .guide-btn:last-child");
      await check(`document.querySelector(".guide-held-card")?.dataset.state === "later"`, "Later puts it off");
      assert.deepEqual(await choicesOf(), [A, B], `${label}: a question put off still offers them`);
      assert.deepEqual(await labels(), ["Answer", "Drop it"], `${label}: Answer and Drop it, as before`);
      await shot("later");
      await click(".guide-held-card .guide-choice", 0);
      await check(`document.querySelector(".guide-caption")?.textContent.includes("You sent")`, "a put-off question is answered too");
      assert.deepEqual(answers().slice(2), [{ type: "answer", to: "agent", text: A }], `${label}: the first answer went`);
      withdraw();
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3 });
      await check(`!document.querySelector(".guide-caption") && !document.querySelector("[data-held-id]")`, "clear", 20_000);

      // ── E. An offer, and a question that only looks like a choice, have no answers. ──
      for (const [words, by] of [[OFFER, "Friend"], [LOOKALIKE, "agent"]]) {
        hold(words, by);
        await cardShown(words);
        assert.equal(await evaluate(`!!document.querySelector(".guide-held-choices, .guide-choice")`), false, `${label}: no answers on "${words}"`);
        assert.deepEqual(await labels(), ["Answer", "Later"], `${label}: Answer and Later, as before`);
        if (by === "Friend") await shot("offer");
        withdraw(by);
        await check(`!document.querySelector("[data-held-id]")`, "withdrawn");
      }

      // ── F. The connection down: it says so, in the card, and the question stays. ──
      hold(ASK);
      await cardShown("the question");
      const before = answers().length;
      away = true;
      core.drop();
      await sleep(300);
      await click(".guide-held-card .guide-choice", 1);
      await check(`!!document.querySelector(".guide-held-card .guide-problem")`, "it says it wasn't sent");
      assert.match(await text(".guide-held-card .guide-problem"), NOT_SENT, `${label}: Not sent, and why`);
      assert.deepEqual(await choicesOf(), [A, B], `${label}: the answers are still there to press again`);
      assert.equal(answers().length, before, `${label}: nothing went`);
      assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, `${label}: and the stage says nothing went`);
      await wholeCard("the card with its problem");
      await shot("not-sent");

      // ── G. The same retained question can be retried after reconnect, without a new hold or a lost draft. ──
      away = false;
      await check(`!document.querySelector("button.mic")?.disabled`, "the connection returns");
      for (let n = 0; n < 100 && !core.connected(); n++) await sleep(50);
      assert.equal(core.connected(), 1, `${label}: reconnected to the core`);
      assert.match(await text(".guide-held-card .guide-problem"), NOT_SENT, `${label}: reconnect alone does not silently answer`);
      await click(".guide-held-card .guide-choice", 1, 2);
      await check(`document.querySelector(".guide-caption")?.textContent.includes("You sent")`, "the retry says it went");
      assert.deepEqual(answers().slice(before), [{ type: "answer", to: "agent", text: B }], `${label}: the retry sends the retained answer once`);
      await check(`!document.querySelector(".guide-held-card") && !document.querySelector("[data-held-id]")`, "the retry retires the question");
      assert.equal(await draftNow(), DRAFT, `${label}: the retry leaves the draft untouched`);
      await shot("retried");
      assert.deepEqual((await evaluate("window.heldErrors")).filter(quiet), [], `${label}: no page errors`);
    } finally { await browser.close(); core.close(); }
  }
} catch (error) {
  console.error(`held-card-choices-check failed: ${error.stack ?? error.message}`);
  process.exit(1);
}
clearTimeout(timeout);
console.log("held-card-choices-check: the held stack's card for a question that reads \"A, or B?\" offers A and B above Answer and Later; a press sends it once to the asker, the card goes and the stage says what went; put off, it still does; an offer and a lookalike have none; the connection down says so and keeps it; laptop and phone, light and dark, and the classic page");
