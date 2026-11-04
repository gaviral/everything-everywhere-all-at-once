// Core: real bounded runtime + fake Meta on ephemeral loopback. UI: built page + synthetic socket/speech.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const root = new URL("../", import.meta.url);
try {
  const output = execFileSync("cargo", ["test", "--manifest-path", "core/Cargo.toml", "c10_style"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /test result: ok\. [1-9]\d* passed/);
  console.log("c10-style core: counted repair, disclosure, baseline, cancellation, deadline, opt-in and revision checks passed");
} catch (error) { process.stderr.write(error.stdout ?? ""); process.stderr.write(error.stderr ?? ""); throw error; }
if (ready()) { console.log(`SKIP c10-style UI: ${ready()}`); process.exitCode = 3; }
else {
  const evidence = mkdtempSync(join(tmpdir(), "e2a2o-c10-style-"));
  const world = { threads: [], thoughts: [], active: null, active_by: {}, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], recaps: [], proposals: [], ai: [] };
  const defaults = { maxWords: 60, bullets: false, pointFirst: false };
  let preferences = { ...defaults }, revision = 0, partner = false, format = false;
  let core, browser;
  core = await standInCore(() => [{ type: "snapshot", world }], { onMessage(msg) {
    if (msg.type === "partner") partner = msg.on;
    if (msg.type === "reply_format") {
      format = msg.on && partner;
      if (format) core.send({ type: "reply_format_state", preferences, revision, request_id: null, accepted: true, message: "For this conversation" });
    }
    if (msg.type === "reply_format_set" && format) {
      const accepted = msg.observed_revision === revision;
      if (accepted) { preferences = msg.preferences; revision++; }
      core.send({ type: "reply_format_state", preferences, revision, request_id: msg.request_id, accepted, message: accepted ? "Saved for this conversation" : "Preferences changed. Review and save again." });
    }
  }, onClose() { preferences = { ...defaults }; revision = 0; partner = false; format = false; } });
  assert.ok(![4360, 4399].includes(core.port));
  try {
    browser = await openPage("about:blank");
    const { evaluate, until, page } = browser;
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured','1'); window.spoken=[]; window.errors=[];
      addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver'))errors.push(e.message)});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
        getVoices:()=>[{name:'Synthetic English',lang:'en-US',default:true,localService:true}], speak:u=>spoken.push(u.text), cancel:()=>{}
      })}); window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
    ` });
    const navigate = async () => {
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
      assert.ok(await until(`!!document.querySelector('#type-a-thought')`));
    };
    const click = async (selector) => { assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
    const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const shot = async name => {
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(evidence, `${name}.png`), Buffer.from(data, "base64"));
    };
    const key = async (key, code, n) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(key === "Enter" ? { text: "\r" } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
    };
    await navigate();
    assert.equal(await evaluate(`!!document.querySelector('.reply-format')`), false);
    assert.ok(!core.heard.some(m => m.type === "reply_format" && m.on));
    await click('[data-guide="catalog"]');
    assert.equal(await evaluate(`document.querySelector('[role="switch"][aria-label="Reply format"]').getAttribute('aria-checked')`), "false");
    await click('[role="switch"][aria-label="Conversation partner"]');
    await click('[role="switch"][aria-label="Reply format"]');
    assert.ok(await until(`!!document.querySelector('.reply-format') && !document.querySelector('.reply-format button').disabled`));
    assert.ok(core.heard.some(m => m.type === "reply_format" && m.on));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum visible words"]').value`), "60");
    await input('[aria-label="Maximum visible words"]', '40');
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="First answer"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'bullets');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('.reply-format-toggle input');
    await click('.reply-format button');
    assert.ok(await until(`document.querySelector('.reply-format').textContent.includes('Saved for this conversation')`));
    assert.deepEqual(preferences, { maxWords: 40, bullets: true, pointFirst: true });
    const calls = core.heard.filter(m => m.type === 'text').length;
    const before = core.heard.length;
    await input('[aria-label="Check sample"]', '- Start with one step.');
    await evaluate(`Array.from(document.querySelectorAll('.reply-format button')).find(b=>b.textContent==='Check sample').click()`);
    assert.ok(await until(`document.querySelector('.reply-format-result')?.textContent.startsWith('Mechanical checks passed')`));
    assert.equal(core.heard.slice(before).filter(m => !['heartbeat'].includes(m.type)).length, 0, "Check sample sends nothing and calls no model");
    await input('[aria-label="Check sample"]', 'Sure, ' + 'word '.repeat(50));
    await evaluate(`Array.from(document.querySelectorAll('.reply-format button')).find(b=>b.textContent==='Check sample').click()`);
    assert.ok(await until(`document.querySelector('.reply-format-result')?.textContent.includes('word count') && document.querySelector('.reply-format-result').textContent.includes('line prefix shape') && document.querySelector('.reply-format-result').textContent.includes('no preamble')`));
    assert.equal(core.heard.filter(m => m.type === 'text').length, calls);
    // Screenshot the real controls in both themes at desktop and 390px; each panel can scroll above the composer.
    for (const theme of ['light','dark']) {
      await page('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme',value:theme },{ name:'prefers-reduced-motion',value:'reduce' }] });
      for (const width of [1440,390]) {
        await page('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate(`document.querySelector('.reply-format').scrollIntoView({block:'start'})`);
        await sleep(100);
        await shot(`${theme}-${width}`);
        assert.ok(await evaluate(`(()=>{const e=document.querySelector('[aria-label="Maximum visible words"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()`), 'word control reachable');
      }
    }
    await evaluate(`document.documentElement.style.fontSize='200%';document.querySelector('[aria-label="Check sample"]').scrollIntoView({block:'center'})`);
    await sleep(100);
    assert.ok(await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('.reply-format button')).find(b=>b.textContent==='Check sample');e.scrollIntoView({block:'center'});e.focus();const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&document.activeElement===e})()`), '200% text keyboard control reachable');
    await shot('phone-200-reduced-motion');
    await key('Enter','Enter',13);
    assert.ok(await until(`!!document.querySelector('.reply-format-result')`));
    await evaluate(`document.documentElement.style.fontSize='100%'`);
    await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await key('Escape','Escape',27);
    assert.ok(await until(`!document.querySelector('#shell-tabpanel')`));
    assert.equal(await evaluate(`document.activeElement.getAttribute('data-guide')`),'catalog','focus returns to Features');
    const valid = { type:'partner_reply',reply_id:'synthetic-success',displayText:'- Start with one step.\n- Check the result.',speakText:'Start with one step. Check the result.',available_answer:null };
    core.send({type:'partner_state',state:'thinking',message:'Thinking…',reply_id:valid.reply_id});
    assert.equal(await evaluate(`!!document.querySelector('.formatted-reply')`),false,'no early publication');
    core.send(valid);
    assert.ok(await until(`document.querySelector('.formatted-reply')?.textContent.includes('Check the result') && spoken.length===1`));
    assert.equal(await evaluate(`spoken[0]`), valid.speakText, 'speech uses bounded speakText, never bullets');
    core.send({type:'partner_state',state:'thinking',message:'Thinking…',reply_id:'synthetic-failure'});
    core.send({...valid,reply_id:'synthetic-failure',displayText:'Could not fit your format',speakText:'Could not fit your format. You can show the available answer.',available_answer:'Sure, an unchecked available answer.'});
    assert.ok(await until(`document.querySelector('.formatted-reply summary')?.textContent==='Show available answer'`));
    assert.equal(await evaluate(`document.querySelector('.formatted-reply details').open`),false);
    await evaluate(`document.querySelector('.formatted-reply summary').focus()`);
    await key('Enter','Enter',13);
    assert.ok(await until(`document.querySelector('.formatted-reply details').open`));
    await shot('honest-disclosure');
    // Reload remembers only feature switches; runtime preferences reset on the last opted-in socket close.
    await navigate();
    await click('[data-guide="catalog"]');
    assert.ok(await until(`document.querySelector('[aria-label="Maximum visible words"]')?.value==='60'`));
    assert.equal(await evaluate(`document.querySelector('[role="switch"][aria-label="Reply format"]').getAttribute('aria-checked')`),'true');
    // Offline does not erase a user's editable preference draft, and never claims it was saved.
    await input('[aria-label="Maximum visible words"]','45');
    core.drop();
    await sleep(100);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum visible words"]').value`),'45');
    await click('[role="switch"][aria-label="Reply format"]');
    assert.ok(await until(`!document.querySelector('.reply-format')`));
    const spokenBefore=await evaluate(`spoken.length`);
    core.send({...valid,reply_id:'late-disabled'});
    await sleep(100);
    assert.equal(await evaluate(`spoken.length`),spokenBefore);
    assert.equal(await evaluate(`!!document.querySelector('.formatted-reply')`),false);
    assert.deepEqual(await evaluate(`errors`),[]);
    console.log(`c10-style UI passed: default off, Features, acknowledged preferences, sample zero calls, reload, honest disclosure, off/late work, keyboard/focus, 390px, both themes, 200% and reduced motion; screenshots ${evidence}`);
  } finally { await browser?.close(); core.close(); }
}
