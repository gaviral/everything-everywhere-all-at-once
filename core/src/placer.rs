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
// Something not done yet is about that thing, not about a habit of not finishing: right after "My biggest problem is
// that I never finish my", on a thread named for that, "Oh, and rent is due Friday and I still haven't sent it" was
// reasoned over at length (is an unsent payment a case of never finishing?) and placed in 5.6 s and 5.0 s in the
// takes, over the 5 s the map has. Always right ("new"), the time was all reasoning: the same request sent alone,
// one lane, batches of 12 side by side (2026-11-02, Spark 1.2, minimal), reasoning tokens median 698 → 528 with this
// wording; 743 → 538 and 813 → 479 with an earlier one ("a bill not paid, a message not sent"); the same line after
// a finished sentence took 365–499.
// Thinking out loud about one project, one thread took idea after idea: in a real talk (2026-11-02), 9 turns on 3 ideas
// landed on one thread, and over 31 of its turns three blind readers' majority (2 of 3) kept apart 40 pairs the app had
// put together (89.5% of 465 pairs agreed). So the model finds the main subject first (the point is often at the end),
// a thread takes it only if its title covers it as it is, words that announce a move usually start a topic, and a
// point names what "it" is and keeps "not" and "maybe" instead of clipping the words. The talk replayed through the
// placer alone (82 turns, Contributor models, two runs each), pairs agreeing with the readers: Spark 1.2 85.8% and
// 86.0% before → 89.5% and 89.9% after; Spark 1.3 86.5% and 85.8% → 87.5% and 90.1%; pairs put together that the
// readers keep apart, the main error, 57–62 → 32–49. The routing cases ran as fast as before, run side by side (median
// 4.0 → 4.1 s on 1.3, 3.3 → 3.2 s on 1.2).
const SYSTEM: &str = "You keep a live map of a person's spoken thoughts as threads: topics and the tangents that branch from them. \
For each NEW THOUGHT decide: \"continue\" if it says more about the active thread (a detail, an update, an answer, a correction, \
news that something is done), \"return\" if it says more about an earlier thread, \
or \"new\" if it starts a new topic or a tangent (parent_id: the thread whose own subject it is one part of, such as the hostel for a trip; \
never one it only clashes with, shares a day or a word with, or was said after; else empty). \
First find its main subject, reading to the end: the point often comes last (a closing ask, or what an example was given for). \
An update on what a thread is about goes on that thread, even with a new detail; \
which thread that is goes by what the words mean, read with what was said just before, never by a word shared with a title. \
Continue or return only if that subject fits under the thread's title as it is: one that would need a wider title is a new topic, \
even on the same project, as usually is what follows words that announce a move (\"another idea\", \"anyway\", \"then I was thinking\"). \
A thought that mostly repeats a point on the map returns to that point's thread. \
Place by what the words are about, not by how they are said or a word they share with a title: \
a thought that trails off, or is about something not done yet (an email not answered, a form not filed), belongs with its own topic, \
never with a thread about unfinished thoughts or habits. \
\"skip\" if it adds nothing, such as \"yeah\" or \"okay\" when nothing was asked, or only introduces the next part \
(\"here's the next one\"); never skip an answer, plan or commitment, even \"I'll paste it here\". \
split: if it moves on to another topic partway, or has distinct plans, commitments or facts that need separate points, \
the exact words where the next point starts (the other fields describe only the words before), else an empty string. \
Separate points may belong to the same thread: a time limit and a promise to record later must both survive. \
Actions with different conditions or times need separate points: split before the next action. \
Keep each if/when attached to its own action; never transfer a condition to another action. \
Keep an action with its own name, time, condition and reason; never split inside that action. \
thread_id: the existing thread for continue or return. title: up to 5 words naming its subject, for a new thread, with a misheard word as its guess. \
point: what the thought means, briefly but without losing any plan, commitment, name or time; use more words when needed. \
Keep who will do what, when, conditions, limits and reasons, including tentative plans as tentative. \
Keep relative times (\"right now\", \"for now\", \"much later\", \"a few messages ago\") as well as dates and clock times. \
Keep exceptions, fallback plans and permission to keep doing something; do not replace them with \"if possible\". \
Keep both a preference and its acceptable fallback explicitly. If shortening would lose either, keep more of the original words. \
Use the speaker's own voice, naming its subject instead of \"it\" or \"this\" (\"The lease ends in May\", not \"It ends in May\"), \
with negations and hedges (\"not\", \"maybe\") kept as said: not a clipped copy, no fillers or exclamations; \
a question they ask stays a question, one they quote keeps who asked. \
complete: false if the thought trails off unfinished (for example \"I need to pay rent before\"), else true. \
dropped: ids of other threads the speaker clearly left unfinished mid-thought, else empty. \
unclear: words that look mistranscribed, such as a near miss of a name on the map or an everyday word where a known name fits (\"ocean\" for Notion), else an empty string. \
guess: what those words most likely were, judging by the context, else an empty string. \
sure: true only if the context leaves no doubt about the guess (the right name is on the map, or the words around it fit that name alone), else false. \
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

/// The models the racing calls ask, unless PLACER_MODELS (or PLACER_MODEL, for every lane) says otherwise: lane i asks
/// the (i mod 2)th, so the 2 calls ask 2 models. A slow spell mostly hits one model at a time: on the app's own placer
/// requests, one round a minute for 37 minutes (2026-11-02, n = 38 rounds, tools/latency-probe.mjs), two Spark 1.2 calls
/// racing took a median 3.6 s, 90th percentile 5.6 s, 5 s or more in 7 rounds; one Spark 1.3 and one Spark 1.2 call
/// took 3.4 s, 4.6 s, and 5 s or more in 3. Each placed the routing and chunk cases alike (69 of 69 alone), at the
/// same price a token, and neither is in Contributor mode, so placing stays private by default. Spark 1.3 goes first,
/// so a placement at the hourly cap's edge (one call) asks it.
pub const MODELS: &str = "muse-spark-1.3,muse-spark-1.2";

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

/// How many of a thread's latest points the prompt shows, oldest first, for the threads touched last (`RECENT`); the
/// others show their last point. A tool-calling placer tried on a real talk (2026-11-02, 14 runs, scored against a
/// blind jury's 2-of-3 gold) showed each thread's last 4 points and put together about half as many pairs the gold
/// keeps apart (23 vs 56) as this prompt did with the last point only.
const POINTS: usize = 3;
const RECENT: usize = 20;

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
    pub(crate) fn placed(&self, thought_id: &str, changes: &[Change], rest: Option<&str>) {
        let mut thoughts = self.thoughts.lock().unwrap();
        thoughts.remove(thought_id);
        if changes.iter().any(|c| matches!(c, Change::ThoughtSkipped { .. })) {
            thoughts.extend(rest.map(String::from));
        }
    }
}

#[derive(Clone, Deserialize)]
struct Placement {
    /// Where the turn starts another point, quoted; empty when one point keeps it all.
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
    match t.trim_end_matches(['.', '!']).to_lowercase().as_str() {
        "" | "none" | "n/a" | "null" | "-" => String::new(),
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

    /// This thought, once placed, leaves its speaker where they are: they moved while it was being placed.
    fn stay(&self, thought_id: &str) {
        self.0.lock().unwrap().stay.insert(thought_id.into());
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

/// A placement deciding, told as it goes so the map can show it (ui/src/route.ts): the threads the prompt points the
/// model to while the calls race, then where the thought went and what decided it. Only what the placer really does:
/// the model reads every thread, so a candidate is a thread the prompt singles out, never a guess at the answer.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "stage", rename_all = "snake_case")]
pub enum Route {
    /// The calls went: `lanes` copies of one call race (see `RACE`), and `candidates` are the threads the prompt names.
    Weighing { thought_id: String, candidates: Vec<Candidate>, lanes: usize },
    /// Placed (or set aside as filler, `skipped`): `path` runs from the top thread down to the one it landed on (a
    /// branch has its parent first), `new` when that thread was made for it. `pick` is what the model answered, and
    /// `rule` the rule that put it elsewhere, if one did (`decide`). `lane` (from 0) of `lanes` gave the first good
    /// answer (another may have answered sooner with one that couldn't be read), `ms` after the first calls went (a round
    /// cut off and asked again counts), and `model` is the model that lane asked (`MODELS`). Sent only once the changes
    /// are on the map.
    Decided {
        thought_id: String,
        path: Vec<String>,
        new: bool,
        skipped: bool,
        pick: Pick,
        rule: Option<String>,
        why: String,
        lane: usize,
        lanes: usize,
        ms: u64,
        model: String,
    },
}

/// A thread the prompt points the model to, and why: "active" (where the speaker is), "said just before" (where
/// their last words went), "left unfinished" (words this may finish), "just asked" (a question this may answer).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Candidate {
    pub thread_id: String,
    pub why: &'static str,
}

/// The model's answer, before the rules: its action, and the thread it named (to continue, or as a new one's parent).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Pick {
    pub action: String,
    pub thread_id: String,
}

/// The threads the prompt for `thought` singles out (see `request`), each once, on the map as it is (a merged one
/// by the thread it went into), in the order the prompt gives them.
pub(crate) fn candidates(world: &World, thought: &Thought) -> Vec<Candidate> {
    let question = just_asked(world, thought);
    let heads = crate::chunks::heads(world, thought, question);
    let mut out: Vec<Candidate> = Vec::new();
    let mut add = |id: Option<&String>, why: &'static str| {
        let Some(id) = id.map(|id| world.resolve(id)).filter(|id| world.thread(id).is_some()) else { return };
        if !out.iter().any(|c| c.thread_id == id) {
            out.push(Candidate { thread_id: id, why });
        }
    };
    add(world.active_for(&thought.speaker), "active");
    add(question.and_then(|q| q.thread_id.as_ref()), "just asked");
    add(heads.before.and_then(|t| t.thread_id.as_ref()), "said just before");
    add(heads.left.and_then(|t| t.thread_id.as_ref()), "left unfinished");
    out
}

/// The path to where `changes` placed a thought: its thread's parent first when it's a branch, then the thread. Read
/// against the map after they landed: a merge while the model thought moves the thought (and a branch's parent) to the
/// thread it went into (`World::apply`), so the path names the cards it's really on. `new` when the thread was made
/// for it.
fn path_of(world: &World, changes: &[Change]) -> (Vec<String>, bool) {
    let Some(placed) = changes.iter().find_map(|c| match c {
        Change::ThoughtPlaced { thread_id, .. } => Some(thread_id.clone()),
        _ => None,
    }) else {
        return (Vec::new(), false);
    };
    let added = changes.iter().find_map(|c| match c {
        Change::ThreadAdded { thread } if thread.id == placed => Some(thread.parent_id.clone()),
        _ => None,
    });
    let id = world.resolve(&placed);
    let parent = match world.thread(&id) {
        Some(thread) => thread.parent_id.clone(),
        None => added.clone().flatten(),
    };
    let mut path: Vec<String> = parent.map(|p| world.resolve(&p)).into_iter().collect();
    path.push(id);
    (path, added.is_some())
}

