// Offline fixtures only: run with `node scripts/hosted-check.mjs`. No deployed service or guest session is tested.
// The hosted site (`E2A2O_HOSTED=1`, core/src/main.rs `hosted`) and any computer that isn't a Mac: what the window
// says and does there (ui/src/site.ts). Hosted, no line sends anyone to a .env file or "the host's computer"; the
// first screen names the Meta models the core asks; a dated item saves as a calendar file (.ics) that calendars open,
// where a Mac would add it to Reminders or Calendar. The core's side has its own tests (sample.rs, apple.rs `saved`,
// main.rs `the_models_on_the_first_screen_are_the_ones_each_step_asks`).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const root = new URL("../ui", import.meta.url).pathname;
const server = await uiServer();
try {
  const site = await server.ssrLoadModule("/src/site.ts");
  const { actionLine, dismissable } = await server.ssrLoadModule("/src/action-line.ts");
  const { TIPS } = await server.ssrLoadModule("/src/Tips.tsx");
  const { MIC_WORDS } = await server.ssrLoadModule("/src/MicButton.tsx");

  // What /room says → how the window runs. An older core, or none yet: a laptop, as before.
  assert.deepEqual(site.siteFrom(null), site.LOCAL);
  assert.deepEqual(site.siteFrom({ room: false }), { hosted: false, calendarFile: false, sample: false, samples: [], models: [] });
  const models = [{ step: "hears", model: "muse-voice-transcribe-1.0" }, { step: "places", model: "muse-spark-1.2-contributor" }];
  assert.deepEqual(site.siteFrom({ hosted: true, calendar_file: true, sample: true, models }), { hosted: true, calendarFile: true, sample: true, samples: [], models });

  // Hosted words: true on a server; none points at a .env file, the host's computer or a Mac.
  const hostedWords = [site.savedWhere(true), site.siteText("The AI key was refused. Check MODEL_API_KEY in .env, then restart.", true),
    site.siteText("Making an app needs the AI key. Set MODEL_API_KEY in .env, then restart.", true)];
  for (const refused of [false, true]) for (const what of ["notice", "mic", "tour"]) hostedWords.push(site.keyWords(true, refused, what));
  for (const words of hostedWords) {
    assert.doesNotMatch(words, /\.env|MODEL_API_KEY|host's|this computer|\bMac\b|restart/, words);
  }
  assert.match(site.savedWhere(true), /server/);
  assert.match(site.siteText("The AI key was refused. Check MODEL_API_KEY in .env, then restart.", true), /refused/);
  assert.match(site.keyWords(true, false, "notice"), /no AI key/);
  // Past the hosted site's daily limit (the proxy's notice): every line says the free tries are used up until
  // tomorrow, never "no AI key" or "until its owner fixes it" (the site would read broken, not resting).
  const proxyLine = "Today's free tries are used up; back tomorrow. Your map is still here to read.";
  assert.ok(site.isResting(proxyLine));
  assert.ok(!site.isResting("MODEL_API_KEY is not set: listening and placement are off."));
  for (const hosted of [true, false]) for (const what of ["notice", "mic", "tour"]) {
    const words = site.keyWords(hosted, false, what, true);
    assert.match(words, /^Today's free tries are used up/, words);
    assert.match(words, /until tomorrow/, words);
    assert.doesNotMatch(words, /AI key|owner|\.env|MODEL_API_KEY/, words);
  }
  assert.match(site.keyWords(true, false, "notice", true), /midnight Pacific/);
  // Recap and the empty map say it too (wiring: they render with the core's `resting`).
  const appSource = readFileSync(`${root}/src/App.tsx`, "utf8");
  assert.match(readFileSync(`${root}/src/Recap.tsx`, "utf8"), /resting \? "Recap is back tomorrow: today's free tries are used up\."/);
  for (const prop of ["<Recap ", "<Tour ", "<PendingThought "]) assert.match(appSource, new RegExp(`${prop}[^\\n]*resting=\\{core\\.resting\\}`), prop);
  assert.match(site.keyWords(true, false, "notice", true), /type/, "typing still works, and is placed then");
  // On a laptop the words are as they were: the .env fix is yours (marks-check holds the mic's).
  assert.equal(site.savedWhere(false), "Your thoughts are saved on the host's computer.");
  assert.equal(site.keyWords(false, false, "notice"), "No AI key: you can browse the map, but new thoughts and listening need MODEL_API_KEY in .env (see .env.example).");
  assert.equal(site.siteText("Making an app needs the AI key. Set MODEL_API_KEY in .env, then restart.", false), "Making an app needs the AI key. Set MODEL_API_KEY in .env, then restart.");
  assert.equal(site.siteText("Couldn't make this app just now.", true), "Couldn't make this app just now.", "other words pass through");
  assert.match(MIC_WORDS.refused.tip, /MODEL_API_KEY in \.env/);

  // Every host-only line in the UI goes through site.ts, so a new one can't slip past hosting: outside it, these
  // words appear only in comments, or in the import's list, which shows only on the core's own machine (Import.tsx).
  const allowed = new Set(["Import.tsx:The file itself isn't kept. The points are saved with your map, on this computer."]);
  for (const file of readdirSync(`${root}/src`).filter((f) => /\.tsx?$/.test(f) && f !== "site.ts")) {
    for (const line of readFileSync(`${root}/src/${file}`, "utf8").split("\n")) {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*") || code.startsWith("{/*")) continue;
      if (!/\.env\b|host's computer|this computer|on a Mac/.test(code)) continue;
      const text = code.replace(/<\/?li>/g, "");
      assert.ok(allowed.has(`${file}:${text}`), `${file}: a host-only line outside site.ts: ${code}`);
    }
  }

  // The first screen: Meta's models by step, public names (Contributor mode is how the key asks, not a model).
  assert.equal(site.modelsLine(models), "Hears: Muse Voice Transcribe 1.0 · Places: Muse Spark 1.2");
  assert.equal(site.modelsLine([]), "", "without a key none runs, so none is named");

  // The calendar file: one all-day event, the next day as its end, even across a month and a year.
  const now = new Date(Date.UTC(2026, 10, 1, 20, 5, 9, 123));
  const ics = site.icsFor({ id: "ac-1", title: "Demo day", when: "2026-11-30" }, now);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"), ics);
  for (const line of ["DTSTART;VALUE=DATE:20261130", "DTEND;VALUE=DATE:20261201", "DTSTAMP:20261101T200509Z", "SUMMARY:Demo day", "UID:ac-1-20261130@e2a2o"]) {
    assert.ok(ics.split("\r\n").includes(line), `${line} in\n${ics}`);
  }
  assert.ok(site.icsFor({ id: "x", title: "NYE", when: "2026-12-31" }, now).includes("DTEND;VALUE=DATE:20270101"));
  assert.ok(!/[^\r]\n/.test(ics), "every line ends in CRLF");
  // Text is escaped; a long title folds at 75 bytes, never inside a character, and unfolds to itself.
  const title = "Call Dr. Chen's office; book Mom's follow-up, then text Priya — “slides” 🎤 ".repeat(3).trim();
  const long = site.icsFor({ id: "ac-2", title, when: "2026-11-03" }, now);
  const encoder = new TextEncoder();
  for (const line of long.split("\r\n")) assert.ok(encoder.encode(line).length <= 75, `${encoder.encode(line).length}: ${line}`);
  const summary = long.replace(/\r\n /g, "").split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  assert.equal(summary, `SUMMARY:${title.replace(/[\\;,]/g, (c) => `\\${c}`)}`);
  // No real day, no file: a calendar can't hold it (as the core: apps.rs `valid_date`).
  for (const when of ["", "tomorrow", "2026-11-31", "2026-02-29", "1999-01-01", "2026-11"]) {
    assert.equal(site.icsFor({ id: "x", title: "t", when }, now), null, when);
  }
  assert.equal(site.icsName("Call Dr. Chen's office!"), "Call-Dr-Chens-office.ics");
  assert.equal(site.icsName("🎤"), "event.ics");

  // The row, where Apple's apps can't be reached: Download .ics on a dated item, nothing to press without a day,
  // and "Saved as .ics" once the core marks it (apple.rs `saved`).
  const action = { id: "ac-1", thread_id: "T1", kind: "event", title: "Demo day", when: "2026-11-04", status: "new", done_ms: null };
  assert.deepEqual(actionLine(action, "Calendar", true), { button: "Download .ics", label: "Download Demo day as a calendar file" });
  assert.deepEqual(actionLine({ ...action, when: "" }, "Reminders", true), {});
  // Undated, it has no button, yet its × stays (App.tsx `ActionRow`): only a waiting item has one.
  assert.ok(dismissable({ ...action, when: "" }));
  for (const status of ["kept", "done", "dismissed"]) assert.ok(!dismissable({ ...action, status }), status);
  assert.match(readFileSync(`${root}/src/App.tsx`, "utf8"), /\{dismissable\(action\) && \(/, "the row's × follows `dismissable`, not the button");
  assert.deepEqual(actionLine({ ...action, status: "done" }, "Calendar", true), { status: "Saved as .ics" });
  assert.deepEqual(actionLine({ ...action, status: "dismissed" }, "Calendar", true), {});
  assert.deepEqual(actionLine(action, "Calendar"), { button: "Add to Calendar", label: "Add Demo day to Calendar" }, "on a Mac, as before");
  // A restarted core's settings reach the window: the door is kept before the "nothing changed" return (room.tsx).
  const recheck = readFileSync(`${root}/src/room.tsx`, "utf8").split("recheck = () => {\n")[1];
  assert.ok(recheck.indexOf("setDoor(d)") < recheck.indexOf("return;"), "recheck keeps the new door before returning");
  assert.match(TIPS.file(false, true), /Download \.ics/);
  assert.match(TIPS.file(false, false), /no day/);
  assert.match(TIPS.file(true, false), /calendar file/);
  console.log("hosted-check: offline fixtures ok (hosted guest journey and boot SHA not tested)");
} finally {
  await server.close();
}
