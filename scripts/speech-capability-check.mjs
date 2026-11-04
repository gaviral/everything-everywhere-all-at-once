// Built page, synthetic replies and browser voices; no microphone, model or audible playback.
import assert from "node:assert/strict";
import { openPage, ready, standInCore } from "./headless.mjs";

if (ready()) { console.log(`SKIP speech-capability-check: ${ready()}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["Fixture"] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
const switchQuery = '[role="switch"][aria-label="Built-in speech"]';
try {
  for (const capability of ["present", "mixed", "remote", "unknown", "empty", "missing"]) {
    const available = capability === "present" || capability === "mixed";
    const voices = capability === "present"
      ? [{ name: "Test English Premium", lang: "en-US", default: true, localService: true }]
      : capability === "mixed"
        ? [{ name: "Remote English Premium", lang: "en-US", default: true, localService: false },
           { name: "Unknown English Premium", lang: "en-US", default: true },
           { name: "Local English", lang: "en-US", default: false, localService: true }]
        : capability === "remote"
          ? [{ name: "Remote English Premium", lang: "en-US", default: true, localService: false }]
          : capability === "unknown"
            ? [{ name: "Unknown English Premium", lang: "en-US", default: true },
               { name: "String-locality English Premium", lang: "en-US", localService: "true" },
               { name: "Null-locality English Premium", lang: "en-US", localService: null }] : [];
    const browser = await openPage("about:blank", { width: capability === "empty" ? 390 : 1440 });
    try {
      const { page, evaluate, until } = browser;
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.setItem("e2a2o.toured", "1");
        localStorage.setItem("e2a2o.features", JSON.stringify({ partner: true }));
        window.spoken = []; window.errors = []; window.cancelled = 0;
        window.voices = ${JSON.stringify(voices)};
        addEventListener("error", e => { if (!e.message.startsWith("ResizeObserver")) errors.push(e.message); });
        addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: ${capability === "missing" ? 'undefined' : `Object.assign(new EventTarget(), {
          getVoices: () => voices, cancel: () => cancelled++,
          speak: u => { spoken.push(u); u.onstart?.(); }
        })`} });
        window.SpeechSynthesisUtterance = ${capability === "missing" ? 'undefined' : 'class { constructor(text) { this.text = text; } }'};
      ` });
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
      assert.ok(await until('!!document.querySelector(".app.shell .shell-welcome")'), `${capability}: empty page mounted after snapshot`);
      await evaluate('document.querySelector("[data-guide=catalog]").click()');
      assert.ok(await until('!!document.querySelector(".shell-catalog")'));
      assert.equal(await evaluate(`document.querySelectorAll('${switchQuery}').length`), available ? 1 : 0,
        `${capability}: exactly one usable speech switch, or none without a voice`);

      const sendReply = async text => {
        core.send({ type: "guide", kind: "caption", text, speak: true, by: "Fixture", at_ms: Date.now() });
        assert.ok(await until(`document.body.textContent.includes(${JSON.stringify(text)})`), "reply remains visible as text");
      };
      await sendReply(`Synthetic ${capability} reply.`);
      assert.equal(await evaluate("spoken.length"), available ? 1 : 0);
      if (available) {
        assert.equal(await evaluate("spoken[0].voice.localService"), true, "only explicitly local voice receives text");
        if (capability === "mixed") {
          assert.equal(await evaluate("spoken[0].voice.name"), "Local English", "higher-ranked remote/unknown voices excluded before ranking");
        }
        await evaluate(`document.querySelector('${switchQuery}').click()`);
        assert.equal(await evaluate("cancelled"), 1, "switching off cancels current playback");
        await sendReply("Synthetic switched off reply.");
        assert.equal(await evaluate("spoken.length"), 1, "off keeps replies text-only");
        await evaluate(`document.querySelector('${switchQuery}').click()`);
        await sendReply("Synthetic switched on reply.");
        assert.equal(await evaluate("spoken.length"), 2, "on speaks future replies");
        await evaluate('spoken.at(-1).onerror({ error: "voice-unavailable" })');
        await sendReply("Synthetic unusable voice reply.");
        assert.equal(await evaluate("spoken.length"), 2, "unusable listed voice quietly falls back to text");
      } else if (capability === "empty") {
        await evaluate('voices = [{ name: "Late English", lang: "en-US", localService: true }]; speechSynthesis.dispatchEvent(new Event("voiceschanged"))');
        assert.ok(await until(`!!document.querySelector('${switchQuery}')`), "late voices enable the switch");
        assert.equal(await evaluate("spoken.length"), 0, "voice arrival never replays old replies");
        await sendReply("Synthetic late voice reply.");
        assert.equal(await evaluate("spoken.length"), 1, "future replies use the detected voice");
        await evaluate('voices = []; speechSynthesis.dispatchEvent(new Event("voiceschanged"))');
        assert.ok(await until(`!document.querySelector('${switchQuery}')`), "voice loss removes the control");
        await sendReply("Synthetic lost voice reply.");
        assert.equal(await evaluate("spoken.length"), 1, "voice loss restores text-only replies");
      }
      const beforeCommand = await evaluate("spoken.length");
      core.send({ type: "command_reply", text: "Synthetic command confirmation.", speak: true });
      assert.ok(await until('document.querySelector(".partner-status [role=status]")?.textContent.includes("Synthetic command confirmation.")'),
        "spoken command confirmations also fall back to visible text");
      assert.equal(await evaluate("spoken.length"), beforeCommand);
      assert.equal(await evaluate('!!document.querySelector("[data-playback=failed]") || document.body.textContent.includes("Retry audio")'), false);
      assert.deepEqual(await evaluate("errors"), [], "no browser errors");
      console.log(`PASS speech capability: ${capability}; visible text, capability-gated Features and quiet fallback`);
    } finally { await browser.close(); }
  }
} finally { core.close(); }
