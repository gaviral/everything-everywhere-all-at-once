//! Refiner: every so often, looks at the whole map in the background and tidies it:
//! better titles, merges of threads that are really one, one suggestion per branch,
//! and the tasks or events the talk decided on. Results arrive as ordinary changes.

use crate::tidy::{Kind, Proposal};
use crate::world::{Action, Change, ItemState, ItemStatus, Suggestion, Thread, Thought, World};
use crate::Core;
use anyhow::Context;
use serde::Deserialize;
use serde_json::json;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "You tidy a live map of spoken thoughts, from one person or a few in a room (then each point says who said it). \
Given the threads and their points, return JSON with: \
titles: better thread titles (up to 5 words), only where clearly better; a thread several people spoke on keeps a title that fits all their points; \
merges: threads that are really the same topic, merging the later id into the earlier; \
suggestions: at most one per thread and only when genuinely useful: a next step, a connection to another thread, or a question to explore, under 14 words; \
never one about a point marked (trailed off): the app brings unfinished thoughts back itself; \
actions: concrete tasks or events the speaker decided on or needs to do, kind \"reminder\" or \"event\", a short title, and when as YYYY-MM-DD if a date is stated or clearly implied, else empty; \
tags: short lowercase hashtags for the wider topic a thread belongs to, never a word already in its title (for example #money on \"Pay rent\", \
#hackathon on \"README draft\"), only for threads with fewer than 3 (each thread lists the ones it has), never one it has, reusing tags across threads when topics overlap. \
Dates like \"tomorrow\" or \"Friday\" are relative to the day a point was said. \
Never repeat an existing suggestion or action, including the cards apps leave (they start with the app's name). Use empty lists when nothing applies.";
/// What the answer's `questions` are, said in its schema rather than the rules above: there, it made the other ideas
/// half as many.
const QUESTIONS: &str = "For a point that flags a problem or a to-do without saying what it is (\"the budget part needs work\", \
\"the intro still bugs me\"): one concrete question that asks what (\"Which part of the budget needs work?\"), at most one per thread, \
never for a point marked (trailed off). Empty when no point is like that.";
/// What `retire` and `revise` are, said in the schema as `QUESTIONS` is. A plan said once and changed later
/// ("midterm is Wednesday, not Tuesday", "forget Lisbon, it got cancelled", "sent it, done") left its old idea or task
/// on the card and in Recap, in all four persona runs of 2026-11-01: the pass could only add.
const RETIRE: &str = "Open ideas and tasks (listed by id) that a later point cancels (\"forget Lisbon, the trip is off\"), \
reports done (\"sent the take-home\") or makes untrue (\"Dev dropped out\" for one with Dev): id, and why in the person's \
words, under 8 words. Never one only because it is old or not mentioned again. Empty when nothing applies.";
const REVISE: &str = "Open tasks and ideas (listed by id) whose day or words a later point corrects (\"midterm is Wednesday, \
not Tuesday\", \"launch moved to the 21st\"): id, the corrected title (an idea's whole text), when as YYYY-MM-DD (empty \
keeps its day), and why in under 8 words. Correct the open one rather than adding a new one. Empty when nothing applies.";
/// Tags on one thread, counting the ones it has: a pass only fills the gap.
const TAGS: usize = 3;
/// How long a pass gets, its whole answer included: twice what filling its 6,000-token room takes, by the placer's rule
/// (4 s and 8 ms a token), so a big first pass over an imported map still finishes. The 8 normal passes in the
/// 2026-11-01 log took 5–13 s; a pass still out at 52 s is hung: it fails and is redone at the next pause (`run`),
/// not two minutes on.
const PATIENCE: Duration = Duration::from_secs(52);

#[derive(Deserialize, Default)]
struct Pass {
    #[serde(default)]
    titles: Vec<Title>,
    #[serde(default)]
    merges: Vec<Merge>,
    #[serde(default)]
    suggestions: Vec<Idea>,
    /// What a vague point meant, asked (C222): one concrete question, which takes its thread's one idea.
    #[serde(default)]
    questions: Vec<Idea>,
    #[serde(default)]
    actions: Vec<Task>,
    #[serde(default)]
    tags: Vec<Tags>,
    /// Open ideas and tasks a later point cancelled, did or made untrue.
    #[serde(default)]
    retire: Vec<Retire>,
    /// Open ideas and tasks a later point corrected.
    #[serde(default)]
    revise: Vec<Revise>,
}

#[derive(Deserialize)]
struct Retire {
    id: String,
    #[serde(default)]
    why: String,
}

#[derive(Deserialize)]
struct Revise {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    when: String,
    #[serde(default)]
    why: String,
}

#[derive(Deserialize)]
struct Tags {
    thread_id: String,
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct Title {
    thread_id: String,
    title: String,
}

#[derive(Deserialize)]
struct Merge {
    from: String,
    into: String,
}

#[derive(Deserialize)]
struct Idea {
    thread_id: String,
    text: String,
}

#[derive(Deserialize)]
struct Task {
    thread_id: String,
    kind: String,
    title: String,
    #[serde(default)]
    when: String,
}

/// When a pass runs, working back from what the person needs:
/// - never mid-sentence, so nothing moves while they talk;
/// - at a natural pause (4 s quiet) once two new thoughts landed, or one started a new thread;
/// - right away when they come back to the window, so the map is tidy when they look;
/// - at most every 10 s (longer after failed passes), and only when something changed;
/// - a pass that comes back while they talk lands at the next pause (2 s quiet), not mid-sentence.
pub async fn run(core: Arc<Core>) {
    // Start from what the journal already holds, so a restart doesn't re-tidy the whole map.
    let start = core.snapshot();
    let (mut seen_thoughts, mut seen_threads, mut last_pass) =
        (start.thoughts.iter().filter(|t| t.placed).count(), start.threads.len(), crate::now_ms());
    let mut failures = 0;
    // What the next pass shows in full: threads changed after `since` (the start of the last pass that came
    // back), and those a capped pass left for later (`owed`). A failed pass moves neither, so its threads go again.
    let mut since = last_pass;
    let mut owed: HashSet<String> = HashSet::new();
    // A finished pass that came back while they were talking, with the map it was sent: it lands at the next pause.
    let mut held: Option<(Pass, Arc<World>)> = None;
    loop {
        tokio::select! {
            _ = core.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        let looked = core.take_looked();
        if let Some((waiting, sent)) = held.take() {
            if core.quiet_ms() < 2_000 {
                held = Some((waiting, sent));
                continue;
            }
            land(&core, waiting, &sent, "held back until this pause");
        }
        // The map's time: anything that changes after it is the next pass's.
        let at = crate::now_ms();
        let world = core.snapshot();
        let placed = world.thoughts.iter().filter(|t| t.placed).count();
        let new_thoughts = placed.saturating_sub(seen_thoughts);
        let new_threads = world.threads.len() > seen_threads;
        let quiet = core.quiet_ms() >= 4_000;
        let rested = crate::now_ms().saturating_sub(last_pass) >= rest_ms(failures);
        let due = new_thoughts > 0 && rested && ((quiet && (new_thoughts >= 2 || new_threads)) || looked);
        if !due || core.key().is_err() {
            continue;
        }
        (seen_thoughts, seen_threads, last_pass) = (placed, world.threads.len(), crate::now_ms());
        let (body, later) = request_in(&world, &Window { since, now: at, owed: &owed }, &chrono_today());
        if !later.is_empty() {
            tracing::info!("refiner pass leaves {} changed threads for later passes", later.len());
        }
        let result = pass(&core, body).await;
        let took = crate::now_ms().saturating_sub(last_pass);
        failures = if result.is_ok() { 0 } else { failures + 1 };
        settle(result.is_ok(), at, later, &mut since, &mut owed);
        match result {
            // Talking resumed while the model worked: move nothing under them; it lands at the next pause, a few
            // seconds on, rather than being thrown away and asked again (which took 15–20 s more in rehearsals).
            Ok(answer) if core.quiet_ms() < 2_000 => {
                tracing::info!("refiner pass in {took} ms: held back, talk resumed");
                held = Some((answer, world));
            }
            Ok(answer) => land(&core, answer, &world, &format!("in {took} ms")),
            // Redo it at the next pause rather than waiting for more talk.
            Err(e) => {
                tracing::warn!("refiner pass failed: {e:#}");
                seen_thoughts = 0;
            }
        }
    }
}

/// Puts a pass on the map. Checked against the map as it is now, not as it was sent (`sent`): an app's card or
/// reminder may have landed while the model worked (a second idea on that thread would only repeat it), a thread
/// merged, or a thread heard more (see `drop_stale_titles`).
fn land(core: &Core, mut answer: Pass, sent: &World, when: &str) {
    let world = core.snapshot();
    drop_stale_titles(&mut answer, sent, &world);
    let mut changes = changes(&world, answer);
    tracing::info!("refiner pass {when}: {} changes", changes.len());
    // An idea or task the person approved or dismissed while this was worked out is theirs: its correction is dropped,
    // checked under the commit's lock, so it never puts back a row that's being added (`as_left`).
    for _ in 0..3 {
        if changes.is_empty() || core.commit_if(|w| changes.iter().all(|c| as_left(w, c)), changes.clone()) {
            return;
        }
        let now = core.snapshot();
        changes.retain(|c| as_left(&now, c));
    }
}

/// True unless `c` corrects an idea or task that is no longer as the pass saw it.
fn as_left(world: &World, c: &Change) -> bool {
    match c {
        Change::ItemRefined { id, was, .. } => world.item_state(id).as_ref() == Some(was),
        _ => true,
    }
}

/// Leaves out titles for threads that heard words the pass didn't see: placed there since it was sent, or still
/// being placed (on the thread that was active when they were said). Those words may name the thread anew ("call
/// it Falcon", then "actually, call it Eagle" while the pass was out); the next pass sees them. So do withdrawals and
/// corrections of ideas and tasks on those threads ("Wednesday", then "no, Thursday" while the pass was out).
fn drop_stale_titles(pass: &mut Pass, sent: &World, now: &World) {
    let seen: HashSet<&str> = sent.thoughts.iter().filter(|t| t.placed).map(|t| t.id.as_str()).collect();
    let heard: HashSet<&str> =
        now.thoughts.iter().filter(|t| !seen.contains(t.id.as_str())).filter_map(|t| t.thread_id.as_deref()).collect();
    pass.titles.retain(|t| !heard.contains(t.thread_id.as_str()));
    // A short or full id; one on a thread that heard more, or any of two that share a short id, waits.
    let fresh = |given: &str| {
        let given = given.trim();
        let named = |id: &str| id == given || short(id) == given;
        !now.suggestions.iter().filter(|s| named(&s.id)).map(|s| &s.thread_id)
            .chain(now.actions.iter().filter(|a| named(&a.id)).map(|a| &a.thread_id))
            .any(|t| heard.contains(t.as_str()))
    };
    pass.retire.retain(|r| fresh(&r.id));
    pass.revise.retain(|r| fresh(&r.id));
}

/// The least time between passes: 10 s, doubling with each failed pass in a row up to about 5 min,
/// so a pass that keeps failing doesn't resend the whole map every 10 s for good.
fn rest_ms(failures: u32) -> u64 {
    10_000 << failures.min(5)
}

async fn pass(core: &Core, body: serde_json::Value) -> anyhow::Result<Pass> {
    let value = core.call_model(URL, &body, PATIENCE).await?;
    let content = value["choices"][0]["message"]["content"].as_str().context("no answer")?;
    serde_json::from_str(content).context("answer wasn't the expected JSON")
}

/// The suggestions and actions already on the map, so the model doesn't repeat them: the latest 30 of each
/// (dismissed ones too, which the person said no to), so the prompt doesn't grow with every idea ever shown.
fn existing(world: &World) -> Vec<String> {
    let suggestions = &world.suggestions[world.suggestions.len().saturating_sub(30)..];
    let actions = &world.actions[world.actions.len().saturating_sub(30)..];
    // One the refiner withdrew was no "no" from the person: it may come back corrected.
    let withdrawn = |id: &str| if withdrawn_by_ai(world, id) { " (withdrawn)" } else { "" };
    suggestions
        .iter()
        .map(|s| format!("suggestion on {}: {}{}", s.thread_id, s.text, withdrawn(&s.id)))
        .chain(actions.iter().map(|a| format!("action on {}: {} {}{}", a.thread_id, a.kind, a.title, withdrawn(&a.id))))
        .chain(world.proposals[world.proposals.len().saturating_sub(30)..].iter().map(|p| match p.kind {
            Kind::Rename => format!("title proposed for {}: {}", p.thread_id, p.title),
            Kind::Merge => format!("merge proposed: {} into {}", p.thread_id, p.into),
        }))
        .chain(world.titled.iter().filter(|id| world.thread(id).is_some()).map(|id| format!("title the person chose: {id}")))
        .chain(kept_apart(world).into_iter().map(|(a, b)| format!("threads the person keeps apart (never merge): {a} and {b}")))
        .collect()
}

/// True for an idea or task the refiner withdrew and nobody put back.
fn withdrawn_by_ai(world: &World, id: &str) -> bool {
    world.refined.get(id).is_some_and(|(now, _)| now.status == ItemStatus::Dismissed)
        && world.item_state(id).is_some_and(|s| s.status == ItemStatus::Dismissed)
}

/// The ideas and tasks a pass may withdraw or correct, each with a short id (`short`): the latest 30 of each still
/// waiting on the person (new), minus those the person put back after an earlier change. A task shows its day with
/// the weekday, which is what a correction names ("Wednesday, not Tuesday").
fn open_items(world: &World) -> Vec<String> {
    let open = |id: &str, status: ItemStatus| status == ItemStatus::New && !world.restored.contains(id);
    let ideas: Vec<&Suggestion> = world.suggestions.iter().filter(|s| open(&s.id, s.status)).collect();
    let tasks: Vec<&Action> = world.actions.iter().filter(|a| open(&a.id, a.status)).collect();
    let weekday = |when: &str| day_number(when).map(|n| {
        let d = WEEK[n.rem_euclid(7) as usize];
        format!(" on {when} ({}{})", d[..1].to_uppercase(), &d[1..])
    });
    ideas[ideas.len().saturating_sub(30)..].iter().map(|s| format!("{} on {}: idea \"{}\"", short(&s.id), s.thread_id, s.text))
        .chain(tasks[tasks.len().saturating_sub(30)..].iter().map(|a| {
            format!("{} on {}: {} \"{}\"{}", short(&a.id), a.thread_id, a.kind, a.title, weekday(&a.when).unwrap_or_default())
        }))
        .collect()
}

/// An item's id as the model sees it: its prefix and 6 of its hex digits ("ac-1a2b3c"), ≈ 4 tokens instead of ≈ 20;
/// two items share one 1 time in 16 million, and then neither is changed (`refine`).
fn short(id: &str) -> &str {
    match id.split_once('-') {
        Some((prefix, rest)) if rest.len() > 6 && rest.is_ascii() => &id[..prefix.len() + 7],
        _ => id,
    }
}

/// Pairs of threads on the map that the person set apart by moving a thought between them (`World::apart`), each
/// once, in the order they were made.
fn kept_apart(world: &World) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (_, from, to) in &world.moves {
        let (a, b) = (world.resolve(from), world.resolve(to));
        let on_map = a != b && world.thread(&a).is_some() && world.thread(&b).is_some();
        if on_map && world.apart(&a, &b) && !pairs.iter().any(|(x, y)| (*x == a && *y == b) || (*x == b && *y == a)) {
            pairs.push((a, b));
        }
    }
    pairs
}

/// After a pass: one that came back moves the window to its map's time and owes what it left out; a failed one
/// moves neither, so its threads go again.
fn settle(ok: bool, at: u64, later: Vec<String>, since: &mut u64, owed: &mut HashSet<String>) {
    if ok {
        (*since, *owed) = (at, later.into_iter().collect());
    }
}

/// `request_in` for one pass after `since`, with nothing owed (the live checks send what a pass sends).
#[cfg(test)]
fn request(world: &World, since: u64, today: &str) -> serde_json::Value {
    request_in(world, &Window { since, now: crate::now_ms(), owed: &HashSet::new() }, today).0
}

/// What a pass sends: the rules, today's date ("YYYY-MM-DD (Weekday)"), the bounded map and what's already on
/// it; and the changed threads left for a later pass.
fn request_in(world: &World, window: &Window, today: &str) -> (serde_json::Value, Vec<String>) {
    let (map, later) = describe_in(world, window, today);
    let existing = existing(world);
    let body = json!({
        "model": std::env::var("REFINER_MODEL").unwrap_or_else(|_| "muse-spark-1.3".into()),
        "reasoning_effort": "low",
        "max_tokens": 6000,
        "prompt_cache_key": "e2a2o-refiner",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Today is {today}.\n{map}\nAlready on the map:\n{}\nOpen ideas and tasks (id on thread: what):\n{}", existing.join("\n"), open_items(world).join("\n"))},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "Pass", "schema": {
            "type": "object",
            "properties": {
                "titles": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "title": {"type": "string"}}, "required": ["thread_id", "title"]}},
                "merges": {"type": "array", "items": {"type": "object", "properties": {"from": {"type": "string"}, "into": {"type": "string"}}, "required": ["from", "into"]}},
                "suggestions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "text": {"type": "string"}}, "required": ["thread_id", "text"]}},
                "questions": {"type": "array", "description": QUESTIONS, "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "text": {"type": "string"}}, "required": ["thread_id", "text"]}},
                "actions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "kind": {"type": "string", "enum": ["reminder", "event"]}, "title": {"type": "string"}, "when": {"type": "string"}}, "required": ["thread_id", "kind", "title", "when"]}},
                "tags": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["thread_id", "tags"]}},
                "retire": {"type": "array", "description": RETIRE, "items": {"type": "object", "properties": {"id": {"type": "string"}, "why": {"type": "string"}}, "required": ["id", "why"]}},
                "revise": {"type": "array", "description": REVISE, "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "when": {"type": "string"}, "why": {"type": "string"}}, "required": ["id", "title", "when", "why"]}}
            },
            "required": ["titles", "merges", "suggestions", "questions", "actions", "tags", "retire", "revise"]
        }}}
    });
    (body, later)
}

