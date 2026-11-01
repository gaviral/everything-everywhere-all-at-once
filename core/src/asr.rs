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
    let key = core.key.clone().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
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
        "keywords": ["E2A2O", "Muse", "Spark", "Meta", "Wonder", "Glimmer"]
    });
    sink.send(Message::Text(handshake.to_string().into())).await?;
    match stream.next().await {
        Some(Ok(Message::Text(t))) if serde_json::from_str::<Value>(t.as_str())?.get("sessionId").is_some() => {}
        other => return Err(anyhow!("Voice Transcribe refused the session: {other:?}")),
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

    while let Some(message) = stream.next().await {
        match message? {
            Message::Text(t) => handle(&core, &speaker, t.as_str()),
            Message::Close(_) => break,
            _ => {}
        }
    }
    writer.abort();
    core.send_to(&speaker, ServerMsg::Partial { text: String::new() });
    core.send_to(&speaker, ServerMsg::Status { listening: false, note: "Stopped listening".into() });
    Ok(())
}

fn handle(core: &Arc<Core>, speaker: &str, text: &str) {
    let Ok(event) = serde_json::from_str::<Value>(text) else { return };
    match event["type"].as_str() {
        Some("transcript") => {
            core.touch();
            let words = event["transcript"].as_str().unwrap_or_default().to_string();
            core.send_to(speaker, ServerMsg::Partial { text: words });
        }
        Some("speechComplete") => {
            let words = event["transcript"].as_str().unwrap_or_default().trim().to_string();
            core.send_to(speaker, ServerMsg::Partial { text: String::new() });
            if !words.is_empty() {
                core.add_thought(speaker, &words);
            }
        }
        Some("error") => {
            let message = event["message"].as_str().unwrap_or("unknown error").to_string();
            core.send_to(speaker, ServerMsg::Error { message: format!("Voice Transcribe: {message}") });
        }
        _ => {}
    }
}
