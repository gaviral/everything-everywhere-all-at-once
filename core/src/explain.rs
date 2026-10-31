//! Explain: select a word or phrase and get a plain answer in its context, from the
//! fastest Muse setting, so it feels like a tooltip rather than a chat.

use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, bail, Context};
use serde_json::json;
use std::sync::Arc;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "Explain the phrase the person selected, in plain words, in at most two short sentences, \
as it is meant in the surrounding text. No preamble.";

pub async fn run(core: Arc<Core>, id: String, phrase: String, context: String) {
    let text = match ask(&core, &phrase, &context).await {
        Ok(text) => text,
        Err(e) => format!("Couldn't explain that: {e}"),
    };
    core.send(ServerMsg::Explanation { id, text });
}

async fn ask(core: &Core, phrase: &str, context: &str) -> anyhow::Result<String> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let body = json!({
        "model": core.placer_model,
        "reasoning_effort": "minimal",
        "max_tokens": 1200,
        "prompt_cache_key": "e2a2o-explain",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Text: \"{context}\"\nPhrase: \"{phrase}\"")},
        ],
    });
    let response = core.http.post(URL).bearer_auth(key).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    Ok(value["choices"][0]["message"]["content"].as_str().context("no answer")?.trim().to_string())
}