/// At most this many threads go in with their latest points in one pass: the demo's whole talk (≈ 10 threads)
/// fits in one, and between two passes (≥ 10 s apart) one person touches 1-3. Any more changed threads wait for
/// the next pass, latest first.
const BUSY_THREADS: usize = 12;
/// …and at most about this many tokens of them: 12 threads × 8 points × ≈ 60 tokens (a spoken point of ≈ 45
/// words). An imported message runs to 2,000 characters, so a few long ones fill it sooner. The latest changed
/// thread always goes in, whatever its size.
const BUSY_TOKENS: usize = 6_000;
/// The quiet one-line threads, latest-touched first, up to about this many tokens: ≈ 375 lines at the measured
/// ≈ 32 tokens a line, so a 300-thread imported history goes in whole; on a bigger map the threads untouched the
/// longest are left out (they still keep their titles; a pass just can't merge into them).
const QUIET_TOKENS: usize = 12_000;
/// A rough token count for English text, enough to keep a prompt under a budget.
const CHARS_PER_TOKEN: usize = 4;
/// The longest date a point's line carries.
const SAID: &str = " (said YYYY-MM-DD)";

/// Which threads a pass shows with their latest points: those that changed after `since` (a time no later
/// than `now`; a time ahead of the clock counts as long ago, as in `Thought::said_at`, so a wrong clock can't
/// mark every thread changed), the active one, and those an earlier capped pass left for later (`owed`).
pub(crate) struct Window<'a> {
    pub since: u64,
    pub now: u64,
    pub owed: &'a HashSet<String>,
}

/// The map as the refiner sees it, bounded however big the map gets: the changed threads (see `Window`), up to
/// `BUSY_THREADS` and `BUSY_TOKENS`, latest first, with their latest 8 thoughts; the rest as one line each, the
/// latest-touched up to `QUIET_TOKENS`, which is enough for titles and merges. The quiet lines come first, in
/// map order, so the cached prefix lasts longer. Each thread shows its tags, and with more than one speaker (a
/// room) each thought says who said it. Older points carry their local said date, including the last point in
/// a quiet line. Returns the text and the changed threads left for a later pass.
fn describe_in(world: &World, window: &Window, today: &str) -> (String, Vec<String>) {
    let now = window.now;
    // Each thread's placed points in map order, gathered once: per thread, a scan of every thought took 9.8 s
    // at 1,000 threads (2026-11-01).
    let mut on: HashMap<&str, Vec<&Thought>> = HashMap::new();
    for p in world.thoughts.iter().filter(|p| p.placed) {
        if let Some(id) = p.thread_id.as_deref() {
            on.entry(id).or_default().push(p);
        }
    }
    let points = |t: &Thread| -> &[&Thought] { on.get(t.id.as_str()).map_or(&[], |v| v.as_slice()) };
    let clamp = |ms: u64| if ms > now { 0 } else { ms };
    let latest = |t: &Thread| points(t).iter().map(|p| clamp(p.at_ms)).fold(clamp(t.touched_ms), u64::max);
    let active = |t: &Thread| world.active.as_deref() == Some(t.id.as_str());
    // Owed ids as they are now: a thread owed a full pass and merged since passes the debt to the thread it joined.
    let owed: HashSet<String> = window.owed.iter().map(|id| world.resolve(id)).collect();
    let changed = |t: &Thread| active(t) || latest(t) > window.since || owed.contains(&t.id);
    let parent = |t: &Thread| t.parent_id.clone().unwrap_or_else(|| "none".into());
    let tags = |t: &Thread| {
        if t.tags.is_empty() { String::new() } else { format!(" tags: {}", t.tags.iter().map(|g| g.name.as_str()).collect::<Vec<_>>().join(" ")) }
    };
    let named = world.thoughts.iter().map(|p| p.speaker.as_str()).collect::<HashSet<_>>().len() > 1;
    // A local day costs a run of `date` (≈ 1 ms), so each is asked once per 15 minutes of UTC: every zone's
    // midnight falls on a quarter hour, so one quarter hour is one local day.
    let days: RefCell<HashMap<u64, Option<String>>> = RefCell::default();
    let dated = |p: &Thought| {
        let day = days.borrow_mut().entry(p.at_ms / 900_000).or_insert_with(|| said_on(p)).clone();
        day.filter(|day| today.get(..10).is_some_and(|now| day.as_str() < now))
            .map(|day| format!(" (said {day})")).unwrap_or_default()
    };
    let undated = |p: &Thought| {
        let who = if named { format!("{}: ", p.speaker) } else { String::new() };
        // A thought that trailed off is the unfinished card's to bring back, so the model is told which ones did.
        format!("  - {who}{}{}", p.text, if p.complete { "" } else { " (trailed off)" })
    };
    let line = |p: &Thought| undated(p) + &dated(p);
    let tokens = |text: &str| text.len().div_ceil(CHARS_PER_TOKEN);

    // The changed threads, the active one first, then latest first; full until either cap, the rest owed.
    let mut wanted: Vec<(usize, &Thread)> = world.threads.iter().enumerate().filter(|(_, t)| changed(t)).collect();
    wanted.sort_by_key(|&(i, t)| (!active(t), std::cmp::Reverse(latest(t)), i));
    let (mut busy, mut later, mut spent) = (Vec::new(), Vec::new(), 0);
    for (_, t) in wanted {
        if busy.len() == BUSY_THREADS {
            later.push(t.id.clone());
            continue;
        }
        let all = points(t);
        let last = &all[all.len().saturating_sub(8)..];
        let head = format!("{}: {} (parent: {}){}", t.id, t.title, parent(t), tags(t));
        // Sized without dates, each counted at its longest, so a thread left for later costs no `date` run:
        // with 1,000 big changed threads, sizing each with its dates ran up to 8,000 of them (≈ 1 ms each).
        let most = (head.len() + last.iter().map(|p| 1 + undated(p).len() + SAID.len()).sum::<usize>()).div_ceil(CHARS_PER_TOKEN);
        if !busy.is_empty() && spent + most > BUSY_TOKENS {
            later.push(t.id.clone());
            continue;
        }
        let text = format!("{head}\n{}", last.iter().map(|p| line(p)).collect::<Vec<_>>().join("\n"));
        spent += tokens(&text);
        busy.push(text);
    }
    let left: HashSet<&str> = later.iter().map(String::as_str).collect();
    let full: HashSet<&str> = world.threads.iter().filter(|t| changed(t) && !left.contains(t.id.as_str())).map(|t| t.id.as_str()).collect();

    // The rest as one line each, the latest-touched while they fit (each written only if it is reached), shown
    // in map order.
    let mut rest: Vec<(usize, &Thread)> = world.threads.iter().enumerate().filter(|(_, t)| !full.contains(t.id.as_str())).collect();
    rest.sort_by_key(|&(i, t)| (std::cmp::Reverse(latest(t)), i));
    let (mut quiet, mut spent) = (Vec::new(), 0);
    for &(i, t) in &rest {
        let said = points(t).iter().rev().find(|p| p.point == t.last_point || p.text == t.last_point)
            .map(|p| dated(p)).unwrap_or_default();
        let text = format!("{}: {} (parent: {}){} last: {}{said}", t.id, t.title, parent(t), tags(t), t.last_point);
        spent += tokens(&text) + 1;
        if spent > QUIET_TOKENS {
            break;
        }
        quiet.push((i, text));
    }
    let left_out = rest.len() - quiet.len();
    quiet.sort_by_key(|&(i, _)| i);
    let quiet: Vec<String> = quiet.into_iter().map(|(_, text)| text).collect();
    let older = if left_out > 0 { format!("\n({left_out} threads untouched longer are left out)") } else { String::new() };
    let text = format!(
        "Quiet threads (title, parent, last point):\n{}{older}\nRecently active threads, with their latest points:\n{}",
        quiet.join("\n"),
        busy.join("\n")
    );
    (text, later)
}

/// `describe_in` for one pass after `since`, with nothing owed.
#[cfg(test)]
fn describe(world: &World, since: u64, today: &str) -> String {
    describe_in(world, &Window { since, now: crate::now_ms(), owed: &HashSet::new() }, today).0
}

fn changes(world: &World, pass: Pass) -> Vec<Change> {
    changes_on(world, pass, &chrono_today())
}

