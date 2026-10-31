//! Placer: asks a Muse model where each new thought belongs, one thought at a time,
//! so every placement sees the map the previous one left.

use crate::world::{Change, Thought, Thread, ThreadStatus, World};
use crate::{now_ms, protocol::ServerMsg, Core};
use anyhow::{anyhow, bail, Context};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;
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
unclear: words that look mistranscribed, else an empty string. Answer with JSON only.";

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
        if let Err(e) = place(&core, &thought_id).await {
            tracing::warn!("placement failed: {e:#}");
            core.send(ServerMsg::Error { message: format!("Couldn't place a thought: {e}") });
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

    let started = Instant::now();
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
    let place_ms = started.elapsed().as_millis() as u64;
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
                "unclear": {"type": "string"}
            },
            "required": ["action", "thread_id", "title", "parent_id", "point", "complete", "dropped", "unclear"]
        }}}
    })
}

/// Turns the model's answer into changes, trusting only ids that exist.
fn decide(world: &World, thought: &Thought, p: Placement, place_ms: u64) -> Vec<Change> {
    let now = now_ms();
    let exists = |id: &str| world.thread(id).is_some();
    let point = if p.point.trim().is_empty() { thought.text.clone() } else { p.point.trim().to_string() };
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
                p.title.trim().to_string()
            };
            let parent_id = Some(p.parent_id.clone()).filter(|x| exists(x));
            changes.push(Change::ThreadAdded {
                thread: Thread { id: id.clone(), title, parent_id, status: ThreadStatus::Open, last_point: String::new(), touched_ms: now },
            });
            id
        }
    };

    changes.push(Change::ThoughtPlaced {
        thought_id: thought.id.clone(),
        thread_id: thread_id.clone(),
        point: point.clone(),
        unclear: clean(&p.unclear),
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
