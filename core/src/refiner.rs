//! Refiner: every so often, looks at the whole map in the background and tidies it:
//! better titles, merges of threads that are really one, one suggestion per branch,
//! and the tasks or events the talk decided on. Results arrive as ordinary changes.

use crate::world::{Action, Change, ItemStatus, Suggestion, World};
use crate::Core;
use anyhow::{anyhow, bail, Context};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "You tidy a live map of someone's spoken thoughts. Given the threads and their points, return JSON with: \
titles: better thread titles (up to 5 words), only where clearly better; \
merges: threads that are really the same topic, merging the later id into the earlier; \
suggestions: at most one per thread and only when genuinely useful: a next step, a connection to another thread, or a question to explore, under 14 words; \
actions: concrete tasks or events the speaker decided on or needs to do, kind \"reminder\" or \"event\", a short title, and when as YYYY-MM-DD if a date is stated or clearly implied, else empty; \
tags: for each thread, up to 3 short lowercase hashtags naming its topic (for example #rent, #hackathon), reusing tags across threads when topics overlap. \
Never repeat an existing suggestion or action. Use empty lists when nothing applies.";

#[derive(Deserialize, Default)]
struct Pass {
    #[serde(default)]
    titles: Vec<Title>,
    #[serde(default)]
    merges: Vec<Merge>,
    #[serde(default)]
    suggestions: Vec<Idea>,
    #[serde(default)]
    actions: Vec<Task>,
    #[serde(default)]
    tags: Vec<Tags>,
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
/// - at most every 10 s, and only when something changed.
pub async fn run(core: Arc<Core>) {
    // Start from what the journal already holds, so a restart doesn't re-tidy the whole map.
    let start = core.snapshot();
    let (mut seen_thoughts, mut seen_threads, mut last_pass) =
        (start.thoughts.iter().filter(|t| t.placed).count(), start.threads.len(), 0u64);
    loop {
        tokio::select! {
            _ = core.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        let looked = core.take_looked();
        let world = core.snapshot();
        let placed = world.thoughts.iter().filter(|t| t.placed).count();
        let new_thoughts = placed.saturating_sub(seen_thoughts);
        let new_threads = world.threads.len() > seen_threads;
        let quiet = core.quiet_ms() >= 4_000;
        let rested = crate::now_ms().saturating_sub(last_pass) >= 10_000;
        let due = new_thoughts > 0 && rested && ((quiet && (new_thoughts >= 2 || new_threads)) || looked);
        if !due || core.key.is_none() {
            continue;
        }
        (seen_thoughts, seen_threads, last_pass) = (placed, world.threads.len(), crate::now_ms());
        match pass(&core, &world).await {
            // Talking resumed while the model worked: move nothing under them; redo the pass at the next pause.
            Ok(changes) if !changes.is_empty() && core.quiet_ms() < 2_000 => seen_thoughts = 0,
            Ok(changes) if !changes.is_empty() => core.commit(changes),
            Ok(_) => {}
            Err(e) => tracing::warn!("refiner pass failed: {e:#}"),
        }
    }
}

async fn pass(core: &Core, world: &World) -> anyhow::Result<Vec<Change>> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let map = world
        .threads
        .iter()
        .map(|t| {
            let points: Vec<String> = world
                .thoughts
                .iter()
                .filter(|p| p.placed && p.thread_id.as_deref() == Some(t.id.as_str()))
                .map(|p| format!("  - {}", p.text))
                .collect();
            format!("{}: {} (parent: {})\n{}", t.id, t.title, t.parent_id.as_deref().unwrap_or("none"), points.join("\n"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let existing: Vec<String> = world
        .suggestions
        .iter()
        .map(|s| format!("suggestion on {}: {}", s.thread_id, s.text))
        .chain(world.actions.iter().map(|a| format!("action on {}: {} {}", a.thread_id, a.kind, a.title)))
        .collect();
    let today = chrono_today();
    let body = json!({
        "model": std::env::var("REFINER_MODEL").unwrap_or_else(|_| "muse-spark-1.3".into()),
        "reasoning_effort": "low",
        "max_tokens": 6000,
        "prompt_cache_key": "e2a2o-refiner",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Today is {today}.\nThreads:\n{map}\nAlready on the map:\n{}", existing.join("\n"))},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "Pass", "schema": {
            "type": "object",
            "properties": {
                "titles": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "title": {"type": "string"}}, "required": ["thread_id", "title"]}},
                "merges": {"type": "array", "items": {"type": "object", "properties": {"from": {"type": "string"}, "into": {"type": "string"}}, "required": ["from", "into"]}},
                "suggestions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "text": {"type": "string"}}, "required": ["thread_id", "text"]}},
                "actions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "kind": {"type": "string", "enum": ["reminder", "event"]}, "title": {"type": "string"}, "when": {"type": "string"}}, "required": ["thread_id", "kind", "title", "when"]}},
                "tags": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["thread_id", "tags"]}}
            },
            "required": ["titles", "merges", "suggestions", "actions", "tags"]
        }}}
    });
    let response = core.http.post(URL).bearer_auth(key).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    let content = value["choices"][0]["message"]["content"].as_str().context("no answer")?;
    let pass: Pass = serde_json::from_str(content).context("answer wasn't the expected JSON")?;
    Ok(changes(world, pass))
}