/// The answer as changes, keeping only what a person wouldn't undo; `today` is "YYYY-MM-DD (Weekday)".
fn changes_on(world: &World, mut pass: Pass, today: &str) -> Vec<Change> {
    let exists = |id: &str| world.thread(id).is_some();
    // Ids are the map's internals: an idea, task or title that names one ("before recording T3 setup") is left out.
    let names_an_id = |text: &str| text.split(|c: char| !c.is_alphanumeric()).any(|w| !w.is_empty() && world.thread(&world.resolve(w)).is_some());
    // Ideas and tasks a later point withdrew or corrected go first, so the card reads in the order it changed.
    let mut out = refine(world, std::mem::take(&mut pass.retire), std::mem::take(&mut pass.revise), today, &names_an_id);
    // Withdrawn in this pass or an earlier one by the refiner: no "no" from the person, so a corrected one may follow.
    let withdrawn: HashSet<String> = out.iter()
        .filter_map(|c| match c {
            Change::ItemRefined { id, now, .. } if now.status == ItemStatus::Dismissed => Some(id.clone()),
            _ => None,
        })
        .chain(world.suggestions.iter().map(|s| &s.id).chain(world.actions.iter().map(|a| &a.id)).filter(|id| withdrawn_by_ai(world, id)).cloned())
        .collect();
    for t in pass.titles {
        // A new title is short and more than a change of case, and a name the person gave stays theirs
        // ("we're calling this Project Falcon"), unless they later gave it the proposed name.
        let keep = |th: &Thread| {
            // Said order, including cues within a thought; split thoughts can share a timestamp.
            let last_named = |title: &str| {
                said_in(world, &th.id).enumerate().filter_map(|(i, text)| named_at(title, text).map(|at| (i, at))).last()
            };
            words(&t.title) == words(&th.title)
                || last_named(&th.title).is_some_and(|old| !last_named(&t.title).is_some_and(|new| new > old))
        };
        // A title the person chose is theirs (tidy.rs).
        if t.title.split_whitespace().count() > 5 || world.thread(&t.thread_id).is_some_and(keep) || world.titled.contains(&t.thread_id) {
            continue;
        }
        let current = world.thread(&t.thread_id).map(|th| th.title.as_str());
        let title = t.title.trim();
        if exists(&t.thread_id) && !title.is_empty() && current != Some(title) && !names_an_id(title) {
            if sure_title(world, &t.thread_id, title) {
                out.push(Change::ThreadRetitled { thread_id: t.thread_id, title: title.into(), was: current.unwrap_or_default().into() });
            } else if !world.proposals.iter().any(|p| p.kind == Kind::Rename && p.thread_id == t.thread_id && (p.status == ItemStatus::New || words(&p.title) == words(title))) {
                out.push(proposal(Kind::Rename, &t.thread_id, title, ""));
            }
        }
    }
    // A merge is never sure: each is proposed on the card of the thread that would go, once
    // per pair and one at a time. A thread never goes into its own branch, which would make the branch its own parent
    // and drop it from the map, and two threads with no word in common aren't one topic. Two threads the person set
    // apart by moving a thought from one to the other stay apart (moves.rs).
    let mut proposed: Vec<(String, String)> = world.proposals.iter().filter(|p| p.kind == Kind::Merge).map(|p| (p.thread_id.clone(), world.resolve(&p.into))).collect();
    let mut waits = HashSet::new();
    for m in pass.merges {
        let (from, into) = (world.resolve(&m.from), world.resolve(&m.into));
        let shared = || !vocabulary(world, &from).is_disjoint(&vocabulary(world, &into));
        let waiting = world.proposals.iter().any(|p| p.kind == Kind::Merge && p.thread_id == from && p.status == ItemStatus::New) || waits.contains(&from);
        let asked = proposed.iter().any(|(a, b)| (*a == from && *b == into) || (*a == into && *b == from));
        if from != into && exists(&from) && exists(&into) && !above(world, &from, &into) && !world.apart(&from, &into) && shared() && !waiting && !asked {
            proposed.push((from.clone(), into.clone()));
            waits.insert(from.clone());
            out.push(proposal(Kind::Merge, &from, "", &into));
        }
    }
    // One idea per thread, an app's card included, and one per thread in a pass too.
    let mut suggested = HashSet::new();
    let questions = pass.questions.into_iter().filter(|q| q.text.trim_end().ends_with('?')).map(|q| (q, true));
    for (s, asks) in questions.chain(pass.suggestions.into_iter().map(|s| (s, false))) {
        // Never an idea that only says again what the person said on that thread; the question asking what a vague
        // point meant ("What feels off about the first screen?") reuses its words by nature.
        if !asks && said_in(world, &s.thread_id).any(|text| repeats(&s.text, text)) {
            continue;
        }
        let repeated = world.suggestions.iter().any(|x| x.thread_id == s.thread_id && x.status != ItemStatus::Dismissed && !withdrawn.contains(x.id.as_str()));
        if exists(&s.thread_id) && !s.text.trim().is_empty() && !repeated && !names_an_id(&s.text) && suggested.insert(s.thread_id.clone()) {
            out.push(Change::SuggestionAdded {
                suggestion: Suggestion { id: new_id("sg"), thread_id: s.thread_id, text: s.text.trim().into(), status: ItemStatus::New },
            });
        }
    }
    for mut a in pass.actions {
        // Never a past day, and the day they named for it; see `day`.
        let (said, point) = about(world, &a.thread_id, &a.title);
        let said_on = point.and_then(said_on);
        a.when = day(a.when.trim(), &said, today, said_on.as_deref().unwrap_or(today));
        // A real day only: "Saturday" would show as an invalid date, and "2026-11-31" would become December 1.
        let when = Some(a.when.trim()).filter(|w| crate::apps::valid_date(w)).unwrap_or_default();
        // The map and earlier actions in this pass share one guard, across reminders and events.
        let normalized = |text: &str| words(&text.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>());
        let title = normalized(&a.title);
        let repeated = world.actions.iter().filter(|x| !withdrawn.contains(x.id.as_str())).chain(out.iter().filter_map(|c| match c {
            Change::ActionProposed { action } => Some(action),
            _ => None,
        })).any(|x| {
            let other = normalized(&x.title);
            x.thread_id == a.thread_id && !title.is_empty() && !other.is_empty()
                && (title == other || (!when.is_empty() && x.when == when
                    && (title.iter().all(|w| other.contains(w)) || other.iter().all(|w| title.contains(w)))))
        });
        if exists(&a.thread_id) && !a.title.trim().is_empty() && !repeated && !names_an_id(&a.title) {
            out.push(Change::ActionProposed {
                action: Action {
                    id: new_id("ac"),
                    thread_id: a.thread_id,
                    // An event needs a date; without one it's a reminder rather than an invented day.
                    kind: if a.kind == "event" && !when.is_empty() { "event".into() } else { "reminder".into() },
                    title: a.title.trim().into(),
                    when: when.into(),
                    status: ItemStatus::New,
                    done_ms: None,
                },
            });
        }
    }
    // Each thread's tags so far, the ones it has and the ones this pass adds, so it never passes `TAGS`.
    let mut tagged: HashMap<&str, Vec<String>> = HashMap::new();
    for group in pass.tags {
        let Some(thread) = world.thread(&group.thread_id) else { continue };
        let names = tagged.entry(thread.id.as_str()).or_insert_with(|| thread.tags.iter().map(|t| t.name.clone()).collect());
        // Its title and any this pass gives it: a tag of only their words (#demo on "Demo Opening Hook") adds nothing.
        let titles: Vec<String> = std::iter::once(thread.title.clone())
            .chain(out.iter().filter_map(|c| match c {
                Change::ThreadRetitled { thread_id, title, .. } if *thread_id == thread.id => Some(title.clone()),
                Change::TidyProposed { proposal: p } if p.thread_id == thread.id && p.kind == Kind::Rename => Some(p.title.clone()),
                _ => None,
            }))
            .collect();
        for raw in group.tags {
            let word: String = raw.trim().trim_start_matches('#').to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
            let tag = format!("#{word}");
            if names.len() >= TAGS || word.is_empty() || names.contains(&tag) || titles.iter().any(|t| in_title(&word, t)) {
                continue;
            }
            names.push(tag.clone());
            out.push(Change::TagSuggested { thread_id: thread.id.clone(), tag });
        }
    }
    out
}

/// Open ideas and tasks brought in line with what was said after them: withdrawn (`retire`: cancelled, done, no
/// longer true) or corrected in place (`revise`: a new day or wording, the same row, so the card doesn't grow a
/// second one beside the stale one). Only while an item still waits on the person (new: not kept, being added, added
/// or dismissed by them), never one they put back after an earlier change, each once a pass, and each with its
/// reason, which the note shows beside Undo: a change without one is a guess. A corrected day is checked as a new
/// task's is (`day`); a correction that would make it the same as another open task on its thread withdraws it.
fn refine(world: &World, retire: Vec<Retire>, revise: Vec<Revise>, today: &str, names_an_id: &dyn Fn(&str) -> bool) -> Vec<Change> {
    // The open item a short or full id names, with its thread and whether it's a task; none when two share it.
    let find = |given: &str| -> Option<(String, String, bool, ItemState)> {
        let given = given.trim();
        let open = |id: &str, status: ItemStatus| status == ItemStatus::New && !world.restored.contains(id) && (id == given || short(id) == given);
        let mut found = world.suggestions.iter().filter(|s| open(&s.id, s.status)).map(|s| (s.id.clone(), s.thread_id.clone(), false))
            .chain(world.actions.iter().filter(|a| open(&a.id, a.status)).map(|a| (a.id.clone(), a.thread_id.clone(), true)));
        let (id, thread, task) = found.next()?;
        if found.next().is_some() {
            return None;
        }
        let was = world.item_state(&id)?;
        Some((id, thread, task, was))
    };
    let reason = |why: &str| Some(why.trim().to_string()).filter(|w| !w.is_empty() && !names_an_id(w));
    let mut out: Vec<Change> = Vec::new();
    let mut touched: HashSet<String> = HashSet::new();
    let normalized = |text: &str| words(&text.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>());
    for r in retire {
        let (Some((id, _, _, was)), Some(why)) = (find(&r.id), reason(&r.why)) else { continue };
        if touched.insert(id.clone()) {
            out.push(Change::ItemRefined { id, now: ItemState { status: ItemStatus::Dismissed, ..was.clone() }, was, why });
        }
    }
    for r in revise {
        let (Some((id, thread, task, was)), Some(why)) = (find(&r.id), reason(&r.why)) else { continue };
        if touched.contains(&id) {
            continue;
        }
        let text = Some(r.title.trim()).filter(|t| !t.is_empty() && !names_an_id(t)).unwrap_or(&was.text).to_string();
        let when = match r.when.trim() {
            "" => was.when.clone(),
            asked if task => {
                let (said, point) = corrected_in(world, &thread, &[&text, &was.text]);
                let said_on = point.and_then(said_on);
                match day(asked, &said, today, said_on.as_deref().unwrap_or(today)) {
                    d if crate::apps::valid_date(&d) => d,
                    // Not a day they named: left as it was rather than shown wrong.
                    _ => continue,
                }
            }
            _ => String::new(),
        };
        if text == was.text && when == was.when {
            continue;
        }
        // Against each task as this pass leaves it: two rows corrected to the same day in one pass are twins too.
        let twin = task && world.actions.iter().any(|a| {
            let after = out.iter().rev().find_map(|c| match c {
                Change::ItemRefined { id, now, .. } if *id == a.id => Some(now.clone()),
                _ => None,
            });
            let ItemState { status, text: title, when: day } = after.unwrap_or(ItemState { status: a.status, text: a.title.clone(), when: a.when.clone() });
            a.id != id && a.thread_id == thread && status != ItemStatus::Dismissed && day == when && normalized(&title) == normalized(&text)
        });
        let now = if twin { ItemState { status: ItemStatus::Dismissed, ..was.clone() } } else { ItemState { status: was.status, text, when } };
        touched.insert(id.clone());
        out.push(Change::ItemRefined { id, now, was, why });
    }
    out
}

/// The Undo on the note about a withdrawn or corrected idea or task: it is as it was before, and the refiner leaves
/// it alone after. Only while it's still as the refiner left it: one kept, added or dismissed since is the person's
/// own call already.
pub fn restore(core: &Core, id: &str) {
    let Some(left) = core.snapshot().refined.get(id).cloned() else { return };
    // Checked under the commit's lock: an approval or a newer correction between the look and the commit stays.
    let as_left = |w: &World| w.refined.get(id) == Some(&left) && w.item_state(id).as_ref() == Some(&left.0);
    core.commit_if(as_left, vec![Change::ItemRestored { id: id.into(), to: left.1.clone() }]);
}

/// A rename the refiner makes on its own, without asking: the person's own words for the thread. Every word of the new
/// title that carries meaning was said on the thread, and on a thread of two or more points they come from at least
/// two of them, so the title speaks for the thread and not for one point; or the person named it so in so many words.
/// Measured on the refiner's own answers: of the 24 different renames it gave on sample,
/// crafted and real maps, this makes 8 at once (7 a person would keep, 1 neither better nor worse) and asks the other
/// 16, all 8 a person would undo among them ("Year-end admin tasks" for taxes and a car registration, "Everything App
/// Demo Vision" for eye tracking): those used words nobody said, or spoke for one point of ten.
pub(crate) fn sure_title(world: &World, thread: &str, title: &str) -> bool {
    let points: Vec<&str> = said_in(world, thread).collect();
    // Named so in the last point that names anything ("call it Falcon", not "call it Falcon … actually, call it Eagle").
    let naming = |p: &&str| words(p).iter().any(|w| CUES.contains(&w.as_str()));
    if points.iter().rposition(naming).is_some_and(|i| named_at(title, points[i]).is_some_and(|at| !words(points[i])[at..].iter().skip(1).any(|w| CUES.contains(&w.as_str())))) {
        return true;
    }
    let wanted = content(title);
    let said: HashSet<String> = points.iter().flat_map(|p| content(p)).collect();
    let speaking = points.iter().filter(|p| !content(p).is_disjoint(&wanted)).count();
    !wanted.is_empty() && wanted.is_subset(&said) && (points.len() < 2 || speaking >= 2)
}

fn proposal(kind: Kind, thread: &str, title: &str, into: &str) -> Change {
    Change::TidyProposed {
        proposal: Proposal { id: new_id("tp"), kind, thread_id: thread.into(), title: title.into(), into: into.into(), status: ItemStatus::New },
    }
}

/// True when `id` is `of`'s parent, or its parent's, and so on up.
pub(crate) fn above(world: &World, id: &str, of: &str) -> bool {
    let mut parent = world.thread(of).and_then(|t| t.parent_id.clone());
    // At most one step per thread, so a corrupt journal with a cycle can't loop forever.
    for _ in 0..world.threads.len() {
        match parent {
            Some(p) if p == id => return true,
            Some(p) => parent = world.thread(&p).and_then(|t| t.parent_id.clone()),
            None => return false,
        }
    }
    false
}

