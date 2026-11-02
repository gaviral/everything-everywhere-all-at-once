//! Placer: asks a Muse model where each new thought belongs, one thought at a time,
//! so every placement sees the map the previous one left.

use crate::world::{find, matches, swap, Change, Thought, Thread, ThreadStatus, World};
use crate::{model::Verdict, now_ms, protocol::ServerMsg, Core};
use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

const URL: &str = "https://api.meta.ai/v1/chat/completions";

// Stable text first, so the API's prompt cache can reuse it.
// An update stays on its thread, and a branch's parent is the thread it is one part of: "a different part of a thread"
// made a price or a moved date its own branch, and "the thread it branched from" hung a cafe shift under a midterm it
// clashed with. Replaying 48 recorded placements twice (2026-11-01, Spark 1.2, minimal): updates on their thread 28 →
// 55 of 68, branches under an unrelated thread 13 → 0 of 16; a party's invite list and cake still branch (12 of 12).
const SYSTEM: &str = "You keep a live map of a person's spoken thoughts as threads: topics and the tangents that branch from them. \
For each NEW THOUGHT decide: \"continue\" if it says more about the active thread (a detail, an update, an answer, a correction, \
news that something is done), \"return\" if it says more about an earlier thread, \
or \"new\" if it starts a new topic or a tangent (parent_id: the thread whose own subject it is one part of, such as the hostel for a trip; \
never one it only clashes with, shares a day or a word with, or was said after; else empty). \
An update on what a thread is about goes on that thread, even with a new detail; \
which thread that is goes by what the words mean, read with what was said just before, never by a word shared with a title. \
Being about the same project is not enough to continue. \
Place by what the words are about, not by how they are said or a word they share with a title: \
a thought that trails off belongs with its own topic, never with a thread about unfinished thoughts. \
\"skip\" if it adds nothing, such as \"yeah\" or \"okay\" when nothing was asked; never skip \"yes\", \"no\" or any other answer. \
split: if it moves on to another thread partway, the exact words where that starts (the other fields describe only the words before), else an empty string; \
never between two sentences about one thing, such as a deadline and what is due by then. \
thread_id: the existing thread for continue or return. title: up to 5 words, for a new thread. \
point: the thought in at most 12 words, in the speaker's own voice; a question they ask stays a question, one they quote keeps who asked. \
complete: false if the thought trails off unfinished (for example \"I need to pay rent before\"), else true. \
dropped: ids of other threads the speaker clearly left unfinished mid-thought, else empty. \
unclear: words that look mistranscribed, such as a near miss of a name on the map, else an empty string. \
guess: what those words most likely were, judging by the context, else an empty string. \
sure: true only if the context leaves no doubt about the guess (for example the right name is already on the map), else false. \
joins: \"before\" if the new thought carries on the words said just before, cut off from them by a pause: it finishes that sentence, \
or can't stand alone without it (\"the one on Main Street\" right after naming a class); \"unfinished\" if it finishes the words left unfinished; \
else \"none\". A sentence that stands on its own, or a decision, is \"none\", even on the same topic. On a join, point says the whole idea, both parts. \
assumed: if where it goes rests on a reading the words leave open (what \"it\" or \"that\" means, which of two threads is meant), \
that reading in at most 8 words, such as \"'it' is the pottery class\", else an empty string. \
why: why it goes there, in at most 10 words, naming the words that show it, such as \"names the lease\", never an id. Answer with JSON only.";

/// A skip never sets aside a turn longer than this, whatever the model says: filler is short.
const SKIP_MAX_WORDS: usize = 8;

/// Words that join two parts of a turn; left out where it's cut in two.
const JOINS: [&str; 9] = ["and", "also", "plus", "but", "so", "oh", "then", "anyway", "or"];

/// Tokens a placement may use, its reasoning included (Spark's counts toward max_tokens, as in find.rs). Plenty for
/// a short turn. But the 1,672-character rest of a turn used up all 2,000 before its JSON ended (2026-11-01: cut off
/// after 9.7 s, then answered in 3.2 s on the same request), so a turn over 1,000 characters gets two tokens a
/// character (3,344 for that one).
const ROOM: u32 = 2000;

/// How many of the same placement call go at once, the first good answer winning, unless PLACER_RACE says otherwise
/// (1 turns it off). A placement's time is nearly all reasoning, and how long it reasons varies from call to call:
/// on 281 placements from two replays (2026-11-01, Spark 1.2 Contributor, minimal effort) time was 0.9 s + 4 ms a
/// completion token (r = 0.94) and barely followed prompt size (r = 0.21); the median was 2.6 s, the slowest tenth
/// over 4.3 s, the slowest 7.7 s. The faster of two draws from that spread is 2.1 s at the median and 3.1 s at the
/// 90th percentile; starting the second only once the first is slow saves little (at 3 s: 90th percentile unchanged),
/// since most of the spread is above the median. Cost: twice a placement's tokens (≈ US$0.004 more a thought on
/// Spark 1.2) and two calls of the hourly cap (model.rs `CALLS_PER_HOUR`: its busiest measured hour had 77
/// placements, so ≈ 280 of 400).
pub const RACE: usize = 2;

/// `RACE`, or PLACER_RACE when it's a whole number from 1 to 4.
pub fn race_from_env() -> usize {
    match std::env::var("PLACER_RACE").ok().map(|v| v.trim().parse::<usize>()) {
        None => RACE,
        Some(Ok(n)) if (1..=4).contains(&n) => n,
        Some(_) => {
            tracing::warn!("PLACER_RACE isn't a whole number from 1 to 4: using {RACE}");
            RACE
        }
    }
}

/// The most room a placement is asked for: as much as the chat import asks for.
const MAX_ROOM: u32 = 12_000;

/// What the placer works through, in the order it was said: a thought to place, or a speaker's spoken
/// command. A command waits behind the thoughts said before it, so their placements can't undo it.
pub enum Job {
    Place(String),
    Back(String),
    Next(String),
    Previous(String),
}

/// "New thread": the next thought a speaker says after it starts a thread of its own, whatever the model
/// answers, unless the model sets it all aside as filler. Asking ends at that thought, or when the speaker
/// moves to a thread before saying one ("where was I?", a click), since they're somewhere again. Kept in
/// memory: after a restart that thought is placed as any.
#[derive(Default)]
pub struct NewThreads {
    /// Speakers who asked, until their next thought.
    asked: Mutex<HashSet<String>>,
    /// Those thoughts, until placed.
    thoughts: Mutex<HashSet<String>>,
}

impl NewThreads {
    pub fn ask(&self, speaker: &str) {
        self.asked.lock().unwrap().insert(speaker.into());
    }

    pub fn cancel(&self, speaker: &str) {
        self.asked.lock().unwrap().remove(speaker);
    }

    /// The speaker said a thought: it starts the thread, if they asked for one.
    pub fn said(&self, speaker: &str, thought_id: &str) {
        if self.asked.lock().unwrap().remove(speaker) {
            self.thoughts.lock().unwrap().insert(thought_id.into());
        }
    }

    pub fn starts(&self, thought_id: &str) -> bool {
        self.thoughts.lock().unwrap().contains(thought_id)
    }

    /// Placed by `changes`; when they set aside only filler before the words, the `rest` starts the thread instead.
    fn placed(&self, thought_id: &str, changes: &[Change], rest: Option<&str>) {
        let mut thoughts = self.thoughts.lock().unwrap();
        thoughts.remove(thought_id);
        if changes.iter().any(|c| matches!(c, Change::ThoughtSkipped { .. })) {
            thoughts.extend(rest.map(String::from));
        }
    }
}

#[derive(Deserialize)]
struct Placement {
    /// Where the turn moves on to another thread, quoted; empty when it stays on one.
    #[serde(default)]
    split: String,
    action: String,
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    parent_id: String,
    #[serde(default)]
    point: String,
    #[serde(default = "yes")]
    complete: bool,
    #[serde(default)]
    dropped: Vec<String>,
    #[serde(default)]
    unclear: String,
    #[serde(default)]
    guess: String,
    #[serde(default)]
    sure: bool,
    /// "before" or "unfinished": it carries on those words, cut off by a pause (chunks.rs).
    #[serde(default)]
    joins: String,
    /// A reading the words left open that decided where it goes.
    #[serde(default)]
    assumed: String,
    /// Why it goes there, in a few words.
    #[serde(default)]
    why: String,
}

fn yes() -> bool {
    true
}

/// Models sometimes write an empty answer as "\"\"" or "none"; treat those as empty.
fn clean(text: &str) -> String {
    let t = text.trim().trim_matches('"').trim();
    match t.to_lowercase().as_str() {
        "none" | "n/a" | "null" | "-" => String::new(),
        _ => t.to_string(),
    }
}

pub async fn run(core: Arc<Core>, queue: mpsc::UnboundedReceiver<Job>) {
    serve(core, queue, URL, PATIENCE).await
}

/// How long a try may take, by its room: the first try is short, so one stalled call can't hold back the words
/// said after it; a later try gets the time a slow answer needs.
#[derive(Clone, Copy)]
struct Patience {
    first: fn(u32) -> Duration,
    later: fn(u32) -> Duration,
}

const PATIENCE: Patience = Patience { first: first_try, later: patience };

/// The placer at `url`. One call at a time, in the order things were said, so each placement sees the map the
/// one before left. A try that fails or runs out of time puts the thought back at the end of the line (0.5 s,
/// then 1 s later), so the words after it go on landing; a third failure is said once, and the thought tries again
/// 15 s later, doubling to 4 min. A spoken command waits only for the speaker's own words said before it that
/// haven't had their first try yet: not for the other person's, and not for a retry.
async fn serve(core: Arc<Core>, mut queue: mpsc::UnboundedReceiver<Job>, url: &str, patience: Patience) {
    let mut line: VecDeque<Job> = VecDeque::new();
    // Failed tries so far, for each thought still waiting to be placed.
    let mut tries: HashMap<String, u32> = HashMap::new();
    // The rest of a turn cut in two goes next, before anything said after it.
    let mut rest: Option<String> = None;
    loop {
        while let Ok(job) = queue.try_recv() {
            line.push_back(job);
        }
        if let Some(id) = rest.take() {
            line.push_front(Job::Place(id));
        }
        act_on_commands(&core, &mut line, &tries);
        let thought_id = match line.pop_front() {
            Some(Job::Place(id)) => id,
            // Never blocked at the front: no word of its speaker's is ahead of it.
            Some(command) => {
                core.act(command);
                continue;
            }
            None => match queue.recv().await {
                Some(job) => {
                    line.push_back(job);
                    continue;
                }
                None => return,
            },
        };
        let Some(speaker) = core.snapshot().thoughts.iter().find(|t| t.id == thought_id && !t.placed).map(|t| t.speaker.clone())
        else {
            continue;
        };
        let failed = tries.get(&thought_id).copied().unwrap_or(0);
        core.placing.start(&core, &thought_id);
        let limit = if failed == 0 { patience.first } else { patience.later };
        match place(&core, &thought_id, url, limit).await {
            Ok(next) => {
                tries.remove(&thought_id);
                core.placing.placed(&core, &thought_id, next.as_deref());
                rest = next;
            }
            // Nothing can place it until a restart with a working key, and every window was told: it waits,
            // saved, and is placed after that restart.
            Err(_) if core.key_refused() => core.placing.stopped(&core),
            Err(e) => {
                let busy = Verdict::of(&e) == Some(Verdict::Busy);
                // The hour's cap lasts minutes, not a blip: it skips the quick tries and counts as a whole round, so
                // the thought waits for the later retry, one a round (15 s, then doubling).
                let capped = Verdict::of(&e) == Some(Verdict::Capped);
                let failed = if capped { (failed / 3 + 1) * 3 } else { failed + 1 };
                tries.insert(thought_id.clone(), failed);
                let (round, wait) = match failed % 3 {
                    0 => (Some(failed / 3 - 1), retry_in(failed / 3 - 1)),
                    n => (None, Duration::from_millis(500 * u64::from(n))),
                };
                if round.is_none() {
                    tracing::warn!("placement failed (try {failed}): {e:#}");
                } else {
                    tracing::warn!("placement failed: {e:#}");
                }
                // Said once: its pill says it's retrying. A busy service or the hour's cap was already said.
                if round == Some(0) && !busy && !capped {
                    core.send(ServerMsg::Error { message: format!("Couldn't place a thought: {e}") });
                }
                // Without a key nothing would change by then.
                if round.is_some() && core.key.is_none() {
                    core.placing.stopped(&core);
                    continue;
                }
                core.placing.retry(&core, &thought_id, &speaker, wait);
                if busy {
                    // Every call would be refused for now: the whole line waits, not only this thought.
                    tokio::time::sleep(wait).await;
                    line.push_back(Job::Place(thought_id));
                } else {
                    let (core, id) = (core.clone(), thought_id);
                    tokio::spawn(async move {
                        tokio::time::sleep(wait).await;
                        let _ = core.placer_queue.send(Job::Place(id));
                    });
                }
            }
        }
    }
}

/// Acts on each command in the line whose speaker has none of their own words ahead of it still waiting for a
/// first try (see `Core::run_command`); the others keep their place.
fn act_on_commands(core: &Core, line: &mut VecDeque<Job>, tries: &HashMap<String, u32>) {
    if line.iter().all(|job| matches!(job, Job::Place(_))) {
        return;
    }
    let world = core.snapshot();
    let mut waiting: HashSet<&str> = HashSet::new();
    let mut kept = VecDeque::with_capacity(line.len());
    for job in line.drain(..) {
        match job {
            Job::Place(id) => {
                let unplaced = world.thoughts.iter().find(|t| t.id == id && !t.placed);
                if let Some(t) = unplaced.filter(|_| !tries.contains_key(&id)) {
                    waiting.insert(t.speaker.as_str());
                }
                kept.push_back(Job::Place(id));
            }
            command => match command.speaker() {
                speaker if waiting.contains(speaker) => kept.push_back(command),
                _ => core.act(command),
            },
        }
    }
    *line = kept;
}

