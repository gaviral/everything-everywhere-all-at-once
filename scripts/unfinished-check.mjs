// No extra dependencies: run with `node scripts/unfinished-check.mjs`.
// The unfinished card (ui/src/unfinished.ts), as in the demo: a line trails off, the card rises only after 2.5 s
// without new words, quotes the words you trailed off on, and Later hides it.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

const server = await uiServer();
try {
  const { pauseOffer, leftOff, cardAt, putOff, lastWords, lingerMs, NONE_HIDDEN, PAUSE_MS, LATER_MS } = await server.ssrLoadModule("/src/unfinished.ts");
  const { LOOK_MS } = await server.ssrLoadModule("/src/attention-core.ts");
  const { DECIDE_MS, REACH_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  assert.equal(lingerMs("Picnic", "Bring chairs"), 11 * 60_000 / 200 + LOOK_MS + DECIDE_MS + REACH_MS,
    "read the heading, title, quote and all actions, plus time to notice and act");
  assert.equal(lingerMs("Picnic", "Bring chairs " + "word ".repeat(200)) - lingerMs("Picnic", "Bring chairs"), 60_000,
    "200 more words get another minute to read");
  const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: 1,
    tags: [], picture: null, dropped_by: "", ...extra });
  const thought = (id, thread_id, at_ms, text, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id,
    placed: !!thread_id, unclear: "", complete: true, at_ms, place_ms: 2500, ...extra });

  // The demo at 58 s: "I should set up autopay before—" trails off, and the bill thread is left unfinished.
  const said = 58_000;
  const bill = thread("T3", "Electric bill", { status: "dropped", dropped_by: "you", touched_ms: said });
  const threads = [thread("T1", "Hackathon demo"), bill, thread("T4", "Rent", { status: "dropped", dropped_by: "Sam", touched_ms: said + 500 })];
  const thoughts = [
    thought("a", "T3", said - 1_000, "I keep forgetting about the electric bill too."),
    thought("b", "T3", said, "I should set up autopay before—"),
    thought("sam", "T3", said + 400, "Sam's words on it", { speaker: "Sam" }),
    thought("waiting", null, said + 600, "Not placed yet"),
    // An imported point lands last in the list with its old time; one dated ahead of the clock counts as the earliest.
    thought("sample", "T3", said + 3_600_000, "A sample's point, dated tomorrow"),
  ];
  const card = (now, wordsAt, hidden = NONE_HIDDEN) => cardAt(leftOff(threads, "you", hidden, now), now, wordsAt)?.id ?? null;

  // Only after the pause: not while the words could still go on, and new words (live or kept) start it over.
  assert.equal(PAUSE_MS, 2500);
  assert.equal(card(said + 2_400, said), null, "too soon after the last words");
  assert.equal(card(said + 2_600, said), "T3", "2.5 s of quiet: the card rises");
  assert.equal(card(said + 2_600, said + 1_000), null, "a new word a second later starts the wait over");
  assert.equal(card(said + 3_600, said + 1_000), "T3");
  // Only the thread you left: Sam's newer one is Sam's to pick up.
  assert.equal(leftOff(threads, "Sam", NONE_HIDDEN, said + 3_000).id, "T4");

  // The card quotes the words you trailed off on: yours, placed there, newest by when you said them.
  assert.equal(lastWords(thoughts, bill, "you", said + 3_000), "I should set up autopay before—");

  // Later hides it: gone at once, back once after 5 minutes (at the next pause), and a second Later sets it aside
  // until that thread changes.
  const now = said + 3_000;
  const once = putOff(NONE_HIDDEN, bill, now);
  assert.equal(card(now + 400, said, once), null, "Later hides the card");
  assert.equal(card(now + LATER_MS - 1_000, said, once), null, "still hidden 4 minutes later");
  assert.equal(LATER_MS, 5 * 60 * 1000);
  assert.equal(card(now + LATER_MS, now + LATER_MS - 2_000, once), null, "after 5 minutes, only at a pause");
  assert.equal(card(now + LATER_MS, said, once), "T3", "offered once more after 5 minutes");
  const twice = putOff(once, bill, now + LATER_MS);
  assert.equal(card(now + 3 * LATER_MS, said, twice), null, "a second Later sets it aside");
  const changed = threads.map((t) => (t.id === "T3" ? { ...t, touched_ms: now + 3 * LATER_MS } : t));
  assert.equal(cardAt(leftOff(changed, "you", twice, now + 4 * LATER_MS), now + 4 * LATER_MS, said)?.id, "T3",
    "new words there make it a new card");
  const pause={id:"pause-b-1",thought_id:"b",speaker:"you",thread_id:"T3",revision:1,excerpt:"I should set up autopay before—",at_ms:said,resolved:false,later_count:0,offer_after_ms:0,hidden:false};
  const recorded={threads,thoughts,pauses:[pause]};
  const offered=pauseOffer(recorded,"you",now,new Set());
  assert.equal(offered.return_source.thought_id,"b");
  assert.equal(lastWords([{...thoughts[0],text:"Newer unrelated words"}],offered,"you",now),pause.excerpt,"a recorded excerpt never follows the newest topic words");
  assert.equal(pauseOffer({...recorded,pauses:[]},"you",now,new Set()),undefined,"a topic alone is not an interruption identity");
  assert.equal(pauseOffer(recorded,"Sam",now,new Set()),undefined,"speaker ownership");
  assert.equal(pauseOffer({...recorded,pauses:[{...pause,hidden:true}]},"you",now,new Set()),undefined);
  assert.equal(pauseOffer({...recorded,pauses:[{...pause,offer_after_ms:now+LATER_MS}]},"you",now+LATER_MS-1,new Set()),undefined);
  assert.equal(pauseOffer({...recorded,pauses:[{...pause,offer_after_ms:now+LATER_MS}]},"you",now+LATER_MS,new Set()).return_source.id,pause.id);
  assert.equal(pauseOffer(recorded,"you",now,new Set([pause.id])),undefined,"presentation expiry hides only the offer");
  assert.equal(recorded.pauses[0].resolved,false);
  assert.equal(pauseOffer({...recorded,pauses:[{...pause,resolved:true}]},"you",now,new Set()),undefined);
  console.log("unfinished-check: ok");
} finally {
  await server.close();
}