/// What the person said on a thread, in order.
fn said_in<'a>(world: &'a World, id: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    world.thoughts.iter().filter(move |p| p.placed && p.thread_id.as_deref() == Some(id)).map(|p| p.text.as_str())
}

/// The last cue for a name they gave in so many words: "we're calling this Project Falcon", "call it Garden Project",
/// "it's called Falcon"; not just words they used ("I need to file the quarterly taxes").
const CUES: [&str; 7] = ["call", "calling", "called", "name", "named", "title", "titled"];

fn named_at(title: &str, text: &str) -> Option<usize> {
    let (title, text) = (words(title), words(text));
    if title.is_empty() {
        return None;
    }
    text.windows(title.len()).enumerate().rev().find_map(|(i, w)| {
        if w != title.as_slice() {
            return None;
        }
        let start = i.saturating_sub(2);
        let cue = text[start..i].iter().rposition(|c| CUES.contains(&c.as_str())).map(|at| start + at)?;
        // "Don't call it X" or "never name it X" turns a name down instead of giving it.
        const NOT: [&str; 6] = ["don", "dont", "not", "never", "stop", "shouldn"];
        let refused = text[cue.saturating_sub(2)..cue].iter().any(|w| NOT.contains(&w.as_str()));
        (!refused).then_some(cue)
    })
}

/// The words that carry a thread's meaning (see `content`): its title's and what was said on it.
fn vocabulary(world: &World, id: &str) -> HashSet<String> {
    world.thread(id).map(|t| t.title.as_str()).into_iter().chain(said_in(world, id)).flat_map(content).collect()
}

/// What was said about an action: its title, and the sentences on its thread with the most of its words
/// ("the water bill is due on the fifteenth", not "I paid the gas bill last Friday"), with their source point.
fn about<'a>(world: &'a World, thread: &'a str, title: &'a str) -> (Vec<&'a str>, Option<&'a Thought>) {
    let words = content(title);
    let sentences: Vec<(&str, usize, &Thought)> = world.thoughts.iter()
        .filter(|p| p.placed && p.thread_id.as_deref() == Some(thread))
        .flat_map(|p| {
            let words = &words;
            p.text.split(['.', '!', '?', ';']).map(move |s| (s, content(s).intersection(words).count(), p))
        })
        .collect();
    let most = sentences.iter().map(|(_, n, _)| *n).max().unwrap_or(0);
    let point = sentences.iter().find(|(_, n, _)| most > 0 && *n == most).map(|(_, _, p)| *p);
    let said = std::iter::once(title).chain(sentences.into_iter().filter(|(_, n, _)| most > 0 && *n == most).map(|(s, _, _)| s)).collect();
    (said, point)
}

/// What a correction of a task is checked against: its title and the latest point on its thread that shares a word
/// with its old or new title, the correcting one ("midterm is Wednesday, not Tuesday" after "Biology midterm is
/// Tuesday", which `about` would pick for having more of the words), with that point.
fn corrected_in<'a>(world: &'a World, thread: &str, titles: &[&'a str]) -> (Vec<&'a str>, Option<&'a Thought>) {
    let words: HashSet<String> = titles.iter().flat_map(|t| content(t)).collect();
    let point = world.thoughts.iter().enumerate()
        .filter(|(_, p)| p.placed && p.thread_id.as_deref() == Some(thread) && !content(&p.text).is_disjoint(&words))
        .max_by_key(|(i, p)| (p.at_ms, *i))
        .map(|(_, p)| p);
    (titles.iter().take(1).copied().chain(point.map(|p| p.text.as_str())).collect(), point)
}

/// The thought's local calendar day; a missing timestamp leaves the old today-based behavior in place.
fn said_on(point: &Thought) -> Option<String> {
    if point.at_ms == 0 { return None; }
    crate::clock::local(point.at_ms).map(|local| local[..10].to_string())
}

/// Lowercase words without punctuation: "Mom's birthday!" is mom, s, birthday.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// A word without its ending, so "bills", "recording" and "organizes" meet "bill", "record" and "organizing".
fn stem(word: &str) -> String {
    let mut w = word.to_string();
    if let Some(end) = ["ing", "ed", "es", "s"].iter().find(|end| w.len() >= end.len() + 3 && w.ends_with(*end) && !w.ends_with("ss")) {
        w.truncate(w.len() - end.len());
    }
    // planning → plann → plan, organize → organiz
    let b = w.as_bytes();
    if b.len() >= 4 && b[b.len() - 1] == b[b.len() - 2] {
        w.pop();
    }
    if w.len() >= 4 && w.ends_with('e') {
        w.pop();
    }
    w
}

/// Words too common to tell two things apart.
const COMMON: [&str; 44] = [
    "a", "an", "the", "to", "of", "for", "and", "or", "but", "in", "on", "at", "by", "with", "about", "from", "is", "are", "be", "it",
    "its", "this", "that", "i", "you", "we", "my", "your", "our", "me", "need", "should", "will", "can", "so", "if", "do", "get", "just",
    "also", "up", "s", "ll", "oh",
];

/// The words of a text that carry its meaning, stemmed.
fn content(text: &str) -> HashSet<String> {
    words(text).iter().filter(|w| !COMMON.contains(&w.as_str())).map(|w| stem(w)).collect()
}

/// An idea that mostly says again what was said: at least two of its words, and 60% of them, in one point.
fn repeats(idea: &str, said: &str) -> bool {
    let (idea, said) = (content(idea), content(said));
    let shared = idea.intersection(&said).count();
    shared >= 2 && shared * 10 >= idea.len() * 6
}

/// A tag word that's a word of the title, or a few of them run together (#electricbill on "Electric bill").
fn in_title(tag: &str, title: &str) -> bool {
    let title: Vec<String> = words(title).iter().map(|w| stem(w)).collect();
    let parts: Vec<String> = tag.split('-').filter(|p| !p.is_empty()).map(stem).collect();
    let joined = stem(&tag.replace('-', ""));
    (!parts.is_empty() && parts.iter().all(|p| title.contains(p))) || (2..=title.len()).any(|n| title.windows(n).any(|w| stem(&w.concat()) == joined))
}

/// Days since 1970-01-01 for a real YYYY-MM-DD day.
fn day_number(date: &str) -> Option<i64> {
    if !crate::apps::valid_date(date) {
        return None;
    }
    let n = |r: std::ops::Range<usize>| date[r].parse::<i64>().ok();
    Some(crate::import::days_from_civil(n(0..4)?, n(5..7)?, n(8..10)?))
}