impl Job {
    fn speaker(&self) -> &str {
        match self {
            Job::Place(_) => "",
            Job::Back(s) | Job::Next(s) | Job::Previous(s) => s,
        }
    }
}

/// Where each unplaced thought stands, for its pill and for commands: the one being placed now, and those whose
/// try failed and that wait to try again. Kept in memory; after a restart every unplaced thought is in line again.
#[derive(Default)]
pub struct Placing(Mutex<PlacingState>);

#[derive(Default)]
struct PlacingState {
    now: Option<String>,
    /// Thought id → (speaker, when it tries again).
    retries: HashMap<String, (String, u64)>,
    /// Retrying thoughts whose speaker has moved since: landing late, they don't move them back.
    stay: HashSet<String>,
}

impl Placing {
    /// What windows show: the thought being placed, and each retry with the time until it tries again.
    pub fn message(&self) -> ServerMsg {
        let state = self.0.lock().unwrap();
        let now = now_ms();
        let mut retries: Vec<Retry> = state
            .retries
            .iter()
            .map(|(id, (_, at))| Retry { thought_id: id.clone(), in_ms: at.saturating_sub(now) })
            .collect();
        retries.sort_by(|a, b| a.thought_id.cmp(&b.thought_id));
        ServerMsg::Placing { now: state.now.clone(), retries }
    }

    /// Whether a try to place the thought has failed: a command no longer waits for it.
    pub fn failed(&self, thought_id: &str) -> bool {
        self.0.lock().unwrap().retries.contains_key(thought_id)
    }

    /// The speaker moved (a command or a click): their thoughts still retrying won't move them when they land.
    pub fn moved(&self, speaker: &str) {
        let mut state = self.0.lock().unwrap();
        let theirs: Vec<String> = state.retries.iter().filter(|(_, (s, _))| s == speaker).map(|(id, _)| id.clone()).collect();
        state.stay.extend(theirs);
    }

    fn stays(&self, thought_id: &str) -> bool {
        self.0.lock().unwrap().stay.contains(thought_id)
    }

    fn start(&self, core: &Core, thought_id: &str) {
        self.0.lock().unwrap().now = Some(thought_id.into());
        core.send(self.message());
    }

    fn stopped(&self, core: &Core) {
        self.0.lock().unwrap().now = None;
        core.send(self.message());
    }

    /// Placed; the rest of its turn, if cut in two, stays put as it would have.
    fn placed(&self, core: &Core, thought_id: &str, rest: Option<&str>) {
        {
            let mut state = self.0.lock().unwrap();
            state.now = None;
            state.retries.remove(thought_id);
            if state.stay.remove(thought_id) {
                state.stay.extend(rest.map(String::from));
            }
        }
        core.send(self.message());
    }

    pub(crate) fn retry(&self, core: &Core, thought_id: &str, speaker: &str, wait: Duration) {
        {
            let mut state = self.0.lock().unwrap();
            state.now = None;
            let at = now_ms() + u64::try_from(wait.as_millis()).unwrap_or(u64::MAX);
            state.retries.insert(thought_id.into(), (speaker.into(), at));
        }
        core.send(self.message());
    }
}

/// A thought that failed a try: it tries again in `in_ms` (0: it's back in line).
#[derive(Clone, Serialize)]
pub struct Retry {
    pub thought_id: String,
    pub in_ms: u64,
}

/// How long a thought waits after a round of failed tries before the next: 15 s, doubling to 4 min,
/// so it lands soon after a blip without calling the model every few seconds through an outage.
fn retry_in(round: u32) -> Duration {
    Duration::from_secs(15 << round.min(4))
}

/// Places one thought, asking the model at `url` and giving each call `limit` for its room; when the turn moved on to
/// another topic partway, returns the rest's id.
async fn place(core: &Core, thought_id: &str, url: &str, limit: fn(u32) -> Duration) -> anyhow::Result<Option<String>> {
    core.key()?;
    let world = core.snapshot();
    let thought = world
        .thoughts
        .iter()
        .find(|t| t.id == thought_id)
        .cloned()
        .context("thought not found")?;
    if thought.placed {
        return Ok(None);
    }
    let new_thread = core.new_threads.starts(thought_id);

    // An answer cut off at its room is asked for once more with twice the room, not again with the same.
    let (mut room, mut again) = (room_for(&thought.text), false);
    let placement = loop {
        // Placements take 2–3 s; a stall should cost seconds, not the shared client's two minutes a try. The same
        // call goes `placer_race` times at once and the first good answer wins (see `RACE`); the others are dropped.
        // Only while the hourly cap has room for every lane: at the cap, one call goes, so the extra one can't be the
        // call refused there and show "AI paused" while the first places the thought.
        let lanes = core.placer_race.max(1);
        let lanes = if core.calls_left() >= lanes { lanes } else { 1 };
        let mut calls: futures_util::stream::FuturesUnordered<_> = (0..lanes)
            .map(|lane| {
                core.ask_model(
                    &core.placer_model,
                    url,
                    limit(room),
                    |model| request(&world, &thought, model, room, new_thread),
                    json!({"thought": thought_id, "room": room, "lane": lane}),
                )
            })
            .collect();
        let (mut won, mut cut_off, mut failed) = (None, false, None);
        while let Some(answer) = futures_util::StreamExt::next(&mut calls).await {
            match answer.and_then(|body| read(&body)) {
                Ok(Some(placement)) => {
                    won = Some(placement);
                    break;
                }
                Ok(None) => cut_off = true,
                Err(e) => failed = failed.or(Some(e)),
            }
        }
        drop(calls);
        match (won, cut_off, failed) {
            (Some(placement), _, _) => break placement,
            (None, false, Some(e)) => return Err(e),
            (None, _, _) if !again && room < MAX_ROOM => {
                let more = (2 * room).min(MAX_ROOM);
                tracing::info!("answer cut off at {room} tokens: asking once more with {more}");
                (room, again) = (more, true);
            }
            (None, _, _) => bail!("answer cut off at {room} tokens"),
        }
    };
    // From when the thought arrived, so time waiting in the queue counts too.
    let place_ms = now_ms().saturating_sub(thought.at_ms);
    // The parent asked for too: a branch that shouldn't be one shows here, not only in a trace file.
    tracing::info!("placed in {place_ms} ms: {} {} parent {:?}", placement.action, placement.thread_id, placement.parent_id);

    let answer = (placement.action.clone(), placement.thread_id.clone(), placement.title.clone(), placement.split.clone());
    // Landing after the speaker moved on (newer words of theirs landed, or they moved while it retried), it
    // doesn't take them back to where they were.
    let now = now_ms();
    let moves = !core.placing.stays(thought_id) && !said_since(&world, &thought, now).any(|t| t.speaker == thought.speaker);
    let (changes, rest) = settle(&world, &thought, placement, place_ms, new_thread, moves);
    // Words taken back while the model thought ("scratch that", catalog.rs) leave no thread, touch or move behind.
    let waiting = |w: &World| w.thoughts.iter().any(|t| t.id == thought_id && !t.placed);
    if !waiting(&core.snapshot()) {
        tracing::info!("placed {thought_id} after it was taken back: dropped");
        return Ok(None);
    }
    core.trace.write(|| traced(&world, &thought, answer, new_thread, &changes, rest.as_deref()));
    drop(world);
    if new_thread {
        core.new_threads.placed(thought_id, &changes, rest.as_deref());
    }
    if !core.commit_if(waiting, changes) {
        return Ok(None);
    }
    Ok(rest)
}

/// A placement's trace line: the words, the thread active for the speaker when they were placed (the one
/// selected, or the last spoken on), what the model answered, and where they landed. Lines about the same
/// words share the thought's id; a split turn's rest gets its own line when it's placed.
fn traced(
    world: &World,
    thought: &Thought,
    (action, thread_id, title, split): (String, String, String, String),
    new_thread: bool,
    changes: &[Change],
    rest: Option<&str>,
) -> serde_json::Value {
    // A thread this placement made isn't on the map yet: its title is in the changes.
    let title_of = |id: &str| {
        changes
            .iter()
            .find_map(|c| match c {
                Change::ThreadAdded { thread } if thread.id == id => Some(thread.title.clone()),
                _ => None,
            })
            .or_else(|| world.thread(id).map(|t| t.title.clone()))
    };
    let (landed, point) = changes
        .iter()
        .find_map(|c| match c {
            Change::ThoughtPlaced { thread_id, point, .. } => Some((thread_id.clone(), point.clone())),
            _ => None,
        })
        .unzip();
    let active = world.active_for(&thought.speaker).cloned();
    json!({
        "kind": "placed",
        "thought": thought.id,
        "speaker": thought.speaker,
        "text": thought.text,
        "active": active,
        "active_title": active.as_deref().and_then(title_of),
        "answer": {"action": action, "thread_id": thread_id, "title": title, "split": split},
        "new_thread_asked": new_thread,
        "skipped": changes.iter().any(|c| matches!(c, Change::ThoughtSkipped { .. })),
        "landed": landed,
        "landed_title": landed.as_deref().and_then(title_of),
        "new": changes.iter().any(|c| matches!(c, Change::ThreadAdded { .. })),
        "point": point,
        "note": changes.iter().find_map(|c| match c {
            Change::ThoughtNoted { note, .. } => Some(note),
            _ => None,
        }),
        "rest": rest,
    })
}

/// The room a turn gets (see `ROOM`).
fn room_for(text: &str) -> u32 {
    u32::try_from(2 * text.len()).unwrap_or(MAX_ROOM).clamp(ROOM, MAX_ROOM)
}

/// The thoughts placed that were said after `thought`: by when each was said, then by their place in the list, so
/// two said in the same millisecond (a queue sent on reconnecting) or a turn's parts (which share its time) keep the
/// order they were said in.
fn said_since<'a>(world: &'a World, thought: &Thought, now: u64) -> impl Iterator<Item = &'a Thought> {
    let at = (thought.said_at(now), world.thoughts.iter().position(|t| t.id == thought.id).unwrap_or(usize::MAX));
    world.thoughts.iter().enumerate().filter(move |(i, t)| t.placed && (t.said_at(now), *i) > at).map(|(_, t)| t)
}

/// How long a later try may take: twice what filling its room takes. The 2,000 tokens that ran out took 9.7 s
/// (2026-11-01), so 4 s and 8 ms a token of room: 20 s for a short turn, and time to use a long turn's room.
fn patience(room: u32) -> Duration {
    Duration::from_millis(4_000 + 8 * u64::from(room))
}

/// How long a first try may take: 1.2 times what filling its whole room takes (9.7 s for 2,000 tokens, so 6 ms a
/// token): 12 s for a short turn. Well above every placement measured on this code: 62 placements from the
/// talks in `scripts/` replayed with demo.mjs (2026-11-01, scripts/trace-summary.mjs), median 2.5 s, slowest 4.4 s.
/// One that runs out goes back in line with `patience`, so a slow answer costs one wasted try, not the thought.
fn first_try(room: u32) -> Duration {
    Duration::from_millis(6 * u64::from(room))
}

/// The placement in a model answer, or None when the answer was cut off at its room: finish_reason "length", or
/// JSON that ends mid-way.
fn read(body: &serde_json::Value) -> anyhow::Result<Option<Placement>> {
    let choice = &body["choices"][0];
    let cut_off = choice["finish_reason"] == "length";
    let content = choice["message"]["content"].as_str().filter(|c| !c.trim().is_empty());
    if cut_off && content.is_none() {
        return Ok(None);
    }
    match serde_json::from_str(content.context("no answer")?) {
        Ok(placement) => Ok(Some(placement)),
        Err(e) if cut_off || e.is_eof() => Ok(None),
        Err(e) => Err(e).context("answer wasn't the expected JSON"),
    }
}

/// The changes for one answer. A turn that moved on to another topic is cut in two first: the answer
/// places the words before, and the rest, returned, is placed next on the map this one leaves.
/// `new_thread`: the thought starts a thread of its own (see `NewThreads`).
fn settle(world: &World, thought: &Thought, mut p: Placement, place_ms: u64, new_thread: bool, moves: bool) -> (Vec<Change>, Option<String>) {
    let Some((before, rest)) = cut(&thought.text, &p.split) else {
        // A quote that cuts nothing leaves the model unsure which words were filler: place them all.
        if p.action == "skip" && !clean(&p.split).is_empty() {
            p.action = "continue".into();
        }
        return (decide(world, thought, p, place_ms, new_thread, moves), None);
    };
    let first = Thought { text: before.clone(), ..thought.clone() };
    // Misheard words in the rest are found again when it's placed.
    if find(&first.text, &clean(&p.unclear)).is_none() {
        (p.unclear, p.guess, p.sure) = (String::new(), String::new(), false);
    }
    let rest = Thought {
        id: format!("th-{}", uuid::Uuid::new_v4().simple()),
        text: rest,
        point: String::new(),
        placed: false,
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: true,
        place_ms: None,
        ..thought.clone()
    };
    let rest_id = rest.id.clone();
    let mut changes = vec![Change::ThoughtSplit { thought_id: thought.id.clone(), text: before, rest }];
    changes.extend(decide(world, &first, p, place_ms, new_thread, moves));
    (changes, Some(rest_id))
}

