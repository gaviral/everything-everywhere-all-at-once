// Focused behavior check: node ui/src/bricks/pair-room/check.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { contextFor, sharedTopics, roomTurns, packetText } from "./context.ts";
import { EXAMPLE_PEOPLE, EXAMPLE_TURNS } from "./example.ts";
import { openPage, ready, standInCore } from "../../../../scripts/headless.mjs";

const manifest = JSON.parse(readFileSync(new URL("./brick.json", import.meta.url), "utf8"));
assert.equal(manifest.defaultOn, false);
const other = { id: "third", speaker: "third-person", topic: "payments", title: "Payments", text: "Third person's unrelated instruction" };
const turns = [...EXAMPLE_TURNS, other];
const shared = sharedTopics(turns, EXAMPLE_PEOPLE);
assert.deepEqual(shared.map(topic => topic.id), ["payments"]);
for (const person of EXAMPLE_PEOPLE) {
  const packet = contextFor(person, turns, shared);
  assert.ok(packet.own.every(turn => turn.speaker === person.id));
  assert.ok(!packetText(packet).includes(other.text));
  const partnerOnly = EXAMPLE_TURNS.filter(turn => turn.speaker !== person.id && turn.topic !== "payments");
  for (const turn of partnerOnly) assert.ok(!packetText(packet).includes(turn.text), "Partner's own context stays out");
  for (const turn of EXAMPLE_TURNS.filter(turn => turn.topic === "payments")) assert.ok(packetText(packet).includes(turn.text));
}
assert.deepEqual(sharedTopics(EXAMPLE_TURNS.slice(0, 1), EXAMPLE_PEOPLE), []);
assert.deepEqual(sharedTopics(EXAMPLE_TURNS.map((turn, i) => ({ ...turn, topic: `distinct-${i}` })), EXAMPLE_PEOPLE), []);
assert.deepEqual(sharedTopics(EXAMPLE_TURNS, [EXAMPLE_PEOPLE[0], EXAMPLE_PEOPLE[0]]), []);
const live = { thoughts: [
  { ...EXAMPLE_TURNS[0], complete: true, thread_id: "payments", at_ms: 1 },
  { ...EXAMPLE_TURNS[1], complete: false, thread_id: "payments", at_ms: 2 },
  { ...EXAMPLE_TURNS[2], complete: true, speaker: "Spark", thread_id: "payments", at_ms: 3 },
], threads: [{ id: "payments", title: "Payments" }], speakers: new Map([["Spark", { ai: true }]]) };
assert.deepEqual(roomTurns(live).map(turn => turn.id), ["m1"]);
console.log("pair-room: context isolation, shared topic identity, completed human turns and default-off passed");

assert.equal(ready(), "", "A built UI and Chrome are required for the focused page check");
const core = await standInCore(() => []);
const browser = await openPage(`http://127.0.0.1:${core.port}/bricks.html?brick=pair-room&sample=empty`, { width: 1600, height: 1100, preserveProfile: true });
const { evaluate, until, page } = browser;
const click = label => evaluate(`[...document.querySelectorAll('.pair-room button')].find(button => button.textContent.includes(${JSON.stringify(label)})).click()`);
try {
  assert.ok(await until(`document.querySelectorAll('.pair-room-lane').length === 2`));
  assert.equal(await evaluate(`document.querySelectorAll('.pair-room-turn').length`), 4);
  assert.equal(await evaluate(`document.querySelectorAll('.pair-room-shared-topic').length`), 1);
  await evaluate(`window.pairRoomMicCalls = 0; navigator.mediaDevices.getUserMedia = () => { window.pairRoomMicCalls++; throw new Error('No microphone in this check'); }`);
  await click("Ask a question");
  assert.ok(await until(`document.querySelector('.pair-room-output')?.textContent.includes('idempotency key')`));
  await evaluate(`document.querySelector('.pair-room-context summary').click()`);
  assert.ok(await evaluate(`!document.querySelector('.pair-room-context pre').textContent.includes('Verify signatures')`));
  await click("Build a draft");
  assert.ok(await until(`document.querySelector('.pair-room-output pre')?.textContent.includes('findPayment')`));
  if (process.env.PAIR_ROOM_SCREENSHOT) {
    const shot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(process.env.PAIR_ROOM_SCREENSHOT, Buffer.from(shot.data, "base64"));
  }
  await click("Play conversation");
  assert.ok(await until(`document.querySelector('.pair-room-partial')?.textContent.includes('Return')`));
  assert.ok(await evaluate(`document.querySelectorAll('.pair-room-lane')[0].contains(document.querySelector('.pair-room-partial'))`));
  await click("Pause");
  assert.ok(await until(`[...document.querySelectorAll('.pair-room button')].some(button => button.textContent.includes('Play conversation'))`));
  assert.equal(await evaluate(`document.querySelectorAll('.pair-room-turn:not(.pair-room-partial)').length`), 4);
  await click("Play conversation");
  assert.ok(await until(`document.querySelectorAll('.pair-room-turn:not(.pair-room-partial)').length === 5`, 8000));
  assert.ok(await until(`document.querySelectorAll('.pair-room-lane')[1].querySelector('.pair-room-partial')?.textContent.includes('Yes')`, 4000));
  await click("Pause");
  await click("Replay from start");
  assert.ok(await until(`document.querySelectorAll('.pair-room-turn:not(.pair-room-partial)').length === 0`));
  await click("Pause");
  await click("Connected shared map");
  assert.ok(await until(`document.querySelector('.pair-room-waiting')?.textContent.includes('Bring two voices')`));
  assert.equal(await evaluate(`document.querySelectorAll('.pair-room-turn').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.pair-room-output').length`), 0);
  await click("Open example shared map");
  for (const width of [390, 320, 1280]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await until(`document.documentElement.scrollWidth <= innerWidth + 1`), `Fits ${width}px without horizontal overflow`);
  }
  assert.equal(await evaluate(`window.pairRoomMicCalls`), 0);
  assert.equal(await evaluate(`document.querySelector('.playground').dataset.errors`), "0");
  console.log("pair-room: example output, speaker-by-speaker playback, pause/replay, empty connected room, 320/390/1280px and no microphone passed");
} finally {
  await browser.close();
  core.close();
}