/// Day 0, 1970-01-01, was a Thursday.
const WEEK: [&str; 7] = ["thursday", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday"];

/// An action's day as the person would keep it, else none (`said`: the action's title and what they said about it):
/// - a real day: "Saturday" would show as an invalid date, and "2026-11-31" would become December 1;
/// - never past: a past day is the model slipping the year (2025-11-10 when it's 2026), so it's the same day at its
///   nearest occurrence, unless that's the one that just went by, which is no day to remind anyone of;
/// - the day they named: when their words name one ("Friday", "next Tuesday", "tomorrow"), the date is on it;
///   relative to `said_on`, not the import day. A different date is dropped rather than shown wrong.
fn day(when: &str, said: &[&str], today: &str, said_on: &str) -> String {
    let Some(mut date) = day_number(when) else { return String::new() };
    // Without today's date (no `date` command) there's nothing to check against.
    let Some(now) = today.get(..10).and_then(day_number) else { return when.into() };
    let said_day = said_on.get(..10).and_then(day_number).unwrap_or(now);
    if date < now {
        let year = |days: i64| crate::import::civil_from_days(days).0;
        let nearest = (-1..=1).filter_map(|y| day_number(&format!("{:04}{}", year(now) + y, &when[4..]))).min_by_key(|d| (d - now).abs());
        match nearest {
            Some(d) if d >= now => date = d,
            _ => return String::new(),
        }
    }
    let (mut days, mut weekdays) = (Vec::new(), Vec::new());
    for text in said {
        let words = words(text);
        for (i, word) in words.iter().enumerate() {
            match word.as_str() {
                "today" | "tonight" => days.push(said_day),
                "tomorrow" => days.push(said_day + 1),
                // "last Friday" is gone; it names no day ahead.
                w if i == 0 || words[i - 1] != "last" => {
                    if let Some(weekday) = WEEK.iter().position(|d| *d == w) {
                        if said_day < now {
                            // An imported Friday belongs to the week it was said, not the next one now.
                            let offset = (weekday as i64 - said_day).rem_euclid(7);
                            let offset = if offset == 0 && i > 0 && words[i - 1] == "next" { 7 } else { offset };
                            days.push(said_day + offset);
                        } else {
                            weekdays.push(weekday);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let named = days.contains(&date) || weekdays.contains(&(date.rem_euclid(7) as usize));
    if (days.is_empty() && weekdays.is_empty()) || named {
        let (y, m, d) = crate::import::civil_from_days(date);
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        String::new()
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

/// Today's date in local time, as "2026-11-01 (Sunday)", from the system's `date` (no extra crate).
fn chrono_today() -> String {
    std::process::Command::new("date")
        .arg("+%Y-%m-%d (%A)")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        changes, changes_on, day, describe, describe_in, drop_stale_titles, existing, named_at, request_in, rest_ms, Pass,
        Window, BUSY_THREADS, BUSY_TOKENS, CHARS_PER_TOKEN, QUIET_TOKENS,
    };
    use std::collections::HashSet;
    use crate::tidy::Kind;
    use crate::world::{Action, Change, ItemStatus, Suggestion, Tag, Thought, Thread, ThreadStatus, World};

    /// A Sunday, as `chrono_today` writes it.
    const TODAY: &str = "2026-11-01 (Sunday)";

    #[test]
    fn a_rename_is_made_at_once_only_in_the_persons_own_words() {
        let world = map(&[
            ("T1", "Never Finishing Tasks", &["My biggest problem is that I never finish my", "Sentences. I never finish my sentences."]),
            ("T2", "Quarterly taxes", &["I need to file the quarterly taxes by January fifteenth.", "And renew the car registration before the new year."]),
            ("T3", "Work anniversary", &["It's the company's tenth anniversary party next week."]),
            ("T4", "Mom's birthday", &["Oh wait, Mom's birthday is Friday. I need to book that cooking class.", "The one on Main Street."]),
            ("T5", "Codename", &["We need a name for this.", "Let's call it Falcon.", "The prototype ships Friday."]),
            ("T6", "Bird project", &["Let's call it Falcon.", "Eagle sounds better, the prototype is fast.", "Actually, call it Eagle."]),
        ]);
        let rows = [
            ("T1", "Never Finishing Sentences", true),
            ("T2", "Taxes and car registration", true),
            // Words nobody said: asked.
            ("T2", "Year-end admin tasks", false),
            ("T3", "Company anniversary party", true),
            // All said, but from one point of the two: it doesn't speak for the thread.
            ("T4", "Mom's birthday class", false),
            // A name they gave in so many words, the latest they gave.
            ("T5", "Falcon", true),
            ("T6", "Falcon", false),
            ("T6", "Eagle", true),
        ];
        for (id, title, sure) in rows {
            let pass: Pass = serde_json::from_value(serde_json::json!({ "titles": [{"thread_id": id, "title": title}] })).unwrap();
            let expected = if sure { format!("{id} title {title}") } else { format!("{id} proposes title {title}") };
            assert_eq!(shown(&changes_on(&world, pass, TODAY)), [expected]);
        }
    }

    #[test]
    fn a_title_the_person_chose_is_left_alone_and_a_rename_is_asked_once() {
        let mut world = map(&[("T1", "Topic", &["Buy oat milk."]), ("T2", "Rent", &["Pay rent by Friday."])]);
        let ask = |world: &World, id: &str, title: &str| {
            let pass: Pass = serde_json::from_value(serde_json::json!({ "titles": [{"thread_id": id, "title": title}] })).unwrap();
            changes_on(world, pass, TODAY)
        };
        let first = ask(&world, "T1", "Grocery list");
        assert_eq!(shown(&first), ["T1 proposes title Grocery list"]);
        first.iter().for_each(|c| world.apply(c));
        // Waiting on the card: no second proposal, whatever its words.
        assert!(ask(&world, "T1", "Grocery list").is_empty() && ask(&world, "T1", "Shopping").is_empty());
        // The person renamed it (or undid an AI rename, or said no to one): never touched again, even in their words.
        world.apply(&Change::TitleChosen { thread_id: "T2".into(), title: "Rent".into() });
        assert!(ask(&world, "T2", "Pay rent").is_empty());
        assert!(existing(&world).iter().any(|l| l == "title the person chose: T2"), "the model is told");
    }

    #[test]
    fn a_vague_point_gets_one_question_that_may_reuse_its_words() {
        let world = map(&[
            ("T1", "Onboarding", &["Something about the first screen feels off."]),
            ("T2", "Rent", &["Pay rent by Friday."]),
        ]);
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "questions": [
                {"thread_id": "T1", "text": "What feels off about the first screen?"},
                {"thread_id": "T2", "text": "Pay rent by Friday"},
            ],
            "suggestions": [
                {"thread_id": "T1", "text": "Try a lighter background"},
                {"thread_id": "T2", "text": "When will you pay rent by Friday?"},
            ],
        }))
        .unwrap();
        // The question takes its thread's one idea; an idea still never just says a point again, and a "question"
        // that isn't one is left out.
        assert_eq!(shown(&changes_on(&world, pass, TODAY)), ["T1 idea What feels off about the first screen?"]);
    }

    #[test]
    fn a_name_turned_down_is_not_a_name_given() {
        assert_eq!(named_at("Project Falcon", "Call it Project Falcon"), Some(0));
        assert_eq!(named_at("Project Falcon", "Don't call it Project Falcon"), None);
        assert_eq!(named_at("Falcon", "We shouldn't name it Falcon"), None);
        assert_eq!(named_at("Falcon", "I'd never call it Falcon"), None);
        // An earlier real naming still counts when a later mention turns it down.
        assert_eq!(named_at("Falcon", "Call it Falcon. Don't call it Falcon"), Some(0));
    }
    #[test]
    fn a_failing_pass_waits_longer_each_time_and_the_prompt_stays_bounded() {
        let rests: Vec<u64> = (0..8).map(|failures| rest_ms(failures) / 1000).collect();
        assert_eq!(rests, [10, 20, 40, 80, 160, 320, 320, 320]);
        let mut world = World::default();
        for n in 0..100 {
            let status = if n % 2 == 0 { ItemStatus::Dismissed } else { ItemStatus::New };
            world.suggestions.push(Suggestion { id: format!("s{n}"), thread_id: "T1".into(), text: format!("idea {n}"), status });
            world.actions.push(Action {
                id: format!("a{n}"),
                thread_id: "T1".into(),
                kind: "reminder".into(),
                title: format!("task {n}"),
                when: String::new(),
                status,
                done_ms: None,
            });
        }
        let lines = existing(&world);
        assert_eq!(lines.len(), 60);
        assert!(lines.contains(&"suggestion on T1: idea 70".to_string()) && lines.contains(&"action on T1: reminder task 99".to_string()));
        assert!(!lines.iter().any(|l| l.ends_with(" 69")), "only the latest");
    }

    fn thread(id: &str, parent: Option<&str>) -> Thread {
        Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: parent.map(Into::into),
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    #[test]
    fn actions_keep_only_real_dates() {
        let world = World { threads: vec![thread("T1", None)], ..World::default() };
        let pass: Pass = serde_json::from_value(serde_json::json!({ "actions": [
            {"thread_id": "T1", "kind": "event", "title": "Demo day", "when": "2026-11-04"},
            {"thread_id": "T1", "kind": "event", "title": "Picnic", "when": "Saturday"},
            {"thread_id": "T1", "kind": "reminder", "title": "Pay rent", "when": "2026-11-31"},
        ]}))
        .unwrap();
        let actions: Vec<[String; 3]> = changes_on(&world, pass, TODAY)
            .into_iter()
            .filter_map(|c| match c {
                Change::ActionProposed { action } => Some([action.title, action.kind, action.when]),
                _ => None,
            })
            .collect();
        let expected = [["Demo day", "event", "2026-11-04"], ["Picnic", "reminder", ""], ["Pay rent", "reminder", ""]];
        assert_eq!(actions, expected.map(|a| a.map(String::from)), "an event without a real day is a reminder");
    }

    #[test]
    fn equivalent_actions_on_one_thread_are_only_proposed_once() {
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None)], ..World::default() };
        let pass = |actions| serde_json::from_value::<Pass>(serde_json::json!({ "actions": actions })).unwrap();
        let task = |thread: &str, title: &str, kind: &str, when: &str| serde_json::json!({
            "thread_id": thread, "title": title, "kind": kind, "when": when
        });
        let first = changes_on(&world, pass(vec![
            task("T1", "Pay rent", "reminder", "2026-11-04"),
            task("T1", "PAY RENT!", "event", "2026-11-04"),
            task("T1", "P.a.y rent!", "event", "2026-11-04"),
            task("T1", "Pay November rent", "event", "2026-11-04"),
            task("T1", "Pay electric bill", "reminder", "2026-11-04"),
            task("T2", "Pay rent", "reminder", "2026-11-04"),
        ]), TODAY);
        let titles: Vec<_> = first.iter().filter_map(|c| match c {
            Change::ActionProposed { action } => Some((action.thread_id.as_str(), action.title.as_str())),
            _ => None,
        }).collect();
        assert_eq!(titles, [("T1", "Pay rent"), ("T1", "Pay electric bill"), ("T2", "Pay rent")]);
        for change in first { world.apply(&change); }
        assert!(changes_on(&world, pass(vec![
            task("T1", "Pay rent!", "event", "2026-11-05"),
            task("T1", "Pa.y rent", "event", "2026-11-05"),
            task("T1", "Pay November rent", "event", "2026-11-04"),
            task("T1", "Electric bill", "event", "2026-11-04"),
        ]), TODAY).is_empty(), "existing actions use the same guard in both containment directions");
        let distinct = changes_on(&world, pass(vec![
            task("T1", "Pay December rent", "event", "2026-12-04"),
            task("T1", "Rent", "reminder", ""),
            task("T1", "Pay water bill", "reminder", "2026-11-04"),
        ]), TODAY);
        assert_eq!(distinct.len(), 3, "containment needs a real matching date; shared words alone aren't duplicates");
    }

    #[test]
    fn two_threads_the_person_set_apart_by_a_move_are_never_proposed_as_one() {
        let thought = |id: &str, thread: &str, text: &str| Thought {
            id: id.into(),
            speaker: "you".into(),
            text: text.into(),
            point: text.into(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        let mut world = World {
            threads: vec![thread("T1", None), thread("T2", None)],
            thoughts: vec![thought("a", "T1", "pottery wheel"), thought("b", "T2", "pottery glaze"), thought("c", "T1", "pottery kiln")],
            ..World::default()
        };
        let merge = |world: &World| {
            let pass: Pass = serde_json::from_value(serde_json::json!({ "merges": [{"from": "T2", "into": "T1"}] })).unwrap();
            changes(world, pass).iter().filter(|c| matches!(c, Change::TidyProposed { .. })).count()
        };
        assert_eq!(merge(&world), 1, "before the move, the two read as one topic");
        world.apply(&Change::ThoughtMoved { thought_id: "c".into(), thread_id: "T2".into(), from: "T1".into(), undo: false });
        assert_eq!(merge(&world), 0, "the person's move says they're two");
        assert!(existing(&world).iter().any(|line| line == "threads the person keeps apart (never merge): T1 and T2"));
        world.apply(&Change::ThoughtMoved { thought_id: "c".into(), thread_id: "T1".into(), from: "T2".into(), undo: true });
        assert_eq!(merge(&world), 1, "a move undone takes its reason back");
    }

    #[test]
    fn merges_follow_the_ones_before_and_never_fold_a_thread_into_its_own_branch() {
        let thought = |id: &str, thread: &str| Thought {
            id: id.into(),
            speaker: "you".into(),
            text: id.into(),
            point: id.into(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        // T7 branches from T5, and T9 from T7.
        let world = World {
            threads: vec![thread("T1", None), thread("T3", None), thread("T5", None), thread("T7", Some("T5")), thread("T9", Some("T7"))],
            thoughts: ["T1", "T3", "T5", "T7", "T9"].iter().map(|t| thought(&format!("on {t}"), t)).collect(),
            ..World::default()
        };
        let merges = |pairs: &[(&str, &str)]| {
            let pairs: Vec<_> = pairs.iter().map(|(from, into)| serde_json::json!({"from": from, "into": into})).collect();
            let pass: Pass = serde_json::from_value(serde_json::json!({ "merges": pairs })).unwrap();
            changes(&world, pass)
        };
        let pairs = |changes: &[Change]| -> Vec<(String, String)> {
            changes
                .iter()
                .filter_map(|c| match c {
                    Change::TidyProposed { proposal: p } if p.kind == Kind::Merge => Some((p.thread_id.clone(), p.into.clone())),
                    Change::ThreadMerged { .. } => panic!("a merge is never made without asking"),
                    _ => None,
                })
                .collect()
        };
        let to = |from: &str, into: &str| (from.to_string(), into.to_string());

        // A chain, applied as proposed, lands on the thread that's left, and every thought stays on the map.
        let chain = merges(&[("T3", "T1"), ("T5", "T3")]);
        assert_eq!(pairs(&chain), [to("T3", "T1"), to("T5", "T3")]);
        let mut after = world.clone();
        for (from, into) in pairs(&chain) {
            let into = after.resolve(&into);
            after.apply(&Change::ThreadMerged { from, into });
        }
        assert!(after.thoughts.iter().all(|t| after.thread(t.thread_id.as_deref().unwrap()).is_some()));
        assert_eq!(after.thread("T7").unwrap().parent_id.as_deref(), Some("T1"));
        // Never into its own branch, however far down.
        assert!(pairs(&merges(&[("T5", "T7"), ("T5", "T9")])).is_empty());
        // Nor into itself, nor from a thread that isn't there, and one proposal at a time on a card.
        assert_eq!(pairs(&merges(&[("T1", "T1"), ("T2", "T1"), ("T3", "T1"), ("T3", "T5")])), [to("T3", "T1")]);
        // Once per pair, either way round, whatever the answer was; a card's next proposal waits for an answer.
        let mut asked = world.clone();
        merges(&[("T3", "T1")]).iter().for_each(|c| asked.apply(c));
        let again = |world: &World, pairs_: &[(&str, &str)]| {
            let list: Vec<_> = pairs_.iter().map(|(from, into)| serde_json::json!({"from": from, "into": into})).collect();
            pairs(&changes(world, serde_json::from_value(serde_json::json!({ "merges": list })).unwrap()))
        };
        assert!(again(&asked, &[("T3", "T1"), ("T1", "T3"), ("T3", "T5")]).is_empty());
        let id = asked.proposals[0].id.clone();
        asked.apply(&Change::ItemStatus { id, status: ItemStatus::Dismissed, done_ms: None });
        assert_eq!(again(&asked, &[("T3", "T1"), ("T3", "T5")]), [to("T3", "T5")]);
        // A branch into a thread above it is fine.
        assert_eq!(pairs(&merges(&[("T9", "T5")])), [to("T9", "T5")]);
    }

    #[test]
    fn one_idea_per_thread_counting_an_apps_card_and_no_more_than_three_tags() {
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None), thread("T3", None)], ..World::default() };
        world.threads[0].tags = vec![Tag { name: "#demo".into(), kept: true }, Tag { name: "#hackathon".into(), kept: false }];
        // An app's card that landed while the model worked: the pass is checked against the map as it is now.
        let card = "Argument resolver · This repeats an earlier point.";
        world.suggestions.push(Suggestion { id: "sg-app".into(), thread_id: "T3".into(), text: card.into(), status: ItemStatus::New });
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "suggestions": [
                {"thread_id": "T2", "text": "Ask Sam about the budget"},
                {"thread_id": "T2", "text": "A second idea for the same thread"},
                {"thread_id": "T3", "text": "The same point as the app's card"},
            ],
            "tags": [
                {"thread_id": "T1", "tags": ["#demo", "#Recording", "#video"]},
                {"thread_id": "T1", "tags": ["#more"]},
                {"thread_id": "T2", "tags": ["budget", "#money", "#plans", "#extra"]},
            ],
        }))
        .unwrap();
        let out = changes(&world, pass);
        let ideas: Vec<&str> = out
            .iter()
            .filter_map(|c| match c {
                Change::SuggestionAdded { suggestion } => Some(suggestion.text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(ideas, ["Ask Sam about the budget"]);
        let tags: Vec<(&str, &str)> = out
            .iter()
            .filter_map(|c| match c {
                Change::TagSuggested { thread_id, tag } => Some((thread_id.as_str(), tag.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(tags, [("T1", "#recording"), ("T2", "#budget"), ("T2", "#money"), ("T2", "#plans")]);
    }

    #[test]
    fn ideas_tasks_and_titles_that_name_a_thread_id_are_left_out() {
        let world = World { threads: vec![thread("T2", None), thread("T3", None)], ..World::default() };
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "titles": [{"thread_id": "T2", "title": "Notes for T3"}, {"thread_id": "T3", "title": "Recording setup"}],
            "suggestions": [
                {"thread_id": "T2", "text": "Draft README before recording T3 setup?"},
                {"thread_id": "T3", "text": "Test the dark background before recording"},
            ],
            "actions": [
                {"thread_id": "T2", "kind": "reminder", "title": "Finish T2", "when": ""},
                {"thread_id": "T2", "kind": "reminder", "title": "Write the README", "when": ""},
            ],
        }))
        .unwrap();
        let texts: Vec<String> = changes(&world, pass)
            .into_iter()
            .map(|c| match c {
                Change::TidyProposed { proposal } => proposal.title,
                Change::SuggestionAdded { suggestion } => suggestion.text,
                Change::ActionProposed { action } => action.title,
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(texts, ["Recording setup", "Test the dark background before recording", "Write the README"]);
    }

    #[test]
    fn the_model_sees_each_threads_tags_and_in_a_room_who_said_what() {
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None)], active: Some("T1".into()), ..World::default() };
        world.threads[0].tags = vec![Tag { name: "#demo".into(), kept: true }];
        world.threads[1].tags = vec![Tag { name: "#rent".into(), kept: false }, Tag { name: "#home".into(), kept: true }];
        let said = |id: &str, speaker: &str| Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: format!("{id} said"),
            point: String::new(),
            thread_id: Some("T1".into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        world.thoughts.push(said("a", "you"));
        let alone = describe(&world, 0, TODAY);
        assert!(alone.contains("T2: Topic T2 (parent: none) tags: #rent #home last: "), "{alone}");
        assert!(alone.contains("T1: Topic T1 (parent: none) tags: #demo\n  - a said"), "{alone}");
        world.thoughts.push(said("b", "Sam"));
        let room = describe(&world, 0, TODAY);
        assert!(room.contains("  - you: a said\n  - Sam: b said"), "{room}");
        world.thoughts.push(Thought { complete: false, ..said("c", "you") });
        assert!(describe(&world, 0, TODAY).contains("  - you: c said (trailed off)"), "a trailed-off point is marked");
    }

    #[test]
    fn quiet_threads_shrink_to_one_line() {
        let thread = |id: &str, touched_ms| Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: format!("last on {id}"),
            touched_ms,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        };
        let thought = |n: u64, thread: &str| Thought {
            id: format!("th-{n}"),
            speaker: "you".into(),
            text: format!("thought {n}"),
            point: String::new(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: n,
            place_ms: None,
        };
        let world = World {
            threads: vec![thread("T1", 5), thread("T2", 100)],
            thoughts: (1..=12).map(|n| thought(n, "T1")).chain([thought(101, "T2")]).collect(),
            ..World::default()
        };
        let text = describe(&world, 50, TODAY);
        assert!(text.contains("T1: Topic T1 (parent: none) last: last on T1"));
        assert!(!text.contains("thought 12\n") && text.contains("thought 101"));
        let all = describe(&world, 0, TODAY);
        assert!(all.contains("thought 12") && !all.contains("  - thought 4"), "keeps only the latest 8");
    }

    #[test]
    fn older_points_show_their_local_said_day_without_changing_the_cached_order() {
        let mut world = map(&[
            ("T1", "Quiet", &["Call the electrician tomorrow."]),
            ("T2", "Active", &["Pay rent Friday.", "Buy milk tomorrow."]),
        ]);
        world.active = Some("T2".into());
        world.thoughts[0].at_ms = crate::clock::ms("2026-10-29 23:30").unwrap();
        world.thoughts[1].at_ms = crate::clock::ms("2026-10-22 00:30").unwrap();
        world.thoughts[2].at_ms = crate::clock::ms("2026-11-01 00:30").unwrap();
        world.threads[0].last_point = world.thoughts[0].text.clone();
        for room in [false, true] {
            if room { world.thoughts[1].speaker = "Sam".into(); }
            let text = describe(&world, u64::MAX, TODAY);
            assert!(text.contains("last: Call the electrician tomorrow. (said 2026-10-29)"), "{text}");
            assert!(text.contains("Pay rent Friday. (said 2026-10-22)"), "{text}");
            assert!(text.ends_with("Buy milk tomorrow."), "today stays unmarked: {text}");
            assert!(text.find("T1: Quiet").unwrap() < text.find("T2: Active").unwrap(), "quiet prefix first");
        }
    }

    #[test]
    fn imported_relative_dates_use_the_best_matching_points_day() {
        for (said_on, text, title, when, today, expected) in [
            ("2026-10-29", "Call the electrician tomorrow.", "Call electrician", "2026-11-02", TODAY, ""),
            ("2026-10-29", "Call the electrician tomorrow.", "Call electrician", "2026-10-30", TODAY, ""),
            ("2026-11-01", "Call the electrician tomorrow.", "Call electrician", "2026-11-02", TODAY, "2026-11-02"),
            ("2026-11-01", "Call the electrician tomorrow.", "Call electrician", "2026-11-03", TODAY, ""),
            ("2026-10-22", "Pay rent Friday.", "Pay rent", "2026-11-06", TODAY, ""),
            ("2026-10-22", "Pay rent Friday.", "Pay rent", "2026-10-23", TODAY, ""),
            ("2026-10-22", "Pay rent Friday.", "Pay rent", "2026-10-23", "2026-10-23 (Friday)", "2026-10-23"),
            ("2026-10-22", "Pay rent Friday.", "Pay rent", "2026-10-30", "2026-10-23 (Friday)", ""),
            ("2026-10-29", "Call the dentist next Tuesday.", "Call dentist", "2026-11-03", TODAY, "2026-11-03"),
            ("2026-10-29", "Call the dentist next Tuesday.", "Call dentist", "2026-11-10", TODAY, ""),
        ] {
            // A newer point on the same thread must not supply this action's day.
            let mut world = map(&[("T1", "Errands", &[text, "Buy milk tomorrow."])]);
            world.thoughts[0].at_ms = crate::clock::ms(&format!("{said_on} 23:30")).unwrap();
            let pass = || serde_json::from_value::<Pass>(serde_json::json!({ "actions": [
                {"thread_id": "T1", "kind": "event", "title": title, "when": when}
            ]})).unwrap();
            let kind = if expected.is_empty() { "reminder" } else { "event" };
            for _ in 0..2 {
                let changes = changes_on(&world, pass(), today);
                assert_eq!(shown(&changes), [format!("T1 {kind} {title} {expected}")], "{said_on}: {text} -> {when}");
                let mut landed = world.clone();
                for change in changes { landed.apply(&change); }
                assert!(changes_on(&landed, pass(), today).is_empty(), "an existing action stays deduplicated");
                world.thoughts.reverse();
            }
        }
    }

    /// A long history: `n` threads of 8 spoken-length thoughts each (≈ 25 words, as the scale sweep had), thread
    /// i touched at `start` + i s, so later threads are later.
    fn big(n: usize, start: u64) -> World {
        let mut world = World::default();
        for i in 0..n {
            let id = format!("T{i}");
            let touched_ms = start + i as u64 * 1_000;
            world.threads.push(Thread {
                last_point: format!("the latest thing said on topic {i}, about a plan and what it costs"),
                touched_ms,
                ..thread(&id, None)
            });
            for k in 0..8 {
                world.thoughts.push(Thought {
                    id: format!("th-{i}-{k}"),
                    speaker: "you".into(),
                    text: format!("On topic {i} point {k}: we should look again at the plan for next week and what it costs, then decide who books it"),
                    point: String::new(),
                    thread_id: Some(id.clone()),
                    placed: true,
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    at_ms: touched_ms - 8 + k,
                    place_ms: None,
                });
            }
        }
        world
    }

    /// Thread ids shown with their points, in the order shown.
    fn full(text: &str) -> Vec<String> {
        let busy = text.split("Recently active threads, with their latest points:\n").nth(1).unwrap_or("");
        let busy = busy.split("\nAlready on the map:").next().unwrap_or("");
        busy.lines().filter(|l| !l.starts_with("  - ") && !l.is_empty()).map(|l| l.split(':').next().unwrap().to_string()).collect()
    }

    /// The sweep's bug, or a room laptop whose clock runs a day ahead: every timestamp past now. Before, every
    /// one of 1,000 threads counted as just changed and went in whole (≈ 242k tokens by this count, 214.9k
    /// measured; 9.8 s to build). Now none does, the one-line threads stop at their budget, and it builds fast.
    #[test]
    fn a_clock_ahead_marks_nothing_changed_and_a_pass_stays_bounded_at_1000_threads() {
        let now = crate::now_ms();
        let mut world = big(1_000, now + 86_400_000);
        let owed = HashSet::new();
        let window = Window { since: now - 10_000, now, owed: &owed };
        let started = std::time::Instant::now();
        let (body, later) = request_in(&world, &window, TODAY);
        let took = started.elapsed();
        let prompt = body["messages"][1]["content"].as_str().unwrap();
        assert!(full(prompt).is_empty() && later.is_empty(), "{:?}", full(prompt));
        let tokens = prompt.len() / CHARS_PER_TOKEN;
        assert!(tokens <= QUIET_TOKENS + 200, "{tokens} tokens");
        assert!(prompt.contains("threads untouched longer are left out"));
        // A pause in a pass runs every 10 s; building it must not hold the core (this machine: a few ms).
        assert!(took < std::time::Duration::from_millis(500), "{took:?}");
        // What is said now on a thread stamped ahead still counts.
        world.thoughts.push(Thought { id: "now".into(), at_ms: now - 1, ..world.thoughts[40].clone() });
        let (text, _) = describe_in(&world, &window, TODAY);
        assert_eq!(full(&text), ["T5"]);
    }

    /// A bulk change (every thread really changed): each pass sends the 12 latest in full and leaves the rest for
    /// the next passes, latest first, until each went once; every pass stays under its budget.
    #[test]
    fn changed_threads_past_the_cap_wait_for_later_passes_latest_first() {
        let now = crate::now_ms();
        let world = big(1_000, now - 2_000_000);
        let mut owed: HashSet<String> = HashSet::new();
        let mut since = now - 3_000_000;
        let mut sent: Vec<String> = Vec::new();
        for pass in 0.. {
            let (text, later) = describe_in(&world, &Window { since, now, owed: &owed }, TODAY);
            let shown = full(&text);
            if pass == 0 {
                assert_eq!(shown[..3], ["T999", "T998", "T997"]);
                assert_eq!(later.len(), 1_000 - BUSY_THREADS);
            }
            assert!(text.len() / CHARS_PER_TOKEN <= BUSY_TOKENS + QUIET_TOKENS + 200, "{}", text.len());
            assert!(shown.len() <= BUSY_THREADS);
            sent.extend(shown);
            (since, owed) = (now, later.into_iter().collect());
            if owed.is_empty() {
                assert_eq!(pass, 1_000usize.div_ceil(BUSY_THREADS) - 1);
                break;
            }
        }
        let want: Vec<String> = (0..1_000).rev().map(|i| format!("T{i}")).collect();
        assert_eq!(sent, want, "each thread once, latest first");
    }

    /// The active thread always goes in first, and a thread too big for the budget still goes in alone; a map the
    /// demo's size goes in whole, as before.
    #[test]
    fn the_active_thread_goes_first_and_a_small_map_is_never_cut() {
        let now = crate::now_ms();
        let mut world = big(10, now - 60_000);
        let (text, later) = describe_in(&world, &Window { since: 0, now, owed: &HashSet::new() }, TODAY);
        assert_eq!(full(&text).len(), 10);
        assert!(later.is_empty() && !text.contains("left out"));
        world.active = Some("T0".into());
        let (text, _) = describe_in(&world, &Window { since: now, now, owed: &HashSet::new() }, TODAY);
        assert_eq!(full(&text), ["T0"]);
        // T3 alone is past the token budget: the threads after it that fit go now, T3 at the next pass, alone.
        for p in world.thoughts.iter_mut().filter(|p| p.thread_id.as_deref() == Some("T3")) {
            p.text = "word ".repeat(600);
        }
        world.active = None;
        let (text, later) = describe_in(&world, &Window { since: 0, now, owed: &HashSet::new() }, TODAY);
        assert_eq!(full(&text), ["T9", "T8", "T7", "T6", "T5", "T4", "T2", "T1", "T0"]);
        assert_eq!(later, ["T3"]);
        let owed: HashSet<String> = later.into_iter().collect();
        let (text, later) = describe_in(&world, &Window { since: now, now, owed: &owed }, TODAY);
        assert_eq!(full(&text), ["T3"]);
        assert!(later.is_empty());
    }

    /// A pass that came back moves the window and owes what it left; a failed one keeps both, so it goes again.
    #[test]
    fn only_a_pass_that_came_back_moves_the_window() {
        let (mut since, mut owed) = (5, HashSet::from(["T1".to_string()]));
        super::settle(false, 9, vec!["T2".into()], &mut since, &mut owed);
        assert_eq!((since, owed.clone()), (5, HashSet::from(["T1".to_string()])));
        super::settle(true, 9, vec!["T2".into()], &mut since, &mut owed);
        assert_eq!((since, owed), (9, HashSet::from(["T2".to_string()])));
    }

    /// A thread owed a full pass and merged before that pass (a merge keeps the points' times): the thread it
    /// joined goes in full instead, so the owed points still get their pass.
    #[test]
    fn an_owed_thread_merged_away_passes_its_turn_to_the_thread_it_joined() {
        let now = crate::now_ms();
        let mut world = big(10, now - 600_000);
        let owed: HashSet<String> = ["T3".to_string()].into();
        world.apply(&crate::world::Change::ThreadMerged { from: "T3".into(), into: "T1".into() });
        let (text, later) = describe_in(&world, &Window { since: now, now, owed: &owed }, TODAY);
        assert_eq!(full(&text), ["T1"]);
        assert!(later.is_empty());
    }

    /// 1,000 big changed threads, each said on a different day: only the one that fits is dated. Sizing each
    /// with its dates ran one `date` per point, 8,000 in all (≈ 8 s), before the model call and outside its timeout.
    #[test]
    fn threads_left_for_later_are_sized_without_dates() {
        let now = crate::now_ms();
        let mut world = big(1_000, now - 2_000_000);
        for (i, p) in world.thoughts.iter_mut().enumerate() {
            p.text = format!("{} {i}", "word ".repeat(400));
            p.at_ms = 1_700_000_000_000 + i as u64 * 86_400_000;
        }
        for t in world.threads.iter_mut() {
            t.last_point = "short".into();
        }
        let started = std::time::Instant::now();
        let (text, later) = describe_in(&world, &Window { since: now - 3_000_000, now, owed: &HashSet::new() }, TODAY);
        let took = started.elapsed();
        assert_eq!(full(&text).len(), 1);
        assert_eq!(later.len(), 999);
        assert!(took < std::time::Duration::from_millis(1_000), "{took:?}");
    }

    /// A map of (id, title, what was said) rows.
    fn map(rows: &[(&str, &str, &[&str])]) -> World {
        let mut world = World::default();
        let at_ms = crate::clock::ms("2026-11-01 12:00").unwrap();
        for (id, title, said) in rows {
            world.threads.push(Thread { title: title.to_string(), ..thread(id, None) });
            for text in *said {
                let n = world.thoughts.len();
                world.thoughts.push(Thought {
                    id: format!("th-{n}"),
                    speaker: "you".into(),
                    text: text.to_string(),
                    point: String::new(),
                    thread_id: Some(id.to_string()),
                    placed: true,
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    at_ms,
                    place_ms: None,
                });
            }
        }
        world
    }

    fn shown(out: &[Change]) -> Vec<String> {
        out.iter()
            .filter_map(|c| match c {
                Change::ThreadRetitled { thread_id, title, .. } => Some(format!("{thread_id} title {title}")),
                Change::TidyProposed { proposal: p } if p.kind == Kind::Rename => Some(format!("{} proposes title {}", p.thread_id, p.title)),
                Change::TidyProposed { proposal: p } => Some(format!("{} proposes into {}", p.thread_id, p.into)),
                Change::SuggestionAdded { suggestion: s } => Some(format!("{} idea {}", s.thread_id, s.text)),
                Change::ActionProposed { action: a } => Some(format!("{} {} {} {}", a.thread_id, a.kind, a.title, a.when)),
                Change::TagSuggested { thread_id, tag } => Some(format!("{thread_id} {tag}")),
                _ => None,
            })
            .collect()
    }

    fn rename(world: &World, title: &str) -> Vec<String> {
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "titles": [{"thread_id": "T1", "title": title}]
        }))
        .unwrap();
        shown(&changes_on(world, pass, TODAY))
    }

    #[test]
    fn the_latest_naming_wins_in_said_order_not_timestamp_order() {
        let old = "We're calling this Project Falcon.";
        let new = "Actually, let's call it Quick Launch.";
        for (said, allowed) in [
            (vec![old, new], true),
            (vec![new, old], false),
            (vec![old, new, old], false),
            (vec![old, new, old, new], true),
            (vec![old], false),
            (vec![old, "Quick Launch would look good on the landing page."], false),
            (vec!["This is named Project Falcon.", "The project is titled Quick Launch."], true),
            (vec!["It's called Project Falcon.", "Let's name it Quick Launch."], true),
            (vec!["The title is Project Falcon.", new], true),
        ] {
            // Split thoughts can share a timestamp; imported or split thoughts need not have increasing times.
            for equal_times in [true, false] {
                let mut world = map(&[("T1", "Project Falcon", &said)]);
                let count = world.thoughts.len();
                for (i, thought) in world.thoughts.iter_mut().enumerate() {
                    thought.at_ms = if equal_times { 1000 } else { (count - i) as u64 * 1000 };
                }
                let expected = if allowed { vec!["T1 title Quick Launch"] } else { vec![] };
                assert_eq!(rename(&world, "Quick Launch"), expected, "{said:?}, equal times: {equal_times}");
            }
        }
    }

    #[test]
    fn a_thread_that_heard_more_while_the_pass_was_out_keeps_its_title_until_the_next() {
        // The pass went out after "call it Falcon" and came back after "actually, call it Eagle".
        let sent = map(&[("T1", "Codename", &["Let's call it Falcon."]), ("T2", "Groceries", &["Buy oat milk."])]);
        let titles = |now: &World| {
            let mut pass: Pass = serde_json::from_value(serde_json::json!({
                "titles": [{"thread_id": "T1", "title": "Falcon"}, {"thread_id": "T2", "title": "Grocery list"}]
            }))
            .unwrap();
            drop_stale_titles(&mut pass, &sent, now);
            shown(&changes_on(now, pass, TODAY))
        };
        // Falcon is the name they gave; "grocery list" are words nobody said, so it's asked.
        assert_eq!(titles(&sent), ["T1 title Falcon", "T2 proposes title Grocery list"], "nothing new: the pass stands");
        // Placed since, or still being placed there: the next pass sees it.
        for placed in [true, false] {
            let mut now = sent.clone();
            now.thoughts.push(Thought { id: "eagle".into(), text: "Actually, call it Eagle.".into(), placed, ..sent.thoughts[0].clone() });
            assert_eq!(titles(&now), ["T2 proposes title Grocery list"], "placed: {placed}");
        }
    }

    #[test]
    fn a_later_speaker_in_a_room_can_rename_a_person_named_title() {
        let mut world = map(&[("T1", "Project Falcon", &["Calling this Project Falcon.", "Let's call it Quick Launch actually."])]);
        world.thoughts[0].speaker = "Ana".into();
        world.thoughts[1].speaker = "Sam".into();
        assert_eq!(rename(&world, "Quick Launch"), ["T1 title Quick Launch"]);
        assert!(rename(&world, "Launch plan").is_empty(), "a model-invented title still has no cue");
        world.thoughts.reverse();
        assert!(rename(&world, "Quick Launch").is_empty(), "said order applies across speakers too");
    }

    #[test]
    fn naming_ignores_case_and_punctuation() {
        let world = map(&[("T1", "Project Falcon", &["Let's call it 'PROJECT—FALCON', okay?", "No wait, CALL it quick—launch!"])]);
        assert_eq!(rename(&world, "Quick Launch"), ["T1 title Quick Launch"]);
    }

    #[test]
    fn naming_cues_are_ordered_within_a_thought_too() {
        for (said, allowed) in [
            ("Call it Project Falcon; actually, let's call it Quick Launch.", true),
            ("Call it Quick Launch; actually, let's call it Project Falcon.", false),
            ("Call it Project Falcon; call it Quick Launch; call it Project Falcon.", false),
            ("Call it Project Falcon; call it Quick Launch; call it Project Falcon; call it Quick Launch.", true),
        ] {
            let world = map(&[("T1", "Project Falcon", &[said])]);
            let expected = if allowed { vec!["T1 title Quick Launch"] } else { vec![] };
            assert_eq!(rename(&world, "Quick Launch"), expected, "{said}");
        }
        for (current, proposed) in [("Project Falcon", "Falcon"), ("Falcon", "Project Falcon")] {
            let world = map(&[("T1", current, &["Call Project Falcon."])]);
            assert!(rename(&world, proposed).is_empty(), "two matches of the same cue are not a later naming");
        }
    }

    #[test]
    fn only_placed_naming_on_the_same_thread_can_supersede_a_name() {
        let mut world = map(&[
            ("T1", "Project Falcon", &["Call it Project Falcon."]),
            ("T2", "Other project", &["Call it Quick Launch."]),
        ]);
        assert!(rename(&world, "Quick Launch").is_empty(), "another thread's cue doesn't count");
        world.thoughts[1].thread_id = Some("T1".into());
        world.thoughts[1].placed = false;
        assert!(rename(&world, "Quick Launch").is_empty(), "an unplaced cue doesn't count");
        world.thoughts[1].placed = true;
        assert_eq!(rename(&world, "Quick Launch"), ["T1 title Quick Launch"]);
    }

    #[test]
    fn a_later_naming_does_not_bypass_other_title_guards() {
        for (current, proposed, cue) in [
            ("Project Falcon", "project—FALCON!", "Call it project—FALCON!"),
            ("Project Falcon", "A new title with six words", "Call it A new title with six words."),
            ("Project Falcon", "Notes for T2", "Call it Notes for T2."),
        ] {
            let world = map(&[("T1", current, &["Call it Project Falcon.", cue]), ("T2", "Other project", &[])]);
            assert!(rename(&world, proposed).is_empty(), "{proposed}");
        }
        let world = map(&[("T1", "Project Falcon", &["We're discussing Project Falcon."])]);
        assert_eq!(rename(&world, "Launch plan"), ["T1 proposes title Launch plan"], "unnamed titles still allow model improvements, asked");
        assert!(rename(&world, "   ").is_empty());
        assert!(rename(&World::default(), "Quick Launch").is_empty(), "a missing thread is still rejected");
    }

    #[test]
    fn nothing_a_person_would_undo_titles_tags_ideas_and_merges() {
        let world = map(&[
            ("T1", "Project Falcon", &["Okay, we're calling this Project Falcon.", "And someone has to own the landing page."]),
            ("T2", "Demo Opening Hook", &["We open with the mic turning on."]),
            ("T3", "Electric Bill Autopay", &["I keep forgetting about the electric bill."]),
            ("T4", "Landlord Lease Email", &["I should email the landlord about the lease."]),
            ("T5", "Money stuff", &["Oh wait, Mom's birthday is Friday. I need to book that cooking class.", "The one on Main Street."]),
            ("T8", "Quarterly taxes", &["I need to file the quarterly taxes by January.", "And renew the car registration."]),
            ("T6", "Pay rent", &["I need to pay rent by the fifth."]),
            ("T7", "Rent payment", &["For the rent, I'll send the landlord an e-transfer."]),
        ]);
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "titles": [
                {"thread_id": "T1", "title": "Falcon prototype tests"},
                {"thread_id": "T2", "title": "Demo opening hook"},
                {"thread_id": "T3", "title": "Electric bill autopay before the due date"},
                {"thread_id": "T5", "title": "Mom's birthday class"},
                {"thread_id": "T8", "title": "Taxes and car registration"},
            ],
            "merges": [{"from": "T4", "into": "T3"}, {"from": "T7", "into": "T6"}],
            "suggestions": [
                {"thread_id": "T1", "text": "Who will own the landing page?"},
                {"thread_id": "T2", "text": "Open with the mic turning on"},
                {"thread_id": "T5", "text": "Check Main Street class availability for Friday?"},
            ],
            "tags": [
                {"thread_id": "T2", "tags": ["#demo", "#hooks", "#hackathon"]},
                {"thread_id": "T3", "tags": ["#bills", "#electricbill", "#electric-bill", "#money"]},
                {"thread_id": "T5", "tags": ["#birthday", "#moms-birthday", "#family"]},
            ],
        }))
        .unwrap();
        assert_eq!(
            shown(&changes_on(&world, pass, TODAY)),
            [
                // Not the name the person gave, a change of case, or over five words; words they only used are fine,
                // made at once when they speak for the thread (both points), else asked.
                "T5 proposes title Mom's birthday class",
                "T8 title Taxes and car registration",
                // Lease and electric bill share no word; the rent threads do, and a merge is always asked.
                "T7 proposes into T6",
                // Not a point said again; a next step that reuses some words is fine.
                "T5 idea Check Main Street class availability for Friday?",
                // Not the title's words, nor those of the title this pass gives it.
                "T2 #hackathon",
                "T3 #money",
                "T5 #family",
            ]
        );
    }

    #[test]
    fn action_dates_are_never_past_and_fall_on_the_day_said() {
        // Sunday 1 November; the 3rd and the 10th are Tuesdays.
        let tuesday = ["I have to call the dentist next Tuesday."];
        assert_eq!(day("2026-11-03", &tuesday, TODAY, TODAY), "2026-11-03");
        assert_eq!(day("2026-11-10", &tuesday, TODAY, TODAY), "2026-11-10");
        assert_eq!(day("2026-11-04", &tuesday, TODAY, TODAY), "", "a Wednesday isn't Tuesday");
        assert_eq!(day("2026-11-20", &["Mom's birthday is Friday the twentieth."], TODAY, TODAY), "2026-11-20");
        let tomorrow = ["The submission deadline is tomorrow at nine PM."];
        assert_eq!((day("2026-11-02", &tomorrow, TODAY, TODAY), day("2026-11-03", &tomorrow, TODAY, TODAY)), ("2026-11-02".into(), String::new()));
        // A slipped year moves to the nearest such day; a day that just went by is no day to remind anyone of.
        assert_eq!(day("2025-11-10", &[], TODAY, TODAY), "2026-11-10");
        assert_eq!(day("2026-10-30", &[], TODAY, TODAY), "");
        assert_eq!(day("2026-01-05", &[], "2026-12-20 (Sunday)", "2026-12-20 (Sunday)"), "2027-01-05");
        // Not a real day; and without today's date, a real one stays as it is.
        assert_eq!((day("Saturday", &[], TODAY, TODAY), day("2026-11-31", &[], TODAY, TODAY)), (String::new(), String::new()));
        assert_eq!(day("2025-11-10", &[], "", ""), "2025-11-10");

        // The day said for an action is in the sentences most about it, not anywhere on its thread.
        let world = map(&[
            ("T1", "Hackathon demo", &["I need to plan the hackathon demo. The deadline is tomorrow."]),
            ("T2", "Rent", &["Pay rent by Friday.", "I'll transfer the money Thursday."]),
            ("T3", "Bills", &["I already paid the gas bill last Friday, so that's done.", "The water bill is due on the fifteenth."]),
        ]);
        let pass: Pass = serde_json::from_value(serde_json::json!({ "actions": [
            {"thread_id": "T1", "kind": "event", "title": "Demo deadline", "when": "2026-11-02"},
            {"thread_id": "T1", "kind": "reminder", "title": "Plan the hackathon demo", "when": "2026-11-03"},
            {"thread_id": "T2", "kind": "reminder", "title": "Transfer the money", "when": "2026-11-06"},
            {"thread_id": "T2", "kind": "event", "title": "Rent due", "when": "2026-11-06"},
            {"thread_id": "T3", "kind": "reminder", "title": "Pay water bill", "when": "2026-11-15"},
        ]}))
        .unwrap();
        assert_eq!(
            shown(&changes_on(&world, pass, TODAY)),
            [
                "T1 event Demo deadline 2026-11-02",
                "T1 reminder Plan the hackathon demo 2026-11-03",
                "T2 reminder Transfer the money ",
                "T2 event Rent due 2026-11-06",
                "T3 reminder Pay water bill 2026-11-15",
            ]
        );
        assert_eq!(day("2026-11-06", &["I paid it last Friday, the next one is Friday"], TODAY, TODAY), "2026-11-06");
        assert_eq!(day("2026-11-07", &["I paid it last Friday"], TODAY, TODAY), "2026-11-07", "a day gone names nothing ahead");
    }

    /// The four kinds of stale card in the persona runs of 2026-11-01, each said after its idea or task was made.
    fn stale_map() -> World {
        let mut world = map(&[
            ("T1", "Midterm", &["Midterm is on Tuesday.", "Midterm is Wednesday, not Tuesday."]),
            ("T2", "Lisbon conference", &["Thinking about the Lisbon conference.", "Forget Lisbon, the conference got cancelled."]),
            ("T3", "Take-home", &["Need to send the take-home to Priya.", "Sent the take-home, done."]),
            ("T4", "Study group", &["Study with Maya and Dev on Thursday.", "Dev dropped out, it's just Maya now."]),
        ]);
        let task = |id: &str, thread: &str, kind: &str, title: &str, when: &str| Action {
            id: id.into(), thread_id: thread.into(), kind: kind.into(), title: title.into(), when: when.into(), status: ItemStatus::New, done_ms: None,
        };
        world.actions = vec![
            task("ac-0a1b2c3d4e5f", "T1", "event", "Midterm", "2026-11-03"),
            task("ac-1b2c3d4e5f6a", "T3", "reminder", "Send take-home to Priya", ""),
        ];
        let idea = |id: &str, thread: &str, text: &str| Suggestion { id: id.into(), thread_id: thread.into(), text: text.into(), status: ItemStatus::New };
        world.suggestions = vec![idea("sg-2c3d4e5f6a7b", "T2", "Book Lisbon flights"), idea("sg-3d4e5f6a7b8c", "T4", "Plan a session with Maya and Dev")];
        world
    }

    fn item(world: &World, id: &str) -> crate::world::ItemState {
        world.item_state(id).unwrap()
    }

    #[test]
    fn a_later_point_withdraws_or_corrects_its_stale_idea_or_task() {
        let mut world = stale_map();
        let open = super::open_items(&world);
        assert!(open.contains(&"ac-0a1b2c on T1: event \"Midterm\" on 2026-11-03 (Tuesday)".to_string()), "{open:?}");
        assert!(open.contains(&"sg-2c3d4e on T2: idea \"Book Lisbon flights\"".to_string()), "{open:?}");
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "revise": [
                {"id": "ac-0a1b2c", "title": "Midterm", "when": "2026-11-04", "why": "midterm is Wednesday"},
                {"id": "sg-3d4e5f", "title": "Plan a session with Maya", "when": "", "why": "Dev dropped out"},
            ],
            "retire": [
                {"id": "sg-2c3d4e", "why": "conference cancelled"},
                {"id": "ac-1b2c3d", "why": "take-home sent"},
            ],
        })).unwrap();
        let out = changes_on(&world, pass, TODAY);
        assert_eq!(out.len(), 4, "{out:?}");
        out.iter().for_each(|c| world.apply(c));
        // Date moved and a person dropped out: the same row, corrected.
        assert_eq!((item(&world, "ac-0a1b2c3d4e5f").when.as_str(), item(&world, "ac-0a1b2c3d4e5f").status), ("2026-11-04", ItemStatus::New));
        assert_eq!(item(&world, "sg-3d4e5f6a7b8c").text, "Plan a session with Maya");
        // Cancelled and done: off the card.
        assert_eq!(item(&world, "sg-2c3d4e5f6a7b").status, ItemStatus::Dismissed);
        assert_eq!(item(&world, "ac-1b2c3d4e5f6a").status, ItemStatus::Dismissed);
        // Told to the model as withdrawn, not as the person's "no"; and no longer open.
        assert!(existing(&world).contains(&"suggestion on T2: Book Lisbon flights (withdrawn)".to_string()));
        assert_eq!(super::open_items(&world).len(), 2);
    }

    #[test]
    fn only_what_still_waits_on_the_person_is_changed_and_each_needs_its_reason() {
        let mut world = stale_map();
        world.actions[1].status = ItemStatus::Done;
        world.suggestions[1].status = ItemStatus::Kept;
        let pass = |v: serde_json::Value| serde_json::from_value::<Pass>(v).unwrap();
        let none = pass(serde_json::json!({
            "retire": [
                {"id": "ac-1b2c3d", "why": "sent"},
                {"id": "sg-3d4e5f", "why": "Dev dropped out"},
                {"id": "sg-2c3d4e", "why": " "},
                {"id": "sg-ffffff", "why": "no such idea"},
                {"id": "sg-2c3d4e", "why": "see T1"},
            ],
            // Not a day they named (Friday), or no change at all.
            "revise": [{"id": "ac-0a1b2c", "title": "", "when": "2026-11-06", "why": "moved"}, {"id": "ac-0a1b2c", "title": "Midterm", "when": "", "why": "same"}],
        }));
        assert!(changes_on(&world, none, TODAY).is_empty(), "added, kept, unexplained, unknown, naming an id, or wrong day");
        // Once the person put one back, it's theirs.
        let withdraw = || pass(serde_json::json!({ "retire": [{"id": "sg-2c3d4e", "why": "conference cancelled"}] }));
        let out = changes_on(&world, withdraw(), TODAY);
        out.iter().for_each(|c| world.apply(c));
        let Some(Change::ItemRefined { was, .. }) = out.first() else { panic!("{out:?}") };
        world.apply(&Change::ItemRestored { id: "sg-2c3d4e5f6a7b".into(), to: was.clone() });
        assert_eq!(item(&world, "sg-2c3d4e5f6a7b").status, ItemStatus::New);
        assert!(changes_on(&world, withdraw(), TODAY).is_empty());
        assert!(!super::open_items(&world).iter().any(|l| l.contains("Lisbon")));
    }

    #[test]
    fn a_withdrawn_task_may_come_back_corrected_and_a_correction_never_doubles_a_row() {
        let mut world = stale_map();
        let pass = |v: serde_json::Value| serde_json::from_value::<Pass>(v).unwrap();
        // Withdrawn and proposed anew in one pass: the new day isn't blocked by the old row's title.
        let out = changes_on(&world, pass(serde_json::json!({
            "retire": [{"id": "ac-0a1b2c", "why": "midterm is Wednesday"}],
            "actions": [{"thread_id": "T1", "kind": "event", "title": "Midterm", "when": "2026-11-04"}],
        })), TODAY);
        assert_eq!(shown(&out), ["T1 event Midterm 2026-11-04"]);
        out.iter().for_each(|c| world.apply(c));
        // A later pass doesn't take the withdrawn one for the person's "no" either.
        let mut later = stale_map();
        changes_on(&later.clone(), pass(serde_json::json!({ "retire": [{"id": "ac-0a1b2c", "why": "moved"}] })), TODAY).iter().for_each(|c| later.apply(c));
        let again = changes_on(&later, pass(serde_json::json!({ "actions": [{"thread_id": "T1", "kind": "event", "title": "Midterm", "when": "2026-11-04"}] })), TODAY);
        assert_eq!(shown(&again), ["T1 event Midterm 2026-11-04"]);
        // Correcting the old row to the day a newer row already has withdraws it instead of showing two.
        world.actions[0].status = ItemStatus::New;
        world.refined.clear();
        let twin = changes_on(&world, pass(serde_json::json!({ "revise": [{"id": "ac-0a1b2c", "title": "Midterm", "when": "2026-11-04", "why": "Wednesday"}] })), TODAY);
        assert!(matches!(twin.as_slice(), [Change::ItemRefined { now, .. }] if now.status == ItemStatus::Dismissed), "{twin:?}");
    }

    #[test]
    fn a_correction_is_checked_against_the_point_that_corrects_it() {
        // "Biology midterm is Tuesday" has more of the title's words; the later point names the day.
        let mut world = map(&[("T1", "Biology midterm", &["Biology midterm is Tuesday.", "Midterm is Wednesday, not Tuesday."])]);
        world.actions = stale_map().actions[..1].to_vec();
        world.actions[0].title = "Biology midterm".into();
        let pass = serde_json::json!({ "revise": [{"id": "ac-0a1b2c", "title": "", "when": "2026-11-04", "why": "midterm is Wednesday"}] });
        let out = changes_on(&world, serde_json::from_value(pass).unwrap(), TODAY);
        assert!(matches!(out.as_slice(), [Change::ItemRefined { now, .. }] if now.when == "2026-11-04"), "{out:?}");
    }

    #[test]
    fn two_rows_corrected_to_one_day_in_one_pass_leave_one() {
        let mut world = map(&[("T1", "Midterm", &["Midterm is on Tuesday.", "Midterm is Wednesday.", "Both midterms are Thursday now."])]);
        world.actions = stale_map().actions[..1].to_vec();
        world.actions.push(Action { id: "ac-9f8e7d6c5b4a".into(), when: "2026-11-04".into(), ..world.actions[0].clone() });
        let pass = serde_json::json!({ "revise": [
            {"id": "ac-0a1b2c", "title": "Midterm", "when": "2026-11-05", "why": "Thursday now"},
            {"id": "ac-9f8e7d", "title": "Midterm", "when": "2026-11-05", "why": "Thursday now"},
        ] });
        changes_on(&world.clone(), serde_json::from_value(pass).unwrap(), TODAY).iter().for_each(|c| world.apply(c));
        let open: Vec<_> = world.actions.iter().filter(|a| a.status == ItemStatus::New).map(|a| a.when.as_str()).collect();
        assert_eq!(open, ["2026-11-05"]);
    }

    #[test]
    fn a_correction_waits_when_its_thread_heard_more_or_its_item_was_acted_on() {
        let sent = stale_map();
        let mut now = sent.clone();
        now.thoughts.push(Thought { id: "thu".into(), text: "No, the midterm is Thursday.".into(), ..sent.thoughts[1].clone() });
        let mut pass: Pass = serde_json::from_value(serde_json::json!({
            "revise": [{"id": "ac-0a1b2c", "title": "Midterm", "when": "2026-11-04", "why": "Wednesday"}],
            "retire": [{"id": "sg-2c3d4e", "why": "conference cancelled"}],
        })).unwrap();
        drop_stale_titles(&mut pass, &sent, &now);
        assert_eq!((pass.revise.len(), pass.retire.len()), (0, 1), "T1 heard Thursday; T2 heard nothing");
        // Approved while the pass was worked out: the correction would put the row back to new.
        let out = changes_on(&sent, pass, TODAY);
        let mut kept = sent.clone();
        kept.suggestions[0].status = ItemStatus::Kept;
        assert!(out.iter().all(|c| super::as_left(&sent, c)) && !out.iter().all(|c| super::as_left(&kept, c)), "{out:?}");
    }

    #[test]
    fn a_pass_is_asked_for_withdrawals_and_corrections_with_short_ids() {
        assert_eq!(super::short("ac-0a1b2c3d4e5f"), "ac-0a1b2c");
        assert_eq!(super::short("a7"), "a7");
        let body = super::request(&stale_map(), 0, TODAY);
        let schema = &body["response_format"]["json_schema"]["schema"];
        assert!(schema["required"].as_array().unwrap().iter().any(|r| r == "retire") && schema["properties"]["revise"]["items"]["required"][3] == "why");
        let user = body["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains("Open ideas and tasks (id on thread: what):\nsg-2c3d4e on T2: idea \"Book Lisbon flights\""), "{user}");
    }

    /// The four stale cards against the real model, and the same map before anything changed (none may move):
    ///   MODEL_API_KEY=… RUNS=3 cargo test -- --ignored refiner_stale_live --nocapture
    #[tokio::test]
    #[ignore = "calls the real model; needs MODEL_API_KEY"]
    async fn refiner_stale_live() {
        let key = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty()).expect("MODEL_API_KEY");
        let runs: usize = std::env::var("RUNS").ok().and_then(|r| r.parse().ok()).unwrap_or(3);
        let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().unwrap();
        let stale = stale_map();
        // Before the later points: each thread's first point only.
        let mut calm = stale.clone();
        let firsts: HashSet<String> = calm.threads.iter().filter_map(|t| calm.thoughts.iter().find(|p| p.thread_id.as_deref() == Some(&t.id)).map(|p| p.id.clone())).collect();
        calm.thoughts.retain(|p| firsts.contains(&p.id));
        for (name, world) in [("stale", &stale), ("calm", &calm)] {
            for run in 0..runs {
                let body = super::request(world, 0, TODAY);
                let value = crate::model::answer(http.post(super::URL).bearer_auth(&key).json(&body).send().await.unwrap()).await.unwrap();
                let pass: Pass = serde_json::from_str(value["choices"][0]["message"]["content"].as_str().unwrap()).unwrap();
                let out = changes_on(world, pass, TODAY);
                let mut after = world.clone();
                out.iter().for_each(|c| after.apply(c));
                let row = |id: &str| { let s = item(&after, id); format!("{:?} {} {}", s.status, s.text, s.when) };
                let refined = out.iter().filter(|c| matches!(c, Change::ItemRefined { .. })).count();
                println!("{name} run {run}: {refined} refined; added {:?}", shown(&out).iter().filter(|l| !l.contains('#')).collect::<Vec<_>>());
                for id in ["ac-0a1b2c3d4e5f", "sg-2c3d4e5f6a7b", "ac-1b2c3d4e5f6a", "sg-3d4e5f6a7b8c"] {
                    println!("  {}", row(id));
                }
                for c in &out {
                    if let Change::ItemRefined { why, .. } = c { println!("  why: {why}"); }
                }
            }
        }
    }

    #[test]
    fn an_undo_puts_back_what_the_latest_change_replaced_and_replay_agrees() {
        let mut world = stale_map();
        let revise = |when: &str| serde_json::from_value::<Pass>(serde_json::json!({ "revise": [{"id": "ac-0a1b2c", "title": "", "when": when, "why": "moved"}] })).unwrap();
        let mut journal = Vec::new();
        for when in ["2026-11-04"] {
            let out = changes_on(&world, revise(when), TODAY);
            out.iter().for_each(|c| world.apply(c));
            journal.extend(out);
        }
        let (now, was) = world.refined["ac-0a1b2c3d4e5f"].clone();
        assert_eq!((now.when.as_str(), was.when.as_str()), ("2026-11-04", "2026-11-03"));
        let undo = Change::ItemRestored { id: "ac-0a1b2c3d4e5f".into(), to: was };
        world.apply(&undo);
        journal.push(undo);
        assert_eq!(item(&world, "ac-0a1b2c3d4e5f").when, "2026-11-03");
        // The journal's lines rebuild the same map.
        let mut replayed = stale_map();
        for line in journal.iter().map(|c| serde_json::to_string(c).unwrap()) {
            replayed.apply(&serde_json::from_str(&line).unwrap());
        }
        assert_eq!(serde_json::to_string(&replayed).unwrap(), serde_json::to_string(&world).unwrap());
        assert!(replayed.restored.contains("ac-0a1b2c3d4e5f") && replayed.refined.is_empty());
    }

}

/// Live checks against the real model (ignored unless asked for; see the file).
#[cfg(test)]
#[path = "refiner_live.rs"]
mod live;