/// Cuts a turn where the model says it moved on to another topic: the words before, and the rest.
/// The quote is found as said (whole words, its last match), or failing that by its first four or three
/// words, so a reworded ending still cuts in the right place. Joining words at the cut ("and also"),
/// on either side, are left out. None when the quote isn't there or either side would be empty.
fn cut(text: &str, quote: &str) -> Option<(String, String)> {
    let words: Vec<&str> = quote.trim_matches(|c: char| !c.is_alphanumeric()).split_whitespace().collect();
    let mut tries = vec![words.len(), 4, 3];
    tries.retain(|&n| n > 0 && n <= words.len());
    tries.dedup();
    let at = tries.iter().find_map(|&n| matches(text, &words[..n].join(" ")).last().map(|r| r.start))?;
    let mut before = text[..at].trim_end();
    loop {
        let trimmed = before.trim_end_matches(|c: char| c.is_whitespace() || ",;:—–-".contains(c));
        let trimmed = match trimmed.rsplit_once(char::is_whitespace) {
            Some((head, last)) if JOINS.contains(&last.to_lowercase().as_str()) => head,
            None if JOINS.contains(&trimmed.to_lowercase().as_str()) => "",
            _ => trimmed,
        };
        if trimmed.len() == before.len() {
            break;
        }
        before = trimmed;
    }
    let mut rest = text[at..].trim();
    loop {
        let trimmed = rest.trim_start_matches(|c: char| c.is_whitespace() || ",;:—–-".contains(c));
        let trimmed = match trimmed.split_once(char::is_whitespace) {
            Some((first, tail)) if JOINS.contains(&first.trim_end_matches([',', ';', ':']).to_lowercase().as_str()) => tail,
            _ => trimmed,
        };
        if trimmed.len() == rest.len() {
            break;
        }
        rest = trimmed;
    }
    (!before.is_empty() && !rest.is_empty()).then(|| (before.to_string(), rest.to_string()))
}

#[cfg(test)]
pub(crate) fn perf(world: &World, thought: &Thought) {
    crate::perf::measure_bytes("placer lookup + prompt", || {
        let thought = world.thoughts.iter().find(|t| t.id == thought.id).unwrap().clone();
        serde_json::to_vec(&request(world, &thought, "perf-model", ROOM, false)).unwrap()
    });
    crate::perf::measure("placer settle + dropped scans", || {
        let answer = json!({"action": "return", "thread_id": "T2", "point": "Review the project budget",
            "dropped": ["T1", "T149", "T150"]});
        settle(world, thought, serde_json::from_value(answer).unwrap(), 2_000, false, true)
    }, |(changes, _)| serde_json::to_vec(changes).unwrap().len());
}

fn request(world: &World, thought: &Thought, model: &str, room: u32, new_thread: bool) -> serde_json::Value {
    // Oldest-touched first, the one just spoken on last (refiner.rs orders its list the same way): a placement
    // rewrites only its own thread's line, so with the threads in the order they were made every line after it was a
    // new prefix, and the cache held the system prompt only (625 tokens) in 14 of 24 calls on a 300-thread map
    // (scale-2026-11-01.md). Ties (an import, a map made at once) keep the order they were made in.
    let mut ordered: Vec<&Thread> = world.threads.iter().collect();
    ordered.sort_by_key(|t| t.touched_ms);
    let threads = if ordered.is_empty() {
        "(none yet)".to_string()
    } else {
        ordered
            .into_iter()
            .map(|t| {
                let status = if t.status == ThreadStatus::Dropped { "dropped" } else { "open" };
                format!("{}: {} [{status}] last: {}", t.id, t.title, t.last_point)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let active = world.active_for(&thought.speaker).cloned().unwrap_or_else(|| "(none)".into());
    // A short turn right after a question may answer it ("Yeah."). The points above often drop the
    // "?", so the question goes in as said; without it the model sets the answer aside as filler.
    // The latest said before it, by time: imported points land last in the list, with their old times.
    let question = just_asked(world, thought);
    let asked = question.map(|t| format!("Just asked: \"{}\"\n", t.text.trim())).unwrap_or_default();
    // What the speaker said just before, word for word, and where it went: a thread's title and last point say
    // what it's about, not what was just said, so a turn on "the cursor thing" right after one on a coding tool's
    // subscription went to the thread named for the UI cursor (2026-11-01 replay). Only a turn said moments
    // before counts: in a real session turns came a median 31 s apart (9 s at the quarter), and one said longer
    // ago than `JUST_BEFORE_MS` is context the map's points already give. Left out only when it's that same turn
    // as the question just asked, which is already there; another speaker's question doesn't hide it.
    // Words left unfinished earlier, which this may finish (chunks.rs): "I never finish my", a tangent, "Sentences."
    let heads = crate::chunks::heads(world, thought, question);
    let quote = |label: &str, t: &Thought| Some(format!("{label} (placed in {}): \"{}\"\n", world.resolve(t.thread_id.as_deref()?), t.text.trim()));
    let before = heads.before.and_then(|t| quote("Said just before", t)).unwrap_or_default();
    let left = heads.left.and_then(|t| quote("Left unfinished", t)).unwrap_or_default();
    let names = names(world);
    let names = if names.is_empty() { String::new() } else { format!("Names said: {}\n", names.join(", ")) };
    // The thread it starts is new whatever the answer (see `decide`); told, the model gives it a title.
    let starts =
        if new_thread { "The speaker asked for a new thread: this thought starts it (\"new\"), unless it adds nothing.\n" } else { "" };
    json!({
        "model": model,
        "reasoning_effort": "minimal",
        "max_tokens": room,
        "prompt_cache_key": "e2a2o-placer",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Threads:\n{threads}\nActive thread: {active}\n{names}{asked}{before}{left}{starts}NEW THOUGHT: \"{}\"", thought.text)},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "Placement", "schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["continue", "return", "new", "skip"]},
                "thread_id": {"type": "string"},
                "title": {"type": "string"},
                "parent_id": {"type": "string"},
                "point": {"type": "string"},
                "split": {"type": "string"},
                "complete": {"type": "boolean"},
                "dropped": {"type": "array", "items": {"type": "string"}},
                "unclear": {"type": "string"},
                "guess": {"type": "string"},
                "sure": {"type": "boolean"},
                "joins": {"type": "string", "enum": ["none", "before", "unfinished"]},
                "assumed": {"type": "string"},
                "why": {"type": "string"}
            },
            "required": ["action", "thread_id", "title", "parent_id", "point", "split", "complete", "dropped", "unclear", "guess", "sure", "joins", "assumed", "why"]
        }}}
    })
}

/// The latest thing said before `thought`, by anyone, when it's a question and the thought is short enough to
/// answer it ("Yeah.").
fn just_asked<'a>(world: &'a World, thought: &Thought) -> Option<&'a Thought> {
    world
        .thoughts
        .iter()
        .take_while(|t| t.id != thought.id)
        .filter(|t| t.at_ms <= thought.at_ms)
        .max_by_key(|t| t.at_ms)
        .filter(|t| t.text.trim_end().ends_with('?') && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS)
}

/// How recent the turn said before must be to go in the prompt as said (see `request`): two minutes.
pub(crate) const JUST_BEFORE_MS: u64 = 120_000;

/// Names in the prompt, at most: the latest ones.
const NAMES: usize = 30;

/// Names said so far, the latest first: runs of capitalized words ("Muse Spark", "Main Street", "Dana") in the
/// words as said. Points are summaries and often drop the name, and then a near miss of it ("Muse Bark") has
/// nothing on the map to be a near miss of. Words still asked about ("Did you mean …?") don't count.
fn names(world: &World) -> Vec<String> {
    // Newest first by when it was said (see `Thought::said_at`): an import lands last in the list, with old times.
    // Reversed first, so the stable sort keeps a split turn's rest (same time) ahead of its first part.
    let now = now_ms();
    let mut said: Vec<&Thought> = world.thoughts.iter().rev().filter(|t| t.placed).collect();
    said.sort_by_key(|t| std::cmp::Reverse(t.said_at(now)));
    let mut seen = HashSet::new();
    said.into_iter()
        .flat_map(|t| {
            let text = if t.unclear.is_empty() { t.text.clone() } else { t.text.replace(t.unclear.as_str(), " ") };
            capitalized(&text).into_iter().rev()
        })
        .filter(|name| seen.insert(name.to_lowercase()))
        .take(NAMES)
        .collect()
}

/// The runs of capitalized words in one turn. A lone one opening a sentence is an ordinary word ("Okay",
/// "The"), as is "I"; a run opening a sentence loses a leading "The" or "And" ("The README" is "README").
fn capitalized(text: &str) -> Vec<String> {
    const OPENERS: [&str; 19] =
        ["the", "a", "an", "and", "but", "so", "oh", "okay", "ok", "yeah", "well", "then", "also", "anyway", "back", "hey", "my", "this", "that"];
    const ENDS: [char; 8] = ['.', '!', '?', ':', ';', '…', '—', '–'];
    let finish = |run: &mut Vec<&str>, opens: bool, out: &mut Vec<String>| {
        let mut words = &run[..];
        if opens && words.len() == 1 {
            words = &[];
        } else if opens && words.first().is_some_and(|w| OPENERS.contains(&w.to_lowercase().as_str())) {
            words = &words[1..];
        }
        if !words.is_empty() {
            out.push(words.join(" "));
        }
        run.clear();
    };
    let mut out = Vec::new();
    let (mut run, mut opens, mut end) = (Vec::new(), false, 0);
    let mut start = None;
    for (i, c) in text.char_indices().chain([(text.len(), ' ')]) {
        let inside = c.is_alphanumeric() || (start.is_some() && matches!(c, '\'' | '’' | '-'));
        match (inside, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                start = None;
                let raw = text[s..i].trim_end_matches(['\'', '’', '-']);
                let word = raw.strip_suffix("'s").or_else(|| raw.strip_suffix("’s")).unwrap_or(raw);
                let before = text[..s].trim_end();
                let capital = word.chars().next().is_some_and(char::is_uppercase)
                    && !(word == "I" || word.starts_with("I'") || word.starts_with("I’"));
                // A pause between two words ends a run: "Main Street, I think" is "Main Street".
                if !capital || text[end..s].contains([',', '.', '!', '?', ':', ';', '…', '—', '–', '(', ')', '"']) {
                    finish(&mut run, opens, &mut out);
                }
                if capital {
                    if run.is_empty() {
                        opens = before.is_empty() || before.ends_with(ENDS);
                    }
                    run.push(word);
                }
                end = i;
            }
            _ => {}
        }
    }
    finish(&mut run, opens, &mut out);
    out
}

