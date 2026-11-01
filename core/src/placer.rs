//! Placer: asks a Muse model where each new thought belongs, one thought at a time,
//! so every placement sees the map the previous one left.

use crate::world::{find, matches, swap, Change, Thought, Thread, ThreadStatus, World};
use crate::{now_ms, protocol::ServerMsg, Core};
use anyhow::{anyhow, bail, Context};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;

const URL: &str = "https://api.meta.ai/v1/chat/completions";

// Stable text first, so the API's prompt cache can reuse it.
const SYSTEM: &str = "You keep a live map of a person's spoken thoughts as threads: topics and the tangents that branch from them. \
For each NEW THOUGHT decide: \"continue\" if it says more about the active thread's last point (a detail, an answer, a correction), \
\"return\" if it says more about an earlier thread's, \
or \"new\" if it starts a new topic, a tangent, or a different part of a thread with its own detail, such as the budget of a trip \
(set parent_id to the thread it branched from or is part of, or leave it empty). Being about the same project is not enough to continue. \
\"skip\" if it adds nothing, such as \"yeah\" or \"okay\" when nothing was asked; never skip an answer, even a bare \"yes\" or \"no\". \
split: if it moves on to another thread partway, the exact words where that starts (the other fields describe only the words before), else an empty string. \
thread_id: the existing thread for continue or return. title: up to 5 words, for a new thread. \
point: the thought in at most 12 words, in the speaker's own voice. \
complete: false if the thought trails off unfinished (for example \"I need to pay rent before\"), else true. \
dropped: ids of other threads the speaker clearly left unfinished mid-thought, else empty. \
unclear: words that look mistranscribed, such as a near miss of a name on the map, else an empty string. \
guess: what those words most likely were, judging by the context, else an empty string. \
sure: true only if the context leaves no doubt about the guess (for example the right name is already on the map), else false. Answer with JSON only.";

/// A skip never sets aside a turn longer than this, whatever the model says: filler is short.
const SKIP_MAX_WORDS: usize = 8;

/// Words that join two parts of a turn; left out where it's cut in two.
const JOINS: [&str; 9] = ["and", "also", "plus", "but", "so", "oh", "then", "anyway", "or"];

/// What the placer works through, in the order it was said: a thought to place, or a spoken command.
/// A command waits behind the thoughts said before it, so their placements can't undo it.
pub enum Job {
    Place(String),
    Back,
    Next,
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

pub async fn run(core: Arc<Core>, mut queue: mpsc::UnboundedReceiver<Job>) {
    // The rest of a turn cut in two goes next, before anything said after it.
    let mut rest: Option<String> = None;
    loop {
        let job = match rest.take() {
            Some(id) => Job::Place(id),
            None => match queue.recv().await {
                Some(job) => job,
                None => return,
            },
        };
        let thought_id = match job {
            Job::Place(id) => id,
            Job::Back => {
                core.go_back();
                continue;
            }
            Job::Next => {
                core.go_next();
                continue;
            }
        };
        // A blip (rate limit, timeout) shouldn't lose a thought: three tries, then say so.
        for attempt in 1..=3u64 {
            match place(&core, &thought_id).await {
                Ok(next) => {
                    rest = next;
                    break;
                }
                Err(e) if attempt < 3 => {
                    tracing::warn!("placement failed (try {attempt}): {e:#}");
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt)).await;
                }
                Err(e) => {
                    tracing::warn!("placement failed: {e:#}");
                    core.send(ServerMsg::Error { message: format!("Couldn't place a thought: {e}") });
                }
            }
        }
    }
}

/// Places one thought; when the turn moved on to another topic partway, returns the rest's id.
async fn place(core: &Core, thought_id: &str) -> anyhow::Result<Option<String>> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
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

    let response = core
        .http
        .post(URL)
        .bearer_auth(key)
        // Placements take 2–3 s; a stall should cost seconds, not the shared client's two minutes a try.
        .timeout(std::time::Duration::from_secs(20))
        .json(&request(&world, &thought, &core.placer_model))
        .send()
        .await?;
    let status = response.status();
    let body: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", body["error"]["message"].as_str().unwrap_or("no message"));
    }
    let content = body["choices"][0]["message"]["content"].as_str().context("no answer")?;
    let placement: Placement = serde_json::from_str(content).context("answer wasn't the expected JSON")?;
    // From when the thought arrived, so time waiting in the queue counts too.
    let place_ms = now_ms().saturating_sub(thought.at_ms);
    tracing::info!("placed in {place_ms} ms: {} {}", placement.action, placement.thread_id);

    let (changes, rest) = settle(&world, &thought, placement, place_ms);
    core.commit(changes);
    Ok(rest)
}

/// The changes for one answer. A turn that moved on to another topic is cut in two first: the answer
/// places the words before, and the rest, returned, is placed next on the map this one leaves.
fn settle(world: &World, thought: &Thought, mut p: Placement, place_ms: u64) -> (Vec<Change>, Option<String>) {
    let Some((before, rest)) = cut(&thought.text, &p.split) else {
        // A quote that cuts nothing leaves the model unsure which words were filler: place them all.
        if p.action == "skip" && !clean(&p.split).is_empty() {
            p.action = "continue".into();
        }
        return (decide(world, thought, p, place_ms), None);
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
    changes.extend(decide(world, &first, p, place_ms));
    (changes, Some(rest_id))
}

/// Cuts a turn where the model says it moved on to another topic: the words before, and the rest.
/// The quote is found as said (whole words, its last match), or failing that by its first four or three
/// words, so a reworded ending still cuts in the right place. Joining words at the cut ("and also") are
/// left out. None when the quote isn't there or either side would be empty.
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
    let rest = text[at..].trim();
    (!before.is_empty() && !rest.is_empty()).then(|| (before.to_string(), rest.to_string()))
}

