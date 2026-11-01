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
const SYSTEM: &str = "You keep a live map of a person's spoken thoughts as threads: topics and the tangents that branch from them. \
For each NEW THOUGHT decide: \"continue\" if it says more about the active thread's last point (a detail, an answer, a correction), \
\"return\" if it says more about an earlier thread's, \
or \"new\" if it starts a new topic, a tangent, or a different part of a thread with its own detail, such as the budget of a trip \
(set parent_id to the thread it branched from or is part of, or leave it empty). Being about the same project is not enough to continue. \
\"skip\" if it adds nothing, such as \"yeah\" or \"okay\" when nothing was asked; never skip \"yes\", \"no\" or any other answer. \
split: if it moves on to another thread partway, the exact words where that starts (the other fields describe only the words before), else an empty string; \
never between two sentences about one thing, such as a deadline and what is due by then. \
thread_id: the existing thread for continue or return. title: up to 5 words, for a new thread. \
point: the thought in at most 12 words, in the speaker's own voice; a question they ask stays a question, one they quote keeps who asked. \
complete: false if the thought trails off unfinished (for example \"I need to pay rent before\"), else true. \
dropped: ids of other threads the speaker clearly left unfinished mid-thought, else empty. \
unclear: words that look mistranscribed, such as a near miss of a name on the map, else an empty string. \
guess: what those words most likely were, judging by the context, else an empty string. \
sure: true only if the context leaves no doubt about the guess (for example the right name is already on the map), else false. Answer with JSON only.";

/// A skip never sets aside a turn longer than this, whatever the model says: filler is short.
const SKIP_MAX_WORDS: usize = 8;

/// Words that join two parts of a turn; left out where it's cut in two.
const JOINS: [&str; 9] = ["and", "also", "plus", "but", "so", "oh", "then", "anyway", "or"];

/// Tokens a placement may use, its reasoning included (Spark's counts toward max_tokens, as in find.rs). Plenty for
/// a short turn. But the 1,672-character rest of a turn used up all 2,000 before its JSON ended (2026-11-01: cut off
/// after 9.7 s, then answered in 3.2 s on the same request), so a turn over 1,000 characters gets two tokens a
/// character (3,344 for that one).
const ROOM: u32 = 2000;

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
                let failed = failed + 1;
                tries.insert(thought_id.clone(), failed);
                let busy = Verdict::of(&e) == Some(Verdict::Busy);
                let (round, wait) = match failed % 3 {
                    0 => (Some(failed / 3 - 1), retry_in(failed / 3 - 1)),
                    n => (None, Duration::from_millis(500 * u64::from(n))),
                };
                if round.is_none() {
                    tracing::warn!("placement failed (try {failed}): {e:#}");
                } else {
                    tracing::warn!("placement failed: {e:#}");
                }
                // Said once: its pill says it's retrying. A busy service was already said.
                if round == Some(0) && !busy {
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
    let key = core.key()?;
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
        let response = core
            .ask_model(&core.placer_model, |model| {
                core.http
                    .post(url)
                    .bearer_auth(key)
                    // Placements take 2–3 s; a stall should cost seconds, not the shared client's two minutes a try.
                    .timeout(limit(room))
                    .json(&request(&world, &thought, model, room, new_thread))
                    .send()
            })
            .await?;
        let body = crate::model::answer(response).await?;
        match read(&body)? {
            Some(placement) => break placement,
            None if !again && room < MAX_ROOM => {
                let more = (2 * room).min(MAX_ROOM);
                tracing::info!("answer cut off at {room} tokens: asking once more with {more}");
                (room, again) = (more, true);
            }
            None => bail!("answer cut off at {room} tokens"),
        }
    };
    // From when the thought arrived, so time waiting in the queue counts too.
    let place_ms = now_ms().saturating_sub(thought.at_ms);
    tracing::info!("placed in {place_ms} ms: {} {}", placement.action, placement.thread_id);

    // Landing after the speaker moved on (newer words of theirs landed, or they moved while it retried), it
    // doesn't take them back to where they were.
    let now = now_ms();
    let moves = !core.placing.stays(thought_id)
        && !world.thoughts.iter().any(|t| t.placed && t.speaker == thought.speaker && t.said_at(now) > thought.said_at(now));
    let (changes, rest) = settle(&world, &thought, placement, place_ms, new_thread, moves);
    drop(world);
    if new_thread {
        core.new_threads.placed(thought_id, &changes, rest.as_deref());
    }
    core.commit(changes);
    Ok(rest)
}