/// Turns the model's answer into changes, trusting only ids that exist. Moves and drops belong to
/// the speaker: in a room, one person changing topic never drops a thread for the other.
/// `new_thread`: the speaker asked for one, so whatever is placed starts it (see `NewThreads`).
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64, new_thread: bool, moves: bool) -> Vec<Change> {
    // Nothing to place ("yeah" when nothing was asked): out of the map. A longer turn is placed anyway.
    // Never words that say a decision: "Okay, decided:" cut off by a pause is two words, and the rest needs it.
    if p.action == "skip" && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS && !crate::decided::said(&thought.text) {
        return vec![Change::ThoughtSkipped { thought_id: thought.id.clone() }];
    }
    let now = now_ms();
    let speaker = &thought.speaker;
    let exists = |id: &str| world.thread(id).is_some();
    // A guess only counts when something looked misheard and the guess differs.
    let unclear = clean(&p.unclear);
    let guess = match clean(&p.guess) {
        guess if unclear.is_empty() || guess.eq_ignore_ascii_case(&unclear) => String::new(),
        guess => guess,
    };
    // A guess the context leaves no doubt about is made without asking: marked, and one tap puts the
    // words back. Only for words really in what was said, and not when the guess was said too (then
    // it's less clear, and undo couldn't tell which words to put back). Anything less is asked.
    let sure = p.sure && !guess.is_empty() && find(&thought.text, &unclear).is_some() && find(&thought.text, &guess).is_none();
    let fix = |text: &str| if sure { swap(text, &unclear, &guess) } else { text.to_string() };
    let point = fix(if p.point.trim().is_empty() { thought.text.as_str() } else { p.point.trim() });
    let mut changes = Vec::new();
    // Carrying on words cut off by a pause, it goes where they are, whatever else the answer says: the two halves
    // are one idea (chunks.rs). Not when the speaker asked for a new thread.
    let head = if new_thread { None } else { crate::chunks::heads(world, thought, just_asked(world, thought)).joined(world, thought, &p.joins) };
    let was = world.active_for(speaker).cloned();

    // From the words as said (a sure fix in them), not the model's point: the mark echoes what they said. Carrying on
    // words cut off by a pause, read on from them: "Decided: I'll study with" … "Priya on Wednesday night" is one
    // decision, and the map shows the two as one point with this one's mark.
    let decided = crate::decided::said_after(head.as_ref().map(|h| h.text.as_str()), &fix(&thought.text));
    let target = match p.action.as_str() {
        _ if head.is_some() => head.as_ref().and_then(|h| h.thread_id.clone()),
        // A decision goes on the thread it decides, not a branch of its own: the model branched "decided: if it's
        // under $80, I'm booking it" off Mom's birthday as "Pottery Class Cost" (2026-11-01 take), so the birthday's
        // card never showed what was decided about it.
        "new" if decided && !new_thread && exists(&p.parent_id) => Some(p.parent_id.clone()),
        "new" => None,
        _ if new_thread => None,
        _ if exists(&p.thread_id) => Some(p.thread_id.clone()),
        _ => world.active_for(speaker).cloned().filter(|a| exists(a)),
    };
    let thread_id = match target {
        Some(id) => id,
        None => {
            let id = world.next_thread_id();
            let title = if p.title.trim().is_empty() {
                point.split_whitespace().take(5).collect::<Vec<_>>().join(" ")
            } else {
                fix(p.title.trim())
            };
            // One level only: the model picks a parent from a flat list, so a second level is picked blind (all 6
            // branches of branches in the threads trace, 2026-11-01, sat under the wrong top thread: a flight home under a
            // cafe shift under a midterm). Naming a branch as its parent makes a thread of its own.
            let parent_id = Some(p.parent_id.clone()).filter(|x| world.thread(x).is_some_and(|t| t.parent_id.is_none()));
            changes.push(Change::ThreadAdded {
                thread: Thread {
                    id: id.clone(),
                    title,
                    parent_id,
                    status: ThreadStatus::Open,
                    last_point: String::new(),
                    touched_ms: now,
                    tags: Vec::new(),
                    picture: None,
                    dropped_by: String::new(),
                },
            });
            id
        }
    };

    let (unclear, guess, heard, fixed) =
        if sure { (String::new(), String::new(), unclear, guess) } else { (unclear, guess, String::new(), String::new()) };
    changes.push(Change::ThoughtPlaced {
        thought_id: thought.id.clone(),
        thread_id: thread_id.clone(),
        point: point.clone(),
        unclear,
        guess,
        heard,
        fixed,
        complete: p.complete,
        place_ms,
        decided,
    });
    let why = crate::chunks::why_here(&p.why, &changes);
    let note = crate::chunks::note(head.as_ref(), &p.assumed, &why, crate::chunks::moved(world, &changes, &thread_id, was.as_ref()));
    if !note.is_empty() {
        changes.push(Change::ThoughtNoted { thought_id: thought.id.clone(), note });
    }
    // Landing late, after the speaker moved on: on the map, but they stay where they are and leave nothing. Nor does
    // it change a thread that has newer words: its last point and whether it was left unfinished stay theirs.
    if moves || !said_since(world, thought, now).any(|t| t.thread_id.as_deref() == Some(thread_id.as_str())) {
        changes.push(Change::ThreadTouched { thread_id: thread_id.clone(), last_point: point, at_ms: now });
    }
    if !moves {
        return changes;
    }

    // Leaving a thread whose last thought trailed off means it was dropped. Only the speaker's own
    // words count, so only threads they spoke on can be dropped, and only for them. Last by when it was
    // said (see `Thought::said_at`).
    let their_last = |id: &str| {
        world.thoughts.iter().filter(|t| t.placed && t.speaker == *speaker && t.thread_id.as_deref() == Some(id)).max_by_key(|t| t.said_at(now))
    };
    let mut dropped: Vec<String> = p.dropped.into_iter().filter(|d| their_last(d).is_some()).collect();
    if let Some(previous) = world.active_by.get(speaker).filter(|a| **a != thread_id) {
        if their_last(previous).is_some_and(|t| !t.complete) {
            dropped.push(previous.clone());
        }
    }
    dropped.sort();
    dropped.dedup();
    for d in dropped {
        let open = world.thread(&d).map(|t| t.status == ThreadStatus::Open).unwrap_or(false);
        if d != thread_id && open {
            changes.push(Change::ThreadStatus { thread_id: d, status: ThreadStatus::Dropped, speaker: speaker.clone() });
        }
    }
    // Alone these always agree; in a room the talk can be elsewhere while the speaker stays put.
    if world.active.as_deref() != Some(thread_id.as_str()) || world.active_by.get(speaker) != Some(&thread_id) {
        changes.push(Change::ActiveChanged { thread_id, speaker: speaker.clone() });
    }
    changes
}

#[cfg(test)]
#[path = "placer_chunks_tests.rs"]
mod chunks_tests;

