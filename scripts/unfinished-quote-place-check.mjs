// The built UI with an already-dropped sample thread. Moves change membership, not the last spoken turn.
// SHOTS=dir saves the shell's incoming-move regression state at both sizes in both themes.
// With WORKTREE OUTPUT [/?shell=2] arguments, save the same fixture and print its absolute PNG paths as JSON.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { uiServer } from "./ui-server.mjs";

const [tree, output, ...paths] = process.argv.slice(2);
if (tree && (!output || paths.length > 1 || (paths.length === 1 && paths[0] !== "/?shell=2"))) {
  throw new Error("usage: unfinished-quote-place-check.mjs [WORKTREE OUTPUT [/?shell=2]]");
}
const { ready, standInCore, openPage, sleep } = await import(tree
  ? pathToFileURL(join(resolve(tree), "scripts/headless.mjs")) : new URL("./headless.mjs", import.meta.url));

const why = ready();
if (why) { console.log(`SKIP unfinished-quote-place-check: ${why}`); process.exit(3); }
const modules = await uiServer();
globalThis.location = new URL("http://localhost/");
const { apply } = await modules.ssrLoadModule("/src/core.ts");
const { lingerMs } = await modules.ssrLoadModule("/src/unfinished.ts");
await modules.close();
const shots = output ? resolve(output) : process.env.SHOTS;
const shotPaths = [];
if (shots) mkdirSync(shots, { recursive: true });
const now = Date.now() - 10_000;
const quote = "I should choose the picnic spot before—";
const older = "Bring the folding chairs";
const imported = "Pack a picnic basket";
const future = "Check the riverside weather";
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now,
  tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true,
  unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false, ...extra });
