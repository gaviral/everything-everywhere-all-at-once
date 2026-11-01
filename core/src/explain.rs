//! Explain: select a word or phrase and get one plain sentence on what it means in its thread,
//! from the fastest Muse setting, so it reads like a tooltip rather than a chat.

use crate::world::World;
use crate::{protocol::ServerMsg, Core};
use anyhow::bail;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "The person selected a word or phrase in their own notes: a live map of their spoken thoughts, \
grouped into threads. Say what it means here, in one short plain sentence of at most 20 words, using the thread and \
the map for context. Start with the meaning itself: no preamble, and don't repeat the phrase. For a name, say who or \
what it is and why it comes up here. For an everyday word, say what it refers to in this thread rather than defining it. \
If it may be misheard by speech-to-text, start with what was probably meant. Plain text, no markdown, in the language \
of the notes.";

/// An answer this late has missed its moment; the person can ask again.
const PATIENCE: Duration = Duration::from_secs(20);

pub async fn run(core: Arc<Core>, id: String, phrase: String, context: String, thread_id: Option<String>) {
    let notes = notes(&core.snapshot(), thread_id.as_deref(), &context);
    let message = match ask(&core, &phrase, &notes).await {
        Ok(text) => ServerMsg::Explanation { id, text, failed: false },
        Err(e) => {
            tracing::warn!("explain failed: {e:#}");
            let text = if core.key.is_none() {
                "Explaining needs MODEL_API_KEY in .env."
            } else if core.key_refused() {
                crate::model::REFUSED
            } else {
                "Couldn't explain that just now."
            };
            ServerMsg::Explanation { id, text: text.into(), failed: true }
        }
    };
    core.send(message);
}

/// What the model reads before the phrase: the other threads' titles, the phrase's thread
/// (and the one it branched from) with its points, and the words around the phrase.
fn notes(world: &World, thread_id: Option<&str>, around: &str) -> String {
    let thread = thread_id.map(|id| world.resolve(id)).and_then(|id| world.thread(&id));
    let others: Vec<&str> = world
        .threads
        .iter()
        .rev()
        .filter(|t| Some(t.id.as_str()) != thread.map(|t| t.id.as_str()))
        .take(40)
        .map(|t| t.title.as_str())
        .collect();
    let mut notes = String::new();
    if !others.is_empty() {
        notes += &format!("Other threads: {}\n", others.join("; "));
    }
    if let Some(thread) = thread {
        notes += &format!("Thread: {}\n", thread.title);
        if let Some(parent) = thread.parent_id.as_deref().and_then(|id| world.thread(id)) {
            notes += &format!("A tangent from: {}\n", parent.title);
        }
        let points: Vec<&str> = world
            .thoughts
            .iter()
            .filter(|t| t.placed && t.thread_id.as_deref() == Some(thread.id.as_str()))
            .map(|t| t.point.as_str())
            .collect();
        for point in &points[points.len().saturating_sub(12)..] {
            notes += &format!("- {point}\n");
        }
    }
    let around: String = around.chars().take(600).collect();
    notes + &format!("Selected in: \"{around}\"")
}

async fn ask(core: &Core, phrase: &str, notes: &str) -> anyhow::Result<String> {
    let key = core.key()?;
    let phrase: String = phrase.chars().take(200).collect();
    let body = json!({
        "model": core.placer_model,
        "reasoning_effort": "minimal",
        // Spark's reasoning counts here too (about 200 to 300 tokens): a tight cap leaves no answer.
        "max_tokens": 1200,
        "prompt_cache_key": "e2a2o-explain",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("{notes}\nPhrase: \"{phrase}\"")},
        ],
    });
    let response = core.http.post(URL).bearer_auth(key).timeout(PATIENCE).json(&body).send().await?;
    let status = response.status();
    core.check(status)?;
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    let text = value["choices"][0]["message"]["content"].as_str().unwrap_or_default().trim();
    if text.is_empty() {
        bail!("no answer ({})", value["choices"][0]["finish_reason"].as_str().unwrap_or("no reason given"));
    }
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

    #[test]
    fn notes_hold_the_thread_its_parent_and_the_other_titles() {
        let thread = |id: &str, title: &str, parent: Option<&str>| Thread {
            id: id.into(),
            title: title.into(),
            parent_id: parent.map(Into::into),
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: vec![],
            picture: None,
            dropped_by: String::new(),
        };
        let mut world = World::default();
        for t in [thread("T1", "The hackathon app", None), thread("T2", "Placement speed", Some("T1")), thread("T3", "Laundry", None)] {
            world.apply(&Change::ThreadAdded { thread: t });
        }
        world.apply(&Change::ThoughtAdded {
            thought: Thought {
                id: "a".into(),
                speaker: "you".into(),
                text: "use JSON schema".into(),
                point: "Use Muse Spark with JSON schema".into(),
                thread_id: Some("T2".into()),
                placed: true,
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                at_ms: 0,
                place_ms: None,
            },
        });
        let notes = super::notes(&world, Some("T2"), "I should use JSON schema");
        assert_eq!(
            notes,
            "Other threads: Laundry; The hackathon app\nThread: Placement speed\nA tangent from: The hackathon app\n\
             - Use Muse Spark with JSON schema\nSelected in: \"I should use JSON schema\""
        );
        assert!(super::notes(&world, None, "Laundry").starts_with("Other threads: Laundry; Placement speed; The hackathon app\n"));
    }
}