#[cfg(test)]
mod tests {
    use super::{cut, decide, patience, read, request, room_for, settle, NewThreads, Patience, Placement, MAX_ROOM, ROOM};
    use crate::protocol::ServerMsg;
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};
    use crate::Core;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn thread(id: &str) -> Thread {
        Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    fn thought(id: &str, speaker: &str, thread: Option<&str>, complete: bool) -> Thought {
        Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: format!("{speaker} says {id}"),
            point: String::new(),
            thread_id: thread.map(Into::into),
            placed: thread.is_some(),
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete,
            at_ms: 0,
            place_ms: None,
            decided: false,
        }
    }

    fn answer(action: &str, thread_id: &str, dropped: &[&str]) -> Placement {
        serde_json::from_value(serde_json::json!({"action": action, "thread_id": thread_id, "dropped": dropped})).unwrap()
    }

    fn drops(changes: &[Change]) -> Vec<(String, String)> {
        changes
            .iter()
            .filter_map(|c| match c {
                Change::ThreadStatus { thread_id, status: ThreadStatus::Dropped, speaker } => Some((thread_id.clone(), speaker.clone())),
                _ => None,
            })
            .collect()
    }

    /// Ana trailed off on T1; Sam talks on T2.
    fn room() -> World {
        let mut world = World {
            threads: vec![thread("T1"), thread("T2")],
            thoughts: vec![thought("a", "Ana", Some("T1"), false), thought("b", "Sam", Some("T2"), true)],
            ..World::default()
        };
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "Ana".into() });
        world.apply(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "Sam".into() });
        world
    }

    fn turn(text: &str) -> Thought {
        Thought { text: text.into(), at_ms: 7, ..thought("a", "you", None, true) }
    }

    /// A map with T1 (active) and T2.
    fn map() -> World {
        World { threads: vec![thread("T1"), thread("T2")], active: Some("T1".into()), ..World::default() }
    }

    fn reply(value: serde_json::Value) -> Placement {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn names_said_reach_the_placer_even_when_points_drop_them() {
        let said = |id: &str, text: &str| Thought { text: text.into(), ..thought(id, "you", Some("T1"), true) };
        let mut world = map();
        world.thoughts = vec![
            said("a", "Okay so I need to plan the hackathon demo. The submission deadline is tomorrow at nine PM."),
            said("b", "Decided: we open with the mic turning on. Muse Spark places it in about two seconds. That's the hook."),
            said("c", "Oh wait, Mom's birthday is Friday. I'm booking that cooking class she mentioned."),
            said("d", "The one on Main Street, I think it's like sixty bucks."),
            said("e", "The README should explain how to run it."),
            // Still asked about: not a name yet.
            Thought { unclear: "Dana".into(), ..said("f", "Ask Dana about it") },
            Thought { placed: false, ..said("g", "Waiting on Priya") },
        ];
        assert_eq!(super::names(&world), ["README", "Main Street", "Friday", "Mom", "Muse Spark", "PM"]);
        let prompt = |world: &World| request(world, &turn("The placement uses Muse Bark"), "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(prompt(&world).contains("Active thread: T1\nNames said: README, Main Street, Friday, Mom, Muse Spark, PM\nNEW THOUGHT"), "{}", prompt(&world));
        assert!(prompt(&map()).contains("Active thread: T1\nNEW THOUGHT"), "no names yet, no line");
    }

    #[test]
    fn names_said_go_by_when_they_were_said_not_by_an_import_landing_last() {
        let now = crate::now_ms();
        let said = |id: &str, text: &str, at_ms: u64| Thought { text: text.into(), at_ms, ..thought(id, "you", Some("T1"), true) };
        // Said a minute ago; then an import of last year's chats landed after it in the list, with 40 names.
        let mut world = map();
        world.thoughts.push(said("live", "The placement uses Muse Spark.", now - 60_000));
        for n in 0..40 {
            world.thoughts.push(said(&format!("old{n}"), &format!("I met with Contact{n} about it."), now - 365 * 86_400_000));
        }
        let names = super::names(&world);
        assert_eq!((names.len(), names[0].as_str(), names[1].as_str()), (super::NAMES, "Muse Spark", "Contact39"));
        let prompt = request(&world, &turn("The placement uses Muse Bark"), "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(prompt.contains("Names said: Muse Spark, Contact39, "), "{prompt}");
    }

    #[test]
    fn a_turn_is_cut_where_it_moves_on() {
        let text = "I need to pay rent and also the hackathon demo is on Tuesday";
        let expected = Some(("I need to pay rent".to_string(), "the hackathon demo is on Tuesday".to_string()));
        assert_eq!(cut(text, "the hackathon demo is on Tuesday"), expected);
        // Quoted with the joining words, or with its own punctuation.
        assert_eq!(cut(text, "\"and also the hackathon demo is on Tuesday.\""), expected);
        let oh = cut("I'll order the cookbook tonight. Oh, and the electric bill, autopay.", "Oh, and the electric bill");
        assert_eq!(oh.unwrap(), ("I'll order the cookbook tonight.".to_string(), "the electric bill, autopay.".to_string()));
        // A reworded ending still cuts by its first words; the last match wins.
        assert_eq!(cut(text, "the hackathon demo is Tuesday"), expected);
        assert_eq!(cut("the demo slides, and the demo is Tuesday", "the demo is Tuesday").unwrap().0, "the demo slides");
        // Nothing to cut: no quote, a quote that isn't there, nothing before it, or only joining words before it.
        for quote in ["", "the budget", text, "also the hackathon demo"] {
            assert_eq!(cut(&text.replace("I need to pay rent and ", ""), quote), None, "{quote}");
        }
        assert_eq!(cut("and also the demo is on Tuesday", "the demo is on Tuesday"), None);
    }

    #[test]
    fn the_first_part_is_placed_and_the_rest_waits_its_turn() {
        let world = map();
        let said = turn("I need to pay rent before Friday — oh, the Muse Bark demo is on Tuesday");
        let p = reply(json!({"split": "the Muse Bark demo is on Tuesday", "action": "continue", "thread_id": "T1",
            "point": "Pay rent before Friday", "unclear": "Muse Bark", "guess": "Muse Spark", "sure": true}));
        let (changes, rest) = settle(&world, &said, p, 0, false, true);
        let Some(Change::ThoughtSplit { thought_id, text, rest: next }) = changes.first() else { panic!("{changes:?}") };
        assert_eq!((thought_id.as_str(), text.as_str()), ("a", "I need to pay rent before Friday"));
        assert_eq!(rest.as_deref(), Some(next.id.as_str()));
        assert_eq!((next.text.as_str(), next.at_ms, next.placed), ("the Muse Bark demo is on Tuesday", 7, false));
        let placed = changes.iter().find_map(|c| match c {
            Change::ThoughtPlaced { thread_id, point, unclear, heard, .. } => Some((thread_id, point, unclear, heard)),
            _ => None,
        });
        // The misheard words are in the rest: they're asked about, or fixed, when it's placed.
        assert_eq!(placed, Some((&"T1".to_string(), &"Pay rent before Friday".to_string(), &String::new(), &String::new())));
    }

    #[test]
    fn a_skip_sets_aside_only_a_short_turn() {
        let world = map();
        let skip = || reply(json!({"split": "", "action": "skip", "thread_id": "", "point": ""}));
        assert!(matches!(decide(&world, &turn("oh wow"), skip(), 0, false, true)[..], [Change::ThoughtSkipped { .. }]));
        // A long turn is placed whatever the model says: on the active thread.
        let long = turn("so I was thinking we could rent a van and drive down on Friday");
        let changes = decide(&world, &long, skip(), 0, false, true);
        assert!(changes.iter().any(|c| matches!(c, Change::ThoughtPlaced { thread_id, .. } if thread_id == "T1")), "{changes:?}");
        // A skip whose quote cuts nothing can't say which words were filler: placed too.
        let unsure = reply(json!({"split": "the demo is on Tuesday", "action": "skip"}));
        let (changes, rest) = settle(&world, &turn("the demo is on Tuesday"), unsure, 0, false, true);
        assert!(rest.is_none() && changes.iter().any(|c| matches!(c, Change::ThoughtPlaced { .. })), "{changes:?}");
        // Filler before real words: the filler is set aside and the rest placed next.
        let lead = reply(json!({"split": "the demo is on Tuesday", "action": "skip"}));
        let (changes, rest) = settle(&world, &turn("yeah, so anyway, the demo is on Tuesday"), lead, 0, false, true);
        assert!(rest.is_some());
        assert!(matches!(changes[..], [Change::ThoughtSplit { .. }, Change::ThoughtSkipped { .. }]), "{changes:?}");
    }

    #[test]
    fn a_late_landing_leaves_a_thread_with_newer_words_as_they_left_it() {
        // Ana said a about T1, and its try failed; then b on T1, trailing off, and c on T2, which left T1 unfinished.
        let said = |id: &str, thread: Option<&str>, at_ms: u64, complete: bool| Thought { at_ms, point: format!("point {id}"), ..thought(id, "Ana", thread, complete) };
        let mut world = World { threads: vec![thread("T1"), thread("T2")], ..World::default() };
        world.thoughts = vec![said("a", None, 1, true), said("b", Some("T1"), 2, false), said("c", Some("T2"), 3, true)];
        for change in [
            Change::ThreadTouched { thread_id: "T1".into(), last_point: "point b".into(), at_ms: 2 },
            Change::ThreadStatus { thread_id: "T1".into(), status: ThreadStatus::Dropped, speaker: "Ana".into() },
            Change::ActiveChanged { thread_id: "T2".into(), speaker: "Ana".into() },
        ] {
            world.apply(&change);
        }
        // a lands on T1 at last: on the map, but T1 still ends with b, unfinished, and Ana stays on T2.
        let a = world.thoughts[0].clone();
        let changes = decide(&world, &a, answer("continue", "T1", &["T2"]), 0, false, false);
        assert!(matches!(changes[..], [Change::ThoughtPlaced { ref thread_id, .. }] if thread_id == "T1"), "{changes:?}");
        for change in &changes {
            world.apply(change);
        }
        let t1 = world.thread("T1").unwrap();
        assert_eq!((t1.status, t1.dropped_by.as_str(), t1.last_point.as_str()), (ThreadStatus::Dropped, "Ana", "point b"));
        assert_eq!(world.active_for("Ana").map(String::as_str), Some("T2"));
        // A new thread has nothing newer: a late landing still gives it its point.
        let changes = decide(&world, &a, answer("new", "", &[]), 0, false, false);
        assert!(changes.iter().any(|c| matches!(c, Change::ThreadTouched { last_point, .. } if last_point == "Ana says a")), "{changes:?}");
        assert!(!changes.iter().any(|c| matches!(c, Change::ActiveChanged { .. })), "{changes:?}");
    }

    #[test]
    fn words_said_in_the_same_millisecond_keep_the_order_they_were_said_in() {
        // a and b came in the same millisecond (a queue sent on reconnecting); a's try failed and b landed.
        let at = |id: &str, thread: Option<&str>| Thought { at_ms: 5, ..thought(id, "Ana", thread, true) };
        let world = World { threads: vec![thread("T2")], thoughts: vec![at("a", None), at("b", Some("T2"))], ..World::default() };
        let now = crate::now_ms();
        let since = |id: &str| super::said_since(&world, &world.thoughts.iter().find(|t| t.id == id).unwrap().clone(), now).map(|t| t.id.clone()).collect::<Vec<_>>();
        // b counts as newer, so a landing late doesn't move Ana back; nothing is newer than b.
        assert_eq!(since("a"), ["b"]);
        assert!(since("b").is_empty());
    }

    #[test]
    fn one_person_moving_on_doesnt_drop_the_others_thread() {
        let world = room();
        // Sam keeps going on T2, and the model even calls T1 dropped: it isn't Sam's to drop.
        let changes = decide(&world, &thought("c", "Sam", None, true), answer("continue", "T2", &["T1"]), 0, false, true);
        assert!(drops(&changes).is_empty(), "{changes:?}");
        // Ana moves to T2, leaving T1 unfinished: dropped, for Ana.
        let changes = decide(&world, &thought("d", "Ana", None, true), answer("return", "T2", &[]), 0, false, true);
        assert_eq!(drops(&changes), [("T1".to_string(), "Ana".to_string())]);
        assert!(changes.iter().any(|c| matches!(c, Change::ActiveChanged { thread_id, speaker } if thread_id == "T2" && speaker == "Ana")));
    }

    #[test]
    fn the_thought_after_new_thread_starts_one_whatever_the_answer() {
        let world = map();
        // The model would continue T1: it starts T3 instead, titled from its point when the answer has no title.
        let continued = reply(json!({"action": "continue", "thread_id": "T1", "point": "Kitchen needs paint before Friday"}));
        let changes = decide(&world, &turn("the kitchen needs paint before Friday"), continued, 0, true, true);
        let added = changes.iter().find_map(|c| match c {
            Change::ThreadAdded { thread } => Some((thread.id.as_str(), thread.title.as_str())),
            _ => None,
        });
        assert_eq!(added, Some(("T3", "Kitchen needs paint before Friday")));
        assert!(changes.iter().any(|c| matches!(c, Change::ThoughtPlaced { thread_id, .. } if thread_id == "T3")), "{changes:?}");
        assert!(changes.iter().any(|c| matches!(c, Change::ActiveChanged { thread_id, .. } if thread_id == "T3")), "{changes:?}");
        // The model is told, so the thread it starts gets a title.
        let prompt = request(&world, &turn("the kitchen needs paint"), "m", super::ROOM, true)["messages"][1]["content"].as_str().unwrap().to_string();
        let told = "The speaker asked for a new thread: this thought starts it (\"new\"), unless it adds nothing.\n";
        assert!(prompt.ends_with(&format!("{told}NEW THOUGHT: \"the kitchen needs paint\"")), "{prompt}");
        // A short turn the model sets aside stays set aside.
        let skip = reply(json!({"action": "skip"}));
        assert!(matches!(decide(&world, &turn("hmm, okay then"), skip, 0, true, true)[..], [Change::ThoughtSkipped { .. }]));
        // Filler before the words is set aside as ever; then the rest starts the thread.
        let threads = NewThreads::default();
        threads.ask("you");
        threads.said("you", "a");
        let lead = reply(json!({"split": "the kitchen needs paint", "action": "skip"}));
        let (changes, rest) = settle(&world, &turn("um, so yeah, the kitchen needs paint"), lead, 0, true, true);
        assert!(matches!(changes[..], [Change::ThoughtSplit { .. }, Change::ThoughtSkipped { .. }]), "{changes:?}");
        threads.placed("a", &changes, rest.as_deref());
        assert!(!threads.starts("a") && threads.starts(rest.as_deref().unwrap()));
        // Placed, it's done.
        let placed = decide(&world, &turn("the kitchen needs paint"), reply(json!({"action": "new", "title": "Kitchen"})), 0, true, true);
        threads.placed(rest.as_deref().unwrap(), &placed, None);
        assert!(!threads.starts(rest.as_deref().unwrap()));
    }

    #[test]
    fn new_thread_marks_only_the_speakers_next_thought() {
        let threads = NewThreads::default();
        threads.said("Ana", "a");
        threads.ask("Ana");
        threads.said("Sam", "b");
        threads.said("Ana", "c");
        threads.said("Ana", "d");
        assert_eq!(["a", "b", "c", "d"].map(|id| threads.starts(id)), [false, false, true, false]);
        // Moving to a thread before saying anything ends the ask.
        threads.ask("Ana");
        threads.cancel("Ana");
        threads.said("Ana", "e");
        assert!(!threads.starts("e"));
    }

    #[test]
    fn a_thought_that_couldnt_be_placed_goes_back_in_the_queue_later_and_later() {
        let waits: Vec<u64> = (0..7).map(|round| super::retry_in(round).as_secs()).collect();
        assert_eq!(waits, [15, 30, 60, 120, 240, 240, 240]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_thought_said_while_capped_waits_with_one_later_try_a_round() {
        use tokio::sync::mpsc;
        let path = std::env::temp_dir().join(format!("e2a2o-placer-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        // The retries land here, where the test counts them before passing each on to the placer.
        let (placer_queue, mut retries) = mpsc::unbounded_channel();
        let core = Arc::new(Core {
            placer_queue,
            key: Some("good".into()),
            service: crate::model::Service::with_limit(1),
            ..Core::test(journal, world)
        });
        core.spend().unwrap();
        // Said and saved, waiting for its place: the placer skips an id that isn't an unplaced thought on the map.
        core.commit(vec![Change::ThoughtAdded { thought: thought("t1", "you", None, true) }]);
        let (jobs, queue) = mpsc::unbounded_channel();
        tokio::spawn(super::run(core.clone(), queue));
        jobs.send(super::Job::Place("t1".into())).unwrap();
        let start = tokio::time::Instant::now();
        let mut at = Vec::new();
        while let Ok(Some(job)) = tokio::time::timeout_at(start + Duration::from_secs(100), retries.recv()).await {
            at.push(start.elapsed().as_secs());
            jobs.send(job).unwrap();
        }
        assert_eq!(at, [15, 45], "one retry a round, 15 s then 30 s on; not three a round, each making three");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_long_turn_gets_room_to_answer_and_time_to_use_it() {
        let turn_of = |chars: usize| "a".repeat(chars);
        // A short turn is asked as before: 2,000 tokens and 20 s.
        for chars in [0, 40, 1000] {
            assert_eq!(room_for(&turn_of(chars)), ROOM, "{chars}");
        }
        assert_eq!(patience(ROOM), Duration::from_secs(20));
        assert_eq!(request(&map(), &turn("Pay rent"), "m", ROOM, false)["max_tokens"], 2000);
        // Past that, two tokens a character: 3,344 for the 1,672 characters that ran out of 2,000; never past the most.
        assert_eq!([1001, 1672, 1934].map(|chars| room_for(&turn_of(chars))), [2002, 3344, 3868]);
        assert_eq!([6000, 6001, 50_000].map(|chars| room_for(&turn_of(chars))), [MAX_ROOM; 3]);
        assert_eq!(request(&map(), &turn(&turn_of(1672)), "m", 3344, false)["max_tokens"], 3344);
        // Room to fill takes time, though not as much as twice the time: 36 s for 4,000, not 40.
        assert_eq!(patience(4000), Duration::from_secs(36));
        assert!(patience(MAX_ROOM) < Duration::from_secs(120), "still sooner than the shared client's limit");
    }

    fn body(reason: serde_json::Value, content: serde_json::Value) -> serde_json::Value {
        json!({"choices": [{"finish_reason": reason, "message": {"content": content}}]})
    }

    const WHOLE: &str = r#"{"action":"new","thread_id":"","title":"Rent","parent_id":"","point":"Pay rent","split":"","complete":true,"dropped":[],"unclear":"","guess":"","sure":false}"#;

    /// The answer, stopped inside the title.
    fn cut_short() -> &'static str {
        &WHOLE[..WHOLE.find("Rent").unwrap() + 2]
    }

    #[test]
    fn an_answer_cut_off_at_its_room_is_told_from_one_that_is_wrong() {
        // A whole answer is read, however the model says it ended.
        for reason in [json!("stop"), json!("length"), json!(null)] {
            assert_eq!(read(&body(reason, json!(WHOLE))).unwrap().unwrap().point, "Pay rent");
        }
        // Cut off: it says "length", or the JSON just stops. With no JSON at all, only "length" says so.
        for (reason, content) in [
            (json!("length"), json!(cut_short())),
            (json!("stop"), json!(cut_short())),
            (json!(null), json!(cut_short())),
            (json!("length"), json!(null)),
            (json!("length"), json!("")),
            (json!("length"), json!("  ")),
        ] {
            assert!(read(&body(reason.clone(), content.clone())).unwrap().is_none(), "{reason} {content}");
        }
        // Wrong, not cut off: asking again with more room would fail the same way.
        for (content, said) in [
            (json!("not json"), "answer wasn't the expected JSON"),
            (json!("{}"), "answer wasn't the expected JSON"),
            (json!("[1, 2]"), "answer wasn't the expected JSON"),
            (json!(null), "no answer"),
            (json!(""), "no answer"),
        ] {
            let e = read(&body(json!("stop"), content.clone())).err().unwrap();
            assert!(format!("{e:#}").starts_with(said), "{content}: {e:#}");
        }
    }

    /// A stand-in for the model service on this machine: each call is answered with the next of `answers` (the last
    /// again when they run out), and the max_tokens it asked for is noted.
    async fn stand_in(answers: Vec<serde_json::Value>) -> (String, Arc<Mutex<Vec<u64>>>) {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
            let mut asked = seen.lock().unwrap();
            asked.push(request["max_tokens"].as_u64().unwrap());
            let answer = answers[(asked.len() - 1).min(answers.len() - 1)].clone();
            async move { axum::Json(answer) }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        let routes = axum::Router::new().route("/v1/chat/completions", axum::routing::post(service));
        tokio::spawn(async move { axum::serve(listener, routes).await });
        (url, asked)
    }

    /// Places `text` as the one thought on an empty map, against a stand-in that answers with `answers` in turn:
    /// what placing came to, the max_tokens each call asked for, and whether the thought was placed.
    async fn place_against(text: &str, answers: Vec<serde_json::Value>) -> (anyhow::Result<Option<String>>, Vec<u64>, bool) {
        let (url, asked) = stand_in(answers).await;
        let path = std::env::temp_dir().join(format!("e2a2o-placer-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let core = Core { key: Some("good".into()), ..Core::test(journal, world) };
        core.keep("you", text);
        let id = core.snapshot().thoughts[0].id.clone();
        let result = super::place(&core, &id, &url, super::patience).await;
        let placed = core.snapshot().thoughts[0].placed;
        let _ = std::fs::remove_file(&path);
        let asked = asked.lock().unwrap().clone();
        (result, asked, placed)
    }

    /// What a burst's stand-in does with a thought, by a word in it: "stall" hangs on its first call (past the first
    /// try's time), "fail" gets a 500 on its first call, "slow" takes 300 ms; any other answers in 100 ms. Each
    /// answer starts a thread titled with the thought, so where it landed is plain.
    async fn burst_stand_in() -> String {
        let calls: Arc<Mutex<std::collections::HashMap<String, u32>>> = Default::default();
        let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
            let calls = calls.clone();
            async move {
                let asked = request["messages"][1]["content"].as_str().unwrap().to_string();
                let text = asked.split("NEW THOUGHT: \"").nth(1).unwrap().trim_end_matches('"').to_string();
                let call = {
                    let mut calls = calls.lock().unwrap();
                    let n = calls.entry(text.clone()).or_default();
                    *n += 1;
                    *n
                };
                let first = call == 1;
                let wait = match () {
                    _ if text.contains("stall") && first => 30_000,
                    _ if text.contains("slow") => 300,
                    _ => 100,
                };
                tokio::time::sleep(Duration::from_millis(wait)).await;
                if text.contains("fail") && first {
                    let error = json!({"error": {"message": "stand-in failure"}});
                    return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(error));
                }
                let placement = json!({"action": "new", "title": text, "point": text, "split": "", "complete": true});
                (axum::http::StatusCode::OK, axum::Json(body(json!("stop"), json!(placement.to_string()))))
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        let routes = axum::Router::new().route("/v1/chat/completions", axum::routing::post(service));
        tokio::spawn(async move { axum::serve(listener, routes).await });
        url
    }

    /// A keyed core on an empty map whose placer asks a burst stand-in, with a 400 ms first try (12 s for real) and
    /// 3 s later; its journal's path, and every message it sends from the start.
    async fn burst_core() -> (Arc<Core>, std::path::PathBuf, tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>) {
        let url = burst_stand_in().await;
        let path = std::env::temp_dir().join(format!("e2a2o-burst-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), ..Core::test(journal, world) });
        let updates = core.updates.subscribe();
        let patience = Patience { first: |_| Duration::from_millis(400), later: |_| Duration::from_secs(3) };
        let placer = core.clone();
        tokio::spawn(async move { super::serve(placer, queue, &url, patience).await });
        (core, path, updates)
    }

    /// Waits up to `limit` for `done`, checking every 10 ms; how long it took.
    async fn until(limit: Duration, done: impl Fn() -> bool) -> Duration {
        let start = std::time::Instant::now();
        while !done() {
            assert!(start.elapsed() < limit, "not within {limit:?}");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        start.elapsed()
    }

    fn id_of(core: &Core, text: &str) -> String {
        core.snapshot().thoughts.iter().find(|t| t.text == text).unwrap().id.clone()
    }

    fn landed(core: &Core, text: &str) -> bool {
        core.snapshot().thoughts.iter().any(|t| t.text == text && t.placed)
    }

    /// Ana talks fast: twelve thoughts 30 ms apart, one whose call stalls and one whose call fails. Every one is
    /// saved as it's said, every one lands exactly once, the stall holds no one up, the pills say what's going on,
    /// and the two that land late don't pull her off the thread she's on.
    #[tokio::test]
    async fn a_burst_with_a_stalled_and_a_failed_call_lands_every_thought_once_without_waiting_on_them() {
        let (core, path, mut updates) = burst_core().await;
        let said: Vec<String> = (1..=12)
            .map(|i| match i {
                3 => "stall on the garden fence".to_string(),
                6 => "fail on the electric bill".to_string(),
                i => format!("thought number {i}"),
            })
            .collect();
        let start = std::time::Instant::now();
        for (i, text) in said.iter().enumerate() {
            core.add_thought("Ana", text);
            // Saved as it's said: on the map and in the journal before any model answers.
            assert_eq!(core.snapshot().thoughts.len(), i + 1);
            let (_, reopened) = crate::world::Journal::open(&path).unwrap();
            assert!(reopened.thoughts.iter().any(|t| &t.text == text), "{text} saved");
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        let said_in = start.elapsed();
        let others: Vec<&String> = said.iter().filter(|t| !t.contains("stall") && !t.contains("fail")).collect();
        // A serial queue with 20 s tries held these ≈ 60 s behind the stall; now they don't wait on it: 1.6 s from
        // the first said here, against 4.3 s when the first try had the later tries' 3 s.
        let others_in = until(Duration::from_millis(2_500).saturating_sub(said_in), || others.iter().all(|t| landed(&core, t))).await;
        let all_in = until(Duration::from_secs(8), || said.iter().all(|t| landed(&core, t))).await;
        let world = core.snapshot();
        assert_eq!(world.thoughts.len(), 12, "none doubled, none lost");
        assert_eq!(world.threads.len(), 12);
        let stall = id_of(&core, &said[2]);
        let fail = id_of(&core, &said[5]);
        // Each placed exactly once, and the pills were told the truth along the way.
        let (mut placed, mut tried, mut retried, mut errors) = (std::collections::HashMap::new(), Vec::new(), Vec::new(), 0);
        while let Ok(out) = updates.try_recv() {
            match out.message {
                ServerMsg::Change { change: Change::ThoughtPlaced { thought_id, .. } } => *placed.entry(thought_id).or_insert(0) += 1,
                ServerMsg::Placing { now, retries } => {
                    tried.extend(now);
                    retried.extend(retries.into_iter().map(|r| r.thought_id));
                }
                ServerMsg::Error { .. } => errors += 1,
                _ => {}
            }
        }
        assert_eq!(placed.len(), 12);
        assert!(placed.values().all(|&n| n == 1), "{placed:?}");
        for id in [&stall, &fail] {
            assert!(tried.iter().filter(|t| t == &id).count() >= 2, "being placed, twice");
            assert!(retried.contains(id), "shown as retrying");
        }
        assert!(!retried.iter().any(|id| id != &stall && id != &fail), "only those two retried");
        assert_eq!(errors, 0, "one failure is a blip, not an error");
        // The last thing she said is where she is: the two late ones landed on the map without moving her.
        let last = world.thoughts.iter().find(|t| t.text == said[11]).unwrap();
        assert_eq!(world.active_for("Ana"), last.thread_id.as_ref());
        eprintln!("burst of 12 (30 ms apart, 100 ms answers, 400 ms first try): from the first said, the 10 fine in {:?}, all 12 in {:?}", others_in + said_in, others_in + said_in + all_in);
        let _ = std::fs::remove_file(&path);
    }

    /// A command waits for the speaker's own words still on their first try, and acts as soon as they land; it waits
    /// for nothing else: not a retry of theirs, and not the other person's words.
    #[tokio::test]
    async fn a_command_waits_only_for_the_speakers_own_first_tries() {
        let (core, path, _updates) = burst_core().await;
        let active = |core: &Core| core.snapshot().active_for("Ana").cloned();
        // Two threads of his; then a slow thought, and "where was I?" right behind it.
        core.add_thought("Ana", "the kitchen needs paint");
        until(Duration::from_secs(2), || landed(&core, "the kitchen needs paint")).await;
        core.add_thought("Ana", "the party is on Saturday");
        until(Duration::from_secs(2), || landed(&core, "the party is on Saturday")).await;
        let party = active(&core).unwrap();
        core.add_thought("Ana", "slow: the caterer needs a head count");
        core.add_thought("Ana", "Where was I?");
        assert_eq!(active(&core), Some(party.clone()), "waits for his words before it");
        until(Duration::from_secs(2), || landed(&core, "slow: the caterer needs a head count")).await;
        let after_landing = until(Duration::from_secs(1), || active(&core) != Some(id_of_thread(&core, "slow: the caterer needs a head count"))).await;
        assert!(after_landing <= Duration::from_millis(200), "acts within 0.2 s of them landing: {after_landing:?}");

        // His words on a retry don't hold a command up, and landing later doesn't undo it.
        core.add_thought("Ana", "stall: the fence needs fixing");
        let stall = id_of(&core, "stall: the fence needs fixing");
        until(Duration::from_secs(2), || core.placing.failed(&stall)).await;
        let here = active(&core);
        let said = std::time::Instant::now();
        core.add_thought("Ana", "Next one");
        let moved = said.elapsed();
        assert!(moved <= Duration::from_millis(200) && active(&core) != here, "acts at once: {moved:?}");
        let there = active(&core);
        until(Duration::from_secs(5), || landed(&core, "stall: the fence needs fixing")).await;
        assert_eq!(active(&core), there, "the late landing leaves her where the command put her");

        // Sam's words in line don't hold Ana's command up.
        for i in 1..=4 {
            core.add_thought("Sam", &format!("slow: Sam's thought {i}"));
        }
        let said = std::time::Instant::now();
        core.add_thought("Ana", "Where was I?");
        assert!(said.elapsed() <= Duration::from_millis(200));
        assert!(core.snapshot().thoughts.iter().filter(|t| t.speaker == "Sam" && t.placed).count() < 4, "before Sam's words landed");
        let _ = std::fs::remove_file(&path);
    }

    fn id_of_thread(core: &Core, text: &str) -> String {
        core.snapshot().thoughts.iter().find(|t| t.text == text).and_then(|t| t.thread_id.clone()).unwrap()
    }

    #[tokio::test]
    async fn an_answer_cut_off_is_asked_once_more_with_twice_the_room_and_a_wrong_one_is_not() {
        let whole = || body(json!("stop"), json!(WHOLE));
        // A short turn answered whole: one call, 2,000 tokens, as always.
        let (result, asked, placed) = place_against("Pay rent before Friday", vec![whole()]).await;
        assert!(result.unwrap().is_none() && placed);
        assert_eq!(asked, [2000]);
        // Cut off, whether it says "length" or the JSON just stops, or there's nothing: once more, with 4,000.
        for cut in [body(json!("length"), json!(cut_short())), body(json!("stop"), json!(cut_short())), body(json!("length"), json!(null))] {
            let (result, asked, placed) = place_against("Pay rent before Friday", vec![cut.clone(), whole()]).await;
            assert!(result.unwrap().is_none() && placed, "{cut}");
            assert_eq!(asked, [2000, 4000], "{cut}");
        }
        // A long turn starts with more, and the second ask doubles that.
        let (result, asked, placed) = place_against(&"I need to pay rent before Friday. ".repeat(60), vec![body(json!("length"), json!(cut_short())), whole()]).await;
        assert!(result.unwrap().is_none() && placed);
        assert_eq!(asked, [4080, 8160]);
        // Cut off again: said so, after two calls and not three; it waits to be placed.
        let (result, asked, placed) = place_against("Pay rent before Friday", vec![body(json!("length"), json!(cut_short()))]).await;
        assert_eq!(result.unwrap_err().to_string(), "answer cut off at 4000 tokens");
        assert_eq!((asked, placed), (vec![2000, 4000], false));
        // Already given the most there is: nothing bigger to ask for.
        let (result, asked, _) = place_against(&"a".repeat(7000), vec![body(json!("length"), json!(cut_short()))]).await;
        assert_eq!(result.unwrap_err().to_string(), "answer cut off at 12000 tokens");
        assert_eq!(asked, [12_000]);
        // Wrong, not cut off: one call, and the error as before.
        let (result, asked, placed) = place_against("Pay rent before Friday", vec![body(json!("stop"), json!("not json"))]).await;
        assert!(result.unwrap_err().to_string().starts_with("answer wasn't the expected JSON"));
        assert_eq!((asked, placed), (vec![2000], false));
    }

    /// Two of the same call race and the first good answer places the thought: one that reasons for long, fails or
    /// is cut off costs nothing while the other answers. Each stand-in answer: its delay, its status and its body.
    #[tokio::test]
    async fn the_faster_of_two_racing_calls_places_the_thought() {
        async fn race(answers: Vec<(u64, u16, serde_json::Value)>) -> (anyhow::Result<Option<String>>, Vec<u64>, bool, Duration) {
            let asked = Arc::new(Mutex::new(Vec::new()));
            let seen = asked.clone();
            let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
                let (delay, status, answer) = {
                    let mut asked = seen.lock().unwrap();
                    asked.push(request["max_tokens"].as_u64().unwrap());
                    answers[(asked.len() - 1).min(answers.len() - 1)].clone()
                };
                async move {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    (axum::http::StatusCode::from_u16(status).unwrap(), axum::Json(answer))
                }
            };
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
            tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
            let path = std::env::temp_dir().join(format!("e2a2o-placer-{}.jsonl", uuid::Uuid::new_v4()));
            let (journal, world) = crate::world::Journal::open(&path).unwrap();
            let core = Core { key: Some("good".into()), placer_race: 2, ..Core::test(journal, world) };
            core.keep("you", "Pay rent before Friday");
            let id = core.snapshot().thoughts[0].id.clone();
            let started = std::time::Instant::now();
            let result = super::place(&core, &id, &url, super::patience).await;
            let took = started.elapsed();
            let placed = core.snapshot().thoughts[0].placed;
            let _ = std::fs::remove_file(&path);
            let asked = asked.lock().unwrap().clone();
            (result, asked, placed, took)
        }
        let whole = || body(json!("stop"), json!(WHOLE));
        // One reasons for 5 s, the other answers at once: placed at once, both asked with the same room.
        let (result, asked, placed, took) = race(vec![(5_000, 200, whole()), (50, 200, whole())]).await;
        assert!(result.unwrap().is_none() && placed);
        assert_eq!(asked, [2000, 2000]);
        assert!(took < Duration::from_secs(2), "waited on the slow call: {took:?}");
        // One fails: the other places it.
        let (result, _, placed, _) = race(vec![(10, 500, json!({"error": {"message": "boom"}})), (100, 200, whole())]).await;
        assert!(result.unwrap().is_none() && placed);
        // One is cut off: the other places it, with no second round.
        let (result, asked, placed, _) = race(vec![(10, 200, body(json!("length"), json!(cut_short()))), (100, 200, whole())]).await;
        assert!(result.unwrap().is_none() && placed);
        assert_eq!(asked, [2000, 2000]);
        // Both cut off: once more, both with twice the room.
        let (result, asked, placed, _) =
            race(vec![(10, 200, body(json!("length"), json!(cut_short()))), (10, 200, body(json!("length"), json!(cut_short()))), (10, 200, whole())]).await;
        assert!(result.unwrap().is_none() && placed);
        assert_eq!(asked, [2000, 2000, 4000, 4000]);
        // Both fail: the error, and it waits to be placed again.
        let (result, _, placed, _) = race(vec![(10, 500, json!({"error": {"message": "boom"}}))]).await;
        assert!(result.is_err() && !placed);
    }

    /// At the hourly cap's edge one call goes, not two: the extra one would be the call refused there, and "AI paused"
    /// would show while the first placed the thought. The slower of two racing calls is still in the trace, marked
    /// dropped, so what was spent can be counted from it.
    #[tokio::test]
    async fn the_race_stays_under_the_cap_and_its_loser_is_traced() {
        async fn race(limit: usize, delays: [u64; 2]) -> (usize, bool, Vec<String>, Vec<serde_json::Value>, Vec<serde_json::Value>) {
            let asked = Arc::new(Mutex::new(0usize));
            let seen = asked.clone();
            let service = move |_: axum::Json<serde_json::Value>| {
                let delay = {
                    let mut asked = seen.lock().unwrap();
                    *asked += 1;
                    delays[(*asked - 1).min(1)]
                };
                async move {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    axum::Json(body(json!("stop"), json!(WHOLE)))
                }
            };
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
            tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
            let dir = std::env::temp_dir().join(format!("e2a2o-race-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let (journal, world) = crate::world::Journal::open(&dir.join("journal.jsonl")).unwrap();
            let core = Core {
                key: Some("good".into()),
                placer_race: 2,
                service: crate::model::Service::with_limit(limit),
                trace: crate::trace::Trace::to(&dir),
                ..Core::test(journal, world)
            };
            let mut updates = core.updates.subscribe();
            core.keep("you", "Pay rent before Friday");
            let id = core.snapshot().thoughts[0].id.clone();
            super::place(&core, &id, &url, super::patience).await.unwrap();
            let placed = core.snapshot().thoughts[0].placed;
            let messages: Vec<_> = std::iter::from_fn(|| updates.try_recv().ok()).map(|o| o.message).collect();
            let said = messages.iter()
                .filter_map(|m| match m {
                    crate::protocol::ServerMsg::Notice { message } => Some(message.clone()),
                    _ => None,
                })
                .collect();
            // How each call ended, as the windows' model line hears it.
            let ends: Vec<serde_json::Value> = messages.iter()
                .map(|m| serde_json::to_value(m).unwrap())
                .filter(|m| m["type"] == "step" && m["done"] == true)
                .collect();
            drop(core);
            let calls = std::fs::read_to_string(dir.join("trace.jsonl")).unwrap_or_default().lines()
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).filter(|l| l["kind"] == "call").collect();
            let asked = *asked.lock().unwrap();
            (asked, placed, said, calls, ends)
        }
        let (asked, placed, said, _, _) = race(1, [10, 10]).await;
        assert_eq!((asked, placed), (1, true), "one call left: one call");
        assert!(said.iter().all(|s| !s.starts_with("AI paused")), "{said:?}");
        let (asked, placed, said, calls, ends) = race(400, [2_000, 10]).await;
        assert_eq!((asked, placed), (2, true));
        assert!(said.is_empty(), "{said:?}");
        let errors: Vec<&str> = calls.iter().filter_map(|c| c["error"].as_str()).collect();
        assert_eq!((calls.len(), errors.len()), (2, 1), "both calls traced: {calls:?}");
        assert!(errors[0].starts_with("dropped before its answer"), "{errors:?}");
        // The windows hear the winner answered and the loser superseded, never that a placing call failed: the model
        // line would say "didn't answer" over every placed thought.
        let told: Vec<_> = ends.iter().map(|m| (m["step"].as_str(), m["ok"].as_bool(), m["superseded"].as_bool())).collect();
        assert_eq!(told, [(Some("placer"), Some(true), Some(false)), (Some("placer"), Some(false), Some(true))], "{ends:?}");
    }

    /// The prompt cache keeps every thread but the one just spoken on: a placement on the first thread made (the one
    /// the talk keeps coming back to) used to rewrite the list's first line, so nothing after the system prompt was
    /// cached. Now it rewrites only the last line.
    #[test]
    fn a_placement_rewrites_only_the_end_of_the_thread_list() {
        let mut world = World { active: Some("T1".into()), ..World::default() };
        for (id, touched) in [("T1", 400), ("T2", 100), ("T3", 200), ("T4", 300)] {
            world.threads.push(Thread { touched_ms: touched, last_point: format!("about {id}"), ..thread(id) });
        }
        let said = Thought { text: "and one more thing on that".into(), at_ms: 500, ..thought("x", "you", None, true) };
        let prompt = |world: &World| request(world, &said, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        let before = prompt(&world);
        let order: Vec<&str> = before.lines().skip(1).take(4).map(|l| &l[..2]).collect();
        assert_eq!(order, ["T2", "T3", "T4", "T1"], "oldest-touched first: {before}");
        world.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "one more thing".into(), at_ms: 500 });
        let after = prompt(&world);
        let same = before.chars().zip(after.chars()).take_while(|(a, b)| a == b).count();
        assert!(before[..same].contains("T4: Topic T4 [open] last: about T4\n"), "the cached prefix ends where T1's line begins: {after}");
        assert!(super::SYSTEM.len() > 2_000 && !super::SYSTEM.contains('{'), "the system prompt is stable text, sent first");
    }

    #[test]
    fn the_placer_sees_the_speakers_own_thread() {
        let world = room();
        let prompt = |speaker: &str| request(&world, &thought("e", speaker, None, true), "m", ROOM, false)["messages"][1]["content"].to_string();
        assert!(prompt("Ana").contains("Active thread: T1"));
        assert!(prompt("Sam").contains("Active thread: T2"));
        assert!(prompt("Lee").contains("Active thread: T2"), "someone new starts where the talk is");
    }

    #[test]
    fn the_turn_said_just_before_goes_in_as_said_with_its_thread() {
        let earlier = |speaker: &str, ago_ms: u64, text: &str| Thought {
            text: text.into(),
            at_ms: 1_000_000 - ago_ms,
            ..thought(&format!("b-{speaker}-{ago_ms}"), speaker, Some("T2"), true)
        };
        let prompt = |before: Vec<Thought>, text: &str| {
            let now = Thought { text: text.into(), at_ms: 1_000_000, ..thought("n", "you", None, true) };
            let world = World { thoughts: before.into_iter().chain([now.clone()]).collect(), ..map() };
            request(&world, &now, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string()
        };
        let line = "Said just before (placed in T2): \"And the coding tool subscription I have\"\n";
        let text = "And then we have the cursor plan as well";
        assert!(prompt(vec![earlier("you", 30_000, "And the coding tool subscription I have")], text).contains(line));
        // Too long ago, someone else's, or not placed yet: left out.
        assert!(!prompt(vec![earlier("you", 121_000, "And the coding tool subscription I have")], text).contains("Said just before"));
        assert!(!prompt(vec![earlier("Sam", 30_000, "And the coding tool subscription I have")], text).contains("Said just before"));
        let waiting = Thought { placed: false, ..earlier("you", 30_000, "Still being placed") };
        assert!(!prompt(vec![waiting], text).contains("Said just before"));
        // Only the latest, and a question just asked is said once, as the question.
        let two = prompt(vec![earlier("you", 60_000, "Older words"), earlier("you", 20_000, "And the coding tool subscription I have")], text);
        assert!(two.contains(line) && !two.contains("Older words"));
        let asked = prompt(vec![earlier("you", 20_000, "Should we use the cursor plan?")], "Yeah.");
        assert!(asked.contains("Just asked") && !asked.contains("Said just before"));
        // Someone else's question in between is a different turn: both go in.
        let both = prompt(
            vec![earlier("you", 30_000, "And the coding tool subscription I have"), earlier("Sam", 10_000, "Who's bringing lunch?")],
            "The cursor thing also has limits.",
        );
        assert!(both.contains("Just asked: \"Who's bringing lunch?\"") && both.contains(line), "{both}");
    }

    #[test]
    fn a_short_reply_to_a_question_comes_with_the_question() {
        let asked = Thought { text: "Should we say it runs on Meta's models?".into(), ..thought("q", "you", Some("T1"), true) };
        let told = Thought { text: "It runs on Meta's models.".into(), ..thought("s", "you", Some("T1"), true) };
        let prompt = |before: &Thought, text: &str| {
            let reply = Thought { text: text.into(), ..thought("r", "you", None, true) };
            let world = World { thoughts: vec![before.clone(), reply.clone()], ..map() };
            request(&world, &reply, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string()
        };
        assert!(prompt(&asked, "Yeah.").ends_with("Just asked: \"Should we say it runs on Meta's models?\"\nNEW THOUGHT: \"Yeah.\""));
        // Nothing was asked, or the turn is long enough to stand on its own.
        assert!(!prompt(&told, "Yeah.").contains("Just asked"));
        assert!(!prompt(&asked, "Yeah, and the intro should be shorter before we record it again.").contains("Just asked"));
    }

    /// Places `text` as a new thread, with the model's answer about the misheard words.
    fn place(text: &str, misheard: serde_json::Value) -> Vec<Change> {
        let thought = Thought {
            id: "a".into(),
            speaker: "you".into(),
            text: text.into(),
            point: String::new(),
            thread_id: None,
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
            decided: false,
        };
        let mut answer = json!({"action": "new", "title": "Muse Bark speed", "point": text});
        answer.as_object_mut().unwrap().extend(misheard.as_object().unwrap().clone());
        let placement: Placement = serde_json::from_value(answer).unwrap();
        decide(&World::default(), &thought, placement, 0, false, true)
    }

    /// The new thread's title, then the placed point, unclear, guess, heard and fixed words.
    fn outcome(changes: &[Change]) -> [String; 6] {
        let title = changes.iter().find_map(|c| match c {
            Change::ThreadAdded { thread } => Some(thread.title.clone()),
            _ => None,
        });
        let placed = changes.iter().find_map(|c| match c {
            Change::ThoughtPlaced { point, unclear, guess, heard, fixed, .. } => {
                Some([point, unclear, guess, heard, fixed].map(|s| s.clone()))
            }
            _ => None,
        });
        let [point, unclear, guess, heard, fixed] = placed.unwrap();
        [title.unwrap(), point, unclear, guess, heard, fixed]
    }

    /// Line 3 of the demo is placed as a decision, whatever the model titles its thread; talk about deciding isn't.
    #[test]
    fn a_decision_said_is_placed_as_one_and_talk_about_deciding_is_not() {
        let decided = |text: &str| {
            decide(&map(), &turn(text), reply(json!({"action": "new", "title": "Pottery Class Cost"})), 0, false, true)
                .into_iter()
                .find_map(|c| match c {
                    Change::ThoughtPlaced { decided, .. } => Some(decided),
                    _ => None,
                })
                .unwrap()
        };
        assert!(decided("Okay, decided: if it's under eighty dollars, I'm booking it tonight."));
        // Branched off a thread, a decision lands on it instead; anything else still branches.
        let landed = |text: &str, new_thread: bool| {
            decide(&map(), &turn(text), reply(json!({"action": "new", "title": "Pottery Class Cost", "parent_id": "T2"})), 0, new_thread, true)
                .into_iter()
                .find_map(|c| match c {
                    Change::ThoughtPlaced { thread_id, .. } => Some(thread_id),
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(landed("Okay, decided: if it's under eighty dollars, I'm booking it tonight.", false), "T2");
        assert_eq!(landed("The class costs eighty dollars a person.", false), "T3", "not a decision: its own branch");
        assert_eq!(landed("Decided: we book the class.", true), "T3", "asked for a new thread, it starts one");
        assert!(decided("Decided: I'll study with Priya on Wednesday night."));
        assert!(!decided("I can't decide whether to book the pottery class."));
        assert!(!decided("We'll decide later about the pottery class."));
        let mut world = World::default();
        let thought = turn("Let's go with the Thursday slot.");
        world.thoughts.push(thought.clone());
        for change in decide(&World::default(), &thought, reply(json!({"action": "new", "title": "Slot"})), 0, false, true) {
            world.apply(&change);
        }
        assert!(world.thoughts[0].decided, "the map keeps it");
    }

    /// A new thread branches one level at most: under a top thread as asked, at the top when the parent named is
    /// itself a branch (the flight home under the cafe shift under the midterm, threads trace 2026-11-01) or isn't there.
    #[test]
    fn a_new_thread_branches_only_from_a_top_thread() {
        let world = World {
            threads: vec![thread("T1"), Thread { parent_id: Some("T1".into()), ..thread("T2") }],
            active: Some("T2".into()),
            ..World::default()
        };
        let parent = |parent_id: &str| {
            let answer = reply(json!({"action": "new", "title": "Flight home", "parent_id": parent_id}));
            decide(&world, &turn("Mom asked when my flight home is, it's December 18."), answer, 0, false, true)
                .into_iter()
                .find_map(|c| match c {
                    Change::ThreadAdded { thread } => Some(thread.parent_id),
                    _ => None,
                })
                .expect("a new thread")
        };
        assert_eq!(parent("T1"), Some("T1".into()), "a top thread keeps its branch");
        assert_eq!(parent("T2"), None, "a branch named as parent: a thread of its own");
        assert_eq!(parent("T9"), None, "a parent that isn't on the map");
        assert_eq!(parent(""), None);
    }

    #[test]
    fn a_sure_guess_is_made_without_asking() {
        let changes = place("Muse Bark is fast enough", json!({"unclear": "Bark", "guess": "Spark", "sure": true}));
        assert_eq!(outcome(&changes), ["Muse Spark speed", "Muse Spark is fast enough", "", "", "Bark", "Spark"]);
        let touched = changes.iter().find_map(|c| match c {
            Change::ThreadTouched { last_point, .. } => Some(last_point.as_str()),
            _ => None,
        });
        assert_eq!(touched, Some("Muse Spark is fast enough"));
    }

    #[test]
    fn anything_less_than_sure_is_asked() {
        let text = "Muse Bark is fast enough";
        let asked = ["Muse Bark speed", text, "Muse Bark", "Muse Spark", "", ""];
        // Unsure, or an older answer with no "sure" at all.
        assert_eq!(outcome(&place(text, json!({"unclear": "Muse Bark", "guess": "Muse Spark", "sure": false}))), asked);
        assert_eq!(outcome(&place(text, json!({"unclear": "Muse Bark", "guess": "Muse Spark"}))), asked);
        // Sure, but those words aren't in what was said, or only inside a longer word.
        let elsewhere = outcome(&place(text, json!({"unclear": "Moose Bark", "guess": "Muse Spark", "sure": true})));
        assert_eq!(elsewhere[2..], ["Moose Bark", "Muse Spark", "", ""]);
        let inside = outcome(&place("the barking is fast", json!({"unclear": "bark", "guess": "park", "sure": true})));
        assert_eq!(inside[2..], ["bark", "park", "", ""]);
        // Sure, but the guess was said too.
        let both = "Muse Spark is good but Muse Bark is faster";
        let said = outcome(&place(both, json!({"unclear": "Bark", "guess": "Spark", "sure": true})));
        assert_eq!(said[1..], [both, "Bark", "Spark", "", ""]);
        // Sure, but nothing to change.
        let same = outcome(&place(text, json!({"unclear": "Muse Bark", "guess": "muse bark", "sure": true})));
        assert_eq!(same[2..], ["Muse Bark", "", "", ""]);
    }

    /// A real case, reworded: one card selected, a thought about another card's topic. The model's
    /// thread wins: selecting a card makes it the active one, a hint, never where the words must go.
    #[tokio::test]
    async fn content_wins_over_the_selected_card_and_the_trace_says_both() {
        let answer = r#"{"action":"return","thread_id":"T1","title":"","parent_id":"","point":"Mic cut me off mid-sentence","split":"","complete":true,"dropped":[],"unclear":"","guess":"","sure":false}"#;
        let (url, _) = stand_in(vec![body(json!("stop"), json!(answer))]).await;
        let dir = std::env::temp_dir().join(format!("e2a2o-placer-trace-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let (journal, _) = crate::world::Journal::open(&dir.join("journal.jsonl")).unwrap();
        let mut world = World::default();
        for (id, title) in [("T1", "Microphone feedback"), ("T2", "Grocery list")] {
            world.apply(&Change::ThreadAdded { thread: Thread { title: title.into(), ..thread(id) } });
        }
        // The grocery card is selected (a click is an ActiveChanged, as `Core::focus` makes it).
        world.apply(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "you".into() });
        let core = Core { key: Some("good".into()), trace: crate::trace::Trace::to(&dir), ..Core::test(journal, world) };
        core.keep("you", "The mic cut me off again in the middle of a sentence");
        let id = core.snapshot().thoughts[0].id.clone();
        super::place(&core, &id, &url, super::patience).await.unwrap();
        let world = core.snapshot();
        assert_eq!(world.thoughts[0].thread_id.as_deref(), Some("T1"), "content, not the selection");
        assert_eq!(world.active_for("you").map(String::as_str), Some("T1"), "the map follows the words");

        let lines: Vec<serde_json::Value> =
            std::fs::read_to_string(dir.join("trace.jsonl")).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let call = lines.iter().find(|l| l["kind"] == "call").expect("the model call");
        assert_eq!((call["feature"].as_str(), call["thought"].as_str(), call["model"].as_str()), (Some("placer"), Some(id.as_str()), Some("test")));
        assert!(call["sent"][1]["content"].as_str().unwrap().contains("Active thread: T2"), "what was sent");
        assert_eq!(call["answer"].as_str(), Some(answer), "what came back");
        let placed = lines.iter().find(|l| l["kind"] == "placed").expect("the placement");
        assert_eq!(placed["thought"].as_str(), Some(id.as_str()));
        assert_eq!((placed["active"].as_str(), placed["active_title"].as_str()), (Some("T2"), Some("Grocery list")));
        assert_eq!((placed["landed"].as_str(), placed["landed_title"].as_str()), (Some("T1"), Some("Microphone feedback")));
        assert_eq!((placed["answer"]["action"].as_str(), placed["new"].as_bool()), (Some("return"), Some(false)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_traced_placement_that_starts_a_thread_names_it_and_a_split_names_the_rest() {
        let world = map();
        let said = turn("Book the dentist and also the car needs new tires");
        let answer = reply(json!({"action": "new", "title": "Dentist", "point": "Book the dentist", "split": "also the car needs new tires"}));
        let (changes, rest) = settle(&world, &said, answer, 0, false, true);
        let line = super::traced(&world, &said, ("new".into(), String::new(), "Dentist".into(), "also the car".into()), false, &changes, rest.as_deref());
        assert_eq!(line["text"], said.text);
        assert_eq!((line["new"].as_bool(), line["landed_title"].as_str()), (Some(true), Some("Dentist")));
        assert_eq!(line["rest"].as_str(), rest.as_deref());
        assert!(line["rest"].is_string());
    }

    /// Routing cases against the real model: `cargo test --release -- --ignored routing_cases --nocapture`, with
    /// MODEL_API_KEY set (about $0.0002 a placement on the default model). Each line of `ROUTING_CASES` (default
    /// scripts/routing-cases.jsonl) is a map, the card selected, words said, and where they may land; each runs
    /// `ROUTING_RUNS` times (default 3) on a fresh copy, since one answer is a hint, not proof. A case fails when
    /// most of its runs land somewhere it doesn't allow. A line can instead take its map from a journal: every
    /// change before thought `thought` was said, and that thought's words and selection (a real miss, kept
    /// outside this repo).
    ///
    /// `before`: [thread, words, seconds ago], the speaker's own turn before; `asked`: [speaker, thread, words,
    /// seconds ago], someone else's turn after it.
    /// `want`: thread ids, "new" (any new thread), "new<" (a new top-level thread) or "new<T1" (a new branch of T1).
    /// `split`: the turn must (true) or must not (false) be cut in two. `known`: a miss not fixed yet, and why.
    /// `unfinished`: [thread, words, seconds ago], an earlier turn of the speaker's that trailed off; `trailed`: the
    /// turn `before` trailed off. `joins`: the words must (true) or must not (false) be linked to a turn before
    /// (chunks.rs); `assumed`: an assumption must (true) or must not (false) be noted. Their cases are in
    /// scripts/chunk-cases.jsonl (`ROUTING_CASES=../scripts/chunk-cases.jsonl`).
    #[tokio::test]
    #[ignore]
    async fn routing_cases() {
        let Some(key) = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty()) else {
            panic!("routing_cases needs MODEL_API_KEY");
        };
        let file = std::env::var("ROUTING_CASES").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/routing-cases.jsonl").into());
        let runs: usize = std::env::var("ROUTING_RUNS").ok().and_then(|n| n.parse().ok()).unwrap_or(3);
        let cases: Vec<serde_json::Value> =
            std::fs::read_to_string(&file).unwrap().lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect();
        let mut failed = Vec::new();
        for case in &cases {
            let name = case["name"].as_str().unwrap_or("?");
            let (world, said) = case_map(case);
            let mut good = 0;
            for run in 1..=runs {
                let dir = std::env::temp_dir().join(format!("e2a2o-case-{}", uuid::Uuid::new_v4().simple()));
                std::fs::create_dir_all(&dir).unwrap();
                let (journal, _) = crate::world::Journal::open(&dir.join("journal.jsonl")).unwrap();
                let core = Core {
                    key: Some(key.clone()),
                    placer_model: crate::model::Setting::from_env("PLACER_MODEL", "muse-spark-1.2"),
                    ..Core::test(journal, world.clone())
                };
                // As `Core::keep` adds it, but with its own time, so what was said just before is as recent as it was.
                let id = said.id.clone();
                core.commit(vec![Change::ThoughtAdded { thought: said.clone() }]);
                let rest = super::place(&core, &id, super::URL, super::patience).await;
                let after = core.snapshot();
                let landed = after.thoughts.iter().find(|t| t.id == id).and_then(|t| t.thread_id.clone()).unwrap_or_default();
                let made = after.thread(&landed).filter(|_| world.thread(&landed).is_none());
                let got = match made {
                    Some(t) => format!("new<{}", t.parent_id.clone().unwrap_or_default()),
                    None => landed.clone(),
                };
                let split = matches!(rest, Ok(Some(_)));
                let note = after.notes.get(&id).cloned().unwrap_or_default();
                let fits = case["want"].as_array().is_some_and(|want| {
                    want.iter().filter_map(|w| w.as_str()).any(|w| w == got || (w == "new" && got.starts_with("new<")))
                }) && case["split"].as_bool().is_none_or(|s| s == split)
                    && case["joins"].as_bool().is_none_or(|j| j == !note.continues.is_empty())
                    && case["assumed"].as_bool().is_none_or(|a| a == !note.assumed.is_empty());
                good += usize::from(fits);
                let title = after.thread(&landed).map(|t| t.title.clone()).unwrap_or_default();
                let noted = [("joins", note.continues.as_str()), ("assumed", note.assumed.as_str()), ("why", note.why.as_str())]
                    .iter()
                    .filter(|(_, v)| !v.is_empty())
                    .map(|(k, v)| format!(" {k}: {v}"))
                    .collect::<String>();
                println!("{} {name} #{run}: {got} \"{title}\"{}{noted}", if fits { "ok  " } else { "MISS" }, if split { " (split)" } else { "" });
                let _ = std::fs::remove_dir_all(&dir);
            }
            // A known miss is said, not failed: it waits for its fix (`known` says why and when).
            match case["known"].as_str() {
                Some(why) if good * 2 <= runs => println!("known miss, {name}: {good}/{runs}: {why}"),
                Some(_) => println!("a known miss now lands right, {name}: {good}/{runs}: drop its \"known\""),
                None if good * 2 <= runs => failed.push(format!("{name}: {good}/{runs}")),
                None => {}
            }
        }
        assert!(failed.is_empty(), "cases that mostly missed: {failed:?}");
    }

    /// A case's map and the thought said: threads given inline (`threads`: [id, title, last point, parent?],
    /// `selected`, `text`, `before`), or a journal up to a thought (`journal`, `thought`), said when it was.
    fn case_map(case: &serde_json::Value) -> (World, Thought) {
        if let Some(path) = case["journal"].as_str() {
            let id = case["thought"].as_str().unwrap();
            let mut world = World::default();
            for line in std::fs::read_to_string(path).unwrap().lines() {
                let Ok(change) = serde_json::from_str::<Change>(line) else { continue };
                if let Change::ThoughtAdded { thought } = &change {
                    if thought.id == id {
                        // Selected when it was said: what the core kept with it.
                        if let Some(at) = &thought.thread_id {
                            world.apply(&Change::ActiveChanged { thread_id: at.clone(), speaker: thought.speaker.clone() });
                        }
                        return (world, Thought { placed: false, point: String::new(), ..thought.clone() });
                    }
                }
                world.apply(&change);
            }
            panic!("thought {id} isn't in {path}");
        }
        let mut world = World::default();
        for t in case["threads"].as_array().unwrap() {
            let field = |i: usize| t[i].as_str().unwrap_or_default().to_string();
            world.apply(&Change::ThreadAdded {
                thread: Thread { title: field(1), parent_id: Some(field(3)).filter(|p| !p.is_empty()), ..thread(&field(0)) },
            });
            world.apply(&Change::ThreadTouched { thread_id: field(0), last_point: field(2), at_ms: 0 });
        }
        let now = crate::now_ms();
        // `unfinished`: [thread, words, seconds ago]: an earlier turn that trailed off.
        if let Some(u) = case["unfinished"].as_array() {
            let thread_id = u[0].as_str().unwrap();
            let earlier = Thought {
                text: u[1].as_str().unwrap().into(),
                at_ms: now - 1000 * u[2].as_u64().unwrap_or(30),
                ..thought("th-unfinished", "you", Some(thread_id), false)
            };
            world.apply(&Change::ThoughtAdded { thought: earlier });
            world.apply(&Change::ActiveChanged { thread_id: thread_id.into(), speaker: "you".into() });
        }
        // `before`: [thread, words, seconds ago]: a turn said and placed that long before this one.
        if let Some(b) = case["before"].as_array() {
            let thread_id = b[0].as_str().unwrap();
            let earlier = Thought {
                text: b[1].as_str().unwrap().into(),
                at_ms: now - 1000 * b[2].as_u64().unwrap_or(10),
                ..thought("th-before", "you", Some(thread_id), !case["trailed"].as_bool().unwrap_or(false))
            };
            world.apply(&Change::ThoughtAdded { thought: earlier });
            world.apply(&Change::ActiveChanged { thread_id: thread_id.into(), speaker: "you".into() });
        }
        // `asked`: [speaker, thread, words, seconds ago]: someone else's turn after that, such as a question.
        if let Some(a) = case["asked"].as_array() {
            let speaker = a[0].as_str().unwrap();
            let theirs = Thought {
                text: a[2].as_str().unwrap().into(),
                at_ms: now - 1000 * a[3].as_u64().unwrap_or(5),
                ..thought("th-asked", speaker, Some(a[1].as_str().unwrap()), true)
            };
            world.apply(&Change::ThoughtAdded { thought: theirs });
        }
        if let Some(selected) = case["selected"].as_str() {
            world.apply(&Change::ActiveChanged { thread_id: selected.into(), speaker: "you".into() });
        }
        let said = Thought {
            text: case["text"].as_str().unwrap().into(),
            at_ms: now,
            ..thought(&format!("th-{}", uuid::Uuid::new_v4().simple()), "you", None, true)
        };
        (world.clone(), Thought { thread_id: world.active_for("you").cloned(), ..said })
    }

    /// Words taken back while the model places them ("scratch that", catalog.rs) leave no thread, touch or move behind;
    /// put back, they go in line again and land.
    #[tokio::test]
    async fn words_taken_back_while_the_model_thinks_leave_nothing_behind() {
        let (core, path, _) = burst_core().await;
        let id = core.keep("you", "slow words taken back");
        // Its call takes 300 ms: taken back in the middle of it.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let thought = core.snapshot().thoughts[0].clone();
        core.commit(vec![Change::ThoughtSkipped { thought_id: id.clone() }]);
        tokio::time::sleep(Duration::from_millis(500)).await;
        let world = core.snapshot();
        assert!(world.threads.is_empty() && world.thoughts.is_empty() && world.active.is_none(), "{:?}", world.threads);
        crate::catalog::run_undo(&core, "you", &crate::catalog::Undo::Restore { thoughts: vec![thought], threads: Vec::new(), order: Vec::new() });
        until(Duration::from_secs(2), || core.snapshot().thoughts.iter().any(|t| t.id == id && t.placed)).await;
        assert_eq!(core.snapshot().threads.len(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