/// How long a thought waits after a round of failed tries before the next: 15 s, doubling to 4 min,
/// so it lands soon after a blip without calling the model every few seconds through an outage.
fn retry_in(round: u32) -> Duration {
    Duration::from_secs(15 << round.min(4))
}

/// Places one thought, asking the model at `url` and giving each call `limit` for its room; when the turn moved on to
/// another topic partway, returns the rest's id.
async fn place(core: &Core, thought_id: &str, url: &str, limit: fn(u32) -> Duration) -> anyhow::Result<Option<String>> {
    if crate::stay::place_waiting(core, thought_id) {
        return Ok(None);
    }
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
    let candidates = candidates(&world, &thought);
    // From when the first calls went, so a round cut off and asked again counts too: the tag says what the wait was.
    let went = std::time::Instant::now();
    let (world_at, thought_at) = (&world, &thought);
    let (lane, model, lanes, race_ms, placement) = loop {
        // Placements take 2–3 s; a stall should cost seconds, not the shared client's two minutes a try. The same
        // call goes `placer_race` times at once, each lane to its own model (`MODELS`), and the first good answer
        // wins (see `RACE`); the others are dropped.
        // Only while the hourly cap has room for every lane: at the cap, one call goes, so the extra one can't be the
        // call refused there and show "AI paused" while the first places the thought.
        let lanes = core.placer_race.max(1);
        let lanes = if core.calls_left() >= lanes { lanes } else { 1 };
        // The map shows the threads the prompt names lighting up while these calls run (ui/src/route.ts).
        core.send(ServerMsg::Route { route: Route::Weighing { thought_id: thought_id.into(), candidates: candidates.clone(), lanes } });
        let mut calls: futures_util::stream::FuturesUnordered<_> = (0..lanes)
            .map(|lane| async move {
                // The model this lane's answer came from, kept as it's asked: the lane's setting can switch while
                // another lane runs (a Contributor model giving way, a model taken out of the race), so it's not read after.
                let asked = std::sync::Mutex::new(String::new());
                let answer = core
                    .ask_model(
                        core.placer_lane(lane),
                        url,
                        limit(room),
                        |model| {
                            if let Ok(mut asked) = asked.lock() {
                                model.clone_into(&mut asked);
                            }
                            request(world_at, thought_at, model, room, new_thread)
                        },
                        json!({"thought": thought_id, "room": room, "lane": lane}),
                    )
                    .await;
                (lane, asked.into_inner().unwrap_or_default(), answer)
            })
            .collect();
        let (mut won, mut cut_off, mut failed) = (None, false, None);
        while let Some((lane, model, answer)) = futures_util::StreamExt::next(&mut calls).await {
            match answer.and_then(|body| read(&body)) {
                Ok(Some(placement)) => {
                    won = Some((lane, model, u64::try_from(went.elapsed().as_millis()).unwrap_or(u64::MAX), placement));
                    break;
                }
                Ok(None) => cut_off = true,
                Err(e) => failed = failed.or(Some(e)),
            }
        }
        drop(calls);
        match (won, cut_off, failed) {
            (Some((lane, model, ms, placement)), _, _) => break (lane, model, lanes, ms, placement),
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
    // `model` is the one the winning lane asked: after a Contributor model gave way, the one without it.
    tracing::info!("placed in {place_ms} ms by {model} (lane {lane}): {} {} parent {:?}", placement.action, placement.thread_id, placement.parent_id);

    let answer = (placement.action.clone(), placement.thread_id.clone(), placement.title.clone(), placement.split.clone());
    let named = if placement.action == "new" { &placement.parent_id } else { &placement.thread_id };
    let pick = Pick { action: clean(&placement.action), thread_id: clean(named) };
    // Landing after the speaker moved on (newer words of theirs landed, or they moved while it retried), it
    // doesn't take them back to where they were.
    let now = now_ms();
    // Nor when they moved while this call ran (a click, "new thread about …", a filing): their place now isn't the
    // one the model was asked from. Checked under the commit's lock, so a click just before it lands stands too.
    let moved = |w: &World| {
        let place = |of: &World| of.active_by.get(&thought.speaker).map(|id| w.resolve(id));
        place(&world) != place(w)
    };
    let mut moved_meanwhile = false;
    // Words taken back while the model thought ("scratch that", catalog.rs) leave no thread, touch or move behind.
    let waiting = |w: &World| w.thoughts.iter().any(|t| t.id == thought_id && !t.placed);
    let (changes, rest, rule, landed) = loop {
        // A pin set while the model was answering wins, keeping the original words whole.
        if crate::stay::place_waiting(core, thought_id) {
            return Ok(None);
        }
        let moves = !moved_meanwhile && !core.placing.stays(thought_id) && !said_since(&world, &thought, now).any(|t| t.speaker == thought.speaker);
        let (changes, rest, rule) = settle_ruled(&world, &thought, placement.clone(), place_ms, new_thread, moves);
        if !waiting(&core.snapshot()) {
            tracing::info!("placed {thought_id} after it was taken back: dropped");
            return Ok(None);
        }
        // The thread it lands on (or under) must still be on the map: a delete while the model thought can take it
        // off, and a point on no card is lost from view. Then it goes in line again and is placed on the map as it is now.
        let added: Vec<String> = changes.iter().filter_map(|c| match c {
            Change::ThreadAdded { thread } => Some(thread.id.clone()),
            _ => None,
        }).collect();
        let targets: Vec<String> = changes.iter().filter_map(|c| match c {
            Change::ThoughtPlaced { thread_id, .. } => Some(thread_id.clone()),
            Change::ThreadAdded { thread } => thread.parent_id.clone(),
            _ => None,
        }).collect();
        let there = |w: &World| targets.iter().all(|id| added.contains(id) || w.thread(&w.resolve(id)).is_some());
        // The ask for a new thread is spent only when the words land: placed again, they still start it.
        let landed = if new_thread { changes.clone() } else { Vec::new() };
        let traced_line = || traced(&world, &thought, answer.clone(), new_thread, &changes, rest.as_deref());
        if core.commit_if(|w| w.stay_here.is_none() && waiting(w) && there(w) && !(moves && moved(w)), changes.clone()) {
            core.trace.write(traced_line);
            break (changes, rest, rule, landed);
        }
        let now = core.snapshot();
        if now.stay_here.is_some() && waiting(&now) {
            continue;
        }
        if moves && waiting(&now) && there(&now) {
            // They moved while the model thought (only that refuses it with the words waiting and their thread there):
            // settle again without moving them.
            moved_meanwhile = true;
            continue;
        }
        core.trace.write(traced_line);
        if waiting(&now) && !there(&now) {
            tracing::info!("placed {thought_id} on a thread taken off the map meanwhile: placing it again");
            let _ = core.placer_queue.send(Job::Place(thought_id.to_string()));
        }
        return Ok(None);
    };
    drop(world);
    // A split turn's rest stays put too when it lands (`Placing::placed` passes this on).
    if moved_meanwhile {
        core.placing.stay(thought_id);
    }
    // The path is filled in once the changes are on the map (`path_of`).
    let mut decided = Route::Decided {
        thought_id: thought_id.into(),
        path: Vec::new(),
        new: false,
        skipped: changes.iter().any(|c| matches!(c, Change::ThoughtSkipped { .. })),
        pick,
        rule: rule.map(String::from),
        why: changes.iter().find_map(|c| match c {
            Change::ThoughtNoted { note, .. } => Some(note.why.clone()),
            _ => None,
        }).unwrap_or_default(),
        lane,
        lanes,
        ms: race_ms,
        model,
    };
    let placing: Vec<Change> = changes.iter().filter(|c| matches!(c, Change::ThoughtPlaced { .. } | Change::ThreadAdded { .. })).cloned().collect();
    if new_thread {
        core.new_threads.placed(thought_id, &landed, rest.as_deref());
    }
    if let Route::Decided { path, new, .. } = &mut decided {
        (*path, *new) = path_of(&core.snapshot(), &placing);
    }
    // After the changes, so the map never shows a place the thought didn't take (taken back, its thread deleted).
    core.send(ServerMsg::Route { route: decided });
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
#[cfg(test)]
fn settle(world: &World, thought: &Thought, p: Placement, place_ms: u64, new_thread: bool, moves: bool) -> (Vec<Change>, Option<String>) {
    let (changes, rest, _) = settle_ruled(world, thought, p, place_ms, new_thread, moves);
    (changes, rest)
}

/// `settle`, with the rule that put the thought somewhere other than the model's pick, if one did (`decide_ruled`).
fn settle_ruled(
    world: &World,
    thought: &Thought,
    mut p: Placement,
    place_ms: u64,
    new_thread: bool,
    moves: bool,
) -> (Vec<Change>, Option<String>, Option<&'static str>) {
    let Some((before, rest)) = cut(&thought.text, &clean(&p.split)) else {
        // A quote that cuts nothing leaves the model unsure which words were filler: place them all.
        let mut rule = None;
        if p.action == "skip" && !clean(&p.split).is_empty() {
            p.action = "continue".into();
            rule = Some(rules::FILLER_UNCLEAR);
        }
        let (changes, decided) = decide_ruled(world, thought, p, place_ms, new_thread, moves);
        return (changes, None, decided.or(rule));
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
    let (placed, rule) = decide_ruled(world, &first, p, place_ms, new_thread, moves);
    changes.extend(placed);
    (changes, Some(rest_id), rule)
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
    // A thread shows its latest points (`POINTS`), not only its last: by its title and last point, a thread that had
    // taken in a few ideas looked like the place for any of them, or for anything near its title. Only the threads
    // touched last (`RECENT`) do, so a map of hundreds stays the length it was; their lines are the list's end, the
    // part a placement rewrites anyway.
    let recent: HashSet<&str> = ordered.iter().rev().take(RECENT).map(|t| t.id.as_str()).collect();
    let mut points: HashMap<&str, Vec<&str>> = HashMap::new();
    for t in world.thoughts.iter().filter(|t| t.placed && !t.point.trim().is_empty()) {
        if let Some(on) = t.thread_id.as_deref().filter(|on| recent.contains(on)) {
            points.entry(on).or_default().push(t.point.trim());
        }
    }
    let threads = if ordered.is_empty() {
        "(none yet)".to_string()
    } else {
        ordered
            .into_iter()
            .map(|t| {
                let status = if t.status == ThreadStatus::Dropped { "dropped" } else { "open" };
                let last = match points.get(t.id.as_str()) {
                    Some(said) => said[said.len().saturating_sub(POINTS)..].join(" | "),
                    None => t.last_point.clone(),
                };
                format!("{}: {} [{status}] last: {last}", t.id, t.title)
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
    // The rest of a turn cut into points (`settle`): placed alone, with its first part quoted just before it, a
    // rest about a summary card read as more of the watch-sync thread its first part went to (its routing case: 0 of 3
    // runs on Spark 1.3 Contributor, 1 of 3 on 1.2; with this line and the prompt's subject check, 2 of 3 on each).
    // A separate commitment on the same subject can stay there; a split alone never requires a new thread.
    let moved_on = world
        .split_from
        .get(&thought.id)
        .and_then(|first| world.thoughts.iter().find(|t| &t.id == first))
        .and_then(|first| first.thread_id.as_deref().map(|on| world.resolve(on)))
        .map(|on| format!("It is the rest of the turn just before, cut into separate points. Place by its own subject: it may continue {on}, return to another thread or start a new one.\n"))
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
            {"role": "user", "content": format!("Threads (last: their latest points, oldest first):\n{threads}\nActive thread: {active}\n{names}{asked}{before}{left}{moved_on}{starts}NEW THOUGHT: \"{}\"", thought.text)},
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
        // Not its own first part: the rest of a turn cut in two moved on from it. Another turn said in the same
        // millisecond (two flushed together on a reconnect) still counts.
        .filter(|t| world.split_from.get(&thought.id) != Some(&t.id))
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
#[cfg(test)]
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64, new_thread: bool, moves: bool) -> Vec<Change> {
    decide_ruled(world, thought, p, place_ms, new_thread, moves).0
}

/// The rules that can put a thought somewhere other than the model's pick, in the person's words: the map says which
/// one did (ui/src/route.ts).
pub(crate) mod rules {
    // Short enough to sit on a card's edge on a phone (ui/src/route.css).
    pub const JOINS: &str = "finishes the words before";
    pub const DECISION: &str = "decisions go on their topic";
    pub const ASKED: &str = "you asked for a new topic";
    pub const ONE_LEVEL: &str = "one level of tangents";
    pub const NO_SUCH: &str = "unknown topic: stays put";
    pub const NOT_FILLER: &str = "too long to be filler";
    pub const SAYS_DECIDED: &str = "says a decision: kept";
    pub const FILLER_UNCLEAR: &str = "unclear what was filler";
    pub const ANSWERS: &str = "answers a question: kept";
}

/// `decide`, with the rule that put the thought somewhere other than the model's pick, if one did (`rules`).
fn decide_ruled(world: &World, thought: &Thought, p: Placement, place_ms: u64, new_thread: bool, moves: bool) -> (Vec<Change>, Option<&'static str>) {
    // Nothing to place ("yeah" when nothing was asked): out of the map. A longer turn is placed anyway.
    // Never words that say a decision: "Okay, decided:" cut off by a pause is two words, and the rest needs it.
    // Nor a short turn right after a question (`just_asked`): it answers it ("The blue."), as the prompt asks of the
    // model too ("never skip … any other answer"); the code holds it to that.
    let answers = just_asked(world, thought).is_some();
    if p.action == "skip" && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS && !crate::decided::said(&thought.text) && !answers {
        return (vec![Change::ThoughtSkipped { thought_id: thought.id.clone() }], None);
    }
    // Kept for one of three reasons, and the map says which: it's long, it says a decision, or it answers a question.
    let mut rule = (p.action == "skip").then(|| {
        if thought.text.split_whitespace().count() > SKIP_MAX_WORDS {
            rules::NOT_FILLER
        } else if crate::decided::said(&thought.text) {
            rules::SAYS_DECIDED
        } else {
            rules::ANSWERS
        }
    });
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
        _ if head.is_some() => {
            let joined = head.as_ref().and_then(|h| h.thread_id.clone());
            if p.action == "new" || joined.as_deref().is_some_and(|j| world.resolve(j) != world.resolve(&p.thread_id)) {
                rule = Some(rules::JOINS);
            }
            joined
        }
        // A decision goes on the thread it decides, not a branch of its own: the model branched "decided: if it's
        // under $80, I'm booking it" off Mom's birthday as "Pottery Class Cost" (2026-11-01 take), so the birthday's
        // card never showed what was decided about it.
        "new" if decided && !new_thread && exists(&p.parent_id) => {
            rule = Some(rules::DECISION);
            Some(p.parent_id.clone())
        }
        "new" => None,
        _ if new_thread => {
            rule = Some(rules::ASKED);
            None
        }
        _ if exists(&p.thread_id) => Some(p.thread_id.clone()),
        _ => {
            let active = world.active_for(speaker).cloned().filter(|a| exists(a));
            if active.is_some() {
                rule = rule.or(Some(rules::NO_SUCH));
            }
            active
        }
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
            if parent_id.is_none() && world.thread(&p.parent_id).is_some() {
                rule = Some(rules::ONE_LEVEL);
            }
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
        return (changes, rule);
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
    (changes, rule)
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

    #[tokio::test]
    async fn stay_here_keeps_every_speaker_whole_and_release_restores_normal_placing() {
        let reply = json!({"action": "return", "thread_id": "T2", "point": "Paint the wall", "split": "rent is due Friday"});
        let path = std::env::temp_dir().join(format!("e2a2o-stay-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let (placer_queue, mut queue) = tokio::sync::mpsc::unbounded_channel();
        // No key: the pin is a choice, and placing or splitting must never ask a model.
        let mut core = Arc::new(Core { placer_queue, placer_race: 1, ..Core::test(journal, world) });
        core.commit(vec![Change::ThreadAdded { thread: thread("T1") }, Change::ThreadAdded { thread: thread("T2") }, Change::AiJoined { speaker: "Claude".into() }]);
        core.focus("User", "T1");
        core.add_thought("User", "Stay here");
        assert_eq!(core.snapshot().stay_here.as_deref(), Some("T1"));
        // Different speakers' active topics and later Focus changes never release or redirect the pin.
        core.focus("Sam", "T2");
        core.focus("Claude", "T2");
        core.focus("User", "T2");
        const TEXT: &str = "Paint the wall, and rent is due Friday.";
        for speaker in ["User", "Sam", "Claude"] {
            core.add_thought(speaker, TEXT);
        }
        core.add_typed("Claude", "okay");
        core.add_thought("Sam", "New topic about the garden");
        core.add_thought("User", "Add milk to the Topic T2 topic");
        let pinned = core.snapshot();
        assert_eq!(pinned.threads.len(), 2);
        assert_eq!(pinned.thoughts.len(), 6, "commands aren't thoughts; every other turn stays whole");
        assert_eq!(pinned.thoughts.iter().map(|t| (t.speaker.as_str(), t.text.as_str())).collect::<Vec<_>>(), [
            ("User", TEXT), ("Sam", TEXT), ("Claude", TEXT), ("Claude", "okay"),
            ("Sam", "New topic about the garden"), ("User", "Add milk to the Topic T2 topic"),
        ], "the original turns stay whole and in arrival order");
        for t in &pinned.thoughts {
            assert!(t.placed);
            assert_eq!(t.thread_id.as_deref(), Some("T1"));
            assert_eq!(t.point, t.text, "no shortening or splitting");
        }
        assert!(queue.try_recv().is_err(), "pinned arrivals never enter the model's queue");
        let (_, reopened) = crate::world::Journal::open(&path).unwrap();
        assert_eq!(reopened.stay_here, pinned.stay_here);
        assert_eq!(reopened.thoughts.len(), 6);

        // A journal reopened with the pin still accepts words whole, before it has a key.
        let replay_path = std::env::temp_dir().join(format!("e2a2o-stay-replay-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::world::Journal::open(&replay_path).unwrap();
        let replay = Core::test(journal, reopened);
        let replayed = replay.keep("Claude", TEXT);
        assert!(replay.snapshot().thoughts.iter().any(|t| t.id == replayed && t.placed && t.point == TEXT && t.thread_id.as_deref() == Some("T1")));

        core.add_thought("Sam", "Let go");
        assert!(core.snapshot().stay_here.is_none());
        assert!(crate::world::Journal::open(&path).unwrap().1.stay_here.is_none());
        Arc::get_mut(&mut core).unwrap().key = Some("good".into());
        let id = core.keep("User", TEXT);
        assert!(matches!(queue.try_recv(), Ok(super::Job::Place(queued)) if queued == id));
        // The released arrival is queued normally. Apply the same model answer through the normal settlement:
        // it can choose another topic and split again. No local HTTP listener is needed for this regression.
        let thought = core.snapshot().thoughts.iter().find(|t| t.id == id).unwrap().clone();
        let (changes, rest) = settle(&core.snapshot(), &thought, serde_json::from_value(reply).unwrap(), 0, false, true);
        core.commit(changes);
        let rest = rest.expect("normal placing splits again");
        let released = core.snapshot();
        let first = released.thoughts.iter().find(|t| t.id == id).unwrap();
        assert_eq!(first.thread_id.as_deref(), Some("T2"), "the model's destination wins after release");
        assert_eq!(first.point, "Paint the wall");
        assert_ne!(first.text, TEXT);
        assert!(released.thoughts.iter().any(|t| t.id == rest && t.text == "rent is due Friday."));
        let journal = std::fs::read_to_string(&path).unwrap();
        assert_eq!(journal.lines().filter(|line| line.contains("\"type\":\"thought_split\"")).count(), 1, "only the released thought split");
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(replay_path);
    }

    #[tokio::test]
    async fn a_queued_thought_obeys_a_new_pin_before_asking_for_a_key_or_splitting() {
        let path = std::env::temp_dir().join(format!("e2a2o-stay-queued-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        core.commit(vec![Change::ThreadAdded { thread: thread("T1") }]);
        let text = "The wall needs paint, and the rent is due Friday.";
        let id = core.keep("Claude", text);
        core.new_threads.ask("Claude");
        core.new_threads.said("Claude", &id);
        assert!(crate::stay::set(&core, "User", Some("T1")));
        assert!(super::place(&core, &id, "unused: no model call", super::patience).await.unwrap().is_none());
        let world = core.snapshot();
        assert_eq!(world.thoughts.len(), 1);
        assert_eq!(world.thoughts[0].point, text);
        assert_eq!(world.thoughts[0].thread_id.as_deref(), Some("T1"));
        assert!(!core.new_threads.starts(&id));
        let _ = std::fs::remove_file(path);
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
        // The windows hear the winner answered and the loser dropped (`dropped`, omitted when false), never that a
        // placing call failed: the model line would say "didn't answer" over every placed thought.
        let told: Vec<_> = ends.iter().map(|m| (m["step"].as_str(), m["ok"].as_bool(), m["dropped"].as_bool().unwrap_or(false))).collect();
        assert_eq!(told, [(Some("placer"), Some(true), false), (Some("placer"), Some(false), true)], "{ends:?}");
    }

    /// How a placement raced on several models went (`mixed`).
    struct Mixed {
        result: anyhow::Result<Option<String>>,
        /// Each model asked, in the order the stand-in heard them.
        asked: Vec<String>,
        placed: bool,
        took: Duration,
        /// The landing as the windows hear it (`Route::Decided`).
        decided: serde_json::Value,
        /// Each placing call's end as the model line hears it: its model, ok, dropped.
        ends: Vec<(String, bool, bool)>,
        notices: Vec<String>,
        /// Each of the 2 lanes' model after the race (a Contributor model may have given way).
        lanes: Vec<String>,
        refused: bool,
    }

    /// In `mixed`'s answers: a 200 whose headers go at once and whose body follows after the delay.
    const HEADERS_FIRST: u16 = 1200;

    /// A placement raced on 2 lanes: `lanes` (empty: every lane asks `one`, as PLACER_MODEL does), against a stand-in
    /// that answers each model after its delay with its status (`answers`; else at once, 200), a whole answer when 200.
    /// A model listed more than once answers its nth request with its nth entry, the last one after that.
    async fn mixed(one: &str, lanes: crate::model::Lanes, answers: Vec<(&'static str, u64, u16)>) -> Mixed {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
            let model = request["model"].as_str().unwrap_or_default().to_string();
            let nth = {
                let mut seen = seen.lock().unwrap();
                seen.push(model.clone());
                seen.iter().filter(|m| **m == model).count() - 1
            };
            let mine: Vec<_> = answers.iter().filter(|(m, _, _)| *m == model).collect();
            let (delay, status) = mine.get(nth).or(mine.last()).map_or((0, 200), |(_, d, s)| (*d, *s));
            async move {
                use axum::response::IntoResponse;
                let late = Duration::from_millis(delay);
                if status == HEADERS_FIRST {
                    let text = body(json!("stop"), json!(WHOLE)).to_string();
                    let chunk = futures_util::stream::once(async move {
                        tokio::time::sleep(late).await;
                        Ok::<_, std::io::Error>(text)
                    });
                    return ([(axum::http::header::CONTENT_TYPE, "application/json")], axum::body::Body::from_stream(chunk)).into_response();
                }
                tokio::time::sleep(late).await;
                let answer = if status == 200 { body(json!("stop"), json!(WHOLE)) } else { json!({"error": {"message": "no"}}) };
                (axum::http::StatusCode::from_u16(status).unwrap(), axum::Json(answer)).into_response()
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
        let path = std::env::temp_dir().join(format!("e2a2o-mixed-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let core = Core { key: Some("good".into()), placer_model: one.into(), placer_lanes: lanes, placer_race: 2, ..Core::test(journal, world) };
        let mut updates = core.updates.subscribe();
        core.keep("you", "Pay rent before Friday");
        let id = core.snapshot().thoughts[0].id.clone();
        let started = std::time::Instant::now();
        let result = super::place(&core, &id, &url, super::patience).await;
        let took = started.elapsed();
        let placed = core.snapshot().thoughts[0].placed;
        let messages: Vec<serde_json::Value> = std::iter::from_fn(|| updates.try_recv().ok()).map(|o| serde_json::to_value(o.message).unwrap()).collect();
        let decided = messages.iter().find(|m| m["type"] == "route" && m["route"]["stage"] == "decided").map(|m| m["route"].clone()).unwrap_or_default();
        let ends = messages.iter()
            .filter(|m| m["type"] == "step" && m["done"] == true && m["step"] == "placer")
            .map(|m| (m["model"].as_str().unwrap_or_default().to_string(), m["ok"] == true, m["dropped"] == true))
            .collect();
        let notices = messages.iter().filter(|m| m["type"] == "notice").map(|m| m["message"].as_str().unwrap_or_default().to_string()).collect();
        let lanes = (0..2).map(|lane| core.placer_lane(lane).name().to_string()).collect();
        let refused = core.key_refused();
        let _ = std::fs::remove_file(&path);
        let asked = asked.lock().unwrap().clone();
        Mixed { result, asked, placed, took, decided, ends, notices, lanes, refused }
    }

    const SPARK_13: &str = "muse-spark-1.3";
    const SPARK_12: &str = "muse-spark-1.2";
    fn default_lanes() -> crate::model::Lanes {
        crate::model::Lanes::pick(None, None, super::MODELS)
    }

    /// Lane i asks the list's (i mod n)th model: by default one Spark 1.3 call and one Spark 1.2 call, not two of one.
    #[tokio::test]
    async fn each_lane_asks_its_own_model_in_turn() {
        let names = |lanes: &crate::model::Lanes, n: usize| (0..n).map(|i| lanes.get(i).unwrap().name().to_string()).collect::<Vec<_>>();
        assert_eq!(names(&default_lanes(), 5), [SPARK_13, SPARK_12, SPARK_13, SPARK_12, SPARK_13]);
        let set = |list: &str| crate::model::Lanes::pick(None, Some(list.into()), super::MODELS);
        assert_eq!(names(&set(" a, b ,c"), 4), ["a", "b", "c", "a"]);
        assert_eq!(names(&set("only"), 2), ["only", "only"]);
        assert_eq!(names(&set(" , "), 2), [SPARK_13, SPARK_12], "nothing named: the default");
        // Through a real race: both models asked once, with the same request otherwise.
        let mut race = mixed("unused", default_lanes(), vec![]).await;
        assert!(race.result.unwrap().is_none() && race.placed);
        race.asked.sort();
        assert_eq!(race.asked, [SPARK_12, SPARK_13]);
    }

    /// PLACER_MODEL keeps its meaning: every lane asks that one model, as is, whatever PLACER_MODELS says; a model the
    /// key can't use counts as the key refused, with no fallback.
    #[tokio::test]
    async fn placer_model_set_asks_that_one_model_in_every_lane_as_is() {
        const CHOSEN: &str = "muse-spark-1.2-contributor";
        let lanes = || crate::model::Lanes::pick(Some(CHOSEN.into()), Some("a,b".into()), super::MODELS);
        assert!(lanes().get(0).is_none() && lanes().get(1).is_none());
        let race = mixed(CHOSEN, lanes(), vec![]).await;
        assert!(race.result.unwrap().is_none() && race.placed);
        assert_eq!((race.asked, race.decided["model"].as_str()), (vec![CHOSEN.to_string(), CHOSEN.into()], Some(CHOSEN)));
        let race = mixed(CHOSEN, lanes(), vec![(CHOSEN, 0, 403)]).await;
        assert_eq!(crate::model::Verdict::of(&race.result.unwrap_err()), Some(crate::model::Verdict::Refused));
        assert_eq!(race.asked, [CHOSEN, CHOSEN], "never the model without Contributor mode");
        assert_eq!(race.lanes, [CHOSEN, CHOSEN]);
    }

    /// A slow spell on one model costs nothing while the other answers: the thought is placed by the fast lane, and
    /// the windows name that lane's model (the landing's `model`, the model line's answered call); the slow one is
    /// told dropped.
    #[tokio::test]
    async fn a_slow_lane_loses_to_a_fast_one_of_the_other_model() {
        for (slow, fast, lane) in [(SPARK_12, SPARK_13, 0), (SPARK_13, SPARK_12, 1)] {
            let race = mixed("unused", default_lanes(), vec![(slow, 5_000, 200), (fast, 30, 200)]).await;
            assert!(race.result.unwrap().is_none() && race.placed);
            assert!(race.took < Duration::from_secs(2), "waited on the slow {slow}: {:?}", race.took);
            assert_eq!((race.decided["model"].as_str(), race.decided["lane"].as_u64(), race.decided["lanes"].as_u64()), (Some(fast), Some(lane), Some(2)));
            assert_eq!(race.ends, [(fast.to_string(), true, false), (slow.to_string(), false, true)]);
        }
    }

    /// Each lane keeps a default's rule for its own model: one in Contributor mode the key can't use gives way to the
    /// same model without it, said once, while the other lane goes on asking its own.
    #[tokio::test]
    async fn each_lane_keeps_the_contributor_fallback_for_its_own_model() {
        const C13: &str = "muse-spark-1.3-contributor";
        const C12: &str = "muse-spark-1.2-contributor";
        let lanes = crate::model::Lanes::pick(None, Some(format!("{C13},{C12}")), super::MODELS);
        let race = mixed("unused", lanes, vec![(C13, 0, 403), (SPARK_13, 30, 200), (C12, 1_500, 200)]).await;
        assert!(race.result.unwrap().is_none() && race.placed);
        let mut asked = race.asked.clone();
        asked.sort();
        assert_eq!(asked, [C12, SPARK_13, C13], "the 1.2 lane is never switched");
        assert_eq!(race.lanes, [SPARK_13, C12]);
        assert_eq!(race.decided["model"].as_str(), Some(SPARK_13));
        assert_eq!(race.notices, ["Using muse-spark-1.3 (this key can't use the contributor model)."]);
    }

    /// One model the key can't use (401 or 403) takes only that model out of the race: the other lane places the
    /// thought, its model takes every lane from then on, said once, and the key isn't counted as refused. Only when
    /// every listed model refuses it does the key count as refused, as with one model.
    #[tokio::test]
    async fn a_model_the_key_cant_use_leaves_the_race_without_stopping_placing() {
        for status in [401, 403] {
            let race = mixed("unused", default_lanes(), vec![(SPARK_13, 0, status), (SPARK_12, 50, 200)]).await;
            assert!(race.result.unwrap().is_none() && race.placed, "{status}");
            assert!(!race.refused, "{status}: one model's refusal counted as the key's");
            assert_eq!(race.lanes, [SPARK_12, SPARK_12], "{status}");
            assert_eq!(race.decided["model"].as_str(), Some(SPARK_12));
            assert_eq!(race.notices, [format!("Placing uses {SPARK_12} (this key can't use {SPARK_13}).")]);
        }
        // The serve loop reads the key's state, not the first lane's error (`serve`: placing stops until a restart).
        let race = mixed("unused", default_lanes(), vec![(SPARK_13, 0, 403), (SPARK_12, 50, 403)]).await;
        assert!(race.result.is_err() && !race.placed && race.refused);
        assert_eq!(race.notices.last().map(String::as_str), Some(crate::model::REFUSED));
    }

    /// The landing names the model the winning lane's answer came from, even when that lane's setting switched while
    /// the race ran: a model listed twice shares one setting, and the other lane's Contributor refusal moves it to the
    /// model without Contributor mode before the first lane's answer wins.
    #[tokio::test]
    async fn the_landing_names_the_model_the_winning_answer_came_from() {
        const C13: &str = "muse-spark-1.3-contributor";
        let lanes = crate::model::Lanes::pick(None, Some(format!("{C13},{C13}")), super::MODELS);
        let race = mixed("unused", lanes, vec![(C13, 300, 200), (C13, 0, 403), (SPARK_13, 2_000, HEADERS_FIRST)]).await;
        assert!(race.result.unwrap().is_none() && race.placed);
        assert_eq!(race.lanes, [SPARK_13, SPARK_13], "the shared setting switched while the race ran");
        assert_eq!(race.decided["model"].as_str(), Some(C13));
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
            let reply = Thought { text: text.into(), at_ms: 1, ..thought("r", "you", None, true) };
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
    /// MODEL_API_KEY set (about $0.0002 a call on the default models; a placement races `RACE` calls on `MODELS` as
    /// the app does, PLACER_RACE=1 for one, PLACER_MODEL for one model in every lane). Each line of `ROUTING_CASES` (default
    /// scripts/routing-cases.jsonl) is a map, the card selected, words said, and where they may land; each runs
    /// `ROUTING_RUNS` times (default 3) on a fresh copy, since one answer is a hint, not proof. A case fails when
    /// most of its runs land somewhere it doesn't allow. A line can instead take its map from a journal: every
    /// change before thought `thought` was said, and that thought's words and selection (a real miss, kept
    /// outside this repo).
    ///
    /// `before`: [thread, words, seconds ago], the speaker's own turn before; `asked`: [speaker, thread, words,
    /// seconds ago], someone else's turn after it.
    /// `want`: thread ids, "new" (any new thread), "new<" (a new top-level thread), "new<T1" (a new branch of T1) or
    /// "skip" (set aside as adding nothing).
    /// `split`: the turn must (true) or must not (false) be cut in two. `known`: a miss not fixed yet, and why.
    /// `unfinished`: [thread, words, seconds ago], an earlier turn of the speaker's that trailed off; `trailed`: the
    /// turn `before` trailed off. `joins`: the words must (true) or must not (false) be linked to a turn before
    /// (chunks.rs); `assumed`: an assumption must (true) or must not (false) be noted. Their cases are in
    /// scripts/chunk-cases.jsonl (`ROUTING_CASES=../scripts/chunk-cases.jsonl`).
    /// `title`, `point`: the landed thread's title, or the point, holds one of these words (any case; a list of
    /// lists, one from each); `point_not`:
    /// the point holds none of them (a slip kept, an exclamation). `rounds`: at most this many rounds of calls (1:
    /// no answer was cut off at its room and asked again). Each run prints how long it took to place, and the end
    /// the median.
    /// `cut`: the words are the rest of the turn `before`, cut where it moved on to another topic.
    /// `talk`: instead of one thought, turns said in a row on one map (see `talk_run`): [{text, want?, speaker?,
    /// at?, id?}].
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
        // Whether `text` holds any of the case's words in `field`; None when the case doesn't name any.
        // A list of lists needs one word from each ("not", and "maybe").
        let holds = |case: &serde_json::Value, field: &str, text: &str| {
            let text = text.to_lowercase();
            let any = |words: &Vec<serde_json::Value>| words.iter().filter_map(|w| w.as_str()).any(|w| text.contains(&w.to_lowercase()));
            case[field].as_array().map(|list| match list.iter().map(|g| g.as_array()).collect::<Option<Vec<_>>>() {
                Some(groups) if !groups.is_empty() => groups.into_iter().all(any),
                _ => any(list),
            })
        };
        let (mut failed, mut times, mut fit, mut tried) = (Vec::new(), Vec::new(), 0, 0);
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
                    placer_lanes: crate::model::Lanes::from_env("PLACER_MODEL", "PLACER_MODELS", super::MODELS),
                    // As the app races (`RACE`, or PLACER_RACE), so a case checks the answer the app would keep:
                    // the first good one, which skews to the shorter reasonings.
                    placer_race: super::race_from_env(),
                    ..Core::test(journal, world.clone())
                };
                tried += 1;
                if let Some(talk) = case["talk"].as_array() {
                    good += usize::from(talk_run(&core, case, talk, run, &mut times).await);
                    let _ = std::fs::remove_dir_all(&dir);
                    continue;
                }
                // As `Core::keep` adds it, but with its own time, so what was said just before is as recent as it was.
                let id = said.id.clone();
                core.commit(vec![Change::ThoughtAdded { thought: said.clone() }]);
                // Timed here, not by `place_ms`: the thought keeps the time the case was read, so a later run's
                // `place_ms` would count the runs before it too.
                let (went, left) = (std::time::Instant::now(), core.calls_left());
                let rest = super::place(&core, &id, super::URL, super::patience).await;
                let ms = went.elapsed().as_millis();
                times.push(ms);
                // One call a lane, more when an answer was cut off at its room and asked again (`room_for`).
                let (calls, lanes) = (left.saturating_sub(core.calls_left()), core.placer_race.max(1));
                let after = core.snapshot();
                let placed = after.thoughts.iter().find(|t| t.id == id).cloned().unwrap_or_else(|| said.clone());
                let landed = placed.thread_id.clone().filter(|_| placed.placed).unwrap_or_default();
                let made = after.thread(&landed).filter(|_| world.thread(&landed).is_none());
                let got = match made {
                    Some(t) => format!("new<{}", t.parent_id.clone().unwrap_or_default()),
                    // Set aside as adding nothing: off the map (`ThoughtSkipped`).
                    None if !after.thoughts.iter().any(|t| t.id == id) => "skip".into(),
                    None => landed.clone(),
                };
                let split = matches!(rest, Ok(Some(_)));
                let note = after.notes.get(&id).cloned().unwrap_or_default();
                let title = after.thread(&landed).map(|t| t.title.clone()).unwrap_or_default();
                let point = if placed.placed { placed.point.clone() } else { String::new() };
                let fits = case["want"].as_array().is_some_and(|want| {
                    want.iter().filter_map(|w| w.as_str()).any(|w| w == got || (w == "new" && got.starts_with("new<")))
                }) && case["split"].as_bool().is_none_or(|s| s == split)
                    && case["joins"].as_bool().is_none_or(|j| j == !note.continues.is_empty())
                    && case["assumed"].as_bool().is_none_or(|a| a == !note.assumed.is_empty())
                    && holds(case, "title", &title).is_none_or(|h| h)
                    && holds(case, "point", &point).is_none_or(|h| h)
                    && holds(case, "point_not", &point).is_none_or(|h| !h)
                    && case["rounds"].as_u64().is_none_or(|r| calls as u64 <= r * lanes as u64);
                good += usize::from(fits);
                // A slip fixed without asking (heard → fixed), or one asked about ("Did you mean …?": unclear → guess).
                let slip = if !placed.fixed.is_empty() {
                    format!(" fixed: {} → {}", placed.heard, placed.fixed)
                } else if !placed.unclear.is_empty() {
                    format!(" asks: {} → {}", placed.unclear, placed.guess)
                } else {
                    String::new()
                };
                let noted = [("joins", note.continues.as_str()), ("assumed", note.assumed.as_str()), ("why", note.why.as_str())]
                    .iter()
                    .filter(|(_, v)| !v.is_empty())
                    .map(|(k, v)| format!(" {k}: {v}"))
                    .collect::<String>();
                println!(
                    "{} {name} #{run}: {got} \"{title}\"{} {:.1} s{} point: \"{point}\"{slip}{noted}",
                    if fits { "ok  " } else { "MISS" },
                    if split { " (split)" } else { "" },
                    ms as f64 / 1000.0,
                    if calls > lanes { format!(" ({calls} calls: cut off and asked again)") } else { String::new() }
                );
                let _ = std::fs::remove_dir_all(&dir);
            }
            fit += good;
            // A known miss is said, not failed: it waits for its fix (`known` says why and when).
            match case["known"].as_str() {
                Some(why) if good * 2 <= runs => println!("known miss, {name}: {good}/{runs}: {why}"),
                Some(_) => println!("a known miss now lands right, {name}: {good}/{runs}: drop its \"known\""),
                None if good * 2 <= runs => failed.push(format!("{name}: {good}/{runs}")),
                None => {}
            }
        }
        times.sort_unstable();
        let at = |q: f64| times.get(((times.len() as f64 - 1.0) * q).round() as usize).map_or(0.0, |&ms| ms as f64 / 1000.0);
        println!(
            "runs that fit: {fit}/{tried}; {} placements in: median {:.2} s, 90th percentile {:.2} s, slowest {:.2} s",
            times.len(),
            at(0.5),
            at(0.9),
            at(1.0)
        );
        assert!(failed.is_empty(), "cases that mostly missed: {failed:?}");
    }

    /// One run of a `talk` case: its turns said in a row on one map, each placed as the app places it, the rest of a
    /// turn cut in two right after it. A turn's move: "new" (it started a thread), "same" (it landed where its
    /// speaker's words before it did), "back" (on another thread already on the map), "skip" or "fail" (no answer); a
    /// turn cut in two
    /// joins its parts' moves with "+" ("same+new"). It fits when each turn with a `want` made one of its moves.
    /// With TALK_OUT set, each run appends a line there with every turn's threads and the threads' titles, for a
    /// script that scores a whole talk.
    async fn talk_run(core: &Core, case: &serde_json::Value, talk: &[serde_json::Value], run: usize, times: &mut Vec<u128>) -> bool {
        let name = case["name"].as_str().unwrap_or("?");
        // As far apart as `at` says (seconds from the first turn; else 12 s apart), the last one now: the prompt
        // quotes the turn before only when it came within `JUST_BEFORE_MS`.
        let at = |i: usize| talk[i]["at"].as_f64().unwrap_or(12.0 * i as f64);
        let base = crate::now_ms().saturating_sub((1000.0 * at(talk.len().saturating_sub(1))) as u64);
        let (mut last, mut moves, mut turns, mut fits) = (std::collections::HashMap::<String, String>::new(), Vec::new(), Vec::new(), true);
        for (i, turn) in talk.iter().enumerate() {
            let id = turn["id"].as_str().map_or_else(|| format!("th-talk-{i}"), String::from);
            let speaker = turn["speaker"].as_str().unwrap_or("you");
            let said = Thought {
                text: turn["text"].as_str().unwrap_or_default().into(),
                at_ms: base + (1000.0 * at(i)) as u64,
                thread_id: core.snapshot().active_for(speaker).cloned(),
                ..thought(&id, speaker, None, true)
            };
            core.commit(vec![Change::ThoughtAdded { thought: said }]);
            // The turn, then the rest each cut leaves, as the placer's queue takes them.
            let (mut kinds, mut landings, mut next) = (Vec::new(), Vec::new(), Some(id.clone()));
            while let Some(part) = next.take() {
                let before = core.snapshot();
                let went = std::time::Instant::now();
                let placed = super::place(core, &part, super::URL, super::patience).await;
                times.push(went.elapsed().as_millis());
                let failed = placed.as_ref().err().map(ToString::to_string);
                next = placed.ok().flatten();
                let after = core.snapshot();
                let landed = after.thoughts.iter().find(|t| t.id == part && t.placed).and_then(|t| t.thread_id.clone());
                if let Some(e) = &failed {
                    println!("     {name} #{run} turn {i}: failed: {e}");
                }
                kinds.push(match &landed {
                    None if failed.is_some() => "fail",
                    None => "skip",
                    Some(on) if before.thread(on).is_none() => "new",
                    Some(on) if last.get(speaker) == Some(on) => "same",
                    Some(_) => "back",
                });
                if let Some(on) = &landed {
                    last.insert(speaker.to_string(), on.clone());
                    let (title, point) = (after.thread(on).map(|t| t.title.clone()).unwrap_or_default(), after.thoughts.iter().find(|t| t.id == part).map(|t| t.point.clone()).unwrap_or_default());
                    println!("     {name} #{run} turn {i}: {} {on} \"{title}\" point: \"{point}\"", kinds.last().unwrap());
                }
                landings.push(landed);
            }
            let made = kinds.join("+");
            if let Some(want) = turn["want"].as_array() {
                fits &= want.iter().any(|w| w.as_str() == Some(made.as_str()));
            }
            turns.push(json!({"id": id, "speaker": speaker, "threads": landings}));
            moves.push(made);
        }
        let map = core.snapshot();
        let titles: Vec<&str> = map.threads.iter().map(|t| t.title.as_str()).collect();
        println!("{} {name} #{run}: {}; {} threads: {}", if fits { "ok  " } else { "MISS" }, moves.join(" "), titles.len(), titles.join(" | "));
        if let Ok(path) = std::env::var("TALK_OUT") {
            let threads: Vec<_> = map.threads.iter().map(|t| json!({"id": t.id, "title": t.title, "parent": t.parent_id})).collect();
            let line = json!({"case": name, "run": run, "model": std::env::var("PLACER_MODEL").ok(), "turns": turns, "threads": threads});
            let written = std::fs::OpenOptions::new().create(true).append(true).open(&path).and_then(|mut f| {
                use std::io::Write;
                writeln!(f, "{line}")
            });
            written.unwrap_or_else(|e| panic!("TALK_OUT {path}: {e}"));
        }
        fits
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
        for t in case["threads"].as_array().into_iter().flatten() {
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
            text: case["text"].as_str().unwrap_or_default().into(),
            at_ms: now,
            ..thought(&format!("th-{}", uuid::Uuid::new_v4().simple()), "you", None, true)
        };
        // `cut`: the words are the rest of the turn `before`, cut where it moved on (`settle`).
        if case["cut"].as_bool() == Some(true) {
            world.split_from.insert(said.id.clone(), "th-before".into());
        }
        (world.clone(), Thought { thread_id: world.active_for("you").cloned(), ..said })
    }

    /// A delete takes the thread a placement chose off the map while the model thinks: the thought isn't put on a card
    /// that's gone (lost from view); it goes in line again.
    #[tokio::test]
    async fn a_placement_never_lands_on_a_thread_deleted_while_the_model_thought() {
        let service = |_: axum::Json<serde_json::Value>| async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let placement = json!({"action": "continue", "thread_id": "T1", "point": "Water the tomatoes", "complete": true});
            axum::Json(body(json!("stop"), json!(placement.to_string())))
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
        let path = std::env::temp_dir().join(format!("e2a2o-placer-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::world::Journal::open(&path).unwrap();
        let mut world = World::default();
        world.threads.push(crate::world::fixtures::thread("T1", "Garden", 1));
        world.thoughts.push(crate::world::fixtures::thought("a", "T1", "Plant the tomatoes", crate::now_ms() - 60_000));
        let (placer_queue, mut queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), ..Core::test(journal, world) });
        let id = core.keep("you", "Water them at dusk");
        let placing = { let core = core.clone(); let id = id.clone(); let url = url.clone(); tokio::spawn(async move { super::place(&core, &id, &url, super::patience).await.ok() }) };
        tokio::time::sleep(Duration::from_millis(100)).await;
        crate::moves::delete(&core, "you", "a");
        placing.await.unwrap();
        let world = core.snapshot();
        let t = world.thoughts.iter().find(|t| t.id == id).unwrap();
        assert!(!(t.placed && t.thread_id.as_deref().is_some_and(|on| world.thread(&world.resolve(on)).is_none())), "on a card that's gone: {:?}", t.thread_id);
        assert!(matches!(queue.try_recv(), Ok(super::Job::Place(again)) if again == id), "it goes in line again");
        let _ = std::fs::remove_file(&path);
    }

    /// "New thread", then a delete takes the parent the model chose off the map while it thinks: placed again, the
    /// words still start a new thread (the ask isn't spent on a placement that didn't land).
    #[tokio::test]
    async fn a_new_thread_ask_outlives_a_placement_put_back_in_line() {
        let service = |_: axum::Json<serde_json::Value>| async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let placement = json!({"action": "new", "title": "Watering", "parent_id": "T1", "point": "Water the tomatoes", "complete": true});
            axum::Json(body(json!("stop"), json!(placement.to_string())))
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
        let path = std::env::temp_dir().join(format!("e2a2o-placer-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::world::Journal::open(&path).unwrap();
        let mut world = World::default();
        world.threads.push(crate::world::fixtures::thread("T1", "Garden", 1));
        world.thoughts.push(crate::world::fixtures::thought("a", "T1", "Plant the tomatoes", crate::now_ms() - 60_000));
        let (placer_queue, mut queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), ..Core::test(journal, world) });
        core.new_threads.ask("you");
        let id = core.keep("you", "Water them at dusk");
        assert!(core.new_threads.starts(&id));
        let placing = { let core = core.clone(); let id = id.clone(); let url = url.clone(); tokio::spawn(async move { super::place(&core, &id, &url, super::patience).await.ok() }) };
        tokio::time::sleep(Duration::from_millis(100)).await;
        crate::moves::delete(&core, "you", "a");
        placing.await.unwrap();
        assert!(matches!(queue.try_recv(), Ok(super::Job::Place(again)) if again == id), "it goes in line again");
        assert!(core.new_threads.starts(&id), "placed again, it still starts a new thread");
        let _ = std::fs::remove_file(&path);
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
        crate::catalog::run_undo(&core, "you", &crate::catalog::Undo::Restore { thoughts: vec![thought], threads: Vec::new(), order: Vec::new(), dismissed: Vec::new(), merged: Vec::new(), on: Vec::new(), active: None });
        until(Duration::from_secs(2), || core.snapshot().thoughts.iter().any(|t| t.id == id && t.placed)).await;
        assert_eq!(core.snapshot().threads.len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    // ---- End to end through `serve`, with a scripted model: clicks during a placement, splits, outages, busy ----

    /// A stand-in model that answers each thought by the first phrase of `script` found in its words (else a new thread
    /// named after them), after `delay_ms`. "@Title" in `thread_id` or `parent_id` becomes that thread's id, read from
    /// the prompt's thread list, so an answer can name a thread the placer made. Keeps every prompt sent, in order.
    async fn scripted(script: Vec<(&'static str, serde_json::Value)>, delay_ms: u64) -> (String, Arc<Mutex<Vec<String>>>) {
        let prompts = Arc::new(Mutex::new(Vec::new()));
        let seen = prompts.clone();
        let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
            let asked = request["messages"][1]["content"].as_str().unwrap_or_default().to_string();
            seen.lock().unwrap().push(asked.clone());
            let said = asked.rsplit("NEW THOUGHT: \"").next().unwrap_or_default().trim_end_matches('"').to_string();
            let mut placement = script
                .iter()
                .find(|(phrase, _)| said.contains(*phrase))
                .map(|(_, p)| p.clone())
                .unwrap_or_else(|| json!({"action": "new", "title": said, "point": said}));
            for field in ["thread_id", "parent_id"] {
                if let Some(title) = placement[field].as_str().and_then(|v| v.strip_prefix('@')).map(String::from) {
                    let id = asked
                        .lines()
                        .find_map(|l| l.split_once(": ").filter(|(_, rest)| rest.starts_with(&format!("{title} ["))).map(|(id, _)| id.to_string()));
                    placement[field] = json!(id.unwrap_or_default());
                }
            }
            async move {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                axum::Json(body(json!("stop"), json!(placement.to_string())))
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        let routes = axum::Router::new().route("/v1/chat/completions", axum::routing::post(service));
        tokio::spawn(async move { axum::serve(listener, routes).await });
        (url, prompts)
    }

    /// A keyed core whose placer asks `url` as shipped (two racing calls, the real patience): what `add_thought` feeds.
    fn placing_core(url: String) -> (Arc<Core>, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("e2a2o-gaps-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), placer_race: super::RACE, ..Core::test(journal, world) });
        let placer = core.clone();
        tokio::spawn(async move { super::serve(placer, queue, &url, super::PATIENCE).await });
        (core, path)
    }

    /// The video's opening (its first 30 seconds), said through `add_thought` as the mic hands it over, with
    /// the model's answers scripted as the takes gave them: the half-sentence is left off, the swerve leaves its thread
    /// unfinished for you, "Wait, where was I?" goes back by rule, and "Sentences." joins it though answered "new".
    #[tokio::test]
    async fn the_catch_beat_lands_end_to_end() {
        let half = "My biggest problem is that I never finish my";
        let swerve = "Oh, and rent is due Friday and I still haven't sent it.";
        let finish = "Sentences. I never finish my sentences.";
        let (url, prompts) = scripted(
            vec![
                ("My biggest problem", json!({"action": "new", "title": "Never finishing things", "point": "My biggest problem: I never finish my", "complete": false})),
                ("rent is due Friday", json!({"action": "new", "title": "Rent", "point": "Rent due Friday, not sent yet"})),
                ("Sentences.", json!({"action": "new", "title": "Sentences", "point": "My biggest problem: I never finish my sentences", "joins": "unfinished"})),
            ],
            20,
        )
        .await;
        let (core, path) = placing_core(url);
        let here = |core: &Core| core.snapshot().active_for("you").cloned();
        core.add_thought("you", half);
        until(Duration::from_secs(5), || landed(&core, half)).await;
        let head = core.snapshot().thoughts.iter().find(|t| t.text == half).unwrap().clone();
        let t1 = head.thread_id.clone().unwrap();
        assert!(!head.complete, "left off");
        core.add_thought("you", swerve);
        until(Duration::from_secs(5), || landed(&core, swerve)).await;
        let rent = id_of_thread(&core, swerve);
        let world = core.snapshot();
        let left = world.thread(&t1).unwrap();
        assert_ne!(rent, t1);
        assert_eq!((left.status, left.dropped_by.as_str()), (ThreadStatus::Dropped, "you"), "the card offers it back");
        assert_eq!(here(&core), Some(rent.clone()));
        let calls = prompts.lock().unwrap().len();
        core.add_thought("you", "Wait, where was I?");
        assert_eq!(here(&core), Some(t1.clone()), "back, by rule, at once");
        let world = core.snapshot();
        assert_eq!((world.thoughts.len(), world.thread(&t1).unwrap().status), (2, ThreadStatus::Open), "not a thought; open again");
        assert_eq!(prompts.lock().unwrap().len(), calls, "no model call");
        core.add_thought("you", finish);
        until(Duration::from_secs(5), || landed(&core, finish)).await;
        let world = core.snapshot();
        let joined = world.thoughts.iter().find(|t| t.text == finish).unwrap();
        assert_eq!(joined.thread_id.as_ref(), Some(&t1), "with the words it finishes");
        assert_eq!(world.threads.len(), 2, "no thread for half a sentence");
        assert_eq!(world.notes.get(&joined.id).map(|n| n.continues.as_str()), Some(head.id.as_str()));
        assert_eq!(world.thread(&t1).unwrap().last_point, "My biggest problem: I never finish my sentences");
        assert_eq!(here(&core), Some(t1.clone()));
        let asked = prompts.lock().unwrap().iter().rev().find(|p| p.ends_with(&format!("NEW THOUGHT: \"{finish}\""))).cloned().unwrap();
        assert!(asked.contains(&format!("Left unfinished (placed in {t1}): \"{half}\"")), "{asked}");
        let _ = std::fs::remove_file(&path);
    }

    /// The ramble (the video, 0:30–0:56): each decision lands on the thread it decides and is marked, though the model
    /// branches it off as a topic of its own (as in the 2026-11-01 take), so its card and Recap lead with it; the loud
    /// line lands on the birthday, unmarked.
    #[tokio::test]
    async fn the_ramble_beat_lands_each_decision_on_its_thread() {
        let lines = [
            "Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.",
            "Okay, decided: if it's under eighty dollars, I'm booking it tonight.",
            "My stats midterm is Thursday, chapters four to six.",
            "Decided: I'll study with Priya on Wednesday night.",
            "And Mom is going to love that pottery class, I'm so excited!",
        ];
        let (url, _) = scripted(
            vec![
                ("Mom's birthday is Saturday", json!({"action": "new", "title": "Mom's birthday", "point": "Mom's birthday Saturday; she wants the pottery class"})),
                ("under eighty dollars", json!({"action": "new", "title": "Pottery Class Cost", "parent_id": "@Mom's birthday", "point": "Book the class tonight if under $80"})),
                ("stats midterm", json!({"action": "new", "title": "Stats midterm", "point": "Stats midterm Thursday, chapters 4-6"})),
                ("study with Priya", json!({"action": "new", "title": "Study with Priya", "parent_id": "@Stats midterm", "point": "Study with Priya Wednesday night"})),
                ("going to love", json!({"action": "return", "thread_id": "@Mom's birthday", "point": "Mom will love the pottery class"})),
            ],
            20,
        )
        .await;
        let (core, path) = placing_core(url);
        for line in lines {
            core.add_thought("you", line);
            until(Duration::from_secs(5), || landed(&core, line)).await;
        }
        let world = core.snapshot();
        let titles: Vec<&str> = world.threads.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["Mom's birthday", "Stats midterm"], "no branch for a decision");
        let mut got = Vec::new();
        for line in lines {
            let t = world.thoughts.iter().find(|t| t.text == line).unwrap();
            got.push((world.thread(t.thread_id.as_deref().unwrap()).unwrap().title.clone(), t.decided));
        }
        let want = [("Mom's birthday", false), ("Mom's birthday", true), ("Stats midterm", false), ("Stats midterm", true), ("Mom's birthday", false)];
        assert_eq!(got, want.map(|(title, decided)| (title.to_string(), decided)));
        let _ = std::fs::remove_file(&path);
    }

    /// You click a card while a thought of yours is still on its first try: when it lands it goes on the map but leaves
    /// you where you clicked, as a retry already does (`Placing::moved`) and as "where was I?" and a search avoid by
    /// waiting their turn (find.rs `placing`).
    #[tokio::test]
    async fn a_click_while_a_thought_is_placing_stands_when_it_lands() {
        let (core, path, _updates) = burst_core().await;
        let here = |core: &Core| core.snapshot().active_for("Ana").cloned();
        core.add_thought("Ana", "the kitchen needs paint");
        until(Duration::from_secs(2), || landed(&core, "the kitchen needs paint")).await;
        let kitchen = here(&core).unwrap();
        core.add_thought("Ana", "the party is on Saturday");
        until(Duration::from_secs(2), || landed(&core, "the party is on Saturday")).await;
        // Its call takes 300 ms: the click comes while it runs.
        core.add_thought("Ana", "slow: the caterer needs a head count");
        let slow = id_of(&core, "slow: the caterer needs a head count");
        until(Duration::from_secs(2), || matches!(core.placing.message(), ServerMsg::Placing { now: Some(ref id), .. } if *id == slow)).await;
        core.focus("Ana", &kitchen);
        assert_eq!(here(&core), Some(kitchen.clone()));
        until(Duration::from_secs(2), || landed(&core, "slow: the caterer needs a head count")).await;
        assert_eq!(here(&core), Some(kitchen), "the click stands");
        let _ = std::fs::remove_file(&path);
    }

    /// A two-topic turn still on its first try when you click a card: neither part moves you when it lands, its rest
    /// (placed next, from a map that already has the click) included.
    #[tokio::test]
    async fn a_click_while_a_split_turn_is_placing_stands_through_its_rest() {
        let (url, _) = scripted(split_script(), 300).await;
        let (core, path) = placing_core(url);
        let here = |core: &Core| core.snapshot().active_for("you").cloned();
        core.add_thought("you", "the bike needs brakes");
        until(Duration::from_secs(5), || landed(&core, "the bike needs brakes")).await;
        let bike = here(&core).unwrap();
        core.add_thought("you", "the kitchen needs paint");
        until(Duration::from_secs(5), || landed(&core, "the kitchen needs paint")).await;
        assert_ne!(here(&core), Some(bike.clone()));
        core.add_thought("you", "I need to pay rent before Friday and also the demo is on Tuesday");
        let turn = id_of(&core, "I need to pay rent before Friday and also the demo is on Tuesday");
        until(Duration::from_secs(2), || matches!(core.placing.message(), ServerMsg::Placing { now: Some(ref id), .. } if *id == turn)).await;
        core.focus("you", &bike);
        until(Duration::from_secs(5), || landed(&core, "the demo is on Tuesday")).await;
        assert_eq!(here(&core), Some(bike), "the click stands after the rest lands too");
        let _ = std::fs::remove_file(&path);
    }

    /// "New thread about …" said while your words before it are still on their first try: the thread it starts is
    /// where you stay when those words land.
    #[tokio::test]
    async fn new_thread_about_said_while_placing_stands_when_the_words_before_land() {
        let (core, path, _updates) = burst_core().await;
        let here = |core: &Core| core.snapshot().active_for("Ana").cloned();
        core.add_thought("Ana", "the kitchen needs paint");
        until(Duration::from_secs(2), || landed(&core, "the kitchen needs paint")).await;
        core.add_thought("Ana", "slow: the garage door squeaks");
        let slow = id_of(&core, "slow: the garage door squeaks");
        until(Duration::from_secs(2), || matches!(core.placing.message(), ServerMsg::Placing { now: Some(ref id), .. } if *id == slow)).await;
        core.add_thought("Ana", "New thread about the garden shed");
        let shed = here(&core).unwrap();
        assert_eq!(core.snapshot().thread(&shed).map(|t| t.title.clone()).as_deref(), Some("Garden shed"));
        until(Duration::from_secs(2), || landed(&core, "slow: the garage door squeaks")).await;
        assert_eq!(here(&core), Some(shed), "the new thread stands");
        let _ = std::fs::remove_file(&path);
    }

    /// Models write an empty answer as "none" (`clean`); a split is no different. "none" must cut nothing, even in
    /// words that say "none" (else "We have" lands as a thought of its own).
    #[test]
    fn a_split_written_as_none_cuts_nothing() {
        let said = turn("We have none of the slides ready and the demo is tomorrow");
        for split in ["none", "None", "None.", "\"none\""] {
            let p = reply(json!({"split": split, "action": "continue", "thread_id": "T1", "point": "No slides ready; demo tomorrow"}));
            let (changes, rest) = settle(&map(), &said, p, 0, false, true);
            assert!(rest.is_none() && !changes.iter().any(|c| matches!(c, Change::ThoughtSplit { .. })), "{split}: {changes:?}");
        }
    }

    #[test]
    fn a_limit_and_a_commitment_can_land_as_two_points_on_one_thread() {
        let said = turn("[private text removed]");
        let mut world = World { thoughts: vec![said.clone()], ..map() };
        let first = reply(json!({"action": "continue", "thread_id": "T1",
            "point": "My demo must be shorter than three minutes", "split": "I will record it after breakfast."}));
        let (changes, rest) = settle(&world, &said, first, 0, false, true);
        for change in changes { world.apply(&change); }
        let rest = world.thoughts.iter().find(|t| Some(&t.id) == rest.as_ref()).unwrap().clone();
        assert_eq!(world.thoughts[0].text, "My demo must be shorter than three minutes.");
        assert_eq!(rest.text, "I will record it after breakfast.");
        let prompt = request(&world, &rest, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(prompt.contains("it may continue T1"), "{prompt}");
        let next = reply(json!({"action": "continue", "thread_id": "T1",
            "point": "I will record my demo after breakfast", "joins": "none"}));
        let (changes, rest) = settle(&world, &rest, next, 0, false, true);
        assert!(rest.is_none());
        for change in changes { world.apply(&change); }
        assert_eq!(world.thoughts.len(), 2);
        assert!(world.thoughts.iter().all(|t| t.placed && t.thread_id.as_deref() == Some("T1")));
        assert_eq!(world.thoughts[1].point, "I will record my demo after breakfast");
        assert_eq!(world.thread("T1").unwrap().last_point, world.thoughts[1].point);
        assert!(world.notes.values().all(|n| n.continues.is_empty()), "separate points stay separate");
    }

    /// Venue Wi-Fi drops mid-talk: a thought's third failed try is said once, later rounds are not, and its tries keep
    /// to 0.5 s, 1 s, then 15 s doubling. A URL the client turns down at once stands in for the outage, so no socket
    /// waits under the paused clock.
    #[tokio::test(start_paused = true)]
    async fn an_outage_is_said_once_per_thought_and_retries_keep_their_schedule() {
        use tokio::sync::mpsc;
        let path = std::env::temp_dir().join(format!("e2a2o-gaps-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let (placer_queue, mut retries) = mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), ..Core::test(journal, world) });
        let mut updates = core.updates.subscribe();
        core.commit(vec![Change::ThoughtAdded { thought: thought("t1", "you", None, true) }]);
        let (jobs, queue) = mpsc::unbounded_channel();
        let placer = core.clone();
        tokio::spawn(async move { super::serve(placer, queue, "unreachable://model.invalid/v1", super::PATIENCE).await });
        jobs.send(super::Job::Place("t1".into())).unwrap();
        let start = tokio::time::Instant::now();
        let mut at = Vec::new();
        while let Ok(Some(job)) = tokio::time::timeout_at(start + Duration::from_secs(100), retries.recv()).await {
            at.push((start.elapsed().as_millis() as u64 + 50) / 100);
            jobs.send(job).unwrap();
        }
        assert_eq!(at, [5, 15, 165, 170, 180, 480, 485, 495], "tenths of a second: 0.5 s, 1 s, then a round 15 s on, doubling");
        let errors: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|o| match o.message {
                ServerMsg::Error { message } => Some(message),
                _ => None,
            })
            .collect();
        assert_eq!(errors.len(), 1, "said once, at the third failure: {errors:?}");
        assert!(errors[0].starts_with("Couldn't place a thought:"), "{errors:?}");
        assert!(!core.snapshot().thoughts[0].placed, "still waiting, saved");
        let _ = std::fs::remove_file(&path);
    }

    /// A busy service (429): the whole line waits out the pause, nothing shows as an error (model.rs says "busy" once a
    /// spell), and the busy thought and the one said after it both land, once each.
    #[tokio::test]
    async fn a_busy_service_pauses_the_line_and_every_thought_still_lands_once() {
        let calls: Arc<Mutex<Vec<String>>> = Default::default();
        let seen = calls.clone();
        let service = move |axum::Json(request): axum::Json<serde_json::Value>| {
            let asked = request["messages"][1]["content"].as_str().unwrap_or_default().to_string();
            let said = asked.rsplit("NEW THOUGHT: \"").next().unwrap_or_default().trim_end_matches('"').to_string();
            let first = {
                let mut calls = seen.lock().unwrap();
                calls.push(said.clone());
                calls.iter().filter(|s| **s == said).count() == 1
            };
            async move {
                if said.contains("busy") && first {
                    return (axum::http::StatusCode::TOO_MANY_REQUESTS, axum::Json(json!({"error": {"message": "slow down"}})));
                }
                let placement = json!({"action": "new", "title": said, "point": said});
                (axum::http::StatusCode::OK, axum::Json(body(json!("stop"), json!(placement.to_string()))))
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });
        let path = std::env::temp_dir().join(format!("e2a2o-gaps-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::world::Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("good".into()), ..Core::test(journal, world) });
        let mut updates = core.updates.subscribe();
        let placer = core.clone();
        tokio::spawn(async move { super::serve(placer, queue, &url, super::PATIENCE).await });
        core.add_thought("Ana", "busy: the landlord wants the lease back");
        core.add_thought("Ana", "the bike needs brakes");
        let bike_in = until(Duration::from_secs(5), || landed(&core, "the bike needs brakes")).await;
        assert!(bike_in >= Duration::from_millis(450), "the line waited out the 0.5 s pause: {bike_in:?}");
        until(Duration::from_secs(5), || landed(&core, "busy: the landlord wants the lease back")).await;
        let (mut placed, mut errors, mut notices) = (std::collections::HashMap::new(), 0, Vec::new());
        while let Ok(out) = updates.try_recv() {
            match out.message {
                ServerMsg::Change { change: Change::ThoughtPlaced { thought_id, .. } } => *placed.entry(thought_id).or_insert(0) += 1,
                ServerMsg::Error { .. } => errors += 1,
                ServerMsg::Notice { message } => notices.push(message),
                _ => {}
            }
        }
        assert!(placed.len() == 2 && placed.values().all(|&n| n == 1), "{placed:?}");
        assert_eq!(errors, 0, "a busy pause isn't an error");
        assert_eq!(notices.iter().filter(|n| n.contains("busy")).count(), 1, "{notices:?}");
        let _ = std::fs::remove_file(&path);
    }

    fn split_script() -> Vec<(&'static str, serde_json::Value)> {
        vec![
            ("pay rent before Friday", json!({"action": "new", "title": "Rent", "point": "Pay rent before Friday", "split": "the demo is on Tuesday"})),
            ("the demo is on Tuesday", json!({"action": "new", "title": "Demo", "point": "Demo is on Tuesday"})),
        ]
    }

    /// A turn cut in two: its rest is placed next, before words said after the turn, and in the order said.
    #[tokio::test]
    async fn the_rest_of_a_split_turn_lands_before_words_said_after_it() {
        let (url, prompts) = scripted(split_script(), 150).await;
        let (core, path) = placing_core(url);
        core.add_thought("you", "I need to pay rent before Friday and also the demo is on Tuesday");
        core.add_thought("you", "the bike needs brakes");
        until(Duration::from_secs(5), || landed(&core, "the bike needs brakes") && landed(&core, "the demo is on Tuesday")).await;
        let mut asked: Vec<String> =
            prompts.lock().unwrap().iter().map(|p| p.rsplit("NEW THOUGHT: \"").next().unwrap().trim_end_matches('"').to_string()).collect();
        asked.dedup();
        assert_eq!(asked, ["I need to pay rent before Friday and also the demo is on Tuesday", "the demo is on Tuesday", "the bike needs brakes"]);
        let world = core.snapshot();
        let texts: Vec<&str> = world.thoughts.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, ["I need to pay rent before Friday", "the demo is on Tuesday", "the bike needs brakes"]);
        assert_eq!(world.active_for("you"), world.thoughts[2].thread_id.as_ref(), "where your last words went");
        let _ = std::fs::remove_file(&path);
    }

    /// "Where was I?" said right after a two-topic turn waits for both parts (the rest is your words too), so the rest
    /// landing can't undo it: you end up back on the first topic.
    #[tokio::test]
    async fn where_was_i_after_a_split_turn_waits_for_its_rest() {
        let (url, _) = scripted(split_script(), 150).await;
        let (core, path) = placing_core(url);
        core.add_thought("you", "I need to pay rent before Friday and also the demo is on Tuesday");
        core.add_thought("you", "Where was I?");
        until(Duration::from_secs(5), || landed(&core, "the demo is on Tuesday")).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        let world = core.snapshot();
        let rent = world.thoughts.iter().find(|t| t.text == "I need to pay rent before Friday").and_then(|t| t.thread_id.clone());
        assert!(rent.is_some());
        assert_eq!(world.active_for("you").cloned(), rent, "back from the detour the rest started, not undone by it");
        let _ = std::fs::remove_file(&path);
    }

    /// "Should I book the pottery class? Also the bike needs brakes." cut in two: the rest is a topic of its own, not the
    /// answer to its own first part, so its prompt doesn't say that question was just asked.
    #[test]
    fn the_rest_of_a_split_turn_is_never_the_answer_to_its_own_question() {
        let said = turn("Should I book the pottery class? Also the bike needs brakes.");
        let world = World { thoughts: vec![said.clone()], ..map() };
        let p = reply(json!({"action": "continue", "thread_id": "T1", "point": "Book the pottery class?", "split": "Also the bike needs brakes."}));
        let (changes, rest) = settle(&world, &said, p, 0, false, true);
        let mut after = world.clone();
        for c in &changes {
            after.apply(c);
        }
        let rest = after.thoughts.iter().find(|t| Some(&t.id) == rest.as_ref()).unwrap().clone();
        assert_eq!(rest.text, "the bike needs brakes.");
        let prompt = request(&after, &rest, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(!prompt.contains("Just asked"), "{prompt}");
    }

    /// A question and a short answer said as two turns in the same millisecond (a reconnect flushes queued turns
    /// together): the answer is still told what was just asked. Only a split's own first part is passed over.
    #[test]
    fn an_answer_said_in_the_same_millisecond_as_its_question_still_answers_it() {
        let asked = Thought { text: "Should I book the pottery class?".into(), at_ms: 5, ..thought("q", "you", Some("T1"), true) };
        let yes = Thought { text: "Yes.".into(), at_ms: 5, ..thought("y", "you", None, false) };
        let world = World { thoughts: vec![asked, yes.clone()], ..map() };
        let prompt = request(&world, &yes, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(prompt.contains("Just asked"), "{prompt}");
        // The same two as one turn cut in two: the rest moved on from its first part.
        let mut split = world.clone();
        split.split_from.insert("y".into(), "q".into());
        let prompt = request(&split, &yes, "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
        assert!(!prompt.contains("Just asked"), "{prompt}");
    }

    /// A sure fix in the first part of a split turn is made there: its words and point say the guess, the heard words
    /// are kept for undo, and the rest keeps its own words.
    #[test]
    fn a_sure_fix_in_the_first_part_of_a_split_is_made_there() {
        let said = turn("The README should name the Muse Bark models and also I should email the landlord");
        let p = reply(json!({"split": "I should email the landlord", "action": "continue", "thread_id": "T1",
            "point": "README names the Muse Bark models", "unclear": "Muse Bark", "guess": "Muse Spark", "sure": true}));
        let world = World { thoughts: vec![said.clone()], ..map() };
        let (changes, rest) = settle(&world, &said, p, 0, false, true);
        let mut after = world.clone();
        for c in &changes {
            after.apply(c);
        }
        let first = after.thoughts.iter().find(|t| t.id == said.id).unwrap();
        assert_eq!(
            (first.text.as_str(), first.point.as_str(), first.heard.as_str(), first.fixed.as_str(), first.unclear.as_str()),
            ("The README should name the Muse Spark models", "README names the Muse Spark models", "Muse Bark", "Muse Spark", "")
        );
        let rest = after.thoughts.iter().find(|t| Some(&t.id) == rest.as_ref()).unwrap();
        assert_eq!((rest.text.as_str(), rest.placed), ("I should email the landlord", false));
    }

    /// An answer naming a thread that isn't on the map ("T9") lands where you are; with nowhere yet, it starts a thread
    /// titled from the words. Never a thought on no thread.
    #[test]
    fn an_answer_naming_a_missing_thread_lands_where_you_are() {
        let landed_on = |changes: &[Change]| {
            changes
                .iter()
                .find_map(|c| match c {
                    Change::ThoughtPlaced { thread_id, .. } => Some(thread_id.clone()),
                    _ => None,
                })
                .unwrap()
        };
        let said = turn("and the paint should be matte");
        let changes = decide(&map(), &said, reply(json!({"action": "continue", "thread_id": "T9"})), 0, false, true);
        assert_eq!(landed_on(&changes), "T1");
        assert!(!changes.iter().any(|c| matches!(c, Change::ThreadAdded { .. })), "{changes:?}");
        let changes = decide(&World::default(), &said, reply(json!({"action": "return", "thread_id": "T9"})), 0, false, true);
        assert_eq!(landed_on(&changes), "T1");
        assert!(changes.iter().any(|c| matches!(c, Change::ThreadAdded { thread } if thread.title == "and the paint should be")), "{changes:?}");
    }
}

#[cfg(test)]
#[path = "placer_route_tests.rs"]
mod route_tests;
