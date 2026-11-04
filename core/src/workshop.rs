//! Configured model trials, saved Flow parts, and optional local event data.
use crate::Core;
use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::Arc, time::{Duration, Instant}};

pub async fn catalog(State(core): State<Arc<Core>>) -> Json<Value> {
    Json(json!({"models": crate::models(&core), "ready": core.key.is_some()}))
}

pub async fn hackathon() -> Json<Value> {
    let result = (|| {
        let path = std::env::var("E2A2O_HACKATHON_FILE")?;
        let bytes = std::fs::read(path)?;
        anyhow::ensure!(bytes.len() <= 256 * 1024, "Event file is too large");
        let value: Value = serde_json::from_slice(&bytes)?;
        anyhow::ensure!(value["sections"].as_array().is_some_and(|rows| rows.iter().all(|r| r["title"].is_string() && r["items"].as_array().is_some_and(|items| items.iter().all(Value::is_string)))), "Invalid event data");
        Ok::<_, anyhow::Error>(value)
    })();
    // Neither server paths nor parse excerpts reach the page.
    Json(result.unwrap_or_else(|_| json!({"sections":[],"unavailable":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trial { model: String, mode: String, input: String }
fn allowed(core: &Core, trial: &Trial) -> bool {
    trial.model.starts_with("muse-") && crate::models(core).as_array().is_some_and(|rows| rows.iter().any(|r| r["model"] == trial.model && r["step"] == trial.mode))
}
fn instruction(mode: &str) -> &'static str {
    match mode {
        "tidies" => "Tidy this writing. Preserve its facts and return only the edited text.",
        "recaps" => "Summarize this text briefly. Preserve facts; invent nothing.",
        "places" => "Suggest a short topic title and explain where this thought belongs.",
        "builds" => "Describe a small useful text tool for this request. Do not execute code.",
        _ => "Help with this text. Preserve its facts; invent nothing.",
    }
}
pub async fn run(State(core): State<Arc<Core>>, Json(trial): Json<Trial>) -> Json<Value> {
    let started = Instant::now();
    let result = async {
        anyhow::ensure!(allowed(&core, &trial), "That model or mode is no longer configured. Refresh the shelf.");
        anyhow::ensure!(!trial.input.trim().is_empty() && trial.input.chars().count() <= 24000, "Use between 1 and 24000 characters");
        anyhow::ensure!(trial.mode != "hears", "Use the app's listening control to transcribe; Workshop never starts a microphone.");
        let image = trial.mode == "draws";
        let body = if image {
            json!({"model":trial.model,"prompt":trial.input,"n":1,"size":"1024x1024","output_format":"webp","tool_enablement":{"enable_image_search":false,"enable_web_search":false,"enable_shell":false}})
        } else {
            json!({"model":trial.model,"max_tokens":1600,"messages":[{"role":"system","content":instruction(&trial.mode)},{"role":"user","content":trial.input}]})
        };
        let url = if image { "https://api.meta.ai/v1/images/generations" } else { "https://api.meta.ai/v1/chat/completions" };
        let answer = core.call_model_noting(url, &body, Duration::from_secs(90), json!({"feature":"workshop","mode":trial.mode})).await?;
        if image {
            let encoded = answer["data"][0]["b64_json"].as_str().ok_or_else(|| anyhow::anyhow!("No image returned"))?;
            Ok(json!({"image":format!("data:image/webp;base64,{encoded}")}))
        } else {
            let text = answer["choices"][0]["message"]["content"].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| anyhow::anyhow!("No text returned"))?;
            Ok::<_, anyhow::Error>(json!({"text":text}))
        }
    }.await;
    let mut value = result.unwrap_or_else(|_| json!({"error":"The trial could not finish. Check model availability and try again."}));
    value["ms"] = json!(started.elapsed().as_millis());
    value["model"] = json!(trial.model);
    Json(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn modes_have_distinct_tasks() {
        assert_ne!(super::instruction("tidies"), super::instruction("recaps"));
        assert!(super::instruction("places").contains("topic"));
    }
}

// Only connected Workshop windows consume explicit bring/remove commands.
// These listeners do not open an audio device or replay old turns.
type Listener = tokio::sync::mpsc::UnboundedSender<String>;
static LISTENERS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, Vec<Listener>>>> = std::sync::LazyLock::new(Default::default);
#[derive(Deserialize)]
pub struct TurnQuery { name: String }
pub async fn turns(axum::extract::Query(query): axum::extract::Query<TurnQuery>) -> impl axum::response::IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    {
        let mut listeners = LISTENERS.lock().unwrap_or_else(|e| e.into_inner());
        listeners.retain(|_, senders| { senders.retain(|s| !s.is_closed()); !senders.is_empty() });
        listeners.entry(query.name).or_default().push(tx);
    }
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|text| (Ok::<_, std::convert::Infallible>(Event::default().data(text)), rx))
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
}
fn is_command(text: &str) -> bool {
    let text = text.trim().trim_end_matches(['.', '!', '?']).to_lowercase();
    (text.starts_with("bring ") && [" here", " to the desk", " to workshop", " to the workshop"].iter().any(|s| text.ends_with(s)))
        || ((text.starts_with("take ") || text.starts_with("send ")) && [" away", " back"].iter().any(|s| text.ends_with(s)))
}
pub fn take_turn(speaker: &str, text: &str) -> bool {
    if !is_command(text) { return false; }
    let mut listeners = LISTENERS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(senders) = listeners.get_mut(speaker) else { return false };
    let value = json!({"text":text}).to_string();
    senders.retain(|s| s.send(value.clone()).is_ok());
    !senders.is_empty()
}
