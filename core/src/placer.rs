//! Placer: asks a Muse model where each new thought belongs, one thought at a time,
//! so every placement sees the map the previous one left.

use crate::world::{Change, Thought, Thread, ThreadStatus, World};
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
guess: what those words most likely were, judging by the context, else an empty string. Answer with JSON only.";

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
    let active = world.active_for(&thought.speaker).cloned().unwrap_or_else(|| "(none)".into());
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
                "guess": {"type": "string"}
            },
            "required": ["action", "thread_id", "title", "parent_id", "point", "complete", "dropped", "unclear", "guess"]
        }}}
    })
}

/// Turns the model's answer into changes, trusting only ids that exist. Moves and drops belong to
/// the speaker: in a room, one person changing topic never drops a thread for the other.
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64) -> Vec<Change> {
    let now = now_ms();
    let speaker = &thought.speaker;
    let exists = |id: &str| world.thread(id).is_some();
    let point = if p.point.trim().is_empty() { thought.text.clone() } else { p.point.trim().to_string() };
    let mut changes = Vec::new();

    let target = match p.action.as_str() {
        "new" => None,
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
                p.title.trim().to_string()
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

    changes.push(Change::ThoughtPlaced {
        thought_id: thought.id.clone(),
        thread_id: thread_id.clone(),
        point: point.clone(),
        unclear: clean(&p.unclear),
        // Only worth asking when something looked misheard and the guess differs.
        guess: match (clean(&p.unclear), clean(&p.guess)) {
            (unclear, guess) if unclear.is_empty() || guess.eq_ignore_ascii_case(&unclear) => String::new(),
            (_, guess) => guess,
        },
        complete: p.complete,
        place_ms,
    });
    changes.push(Change::ThreadTouched { thread_id: thread_id.clone(), last_point: point, at_ms: now });

    // Leaving a thread whose last thought trailed off means it was dropped. Only the speaker's own
    // words count, so only threads they spoke on can be dropped, and only for them.
    let their_last = |id: &str| {
        world.thoughts.iter().rev().find(|t| t.placed && t.speaker == *speaker && t.thread_id.as_deref() == Some(id))
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
    use super::{decide, request, Placement};
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

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

    #[test]
    fn one_person_moving_on_doesnt_drop_the_others_thread() {
        let world = room();
        // Sam keeps going on T2, and the model even calls T1 dropped: it isn't Sam's to drop.
        let changes = decide(&world, &thought("c", "Sam", None, true), answer("continue", "T2", &["T1"]), 0);
        assert!(drops(&changes).is_empty(), "{changes:?}");
        // User moves to T2, leaving T1 unfinished: dropped, for User.
        let changes = decide(&world, &thought("d", "User", None, true), answer("return", "T2", &[]), 0);
        assert_eq!(drops(&changes), [("T1".to_string(), "User".to_string())]);
        assert!(changes.iter().any(|c| matches!(c, Change::ActiveChanged { thread_id, speaker } if thread_id == "T2" && speaker == "User")));
    }

    #[test]
    fn the_placer_sees_the_speakers_own_thread() {
        let world = room();
        let prompt = |speaker: &str| request(&world, &thought("e", speaker, None, true), "m")["messages"][1]["content"].to_string();
        assert!(prompt("User").contains("Active thread: T1"));
        assert!(prompt("Sam").contains("Active thread: T2"));
        assert!(prompt("Lee").contains("Active thread: T2"), "someone new starts where the talk is");
    }
}