/// The room a turn gets (see `ROOM`).
fn room_for(text: &str) -> u32 {
    u32::try_from(2 * text.len()).unwrap_or(MAX_ROOM).clamp(ROOM, MAX_ROOM)
}

/// How long a later try may take: twice what filling its room takes. The 2,000 tokens that ran out took 9.7 s
/// (2026-11-01), so 4 s and 8 ms a token of room: 20 s for a short turn, and time to use a long turn's room.
fn patience(room: u32) -> Duration {
    Duration::from_millis(4_000 + 8 * u64::from(room))
}

/// How long a first try may take: 1.2 times what filling its whole room takes (9.7 s for 2,000 tokens, so 6 ms a
/// token): 12 s for a short turn. Above every placement measured: 1,015 turns of up to 1,000 characters across our
/// journals (2026-10-27 to 11-01), median 2.8 s, 99th percentile 6.5 s, slowest 11.0 s. One that runs out goes
/// back in line with `patience`, so a slow answer costs one wasted try, not the thought.
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
    let threads = if world.threads.is_empty() {
        "(none yet)".to_string()
    } else {
        world
            .threads
            .iter()
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
    let asked = world
        .thoughts
        .iter()
        .take_while(|t| t.id != thought.id)
        .filter(|t| t.at_ms <= thought.at_ms)
        .max_by_key(|t| t.at_ms)
        .filter(|t| t.text.trim_end().ends_with('?') && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS)
        .map(|t| format!("Just asked: \"{}\"\n", t.text.trim()))
        .unwrap_or_default();
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
            {"role": "user", "content": format!("Threads:\n{threads}\nActive thread: {active}\n{names}{asked}{starts}NEW THOUGHT: \"{}\"", thought.text)},
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
                "sure": {"type": "boolean"}
            },
            "required": ["action", "thread_id", "title", "parent_id", "point", "split", "complete", "dropped", "unclear", "guess", "sure"]
        }}}
    })
}

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
    if p.action == "skip" && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS {
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

    let target = match p.action.as_str() {
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
            let parent_id = Some(p.parent_id.clone()).filter(|x| exists(x));
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
    });
    changes.push(Change::ThreadTouched { thread_id: thread_id.clone(), last_point: point, at_ms: now });
    // Landing late, after the speaker moved on: on the map, but they stay where they are and leave nothing.
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

    /// User trailed off on T1; Sam talks on T2.
    fn room() -> World {
        let mut world = World {
            threads: vec![thread("T1"), thread("T2")],
            thoughts: vec![thought("a", "User", Some("T1"), false), thought("b", "Sam", Some("T2"), true)],
            ..World::default()
        };
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "User".into() });
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
    fn one_person_moving_on_doesnt_drop_the_others_thread() {
        let world = room();
        // Sam keeps going on T2, and the model even calls T1 dropped: it isn't Sam's to drop.
        let changes = decide(&world, &thought("c", "Sam", None, true), answer("continue", "T2", &["T1"]), 0, false, true);
        assert!(drops(&changes).is_empty(), "{changes:?}");
        // User moves to T2, leaving T1 unfinished: dropped, for User.
        let changes = decide(&world, &thought("d", "User", None, true), answer("return", "T2", &[]), 0, false, true);
        assert_eq!(drops(&changes), [("T1".to_string(), "User".to_string())]);
        assert!(changes.iter().any(|c| matches!(c, Change::ActiveChanged { thread_id, speaker } if thread_id == "T2" && speaker == "User")));
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
        threads.said("User", "a");
        threads.ask("User");
        threads.said("Sam", "b");
        threads.said("User", "c");
        threads.said("User", "d");
        assert_eq!(["a", "b", "c", "d"].map(|id| threads.starts(id)), [false, false, true, false]);
        // Moving to a thread before saying anything ends the ask.
        threads.ask("User");
        threads.cancel("User");
        threads.said("User", "e");
        assert!(!threads.starts("e"));
    }

    #[test]
    fn a_thought_that_couldnt_be_placed_goes_back_in_the_queue_later_and_later() {
        let waits: Vec<u64> = (0..7).map(|round| super::retry_in(round).as_secs()).collect();
        assert_eq!(waits, [15, 30, 60, 120, 240, 240, 240]);
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

    /// User talks fast: twelve thoughts 30 ms apart, one whose call stalls and one whose call fails. Every one is
    /// saved as it's said, every one lands exactly once, the stall holds no one up, the pills say what's going on,
    /// and the two that land late don't pull him off the thread he's on.
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
            core.add_thought("User", text);
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
        // The last thing he said is where he is: the two late ones landed on the map without moving him.
        let last = world.thoughts.iter().find(|t| t.text == said[11]).unwrap();
        assert_eq!(world.active_for("User"), last.thread_id.as_ref());
        eprintln!("burst of 12 (30 ms apart, 100 ms answers, 400 ms first try): from the first said, the 10 fine in {:?}, all 12 in {:?}", others_in + said_in, others_in + said_in + all_in);
        let _ = std::fs::remove_file(&path);
    }

    /// A command waits for the speaker's own words still on their first try, and acts as soon as they land; it waits
    /// for nothing else: not a retry of theirs, and not the other person's words.
    #[tokio::test]
    async fn a_command_waits_only_for_the_speakers_own_first_tries() {
        let (core, path, _updates) = burst_core().await;
        let active = |core: &Core| core.snapshot().active_for("User").cloned();
        // Two threads of his; then a slow thought, and "where was I?" right behind it.
        core.add_thought("User", "the kitchen needs paint");
        until(Duration::from_secs(2), || landed(&core, "the kitchen needs paint")).await;
        core.add_thought("User", "the party is on Saturday");
        until(Duration::from_secs(2), || landed(&core, "the party is on Saturday")).await;
        let party = active(&core).unwrap();
        core.add_thought("User", "slow: the caterer needs a head count");
        core.add_thought("User", "Where was I?");
        assert_eq!(active(&core), Some(party.clone()), "waits for his words before it");
        until(Duration::from_secs(2), || landed(&core, "slow: the caterer needs a head count")).await;
        let after_landing = until(Duration::from_secs(1), || active(&core) != Some(id_of_thread(&core, "slow: the caterer needs a head count"))).await;
        assert!(after_landing <= Duration::from_millis(200), "acts within 0.2 s of them landing: {after_landing:?}");

        // His words on a retry don't hold a command up, and landing later doesn't undo it.
        core.add_thought("User", "stall: the fence needs fixing");
        let stall = id_of(&core, "stall: the fence needs fixing");
        until(Duration::from_secs(2), || core.placing.failed(&stall)).await;
        let here = active(&core);
        let said = std::time::Instant::now();
        core.add_thought("User", "Next one");
        let moved = said.elapsed();
        assert!(moved <= Duration::from_millis(200) && active(&core) != here, "acts at once: {moved:?}");
        let there = active(&core);
        until(Duration::from_secs(5), || landed(&core, "stall: the fence needs fixing")).await;
        assert_eq!(active(&core), there, "the late landing leaves him where the command put him");

        // Sam's words in line don't hold User's command up.
        for i in 1..=4 {
            core.add_thought("Sam", &format!("slow: Sam's thought {i}"));
        }
        let said = std::time::Instant::now();
        core.add_thought("User", "Where was I?");
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

    #[test]
    fn the_placer_sees_the_speakers_own_thread() {
        let world = room();
        let prompt = |speaker: &str| request(&world, &thought("e", speaker, None, true), "m", ROOM, false)["messages"][1]["content"].to_string();
        assert!(prompt("User").contains("Active thread: T1"));
        assert!(prompt("Sam").contains("Active thread: T2"));
        assert!(prompt("Lee").contains("Active thread: T2"), "someone new starts where the talk is");
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
}
