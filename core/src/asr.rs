//! Listening: relays microphone audio from the UI to Muse Voice Transcribe in real time,
//! turns its draft words into live text and each finished turn into a thought.
//! One stream per window, so in a room each laptop transcribes its own mic under its own name.
//! The API key stays here, on the server; the browser never sees it.

use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, Context};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const URL: &str = "wss://api.meta.ai/v1/asr/realtime";

pub async fn run(core: Arc<Core>, speaker: String, mut audio: mpsc::Receiver<Vec<u8>>) -> anyhow::Result<()> {
    let key = core.key()?.to_string();
    let session = format!("e2a2o-{}", uuid::Uuid::new_v4().simple());
    let (socket, _) = tokio_tungstenite::connect_async(format!("{URL}?sessionId={session}"))
        .await
        .context("couldn't reach Voice Transcribe")?;
    let (mut sink, mut stream) = socket.split();

    let handshake = json!({
        "authorization": {"accessToken": format!("Bearer {key}")},
        "audioEncoding": "PCM_24KHZ",
        "model": "muse-voice-transcribe-1.0",
        "mode": "ENDPOINTING",
        "partialMode": "CUMULATIVE",
        "emitAudioProgress": false,
        "languageBias": ["English"],
        "keywords": ["E2A2O", "Muse", "Spark", "Meta", "Wonder", "Glimmer", "Llama", "Muse Image"]
    });
    sink.send(Message::Text(handshake.to_string().into())).await?;
    let first = match stream.next().await {
        Some(Ok(Message::Text(t))) => serde_json::from_str::<Value>(t.as_str())?,
        other => return Err(anyhow!("Voice Transcribe refused the session: {other:?}")),
    };
    // A session starts with its id. A refusal carries one too, as an error event, and a wrong key there is
    // told like any model call's.
    if first["type"] == "error" || first.get("sessionId").is_none() {
        if let Some(status) = first["errorType"].as_str().and_then(crate::model::status_of) {
            core.check(status)?;
        }
        return Err(anyhow!("Voice Transcribe refused the session: {first}"));
    }
    core.send_to(&speaker, ServerMsg::Status { listening: true, note: "Listening".into() });

    // Audio out, paced by the microphone itself; when the UI stops, end the stream.
    let writer = tokio::spawn(async move {
        while let Some(frame) = audio.recv().await {
            if sink.send(Message::Binary(frame.into())).await.is_err() {
                return;
            }
        }
        let _ = sink.send(Message::Text(r#"{"type":"endStream"}"#.into())).await;
    });

    // However the stream ends, the writer stops too: it holds the audio channel, and this window can
    // only start listening again once that closes. The caller says listening stopped.
    let ended = loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => handle(&core, &speaker, t.as_str()),
            Some(Ok(Message::Close(_))) | None => break Ok(()),
            Some(Ok(_)) => {}
            Some(Err(e)) => break Err(e),
        }
    };
    writer.abort();
    core.send_to(&speaker, ServerMsg::Partial { text: String::new() });
    Ok(ended?)
}

fn handle(core: &Arc<Core>, speaker: &str, text: &str) {
    let Ok(event) = serde_json::from_str::<Value>(text) else { return };
    // Turn boundaries with their audio position, to see how long endpointing takes (scripts/voice.mjs):
    // RUST_LOG=info,e2a2o_core::asr=debug. Drafts are left out, one per word.
    if event["type"] != "transcript" {
        tracing::debug!("voice event: {text}");
    }
    match event["type"].as_str() {
        Some("transcript") => {
            core.touch();
            let words = event["transcript"].as_str().unwrap_or_default().to_string();
            core.send_to(speaker, ServerMsg::Partial { text: words });
        }
        Some("speechComplete") => {
            let words = sentence_case(event["transcript"].as_str().unwrap_or_default().trim());
            core.send_to(speaker, ServerMsg::Partial { text: String::new() });
            if !words.is_empty() {
                core.add_thought(speaker, &words);
            }
        }
        Some("error") => {
            if let Some(status) = event["errorType"].as_str().and_then(crate::model::status_of) {
                let _ = core.check(status);
            }
            let message = event["message"].as_str().unwrap_or("unknown error").to_string();
            core.send_to(speaker, ServerMsg::Error { message: format!("Voice Transcribe: {message}") });
        }
        _ => {}
    }
}

/// A finished turn reads as a sentence: the transcriber sometimes starts one in lowercase ("oh and the
/// dentist…"). A first word with capitals of its own ("iPhone", "eBay") stays as said.
fn sentence_case(text: &str) -> String {
    let first = text.split_whitespace().next().unwrap_or_default();
    let mut chars = text.chars();
    match chars.next() {
        Some(c) if c.is_lowercase() && !first.chars().any(char::is_uppercase) => c.to_uppercase().chain(chars).collect(),
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::sentence_case;

    #[test]
    fn a_finished_turn_starts_with_a_capital() {
        assert_eq!(sentence_case("oh and the dentist moved my cleaning"), "Oh and the dentist moved my cleaning");
        assert_eq!(sentence_case("éclair or cake"), "Éclair or cake");
        for same in ["Muse Spark places it", "iPhone battery is low", "eBay listing", "3 things to do", "", "\"quoted\" words"] {
            assert_eq!(sentence_case(same), same);
        }
    }
}