fn request(world: &World, thought: &Thought, model: &str) -> serde_json::Value {
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
    let active = world.active.clone().unwrap_or_else(|| "(none)".into());
    json!({
        "model": model,
        "reasoning_effort": "minimal",
        "max_tokens": 2000,
        "prompt_cache_key": "e2a2o-placer",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Threads:\n{threads}\nActive thread: {active}\nNEW THOUGHT: \"{}\"", thought.text)},
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

/// Turns the model's answer into changes, trusting only ids that exist.
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64) -> Vec<Change> {
    // Nothing to place ("yeah" when nothing was asked): out of the map. A longer turn is placed anyway.
    if p.action == "skip" && thought.text.split_whitespace().count() <= SKIP_MAX_WORDS {
        return vec![Change::ThoughtSkipped { thought_id: thought.id.clone() }];
    }
    let now = now_ms();
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
        _ if exists(&p.thread_id) => Some(p.thread_id.clone()),
        _ => world.active.clone().filter(|a| exists(a)),
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

    // Leaving a thread whose last thought trailed off means it was dropped.
    let mut dropped = p.dropped;
    if let Some(previous) = world.active.clone().filter(|a| *a != thread_id) {
        let last = world.thoughts.iter().rev().find(|t| t.placed && t.thread_id.as_deref() == Some(previous.as_str()));
        if last.map(|t| !t.complete).unwrap_or(false) {
            dropped.push(previous);
        }
    }
    dropped.sort();
    dropped.dedup();
    for d in dropped {
        let open = world.thread(&d).map(|t| t.status == ThreadStatus::Open).unwrap_or(false);
        if d != thread_id && open {
            changes.push(Change::ThreadStatus { thread_id: d, status: ThreadStatus::Dropped });
        }
    }
    if world.active.as_deref() != Some(thread_id.as_str()) {
        changes.push(Change::ActiveChanged { thread_id });
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::{cut, decide, settle, Placement};
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};
    use serde_json::json;

    fn thought(text: &str) -> Thought {
        Thought {
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
            at_ms: 7,
            place_ms: None,
        }
    }

    /// A map with "Pay rent" (T1, active) and "Hackathon demo" (T2).
    fn map() -> World {
        let thread = |id: &str, title: &str| Thread {
            id: id.into(),
            title: title.into(),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
        };
        World { threads: vec![thread("T1", "Pay rent"), thread("T2", "Hackathon demo")], active: Some("T1".into()), ..World::default() }
    }

    fn answer(value: serde_json::Value) -> Placement {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_turn_is_cut_where_it_moves_on() {
        let text = "I need to pay rent and also the hackathon demo is on Tuesday";
        let expected = Some(("I need to pay rent".to_string(), "the hackathon demo is on Tuesday".to_string()));
        assert_eq!(cut(text, "the hackathon demo is on Tuesday"), expected);
        // Quoted with the joining words, or with its own punctuation.
        let joined = cut(text, "\"also the hackathon demo is on Tuesday.\"").unwrap();
        assert_eq!(joined, ("I need to pay rent".to_string(), "also the hackathon demo is on Tuesday".to_string()));
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
        let turn = thought("I need to pay rent before Friday — oh, the Muse Bark demo is on Tuesday");
        let p = answer(json!({"split": "the Muse Bark demo is on Tuesday", "action": "continue", "thread_id": "T1",
            "point": "Pay rent before Friday", "unclear": "Muse Bark", "guess": "Muse Spark", "sure": true}));
        let (changes, rest) = settle(&world, &turn, p, 0);
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
        let skip = || answer(json!({"split": "", "action": "skip", "thread_id": "", "point": ""}));
        assert!(matches!(decide(&world, &thought("oh wow"), skip(), 0)[..], [Change::ThoughtSkipped { .. }]));
        // A long turn is placed whatever the model says: on the active thread.
        let long = thought("so I was thinking we could rent a van and drive down on Friday");
        let changes = decide(&world, &long, skip(), 0);
        assert!(changes.iter().any(|c| matches!(c, Change::ThoughtPlaced { thread_id, .. } if thread_id == "T1")), "{changes:?}");
        // A skip whose quote cuts nothing can't say which words were filler: placed too.
        let unsure = answer(json!({"split": "the demo is on Tuesday", "action": "skip"}));
        let (changes, rest) = settle(&world, &thought("the demo is on Tuesday"), unsure, 0);
        assert!(rest.is_none() && changes.iter().any(|c| matches!(c, Change::ThoughtPlaced { .. })), "{changes:?}");
        // Filler before real words: the filler is set aside and the rest placed next.
        let lead = answer(json!({"split": "the demo is on Tuesday", "action": "skip"}));
        let (changes, rest) = settle(&world, &thought("yeah, so anyway, the demo is on Tuesday"), lead, 0);
        assert!(rest.is_some());
        assert!(matches!(changes[..], [Change::ThoughtSplit { .. }, Change::ThoughtSkipped { .. }]), "{changes:?}");
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
        decide(&World::default(), &thought, placement, 0)
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
