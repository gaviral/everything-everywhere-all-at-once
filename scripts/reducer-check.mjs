// No extra dependencies: run with `node scripts/reducer-check.mjs`.
// The window's reducer (`apply` in ui/src/core.ts) for the changes no other check feeds it, each as the core applies
// it (core/src/world.rs `World::apply`): a thought placed (every landing in the demo), split, marked decided; a thread
// left off and picked up again; tags, pictures, proposed ideas and reminders, a saved recap, and the apps' changes.
// A change applied differently here than in the core shows a map the core doesn't hold, until the next reload.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const thread = (id, extra = {}) => ({ id, title: `Topic ${id}`, parent_id: null, status: "open", last_point: "", touched_ms: 1,
    tags: [], picture: null, dropped_by: "", ...extra });
  const thought = (id, extra = {}) => ({ id, speaker: "you", text: id, point: "", thread_id: null, placed: false, unclear: "",
    guess: "", heard: "", fixed: "", complete: true, at_ms: 1, place_ms: null, decided: false, ...extra });
  const base = { recaps: [], apps: [], apps_seeded: false, threads: [thread("T1"), thread("T2"), thread("T3")], thoughts: [],
    active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, proposals: [], notes: {} };
  const run = (world, ...changes) => changes.reduce(apply, world);

  // A landing: the point, its thread and its placing time; a fix the placer was sure of ("muse bark" heard, "Muse
  // Spark" meant) is in the words too, on the first placing only, whole words only; the decided mark comes with it.
  const said = run(base, { type: "thought_added", thought: thought("q", { text: "ask muse bark about the lease" }) });
  const placed = { type: "thought_placed", thought_id: "q", thread_id: "T2", point: "Ask Muse Spark about the lease", unclear: "",
    heard: "muse bark", fixed: "Muse Spark", complete: true, place_ms: 2800, decided: true };
  const q = apply(said, placed).thoughts[0];
  assert.deepEqual([q.placed, q.thread_id, q.point, q.place_ms, q.text, q.heard, q.fixed, q.guess, q.decided],
    [true, "T2", "Ask Muse Spark about the lease", 2800, "ask Muse Spark about the lease", "muse bark", "Muse Spark", "", true]);
  assert.equal(run(said, placed, { ...placed, fixed: "Muse Lark" }).thoughts[0].text, "ask Muse Spark about the lease", "placed again: fixed once");
  assert.equal(run(base, { type: "thought_added", thought: thought("w", { text: "the muse barking" }) }, { ...placed, thought_id: "w" })
    .thoughts[0].text, "the muse barking", "only a whole-word match is fixed");
  // Not sure: "Did you mean …?" waits on the point, and the words stay as heard until it's answered.
  const asked = apply(said, { ...placed, heard: undefined, fixed: undefined, unclear: "muse bark", guess: "Muse Spark", decided: undefined }).thoughts[0];
  assert.deepEqual([asked.text, asked.unclear, asked.guess, asked.heard, asked.decided], ["ask muse bark about the lease", "muse bark", "Muse Spark", "", false]);
  // The mark read again after the words changed (decided.rs): on, then off.
  const marked = run(said, { ...placed, decided: false }, { type: "thought_decided", thought_id: "q", decided: true });
  assert.equal(marked.thoughts[0].decided, true);
  assert.equal(apply(marked, { type: "thought_decided", thought_id: "q", decided: false }).thoughts[0].decided, false);

  // Two topics in one turn: the thought keeps its first part, the rest follows it right after, to be placed next.
  const two = run(base, ...["a", "b"].map((id) => ({ type: "thought_added", thought: thought(id) })));
  const split = { type: "thought_split", thought_id: "a", text: "Rent is due Friday.", rest: thought("a2", { text: "Also call Mom." }) };
  assert.deepEqual(apply(two, split).thoughts.map((t) => [t.id, t.text]), [["a", "Rent is due Friday."], ["a2", "Also call Mom."], ["b", "b"]]);
  assert.equal(run(two, split, split).thoughts.length, 3, "sent twice: one rest");
  assert.equal(apply(two, { ...split, thought_id: "gone" }), two, "a thought taken back meanwhile: nothing");

  // Left off mid-sentence, by whoever said it; picked up again (new words there), it's open and no one's to finish.
  const left = apply(base, { type: "thread_status", thread_id: "T1", status: "dropped", speaker: "Speaker" }).threads[0];
  assert.deepEqual([left.status, left.dropped_by], ["dropped", "Speaker"]);
  const back = run(base, { type: "thread_status", thread_id: "T1", status: "dropped", speaker: "you" },
    { type: "thread_touched", thread_id: "T1", last_point: "Sentences. I never finish them", at_ms: 99 }).threads[0];
  assert.deepEqual([back.status, back.dropped_by, back.last_point, back.touched_ms], ["open", "", "Sentences. I never finish them", 99]);
  assert.equal(apply(base, { type: "thread_status", thread_id: "T1", status: "open", speaker: "you" }).threads[0].dropped_by, "");

  // Tags: suggested once however often it's sent, kept, removed; a thread from an older core without tags takes one.
  const tagged = run(base, ...[1, 2].map(() => ({ type: "tag_suggested", thread_id: "T1", tag: "school" })));
  assert.deepEqual(tagged.threads[0].tags, [{ name: "school", kept: false }]);
  assert.deepEqual(apply(tagged, { type: "tag_kept", thread_id: "T1", tag: "school" }).threads[0].tags, [{ name: "school", kept: true }]);
  assert.deepEqual(apply(tagged, { type: "tag_removed", thread_id: "T1", tag: "school" }).threads[0].tags, []);
  const old = { ...base, threads: [{ ...thread("T1"), tags: undefined }] };
  assert.deepEqual(apply(old, { type: "tag_suggested", thread_id: "T1", tag: "rent" }).threads[0].tags, [{ name: "rent", kept: false }]);

  // A picture reaches its card.
  assert.equal(apply(base, { type: "thread_picture", thread_id: "T3", path: "/images/T3-small.webp" }).threads[2].picture, "/images/T3-small.webp");

  // An idea or a reminder the AI proposes: on the thread, once; one made for a thread merged away lands where it went.
  const reminder = { id: "ac-1", thread_id: "T1", kind: "reminder", title: "Send rent", when: "2026-11-06", status: "new", done_ms: null };
  const idea = { id: "sg-1", thread_id: "T1", text: "Set up autopay", status: "new" };
  const proposed = run(base, { type: "action_proposed", action: reminder }, { type: "action_proposed", action: reminder },
    { type: "suggestion_added", suggestion: idea }, { type: "suggestion_added", suggestion: idea });
  assert.deepEqual([proposed.actions.length, proposed.suggestions.length], [1, 1], "each once");
  const merged = apply(base, { type: "thread_merged", from: "T1", into: "T2" });
  const late = run(merged, { type: "action_proposed", action: reminder }, { type: "suggestion_added", suggestion: idea },
    { type: "thought_added", thought: thought("x", { thread_id: "T1", placed: true }) },
    { type: "thread_added", thread: thread("T9", { parent_id: "T1" }) });
  assert.deepEqual([late.actions[0].thread_id, late.suggestions[0].thread_id, late.thoughts[0].thread_id, late.threads.at(-1).parent_id],
    ["T2", "T2", "T2", "T2"], "everything made for T1 lands on T2");

  // Your place, per speaker.
  assert.deepEqual(apply(base, { type: "active_changed", thread_id: "T3", speaker: "Colleague" }).active_by, { you: "T1", Colleague: "T3" });

  // A saved recap replaces the one for its period, and only that one.
  const recap = (period, summary) => ({ period, summary, since_ms: 0, through_ms: 1, generated_ms: 2, source_key: "", worked_on: [], plans: [],
    decisions: [], questions: [], unfinished: [], actions: [], thought_count: 1, thread_count: 1, limited: false });
  const recaps = run(base, { type: "recap_saved", recap: recap("today", "old") }, { type: "recap_saved", recap: recap("session", "s") },
    { type: "recap_saved", recap: recap("today", "new") }).recaps;
  assert.deepEqual(recaps.map((r) => [r.period, r.summary]), [["session", "s"], ["today", "new"]]);

  // Apps: kept once, switched, run, its loud-voice choice swapped (only on a volume app), removed; seeds once.
  const loud = { id: "app-volume", name: "Loud Silly Tune", purpose: "x", watcher: { kind: "volume", level: 0.12, seconds: 3 }, prompt: null,
    publishers: [{ kind: "sound" }], enabled: false, request: "", cooldown_secs: 60, created_ms: 0, last_run_ms: 0 };
  const card = { ...loud, id: "app-card", watcher: { kind: "topic", topic: "the demo" }, publishers: [{ kind: "card", text: "Demo!" }] };
  let apps = run(base, { type: "app_registered", app: loud }, { type: "app_registered", app: loud }, { type: "app_registered", app: card },
    { type: "app_enabled", id: "app-volume", enabled: true }, { type: "app_ran", id: "app-volume", at_ms: 42 }, { type: "apps_seeded" });
  assert.deepEqual([apps.apps.length, apps.apps[0].enabled, apps.apps[0].last_run_ms, apps.apps_seeded], [2, true, 42, true]);
  apps = run(apps, { type: "app_output", id: "app-volume", sound: false }, { type: "app_output", id: "app-card", sound: true });
  assert.deepEqual(apps.apps[0].publishers.map((p) => p.kind), ["card"], "calm card only");
  assert.match(apps.apps[0].purpose, /quiet pause/);
  assert.deepEqual(apps.apps[1].publishers, card.publishers, "a non-volume app keeps its own");
  assert.deepEqual(apply(apps, { type: "app_output", id: "app-volume", sound: true }).apps[0].publishers.map((p) => p.kind), ["sound", "card"]);
  assert.deepEqual(apply(apps, { type: "app_removed", id: "app-card" }).apps.map((a) => a.id), ["app-volume"]);

  // An import's record of what it read is the core's alone.
  assert.equal(apply(base, { type: "messages_read", at_ms: [1, 2] }), base);
  console.log("reducer-check: ok (placed, fixed once, did you mean, decided, split, left off and picked up, tags, pictures, proposals through a merge, recaps, apps)");
} finally {
  await server.close();
}
