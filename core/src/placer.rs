//! Placer: asks a Muse model where each new thought belongs, one thought at a time,
//! so every placement sees the map the previous one left.

use crate::world::{find, swap, Change, Thought, Thread, ThreadStatus, World};
use crate::{now_ms, protocol::ServerMsg, Core};
use anyhow::{anyhow, bail, Context};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;

const URL: &str = "https://api.meta.ai/v1/chat/completions";

// Stable text first, so the API's prompt cache can reuse it.
const SYSTEM: &str = "You keep a live map of a person's spoken thoughts as threads: topics and the tangents that branch from them. \
For each NEW THOUGHT decide: \"continue\" if it belongs to the active thread, \"return\" if it goes back to an earlier thread, \
or \"new\" if it starts a new topic or tangent (set parent_id to the thread it branched from, or leave it empty). \
thread_id: the existing thread for continue or return. title: up to 5 words, for a new thread. \
point: the thought in at most 12 words, in the speaker's own voice. \
complete: false if the thought trails off unfinished (for example \"I need to pay rent before\"), else true. \
dropped: ids of other threads the speaker clearly left unfinished mid-thought, else empty. \
unclear: words that look mistranscribed, else an empty string. \
guess: what those words most likely were, judging by the context, else an empty string. \
sure: true only if the context leaves no doubt about the guess (for example the right name is already on the map), else false. Answer with JSON only.";

#[derive(Deserialize)]
struct Placement {
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

pub async fn run(core: Arc<Core>, mut queue: mpsc::UnboundedReceiver<String>) {
    while let Some(thought_id) = queue.recv().await {
        // A blip (rate limit, timeout) shouldn't lose a thought: three tries, then say so.
        for attempt in 1..=3u64 {
            match place(&core, &thought_id).await {
                Ok(()) => break,
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

async fn place(core: &Core, thought_id: &str) -> anyhow::Result<()> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let world = core.snapshot();
    let thought = world
        .thoughts
        .iter()
        .find(|t| t.id == thought_id)
        .cloned()
        .context("thought not found")?;
    if thought.placed {
        return Ok(());
    }

    let response = core
        .http
        .post(URL)
        .bearer_auth(key)
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

    core.commit(decide(&world, &thought, placement, place_ms));
    Ok(())
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
                "action": {"type": "string", "enum": ["continue", "return", "new"]},
                "thread_id": {"type": "string"},
                "title": {"type": "string"},
                "parent_id": {"type": "string"},
                "point": {"type": "string"},
                "complete": {"type": "boolean"},
                "dropped": {"type": "array", "items": {"type": "string"}},
                "unclear": {"type": "string"},
                "guess": {"type": "string"},
                "sure": {"type": "boolean"}
            },
            "required": ["action", "thread_id", "title", "parent_id", "point", "complete", "dropped", "unclear", "guess", "sure"]
        }}}
    })
}

/// Turns the model's answer into changes, trusting only ids that exist.
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64) -> Vec<Change> {
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
    use super::{decide, Placement};
    use crate::world::{Change, Thought, World};
    use serde_json::json;

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