// Original sample words; the newer herb thought belongs elsewhere when the picnic thread is left unfinished.
const world = {
  threads: [thread("T1", "Balcony herbs", { touched_ms: now + 1000 }), thread("T2", "Riverside picnic", { status: "dropped", dropped_by: "you" })],
  thoughts: [
    thought("herbs", "Water the balcony herbs", "T1", { at_ms: now - 2000 }),
    thought("p0", older, "T2", { at_ms: now - 1000 }),
    thought("p1", "Plant mint in its own pot", "T1", { at_ms: now + 1000 }),
    thought("p2", quote, "T2", { complete: false }),
    thought("colleague", "Meet by the river", "T2", { speaker: "Colleague" }),
    // Imports can be appended after newer words. A future-dated sample counts as the earliest, as in lastWordsOn.
    thought("imported", imported, "T2", { at_ms: now - 4000, place_ms: null }),
    thought("future", future, "T2", { at_ms: now + 3_600_000 }),
  ],
  pauses: [{id:"pause-p2-1",thought_id:"p2",speaker:"you",thread_id:"T2",revision:1,excerpt:quote,at_ms:now,resolved:false,later_count:0,offer_after_ms:0,hidden:false}],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [],
  positions: { p2: { x: 2200, y: 1800, by: "you", at_ms: now } },
};
let shown = world;
const relayChange = change => { shown=apply(shown,change);core.send({type:"change",change}); };
const returnSource = (pause, request_id=null, current=null) => {
  const thought=shown.thoughts.find(t=>t.id===(pause?.thought_id??current?.id));
  const anchor={pause:pause??null,thought_id:pause?.thought_id??current.id,thread_id:thought?.thread_id??null,excerpt:pause?.excerpt??current.text,current_text:thought?.text??null};
  if(anchor.thread_id)relayChange({type:"active_changed",thread_id:anchor.thread_id,speaker:"you"});
  core.send({type:"returned",request_id,anchor,message:thought?"Back to the exact interrupted words":"The source was deleted. Its interruption-time words are still here."});
  if(anchor.thread_id)core.send({type:"found",thread_id:anchor.thread_id,thought_id:anchor.thought_id,message:"Back to the exact interrupted words"});
};
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => {
    if(message.type==="resume") {
      const pause=(shown.pauses??[]).find(p=>p.id===message.pause_id&&p.speaker==="you"&&!p.resolved);
      if(pause)returnSource(pause,message.request_id);
      return;
    }
    if(message.type==="pause_choice") {
      const p=shown.pauses.find(p=>p.id===message.pause_id);
      if(p)relayChange({type:"pause_choice",id:p.id,later_count:p.later_count+Number(message.later),offer_after_ms:message.later?Date.now()+300000:p.offer_after_ms,hidden:p.hidden||!message.later||p.later_count+Number(message.later)>=2});
      return;
    }
    if(message.type==="text"&&message.text.toLowerCase()==="where was i?") {
      const latest=[...shown.thoughts].reverse().filter(t=>t.placed&&t.speaker==="you").sort((a,b)=>(b.at_ms>Date.now()?0:b.at_ms)-(a.at_ms>Date.now()?0:a.at_ms))[0];
      const pause=[...(shown.pauses??[])].reverse().find(p=>p.speaker==="you"&&!p.resolved);
      if(latest&&!latest.complete)returnSource((shown.pauses??[]).find(p=>p.thought_id===latest.id),null,latest);
      else if(pause)returnSource(pause);
      core.send({type:"text_received",id:message.id});
      return;
    }
    if (message.type !== "focus") return;
    relayChange({type:"active_changed",thread_id:message.thread_id,speaker:"you"});
  },
});
let browser;
const timeout = setTimeout(() => { console.error("unfinished-quote-place-check: timed out"); process.exit(1); }, 600_000);
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const scheme of ["light", "dark"]) {
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      localStorage.setItem("e2a2o.brick.tiny-transcript.hinted", "true");
      localStorage.setItem("e2a2o.features", JSON.stringify({ cards: true, pictures: true }));
      window.__errors = [];
      addEventListener("error", e => {
        if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src);
      }, true);
      addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
      const error = console.error;
      console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const shell of [true, false]) {
      const label = `${shell ? "shell" : "legacy"}/${width}x${height}/${scheme}`;
      const check = async (expression, reason, ms = 8000) => assert.ok(await until(expression, ms), `${label}: ${reason}`);
      const tap = async (at) => {
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
      };
      const healthy = async () => {
        assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
        assert.equal(await evaluate('!!document.querySelector(".brick-broke, .crash")'), false, `${label}: healthy UI`);
        assert.equal(await evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1'), true, `${label}: no horizontal overflow`);
      };
      const settled = async () => {
        await evaluate('document.fonts.ready.then(() => true)');
        await sleep(700);
        const rect = () => evaluate(`(() => {
          const el = document.querySelector('.pullback'), r = el?.getBoundingClientRect();
          return { card: r ? [r.x, r.y, r.width, r.height, Number(getComputedStyle(el).opacity)] : null,
            canvas: document.querySelector('.react-flow__viewport')?.style.transform ?? null };
        })()`);
        const before = await rect();
        await sleep(100);
        assert.deepEqual(await rect(), before, `${label}: card layout settled`);
        await healthy();
      };
      const expectQuote = async (text, reason) => {
        await check('document.querySelectorAll(".pullback").length === 1', `${reason}: one unfinished card`);
        const expected = text ? `“${text}”` : null;
        await check(`(document.querySelector('.pullback-quote')?.textContent ?? null) === ${JSON.stringify(expected)}`, `${reason}: quote is ${JSON.stringify(expected)}`);
        await settled();
        assert.equal(await evaluate('document.querySelector(".pullback-title b").textContent'), "Riverside picnic", `${label}: offered thread`);
        assert.equal(await evaluate('document.querySelector(".pullback-quote")?.textContent ?? null'), expected, `${label}: ${reason}: settled quote`);
        assert.equal(await evaluate(`document.querySelector('.pullback').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          (!document.querySelector('.pullback-quote') || document.querySelector('.pullback-quote').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))`), true, `${label}: card and quote displayed`);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".pullback-actions button")].map(el => el.textContent)'), ["Finish it", "Later", "Forget it"]);
      };
      const relay = relayChange;
      const move = async (id, to, undo = false) => {
        const from = shown.thoughts.find(t => t.id === id).thread_id;
        shown = { ...shown, thoughts: shown.thoughts.map(t => t.id === id ? { ...t, thread_id: to } : t) };
        relay({ type: "thought_moved", thought_id: id, thread_id: to, from, ...(undo ? { undo: true } : {}) });
        // Prove the relay reached the rendered map before accepting an unchanged quote.
        await check(shell ? `!!document.querySelector('[data-thought="${id}"][data-thread="${to}"]')`
          : `!!document.querySelector('#thread-${to} #point-${id}')`, `${id} moved to ${to}`);
      };

      shown = world;
      // Each shell is a fresh synthetic scene; saved choices are covered by phone-walk-check.
      await evaluate('if (location.protocol === "http:") Object.keys(localStorage).filter(key => key.startsWith("e2a2o.unfinished:")).forEach(key => localStorage.removeItem(key))');
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${shell ? "?shell=2" : "?cards"}` });
      await check(`!!document.querySelector('#type-a-thought') && !document.querySelector('.tour-tip')`, "sample loaded");
      if (shell) {
        await check('!!document.querySelector(".app.shell .spine-frame.spine-ready")', "populated Canvas ready");
        const bare = await evaluate(`(() => {
          for (let y = 100; y < innerHeight - 200; y += 40) for (let x = 20; x < innerWidth; x += 40) {
            if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
          }
          return null;
        })()`);
        assert.ok(bare, `${label}: bare canvas is reachable`);
        await tap(bare);
        await check('!document.querySelector(".keys-panel")', "first-use key hint dismissed by canvas input");
      } else {
        // Expose both memberships in the original cards renderer without invoking Finish it or changing the offer.
        // The snapshot first: an unfold that reaches a window before its threads are drawn (a slow machine) opens nothing.
        await check('!!document.querySelector("#thread-T2 .thread-toggle")', "legacy cards drawn");
        core.send({ type: "unfold", thread_id: null, open: true });
        await check('document.querySelector("#thread-T2 .thread-toggle")?.getAttribute("aria-expanded") === "true"', "legacy thread expanded");
      }
      // The actual pause/card condition, with no changes to clocks or product timing.
      await expectQuote(quote, "initial dropped thread ignores another speaker and appended older imports");
      const cardAt = () => evaluate(`(() => {
        const r = document.querySelector('.pullback').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 8 };
      })()`);
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...await cardAt() });
      if (width === 1440 && scheme === "light") {
        await sleep(lingerMs("Riverside picnic", quote) + 500);
        await expectQuote(quote, "hover holds the card beyond its reading time");
      }
      await move("p1", "T2");
      await expectQuote(quote, "newer incoming move does not change the last spoken turn");
      if (shell && shots) {
        assert.equal(await evaluate(`(() => {
          const el = document.querySelector('[data-thought="herbs"] .spine-text'), r = el?.getBoundingClientRect();
          return !!r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        })()`), true, `${label}: populated Canvas remains visible after move`);
        assert.equal(await evaluate(`(() => {
          const card = document.querySelector('.pullback'), r = card.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            [...card.querySelectorAll('button, .pullback-quote')].every(el => {
              const b = el.getBoundingClientRect();
              return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
            });
        })()`), true, `${label}: quote and actions are visible and clear`);
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const png = Buffer.from(data, "base64");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
        const file = resolve(shots, `${output ? "look-1" : "unfinished-quote-place"}-${width}x${height}-${scheme}.png`);
        writeFileSync(file, png);
        shotPaths.push(file);
      }
      await move("p2", "T1");
      await expectQuote(quote, "moving the source retains its interruption-time excerpt");
      await move("p2", "T2", true);
      await expectQuote(quote, "undo restores the quote");
      await move("p2", "T1");
      await expectQuote(quote, "moving the source again keeps the same excerpt");
      await move("p0", "T1");
      await expectQuote(quote, "imports cannot replace the recorded source");
      await move("imported", "T1");
      await expectQuote(quote, "future dates cannot replace the recorded source");
      await move("future", "T1");
      await expectQuote(quote, "source remains identifiable after all other words move");

      // Speech cannot take away a card being read, even when the new words reopen its thread.
      await evaluate(`navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext(), tone = ctx.createOscillator(), out = ctx.createMediaStreamDestination();
        tone.connect(out); tone.start(); return out.stream;
      }`);
      await tap(await evaluate(`(() => {
        const r = document.querySelector('button.mic').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`));
      await check('document.querySelector("button.mic")?.getAttribute("aria-pressed") === "true"', "local microphone starts");
      core.send({ type: "status", listening: true });
      core.send({ type: "partial", text: "I am still explaining the picnic" });
      await check('document.body.textContent.includes("I am still explaining the picnic")', "live speech reached the page");
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      await expectQuote(quote, "live speech leaves the exact source up after the pointer leaves");
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...await cardAt() });
      await check('document.querySelector(".pullback")?.matches(":hover")', "the pointer holds the current card position");
      const spoken = thought("spoken", "Choose a shady picnic spot before—", "T2", { at_ms: Date.now(), complete: false });
      relay({ type: "thought_added", thought: spoken });
      relay({ type: "thread_touched", thread_id: "T2", last_point: spoken.point, at_ms: spoken.at_ms });
      await expectQuote(quote, "new spoken turn keeps the recorded card being read");
      core.send({ type: "partial", text: "" });
      // An explicit Later still dismisses at once, despite the pointer holding the card.
      await evaluate('document.querySelector(".pullback-actions button:nth-child(2)").click()');
      await check('!document.querySelector(".pullback")', "Later dismisses the hovered card");
      relay({ type: "thread_status", thread_id: "T2", status: "dropped", speaker: "you" });
      relay({type:"paused",pause:{id:"pause-spoken-1",thought_id:"spoken",speaker:"you",thread_id:"T2",revision:1,excerpt:spoken.text,at_ms:spoken.at_ms,resolved:false,later_count:0,offer_after_ms:0,hidden:false}});
      assert.equal(await evaluate('!!document.querySelector(".pullback-quote")'), false, `${label}: no offer during fresh-word pause`);
      await expectQuote(spoken.text, "newly dropped spoken turn quotes its own words");
      if (width === 1440 && scheme === "light") {
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
        const lifetime = lingerMs("Riverside picnic", spoken.text);
        const started = Date.now();
        core.send({ type: "partial", text: "Talking during the reading time" });
        await sleep(1000);
        assert.equal(await evaluate('!!document.querySelector(".pullback")'), true, `${label}: speech does not dismiss the card`);
        await check('!document.querySelector(".pullback")', "card expires after reading time", lifetime + 2000);
        assert.ok(Date.now() - started >= lifetime - 1200, `${label}: card gets its full reading time`);
        core.send({ type: "partial", text: "" });
        await sleep(3000);
        assert.equal(await evaluate('!!document.querySelector(".pullback")'), false, `${label}: read card stays collapsed after the next pause`);
        assert.equal(shown.pauses.find(p=>p.id==="pause-spoken-1").hidden,false,"timer expiry is not Forget");
        assert.ok(await evaluate('!!document.querySelector("[data-paused-source=pause-spoken-1]")'),"source remains discoverable after the offer expires");
      } else {
        await evaluate('document.querySelector(".pullback-actions button:last-child").click()');
        await check('!document.querySelector(".pullback")', "Forget it dismisses immediately");
      }
      await healthy();
      console.log(`return fixture ${label}: ok`);
    }
    await browser.close();
    browser = null;
  }
  // Exact return contract: deliberately make the visible offer A and generic return B.
  for (const [width,height] of [[1440,900],[390,844]]) for (const reduced of [false,true]) {
    const sourceB="I need to finish the balcony plan before";
    const fixture=structuredClone(world);
    fixture.thoughts.find(t=>t.id==="p2").unclear="picnic";
    fixture.threads.push(thread("T3","Appointments"));
    fixture.thoughts.push(thought("b",sourceB,"T1",{complete:false,at_ms:Date.now()-2000}),thought("c","The appointment is booked","T3",{at_ms:Date.now()-1000}));
    fixture.pauses.push({id:"pause-b-1",thought_id:"b",speaker:"you",thread_id:"T1",revision:1,excerpt:sourceB,at_ms:Date.now()-1500,resolved:false,later_count:0,offer_after_ms:0,hidden:true});
    fixture.active="T3";fixture.active_by={you:"T3"};shown=fixture;
    browser=await openPage(`http://127.0.0.1:${core.port}/`,{width,height});
    const {page,evaluate,until}=browser;
    const check=async (expression,reason,ms=8000)=>assert.ok(await until(expression,ms),`${width} reduced=${reduced}: ${reason}`);
    const visible=id=>`(()=>{const e=document.querySelector('.spine-point[data-thought="${id}"] .spine-words');if(!e)return false;const r=e.getBoundingClientRect(),dock=document.querySelector('.dock').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=dock.top})()`;
    await page("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:reduced?"reduce":"no-preference"}]});
    await check('!!document.querySelector(".pullback-actions button")',"recorded A offer appears");
    const draft="Keep my own draft 🙂 exactly as typed";
    await evaluate(`(()=>{const f=document.querySelector('#type-a-thought');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,${JSON.stringify(draft)});f.dispatchEvent(new Event('input',{bubbles:true}));f.focus();f.setSelectionRange(2,17,'backward')})()`);
    const editor=()=>evaluate(`(()=>{const f=document.querySelector('#type-a-thought');return [f.value,f.selectionStart,f.selectionEnd,f.selectionDirection,document.activeElement===f]})()`);
    const before=await editor(),micStarts=core.heard.filter(m=>m.type==='listen'&&m.on).length;
    returnSource(shown.pauses.find(p=>p.id==='pause-b-1'));
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource === "b"',"generic voice return resolves B");
    await check(visible('b'),"generic return reveals B's original in context");
    if(reduced){await check('!!document.querySelector(".spine-cut")',"reduced motion shows a static source outline");assert.equal(await evaluate('getComputedStyle(document.querySelector(".spine-cut")).animationName'),'none');}
    await sleep(800);
    assert.deepEqual(await editor(),before,"voice return preserves byte-identical draft, selection, caret and focus");
    assert.equal(core.heard.filter(m=>m.type==='listen'&&m.on).length,micStarts,"return never starts a microphone");
    assert.equal(shown.active_by.you,"T1");
    await check('!!document.querySelector(".spine-paused-mark[data-source-thought=b]")',"static source marker remains after the offer disappears");
    const marker=await evaluate('(()=>{const r=document.querySelector(".spine-paused-mark[data-source-thought=b]").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');
    for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...marker,button:'left',clickCount:1});
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource === "b"',"source marker returns to its own exact thought");
    returnSource(shown.pauses.find(p=>p.id==='pause-b-1'));
    await sleep(100);assert.equal(shown.active_by.you,"T1","repeated return does not bounce");
    await evaluate('document.querySelector(".pullback-actions button").click()');
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource === "p2"',"named Finish A differs from generic B");
    await check(visible('p2'),"named Finish reveals A's exact offscreen source");
    assert.deepEqual((await editor()).slice(0,4),before.slice(0,4),"named return preserves existing draft and caret");
    assert.equal(shown.active_by.you,"T2");
    if(shots){const {data}=await page('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,`exact-return-${width}-${reduced?'reduced':'normal'}.png`),Buffer.from(data,'base64'));}
    assert.ok(shown.pauses.every(p=>!p.resolved),"navigation completes no interruption");
    relayChange({type:'thought_corrected',thought_id:'p2',accept:true,with:'garden'});
    relayChange({type:'thought_moved',thought_id:'p2',thread_id:'T1',from:'T2'});
    returnSource(shown.pauses.find(p=>p.id==='pause-p2-1'),'edited');
    await check('document.querySelector(".return-receipt")?.textContent.includes("Current words:")',"edited source is distinguished from captured excerpt");
    assert.ok(await evaluate(`document.querySelector('.return-receipt').textContent.includes(${JSON.stringify(quote)})`));
    assert.equal(shown.active_by.you,"T1","moved source returns in its actual current topic");
    const active=shown.active_by.you;
    relayChange({type:'thought_skipped',thought_id:'p2'});
    returnSource(shown.pauses.find(p=>p.id==='pause-p2-1'),'deleted');
    await check('document.querySelector(".return-receipt")?.textContent.includes("Source deleted")',"deletion is explicit");
    assert.equal(shown.active_by.you,active,"deleted source cannot navigate to a fabricated topic fallback");
    assert.ok(await evaluate(`document.querySelector('.return-receipt').textContent.includes(${JSON.stringify(quote)})`),"deleted original remains available");
    await page('Page.reload');
    await check('!!document.querySelector("[data-paused-source=pause-p2-1]")',"source survives reload and vanished offer");
    // Two explicit Later choices suppress the same revision; its source is still discoverable.
    shown=structuredClone(world);await page('Page.reload');
    await check('!!document.querySelector(".pullback-actions button")',"A offered for Later");
    await evaluate('document.querySelector(".pullback-actions button:nth-child(2)").click()');
    await check('!document.querySelector(".pullback")',"first Later hides the offer");
    assert.equal(shown.pauses[0].later_count,1);assert.equal(shown.pauses[0].hidden,false);
    await evaluate('window.actualNow=Date.now.bind(Date);Date.now=()=>actualNow()+300001');
    await check('!!document.querySelector(".pullback-actions button")',"first Later returns after five minutes");
    await evaluate('document.querySelector(".pullback-actions button:nth-child(2)").click()');
    await check('!document.querySelector(".pullback")',"second Later suppresses revision");
    assert.equal(shown.pauses[0].later_count,2);assert.equal(shown.pauses[0].hidden,true);
    await page('Page.reload');
    await check('!!document.querySelector(".paused-sources")',"suppressed source remains discoverable after reload");
    assert.equal(await evaluate('!!document.querySelector(".pullback")'),false);
    // A keyboard activation may focus an empty editor, only after the acknowledged return.
    await evaluate('document.querySelector(".paused-sources").open=true;document.querySelector(".paused-sources button").focus()');
    for(const type of ['keyDown','keyUp'])await page('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
    await check('document.activeElement===document.querySelector("#type-a-thought")',"explicit keyboard return focuses empty editor after acknowledgement");
    assert.equal(shown.pauses[0].resolved,false);
    shown={...structuredClone(world),pauses:[]};await page('Page.reload');
    await check('!!document.querySelector(".pullback")',"older topic can report missing identity");
    assert.ok(await evaluate('document.querySelector(".pullback").textContent.includes("Exact interruption source unavailable")'));
    assert.equal(await evaluate('document.querySelector(".pullback-actions button").disabled'),true,"topic-only fallback cannot pass as exact Finish");
    await healthyReturn();
    console.log(`exact return ${width} reduced=${reduced}: ok`);
    await browser.close();browser=null;
    async function healthyReturn(){assert.equal(await evaluate('!!document.querySelector(".brick-broke,.crash")'),false);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));}
  }
  if (shots) assert.equal(shotPaths.length, 4, "all four incoming-move shell fixtures captured");
  console.log(output ? JSON.stringify(shotPaths) : "unfinished-quote-place-check: ok");
} finally {
  clearTimeout(timeout);
  if (browser) await browser.close();
  core.close();
}
