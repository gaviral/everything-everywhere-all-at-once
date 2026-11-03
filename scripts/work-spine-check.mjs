// The Work spine (ui/src/bricks/work-spine), on the built page with a stand-in core that sends the jobs as the core does
// (flat `job` messages, the latest of each replayed right after a window's snapshot): off until switched on in the
// Catalog; every state in words (running with a live clock, done with how long, failed with why, waiting with its
// question); oldest at the top, newest at the foot, "Just now" on the newest change; side jobs folded under their parent
// and opened by a click or a key; "Demo mode · simulated" when a job shown is simulated; the lane beside the Canvas on a
// laptop (the Canvas ends where it begins, nothing under it), a card above the composer on a phone that opens a sheet
// without covering the composer; replay on a new connection; at most 60 jobs; light, dark and reduced motion.
// SHOTS=dir saves <scene>-<width>-<scheme>.png of the Canvas with the Work spine, a fold opened and the demo label.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP work-spine-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const at = Date.now();
const thread = (n, title) => ({ id: `T${n}`, title, parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, i) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", complete: true, at_ms: at - 60_000 + i * 1000, place_ms: 2400 });
const threads = [thread(1, "Mom's birthday"), thread(2, "Stats midterm")];
const world = {
  threads, active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
  thoughts: [thought("a1", "Mom's birthday is Saturday", "T1", 1), thought("a2", "She keeps talking about the pottery class on Main Street", "T1", 2),
    thought("a3", "If it's under eighty dollars, I'm booking it tonight", "T1", 3), thought("b1", "My stats midterm is Thursday", "T2", 4), thought("b2", "I'll study with Priya on Wednesday", "T2", 5)],
};
/** A job message as the core sends it: flat, with who and when. */
const job = (id, status, extra = {}) => ({ type: "job", id, title: `Task ${id}`, status, demo: false, by: "Helper", at_ms: Date.now(), ...extra });
/** The demo story's jobs, as they'd look a moment into the feed (from `now`): all four states at the top level, a fold. */
const story = (now, demo = true) => {
  const m = (id, status, ago, extra) => job(id, status, { demo, by: "agent", at_ms: now - ago, ...extra });
  const birthday = { title: "Plan Mom's birthday on Saturday" };
  const pottery = { title: "Find the pottery class on Main Street", parent: "demo-birthday" };
  const card = { title: "Draft a birthday card for Mom", parent: "demo-birthday" };
  return [
    m("demo-birthday", "running", 62_000, birthday),
    m("demo-pottery", "running", 58_000, pottery), m("demo-pottery", "done", 51_000, { ...pottery, result: "Saturdays at 10 AM · $45 a person · 2 seats left" }),
    m("demo-card", "running", 47_000, card), m("demo-card", "waiting", 40_000, { ...card, result: "Mention the pottery class in Mom's card, or keep it a surprise?" }),
    m("demo-birthday", "waiting", 39_000, { ...birthday, result: "Class found · card drafted · waiting on your answer" }),
    m("demo-rent", "running", 33_000, { title: "Check when rent is due" }), m("demo-rent", "done", 26_000, { title: "Check when rent is due", result: "Due on the 1st · reminder set for Friday" }),
    m("demo-booking", "running", 17_000, { title: "Book two pottery seats" }),
    m("demo-booking", "failed", 12_000, { title: "Book two pottery seats", result: "The booking site needs your sign-in, so it's left for you" }),
    m("demo-study", "running", 4_000, { title: "Make this week's study plan" }),
  ];
};

let replay = [];
const core = await standInCore(() => [{ type: "snapshot", world }, ...replay]);
let browser;
const timeout = setTimeout(() => { console.error("work-spine-check: timed out"); process.exit(1); }, 150_000);
const quiet = (e) => !/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(e);

try {
  for (const width of [1440, 390]) {
    const phone = width === 390;
    const began = Date.now();
    replay = [job("old:done", "done", { result: "Found it.", at_ms: began - 300_000 }), job("old:failed", "failed", { result: "The source was unavailable.", at_ms: began - 280_000 }),
      job("old:ask", "waiting", { title: "Choose a direction", result: "Which idea should we explore first?", demo: true, at_ms: began - 270_000 }),
      job("old:run", "running", { title: "Shape a short outline", at_ms: began - 250_000 })];
    browser = await openPage("about:blank", { width, height: phone ? 844 : 900 });
    const { page, evaluate, until } = browser;
    // Without Page.enable Chrome accepts the script below and never runs it.
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      window.workErrors = [];
      addEventListener("error", (e) => window.workErrors.push(e.message));
      addEventListener("unhandledrejection", (e) => window.workErrors.push(String(e.reason)));
      const error = console.error; console.error = (...args) => { window.workErrors.push(args.map(String).join(" ")); error(...args); };
    ` });
    const scheme = (value, motion = "no-preference") => page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: motion }] });
    await scheme("light");
    const where = `${width}`;
    const check = async (expression, label, ms = 6000) => assert.ok(await until(expression, ms), `${where}: ${label}`);
    const settle = async () => {
      await evaluate("document.fonts.ready.then(() => true)");
      await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      await sleep(250);
    };
    const click = async (selector) => assert.ok(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), `${where}: click ${selector}`);
    const key = async (name, code, windowsVirtualKeyCode) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode, ...(name === "Enter" ? { text: "\r" } : name === " " ? { text: " " } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode });
    };
    const rect = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; })()`;
    const go = async (query = "?shell=2") => {
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${query}` });
      await check('!!document.querySelector("[data-guide=composer] textarea") && !!document.querySelector(".spine-ready")', "the Canvas and the composer are up", 10_000);
      await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()');
      await check('!document.querySelector(".tour-tip")', "first-use hints are down");
      await settle();
    };
    const job$ = (id) => `[data-job-id=${JSON.stringify(id)}]`;
    const part = (id, name) => `document.querySelector(${JSON.stringify(`${job$(id)} > .work-spine-bubble .work-spine-${name}`)})?.textContent`;
    const roots = () => evaluate('[...document.querySelectorAll(".work-spine-list > [data-job-id]")].map((el) => el.dataset.jobId)');
    const fold$ = (id) => `${job$(id)} > .work-spine-fold`;
    /** A fold's words as they read: "+3 side jobs", and what in them isn't over (the dots between are drawn, not text). */
    const fold = (id) => evaluate(`(() => { const f = document.querySelector(${JSON.stringify(fold$(id))}); if (!f) return null;
      const count = f.querySelector(".work-spine-fold-count").cloneNode(true); count.querySelector(".sr-only")?.remove();
      return { count: count.textContent, more: [...f.querySelectorAll(":scope > :not(.work-spine-fold-count):not(.work-spine-now)")].map((el) => el.textContent), now: !!f.querySelector(".work-spine-now") }; })()`);
    const switchOn = async (on) => {
      await click('[data-guide="catalog"]');
      await check('!!document.querySelector(".shell-catalog")', "the Catalog is open");
      await check('!!document.querySelector(\'[data-row="work-spine"] [role="switch"]\')', "the Catalog lists the Work spine, with a switch");
      assert.equal(await evaluate('document.querySelector(\'[data-row="work-spine"] [role="switch"]\').getAttribute("aria-checked")'), on ? "false" : "true", `${where}: the switch was ${on ? "off" : "on"}`);
      await click('[data-row="work-spine"] [role="switch"]');
      await click(".shell-rail-close");
      await check('!document.querySelector(".shell-rail")', "the Catalog is closed");
    };
    /** Nothing runs off the side, the page has no error, and (on a laptop) nothing the lane shares the page with is covered. */
    const sound = async (label) => {
      await settle();
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${where} ${label}: the page fits across`);
      assert.deepEqual((await evaluate("window.workErrors")).filter(quiet), [], `${where} ${label}: no page errors`);
    };
    const shot = async (scene, schemeName, clip) => {
      if (!shots) return;
      await settle();
      const { data } = await page("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 2 } } : { format: "png" });
      writeFileSync(join(shots, `${scene}-${width}-${schemeName}.png`), Buffer.from(data, "base64"));
    };

    // ── Off until switched on; the jobs that came before it are all there once it is. ──
    await go();
    assert.equal(await evaluate('!document.querySelector(".work-spine-lane, .work-spine-card")'), true, `${where}: off by default, though jobs were replayed`);
    assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--room-right")'), "", `${where}: the page gives it no room while it's off`);
    await switchOn(true);
    await check(phone ? '!!document.querySelector(".work-spine-card")' : '!!document.querySelector(".work-spine-lane")', phone ? "a card in the dock" : "the lane");
    assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(phone ? ".work-spine-lane" : ".work-spine-card")})`), false, `${where}: only one of the lane and the card`);
    await sleep(800);

    if (phone) {
      // The card: one line above the composer; opened, a sheet above the dock; the composer is never covered.
      const bar = '.work-spine-bar';
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(bar)}).textContent.replace(/\\s+/g, " ").trim()`), "✦Work spine Demo mode · simulated 1 running · 1 waiting · 1 failed", "the card says what's going on in one line");
      assert.equal(await evaluate('!document.querySelector(".work-spine-sheet")'), true, "closed: no sheet");
      const composer = await evaluate(rect('[data-guide="composer"]')), barBox = await evaluate(rect(bar));
      assert.ok(barBox.bottom <= composer.top + 1 && barBox.top >= 0 && barBox.left >= 0 && barBox.right <= width, `the card sits above the composer: ${JSON.stringify({ barBox, composer })}`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(bar)}).getAttribute("aria-expanded")`), "false");
      await shot("demo-label", "light");
      await click(bar);
      await check('!!document.querySelector(".work-spine-sheet")', "tapped, the list opens");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(bar)}).getAttribute("aria-expanded")`), "true");
      const sheet = await evaluate(rect(".work-spine-sheet")), stage = await evaluate(rect('[data-slot="stage"]'));
      assert.ok(sheet.bottom <= stage.top + 1 && sheet.top >= 56 && sheet.left >= 0 && sheet.right <= width, `the sheet is above the dock and inside the window: ${JSON.stringify({ sheet, stage })}`);
      assert.equal(await evaluate(`(() => { const c = document.querySelector("[data-guide=composer] textarea").getBoundingClientRect(); const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2); return !!hit?.closest("[data-guide=composer]"); })()`), true, "the composer is not covered");
      await check(`document.querySelectorAll(".work-spine-sheet [data-job-id]").length === 4`, "four top-level jobs in the sheet");
      await key("Escape", "Escape", 27);
      await check('!document.querySelector(".work-spine-sheet")', "Esc puts the sheet away");
      assert.equal(await evaluate("document.activeElement?.classList.contains('work-spine-bar')"), true, "and focus is back on the card");
      await click(bar);
      await check('!!document.querySelector(".work-spine-sheet")', "opened again");
    } else {
      // The lane: the Canvas ends where it begins; nothing the lane shares the window with is under it.
      const lane = await evaluate(rect(".work-spine-lane")), frame = await evaluate(rect(".spine-frame"));
      assert.ok(lane.width >= 320 && lane.width <= 392 && Math.abs(lane.right - width) < 1, `the lane is 320 to 392 wide at the page's right: ${JSON.stringify(lane)}`);
      assert.ok(Math.abs(frame.right - lane.left) < 1.5, `the Canvas ends where the lane begins: ${JSON.stringify({ frame, lane })}`);
      assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--room-right")'), `${Math.round(lane.width)}px`, "the page was told how much room it takes");
      assert.equal(await evaluate("document.querySelector('.brick-card')?.children.length === 0 || !document.querySelector('.brick-card')"), true, "nothing is drawn in the dock's cards, so the dock takes no room");
      assert.equal(await evaluate(`(() => { const r = document.querySelector(".work-spine-title").getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".work-spine-lane"); })()`), true, "the lane takes the touches in its place, not the Canvas");
      const corner = await evaluate(rect('[data-slot="top-right"]')), head = await evaluate(rect(".work-spine-badge"));
      assert.ok(head.top >= corner.bottom, `the lane's words start under the corner buttons: ${JSON.stringify({ head, corner })}`);
      // The followed thread is in view, beside the lane: the Canvas moved to keep it clear.
      assert.equal(await evaluate(`(() => { const lane = document.querySelector(".work-spine-lane").getBoundingClientRect().left; const t = document.querySelector('[data-guide="thread:T1"]'); const r = t?.getBoundingClientRect(); return !!r && r.width > 0 && r.right <= lane && r.left >= 0; })()`), true, "the thread you're on stands beside the lane");
      const shelf = await evaluate(rect(".spine-shelf-head")), stage = await evaluate(rect('[data-slot="stage"]'));
      assert.ok(shelf.right <= lane.left && (shelf.bottom <= stage.top || shelf.right <= stage.left || shelf.left >= stage.right), `the shelf is clear of the lane and the composer: ${JSON.stringify({ shelf, stage, lane })}`);
    }
    const list = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.dataset.jobId)`;
    const inside = phone ? ".work-spine-sheet" : ".work-spine-lane";
    const rootsAre = async (expected, label) => assert.deepEqual(await evaluate(list(`${inside} .work-spine-list > [data-job-id]`)), expected, `${where}: ${label}`);
    // The list's checks below read it where it is: in the sheet on a phone (open), in the lane on a laptop.
    if (phone) await check('!!document.querySelector(".work-spine-sheet")', "the sheet is open for the list's checks");

    // ── What came before it: each state in words; no length is made up for a job seen only once it was over. ──
    await rootsAre(["old:done", "old:failed", "old:ask", "old:run"], "the replay comes in the order it first came, oldest first");
    assert.equal(await evaluate(part("old:done", "mark")), "✓");
    assert.equal(await evaluate(part("old:done", "word")), "Done", `${where}: no length made up for a job seen only at its end`);
    assert.equal(await evaluate(part("old:done", "result")), "Found it.");
    assert.equal(await evaluate(part("old:failed", "mark")), "✕");
    assert.equal(await evaluate(part("old:failed", "word")), "Failed");
    assert.equal(await evaluate(part("old:failed", "result")), "The source was unavailable.", "a failed job says why");
    assert.equal(await evaluate(part("old:ask", "word")), "Waiting for you");
    assert.equal(await evaluate(part("old:ask", "question")), "Which idea should we explore first?", "a waiting job shows its question");
    assert.equal(await evaluate(part("old:run", "word")), "Running");
    const seconds = (text) => text.split(":").reduce((n, p) => n * 60 + Number(p), 0);
    assert.ok(Math.abs(seconds(await evaluate(part("old:run", "clock"))) - (Date.now() - (began - 250_000)) / 1000) < 3, `${where}: its clock counts from when the core said it started`);
    assert.equal(await evaluate('document.querySelector(".work-spine-now") === null'), true, `${where}: a replay of older jobs marks nothing "Just now"`);
    assert.equal(await evaluate("document.querySelector('.work-spine-demo')?.textContent"), "Demo mode · simulated", `${where}: a simulated job shown heads the Work spine with the label`);
    assert.equal(await evaluate('!!document.querySelector(".work-spine-top > .work-spine-title + .work-spine-demo")'), true, `${where}: the label stands beside the name, in the heading`);
    await sleep(700);

    // ── Live: a job comes, runs, ends; it keeps its place; the newest change is "Just now"; a landing glows once. ──
    const t0 = Date.now();
    core.send(job("live:one", "running", { title: "Gather the useful points", at_ms: t0 - 5000 }));
    await check(`${part("live:one", "word")} === "Running"`, "a running job");
    await check(`/^0:(0[5-9]|[1-3]\\d)$/.test(${part("live:one", "clock")})`, "it shows a clock from its start (5 s or more, as a slow page may add to)");
    const clock1 = await evaluate(part("live:one", "clock"));
    await sleep(1300);
    assert.notEqual(await evaluate(part("live:one", "clock")), clock1, `${where}: the clock keeps counting`);
    await rootsAre(["old:done", "old:failed", "old:ask", "old:run", "live:one"], "a new job lands at the foot");
    await check(`document.querySelector(${JSON.stringify(`${job$("live:one")} .work-spine-now`)})?.textContent === "Just now"`, "the newest, at the foot, is marked Just now");
    assert.equal(await evaluate('document.querySelectorAll(".work-spine-now").length'), 1, `${where}: only one is marked`);
    core.send(job("live:two", "running", { title: "Shape a short outline of it", at_ms: t0 - 1000 }));
    await check(`!!document.querySelector(${JSON.stringify(`${job$("live:two")} .work-spine-now`)}) && !document.querySelector(${JSON.stringify(`${job$("live:one")} .work-spine-now`)})`, "Just now moves to the next one");
    core.send(job("live:one", "done", { title: "Gather the useful points", result: "Three ideas ready to revisit.", at_ms: t0 + 4000 }));
    await check(`${part("live:one", "word")} === "Done in 9 s" && document.querySelector(${JSON.stringify(job$("live:one"))}).dataset.fresh === "landed"`, "done: how long, from when it was seen starting to when it ended, and the landing is marked");
    await check(`${part("live:one", "result")} === "Three ideas ready to revisit."`, "done: what it found");
    await rootsAre(["old:done", "old:failed", "old:ask", "old:run", "live:one", "live:two"], "an update keeps the job where it was");
    assert.equal(await evaluate('document.querySelectorAll(".work-spine-now").length'), 1, `${where}: Just now is on the one whose change came last`);
    await check(`document.querySelector(${JSON.stringify(`${job$("live:one")} .work-spine-now`)})?.textContent === "Just now"`, "the one that just landed");
    await check(`!document.querySelector(${JSON.stringify(job$("live:one"))}).dataset.fresh`, "a landing's mark goes after a moment", 6000);
    core.send(job("live:one", "done", { title: "Gather the useful points", result: "Three ideas ready to revisit.", at_ms: t0 + 9000 }));
    await sleep(200);
    assert.equal(await evaluate(part("live:one", "word")), "Done in 9 s", `${where}: the first end stands`);
    core.send(job("live:fail", "running", { title: "Look for a supporting source", at_ms: t0 + 9500 }));
    core.send(job("live:fail", "failed", { title: "Look for a supporting source", result: "A detail needs another source.", at_ms: t0 + 16500 }));
    await check(`${part("live:fail", "word")} === "Failed after 7 s"`, "failed: after how long");
    assert.equal(await evaluate(part("live:fail", "result")), "A detail needs another source.");
    await sound("live");

    // ── Side jobs: folded under their parent, opened by a click or a key; a parent that comes late takes its children in. ──
    core.send(job("side:parent", "running", { title: "Plan the week", at_ms: t0 + 20_000 }));
    core.send(job("side:a", "done", { title: "Check the calendar", parent: "side:parent", result: "Free on Wednesday.", at_ms: t0 + 21_000 }));
    core.send(job("side:b", "waiting", { title: "Pick a study room", parent: "side:parent", result: "Quiet floor or the café?", at_ms: t0 + 22_000 }));
    core.send(job("side:c", "failed", { title: "Book the room", parent: "side:parent", result: "No rooms are free.", at_ms: t0 + 23_000 }));
    await check(`!!document.querySelector(${JSON.stringify(fold$("side:parent"))})`, "the parent has a fold");
    assert.deepEqual({ ...(await fold("side:parent")), now: undefined }, { count: "+3 side jobs", more: ["1 waiting", "1 failed"], now: undefined }, `${where}: "+3 side jobs", with what in them isn't over`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(fold$("side:parent"))}).getAttribute("aria-expanded")`), "false");
    assert.equal(await evaluate('!document.querySelector(\'[data-job-id="side:a"]\')'), true, `${where}: a folded side job is not drawn`);
    assert.equal((await fold("side:parent")).now, true, `${where}: the newest change is inside the fold, so the fold says Just now`);
    await evaluate(`document.querySelector(${JSON.stringify(fold$("side:parent"))}).focus()`);
    await key("Enter", "Enter", 13);
    await check(`document.querySelector(${JSON.stringify(fold$("side:parent"))}).getAttribute("aria-expanded") === "true"`, "Enter opens the fold");
    await check(`${list(`${job$("side:parent")} > .work-spine-kids > [data-job-id]`)}.join() === "side:a,side:b,side:c"`, "its side jobs, oldest first");
    assert.equal(await evaluate(part("side:b", "question")), "Quiet floor or the café?", `${where}: a side job shows its state and words as any job does`);
    assert.deepEqual({ ...(await fold("side:parent")), now: undefined }, { count: "Hide side jobs", more: [], now: undefined }, `${where}: open, it says Hide side jobs, with nothing else beside it: the side jobs show for themselves`);
    assert.equal(await evaluate(`(() => { const box = document.querySelector(${JSON.stringify(`${inside} .work-spine-scroll`)}); const r = document.querySelector(${JSON.stringify(job$("side:c"))}).getBoundingClientRect(), b = box.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; })()`), true, `${where}: what the fold opened is in view`);
    await shot("fold", "light");
    await key(" ", "Space", 32);
    await check(`document.querySelector(${JSON.stringify(fold$("side:parent"))}).getAttribute("aria-expanded") === "false" && !document.querySelector('[data-job-id="side:a"]')`, "Space folds it again");
    await click(fold$("side:parent"));
    await check('!!document.querySelector(\'[data-job-id="side:a"]\')', "a click opens it too");
    core.send(job("late:child", "waiting", { title: "Which seat?", parent: "late:parent", result: "Window or aisle?", at_ms: t0 + 24_000 }));
    await check('!!document.querySelector(".work-spine-list > [data-job-id=\\"late:child\\"]")', "a side job whose parent hasn't come stands alone");
    core.send(job("late:parent", "running", { title: "Choose seats", at_ms: t0 + 25_000 }));
    await check('!document.querySelector(".work-spine-list > [data-job-id=\\"late:child\\"]") && !!document.querySelector(\'[data-job-id="late:parent"] > .work-spine-fold\')', "once its parent comes, it's folded under it");
    for (const [id, parent] of [["loop:a", "loop:b"], ["loop:b", "loop:a"], ["loop:self", "loop:self"]]) core.send(job(id, "done", { parent, at_ms: t0 + 26_000 }));
    await check('["loop:a", "loop:b", "loop:self"].every((id) => !!document.querySelector(".work-spine-list > [data-job-id=\\"" + id + "\\"]"))', "jobs that name each other, or themselves, all still show");

    // ── The demo label goes with the last simulated job. ──
    for (const old of ["old:ask"]) core.send(job(old, "waiting", { title: "Choose a direction", result: "Which idea should we explore first?", demo: false, at_ms: Date.now() }));
    await check('!document.querySelector(".work-spine-demo")', "no simulated job shown, no label");
    core.send(job("sim", "done", { title: "A simulated job", demo: true, at_ms: Date.now() }));
    await check('document.querySelector(".work-spine-demo")?.textContent === "Demo mode · simulated"', "a simulated job brings the label back");
    await sound("states");

    // ── A waiting parent's words are a summary, plain; the question's bar is only on the job that asks. Waiting counts the questions. ──
    const waitingNow = async () => Number((await evaluate('(document.querySelector(".work-spine-counts .work-spine-waiting, .work-spine-bar .work-spine-waiting")?.textContent ?? "0 waiting")')).split(" ")[0]);
    const before = await waitingNow();
    core.send(job("wp:parent", "waiting", { title: "Plan the trip", result: "Route found · hotel held · waiting on your answer", demo: false, at_ms: Date.now() }));
    core.send(job("wp:kid", "waiting", { title: "Pick a seat", parent: "wp:parent", result: "Window or aisle?", demo: false, at_ms: Date.now() }));
    await check(`${part("wp:parent", "result")} === "Route found · hotel held · waiting on your answer"`, "a waiting parent's words are its summary");
    assert.equal(await evaluate(`!document.querySelector(${JSON.stringify(`${job$("wp:parent")} > .work-spine-bubble .work-spine-question`)})`), true, `${where}: and wear no question bar`);
    assert.equal(await evaluate(part("wp:parent", "word")), "Waiting for you", `${where}: it still waits`);
    await evaluate(`document.querySelector(${JSON.stringify(fold$("wp:parent"))}).click()`);
    await check(`${part("wp:kid", "question")} === "Window or aisle?"`, "the side job that asks wears the question's bar");
    assert.equal(await waitingNow(), before + 1, `${where}: one question waiting, counted once, not twice for the summary above it`);
    core.send(job("wq:parent", "waiting", { title: "Book the table", result: "Which night: Friday or Saturday?", demo: false, at_ms: Date.now() }));
    core.send(job("wq:kid", "done", { title: "Check the menu", parent: "wq:parent", result: "Open both nights.", demo: false, at_ms: Date.now() }));
    await check(`${part("wq:parent", "question")} === "Which night: Friday or Saturday?"`, "a parent that asks itself (its side jobs aren't waiting) wears the bar");
    assert.equal(await waitingNow(), before + 2, `${where}: and is counted`);

    // ── A call (desktop): with an AI beside you, Talk is a pill under the corner buttons and the lane starts below it; with two
    //    people Talk's own rail holds the page's right, so the Work spine is the card in the dock until it's closed. ──
    if (!phone) {
      const person = (name, ai) => ({ name, ai, joined_ms: Date.now(), here: true, left_ms: null, mic: false, speaking: false, read: null });
      const call = (...people) => core.send({ type: "call", started_ms: Date.now(), people, level: "hand", level_by: "" });
      call(person("you", false), person("agent", true));
      await check('!!document.querySelector(".talk-pill") && !!document.querySelector(".work-spine-lane")', "you and an AI: Talk is a pill, the lane stays");
      await settle();
      const pill = await evaluate(rect(".talk-pill")), badge = await evaluate(rect(".work-spine-badge")), label = await evaluate(rect(".work-spine-demo"));
      assert.ok(badge.top >= pill.bottom && label.top >= pill.bottom, `the lane's words start below the Talk pill: ${JSON.stringify({ pill, badge, label })}`);
      call(person("you", false), person("Maya", false));
      await check('!!document.querySelector(".talk-rail") && !document.querySelector(".work-spine-lane") && !!document.querySelector(".work-spine-card")', "two people: Talk's rail holds the page's right, so the Work spine is the card");
      assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--room-right")'), "", `${where}: and the page's room is given back`);
      call(person("you", false));
      await check('!document.querySelector(".talk-rail") && !!document.querySelector(".work-spine-lane")', "the call over, the lane is back");
      await sound("call");
    }

    // ── A new connection: its snapshot starts the jobs over, and the replay fills them in the core's order. ──
    replay = [job("again:1", "done", { title: "After the reconnect", at_ms: Date.now() - 90_000 }), job("again:2", "running", { title: "Still going", at_ms: Date.now() - 20_000 })];
    core.drop();
    await check('document.querySelectorAll(".work-spine-list > [data-job-id]").length === 2 && !!document.querySelector(\'[data-job-id="again:1"]\')', "a new connection's jobs replace the old ones", 20_000);
    await rootsAre(["again:1", "again:2"], "in the order the core replayed them");
    assert.equal(await evaluate('document.querySelector(".work-spine-demo") === null'), true, `${where}: and its label goes with the simulated ones`);

    // ── At most 60: the oldest goes; an update to an old one stays in its place. ──
    for (let n = 0; n < 64; n++) core.send(job(`cap:${n}`, "done", { at_ms: Date.now() }));
    await check('document.querySelectorAll(".work-spine-list > [data-job-id]").length === 60 && document.querySelector(".work-spine-list > [data-job-id]").dataset.jobId === "cap:4"', "60 jobs, the oldest gone");
    core.send(job("cap:4", "failed", { at_ms: Date.now() }));
    await check(`${part("cap:4", "word")} === "Failed"`, "an old job updates in place");
    assert.equal(await evaluate('document.querySelector(".work-spine-list > [data-job-id]").dataset.jobId'), "cap:4");
    // The list follows the newest while you're at its foot, lets go when you scroll up, and brings you back on "Latest".
    assert.equal(await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${inside} .work-spine-scroll`)}); return b.scrollHeight - b.scrollTop - b.clientHeight < 40; })()`), true, `${where}: at the foot, the newest in view`);
    // A real wheel, as a hand's: the list lets go of the newest and shows a Latest button, however a render falls among it.
    const wheel = await evaluate(rect(`${inside} .work-spine-scroll`));
    await page("Input.dispatchMouseEvent", { type: "mouseWheel", x: wheel.left + wheel.width / 2, y: wheel.top + wheel.height / 2, deltaX: 0, deltaY: -20000 });
    await check('!!document.querySelector(".work-spine-latest")', "scrolled up by hand, a Latest button shows");
    core.send(job("cap:new", "running", { at_ms: Date.now() }));
    await sleep(300);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${inside} .work-spine-scroll`)}).scrollTop`), 0, `${where}: a new job doesn't pull you off what you're reading`);
    await click(".work-spine-latest");
    await check('!document.querySelector(".work-spine-latest") && !!document.querySelector(".work-spine-now")', "Latest brings you back to the newest");
    assert.equal(await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${inside} .work-spine-scroll`)}); const n = document.querySelector(".work-spine-now").getBoundingClientRect(), r = b.getBoundingClientRect(); return n.top >= r.top && n.bottom <= r.bottom + 1; })()`), true);

    // ── A fresh snapshot (another map, a restarted core) clears them. ──
    core.send({ type: "snapshot", world });
    await check('!document.querySelector("[data-job-id]") && !!document.querySelector(".work-spine-empty")', "a new snapshot clears the jobs");
    assert.equal(await evaluate("document.querySelector('.work-spine-counts, .work-spine-bar-text')?.textContent.includes('No jobs yet')"), true, `${where}: and says so`);

    // ── Switched off: gone, and the Canvas has its room back; jobs that came meanwhile are there when it's back on. ──
    if (phone) { await key("Escape", "Escape", 27); await check('!document.querySelector(".work-spine-sheet")', "the sheet is put away"); }
    await switchOn(false);
    await check('!document.querySelector(".work-spine-lane, .work-spine-card, .work-spine-sheet")', "off, it's gone");
    assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--room-right")'), "", `${where}: the room is given back`);
    if (!phone) assert.ok(Math.abs((await evaluate(rect(".spine-frame"))).right - width) < 1.5, "the Canvas is as wide as the window again");
    core.send(job("while:off", "done", { title: "Came while it was off", result: "Still here.", at_ms: Date.now() }));
    await sleep(200);
    await switchOn(true);
    if (phone) { await check('!!document.querySelector(".work-spine-bar")', "the card is back"); await click(".work-spine-bar"); }
    await check(`${part("while:off", "result")} === "Still here."`, "jobs that came while it was off are there");

    // ── Dark is dark and light is light: the bubbles follow the page's tokens; reduced motion stops the pulse. ──
    const bubbleColor = () => evaluate('getComputedStyle(document.querySelector(".work-spine-bubble")).backgroundColor');
    await scheme("light"); await settle();
    const light = await bubbleColor();
    await scheme("dark"); await settle();
    assert.notEqual(await bubbleColor(), light, `${where}: the bubbles change with the theme`);
    await core.send(job("pulse", "running", { at_ms: Date.now() }));
    await check('!!document.querySelector(".work-spine-pulse")', "a running job pulses");
    await scheme("light", "reduce"); await settle();
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".work-spine-pulse")).animationName'), "none", `${where}: reduced motion: nothing pulses`);
    await scheme("light");

    // ── A window too narrow for the lane on a laptop: the card, with the lane's room given back. ──
    if (!phone) {
      await page("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
      await check('!!document.querySelector(".work-spine-card") && !document.querySelector(".work-spine-lane")', "under 1000 px wide, the card");
      assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--room-right")'), "", "and the page's room is given back");
      await page("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
      await check('!!document.querySelector(".work-spine-lane")', "at 1100 px wide, the lane");
      await settle();
      const lane = await evaluate(rect(".work-spine-lane")), composer = await evaluate(rect('[data-guide="composer"]')), scroll = await evaluate(rect(".work-spine-lane .work-spine-scroll"));
      assert.ok(lane.left < composer.right && lane.right > composer.left ? scroll.bottom <= composer.top : true, `the lane's list stops above the composer where they share the window: ${JSON.stringify({ scroll, composer })}`);
      const shelf = await evaluate(rect(".spine-shelf-head"));
      assert.ok(shelf.bottom <= composer.top || shelf.right <= composer.left || shelf.left >= composer.right, `the shelf is clear of the composer: ${JSON.stringify({ shelf, composer })}`);
      await sound("1100");
      await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }

    // ── The address: ?bricks= names features by id, and the Work spine's own flag, for that visit; both win over a switch. ──
    replay = [];
    await evaluate('localStorage.setItem("e2a2o.bricks", JSON.stringify({ "work-spine": false }))');
    const present = phone ? ".work-spine-card" : ".work-spine-lane";
    await go("?shell=2&bricks=level");
    await sleep(500);
    assert.equal(await evaluate('!document.querySelector(".work-spine-lane, .work-spine-card")'), true, `${where}: ?bricks= naming another feature leaves it off`);
    await go("?shell=2&work-spine");
    await check(`!!document.querySelector(${JSON.stringify(present)})`, "?work-spine switches it on for the visit");
    await go("?shell=2&bricks=level,work-spine");
    await check(`!!document.querySelector(${JSON.stringify(present)})`, "so does ?bricks=level,work-spine");

    // ── The pitch's own scenes, on a page that opened beside the lane: light, then dark. ──
    await go("?shell=2&bricks=work-spine");
    await check(`!!document.querySelector(${JSON.stringify(present)})`, "the scenes' page");
    const now = Date.now();
    for (const message of story(now)) { core.send(message); await sleep(90); }
    if (phone) await click(".work-spine-bar");
    await check(`document.querySelectorAll(${JSON.stringify(`${inside} .work-spine-list > [data-job-id]`)}).length === 4`, "the four top-level jobs");
    await sleep(2800); // landing marks are gone, entrance animations finished
    assert.deepEqual(await evaluate(list(`${inside} .work-spine-list > [data-job-id]`)), ["demo-birthday", "demo-rent", "demo-booking", "demo-study"]);
    assert.deepEqual(await evaluate(`["demo-birthday", "demo-rent", "demo-booking", "demo-study"].map((id) => document.querySelector(${JSON.stringify(inside)} + ' [data-job-id="' + id + '"]').dataset.status)`),
      ["waiting", "done", "failed", "running"], `${where}: all four states at the top level`);
    assert.deepEqual({ ...(await fold("demo-birthday")), now: undefined }, { count: "+2 side jobs", more: ["1 waiting"], now: undefined }, `${where}: a waiting question inside a fold still shows on its fold`);
    assert.equal(await evaluate(part("demo-study", "word")), "Running");
    await check(`!!document.querySelector(${JSON.stringify(`${job$("demo-study")} .work-spine-now`)})`, "the newest, at the foot, says Just now");
    if (!phone) {
      // The words on the Canvas (both threads' titles and points), as far as the eye reads them, end before the lane begins.
      assert.equal(await evaluate(`(() => {
        const edge = document.querySelector(".work-spine-lane").getBoundingClientRect().left;
        const words = [...document.querySelectorAll('.spine-frame .spine-title, .spine-frame .spine-text')];
        const ends = words.map((el) => { const range = document.createRange(); range.selectNodeContents(el); return Math.max(0, ...[...range.getClientRects()].map((r) => r.right)); });
        return words.length >= 7 && ends.every((right) => right <= edge);
      })()`), true, `${where}: both threads' words stand beside the lane, whole`);
    }
    for (const schemeName of ["light", "dark"]) {
      await scheme(schemeName);
      await settle();
      await shot("states", schemeName);
      if (!phone) {
        const lane = await evaluate(rect(".work-spine-lane"));
        await shot("demo-label", schemeName, { x: lane.left, y: 60, width: lane.width, height: 380 });
      } else {
        await click(".work-spine-bar");
        await check('!document.querySelector(".work-spine-sheet")', "the card closes the sheet");
        await shot("demo-label", schemeName);
        await click(".work-spine-bar");
        await check('!!document.querySelector(".work-spine-sheet")', "and opens it");
      }
      await click(fold$("demo-birthday"));
      await check(`!!document.querySelector(${JSON.stringify(job$("demo-card"))})`, "the fold opens");
      await shot("fold", schemeName);
      await click(fold$("demo-birthday"));
      await check(`!document.querySelector(${JSON.stringify(job$("demo-card"))})`, "and folds");
      await sound(`story ${schemeName}`);
    }
    await browser.close(); browser = null;
  }
  console.log("work-spine-check: ok");
} finally {
  clearTimeout(timeout);
  await browser?.close();
  core.close();
}