fn changes(world: &World, pass: Pass) -> Vec<Change> {
    let exists = |id: &str| world.thread(id).is_some();
    let mut out = Vec::new();
    for t in pass.titles {
        let current = world.thread(&t.thread_id).map(|th| th.title.as_str());
        if exists(&t.thread_id) && !t.title.trim().is_empty() && current != Some(t.title.trim()) {
            out.push(Change::ThreadRenamed { thread_id: t.thread_id, title: t.title.trim().into() });
        }
    }
    for m in pass.merges {
        if m.from != m.into && exists(&m.from) && exists(&m.into) {
            out.push(Change::ThreadMerged { from: m.from, into: m.into });
        }
    }
    for s in pass.suggestions {
        let repeated = world.suggestions.iter().any(|x| x.thread_id == s.thread_id && x.status != ItemStatus::Dismissed);
        if exists(&s.thread_id) && !s.text.trim().is_empty() && !repeated {
            out.push(Change::SuggestionAdded {
                suggestion: Suggestion { id: new_id("sg"), thread_id: s.thread_id, text: s.text.trim().into(), status: ItemStatus::New },
            });
        }
    }
    for a in pass.actions {
        let repeated = world.actions.iter().any(|x| x.title.eq_ignore_ascii_case(a.title.trim()));
        if exists(&a.thread_id) && !a.title.trim().is_empty() && !repeated {
            out.push(Change::ActionProposed {
                action: Action {
                    id: new_id("ac"),
                    thread_id: a.thread_id,
                    // An event needs a date; without one it's a reminder rather than an invented day.
                    kind: if a.kind == "event" && !a.when.trim().is_empty() { "event".into() } else { "reminder".into() },
                    title: a.title.trim().into(),
                    when: a.when.trim().into(),
                    status: ItemStatus::New,
                    done_ms: None,
                },
            });
        }
    }
    for group in pass.tags {
        let Some(thread) = world.thread(&group.thread_id) else { continue };
        for raw in group.tags.into_iter().take(3) {
            let word: String = raw.trim().trim_start_matches('#').to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
            if word.is_empty() || thread.tags.iter().any(|t| t.name == format!("#{word}")) {
                continue;
            }
            out.push(Change::TagSuggested { thread_id: thread.id.clone(), tag: format!("#{word}") });
        }
    }
    out
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

/// Today's date as YYYY-MM-DD in local time, from the system's `date` (no extra crate).
fn chrono_today() -> String {
    std::process::Command::new("date")
        .arg("+%Y-%m-%d (%A)")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}
