//! Listening: relays microphone audio from the UI to Muse Voice Transcribe in real time,
//! turns its draft words into live text and each finished turn into a thought.
//! One stream per window, so in a room each laptop transcribes its own mic under its own name.
//! The API key stays here, on the server; the browser never sees it.

use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, Context};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const URL: &str = "wss://api.meta.ai/v1/asr/realtime";

/// The longest the service may say nothing before the stream counts as gone (connect, handshake, and every event
/// after). Why this long: a person who stops talking gets their finished turn back within about 3.8 s at the
/// slowest (a session's first line; later lines 0.3–0.8 s; voice probes, 2026-11-01). Any silence longer than
/// that is no pause and no turn being finished: the person is already waiting longer than ever, so the window
/// is told the mic stopped instead of showing "Listening" while the words go nowhere. A live stream is never that
/// quiet, even while nobody talks: with `emitAudioProgress` on it reports the audio it has heard after every
/// 80 ms frame, about 0.3 s behind; it connects in 0.25 s and answers the handshake 0.07–0.19 s later (2 runs of
/// 150 frames, 2026-11-01).
const QUIET_MAX: Duration = Duration::from_millis(3_800);

pub async fn run(core: Arc<Core>, speaker: String, mut audio: mpsc::Receiver<Vec<u8>>) -> anyhow::Result<()> {
    let key = core.listening_key()?.to_string();
    let session = format!("e2a2o-{}", uuid::Uuid::new_v4().simple());
    let (socket, _) = tokio::time::timeout(QUIET_MAX, tokio_tungstenite::connect_async(format!("{URL}?sessionId={session}")))
        .await
        .map_err(|_| anyhow!("Voice Transcribe didn't answer"))?
        .context("couldn't reach Voice Transcribe")?;
    let (mut sink, mut stream) = socket.split();

    sink.send(Message::Text(handshake(&key).to_string().into())).await?;
    let first = match tokio::time::timeout(QUIET_MAX, stream.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(t.as_str())?,
        Ok(other) => return Err(anyhow!("Voice Transcribe refused the session: {other:?}")),
        Err(_) => return Err(anyhow!("Voice Transcribe didn't answer")),
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
    let ended = hear(&core, &speaker, &mut stream).await;
    writer.abort();
    core.send_to(&speaker, ServerMsg::Partial { text: String::new() });
    ended
}

/// Reads the service's events until the stream ends, a spoken "stop listening", or a silence past `QUIET_MAX`.
async fn hear<S>(core: &Arc<Core>, speaker: &str, stream: &mut S) -> anyhow::Result<()>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let Ok(next) = tokio::time::timeout(QUIET_MAX, stream.next()).await else {
            return Err(anyhow!("Voice Transcribe stopped answering"));
        };
        match next {
            // A sign of life only (`QUIET_MAX`).
            Some(Ok(Message::Text(t))) if t.as_str().contains(r#""audioProgress""#) => {}
            // "Stop listening": nothing after it is heard, kept or sent on, even words the service still had.
            Some(Ok(Message::Text(t))) => {
                if handle(core, speaker, t.as_str()) {
                    return Ok(());
                }
            }
            Some(Ok(Message::Close(_))) | None => return Ok(()),
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(e.into()),
        }
    }
}

/// The session's first message: how to listen, and the words to expect.
fn handshake(key: &str) -> Value {
    json!({
        "authorization": {"accessToken": format!("Bearer {key}")},
        "audioEncoding": "PCM_24KHZ",
        "model": "muse-voice-transcribe-1.0",
        "mode": "ENDPOINTING",
        "partialMode": "CUMULATIVE",
        // Every frame heard is reported, so a quiet room still shows the stream is alive (`QUIET_MAX`).
        "emitAudioProgress": true,
        "languageBias": ["English"],
        // Product names, and the spoken commands most often misheard alone: "Palace." came back as "Palis",
        // "Palice" or "Alice" for 5 of 6 synthesized voices without it, 0 of 6 with it (2026-11-01).
        "keywords": ["E2A2O", "Muse", "Spark", "Meta", "Wonder", "Glimmer", "Llama", "Muse Image", "Palace", "Recap"]
    })
}

/// One event from the service; true when it was a spoken "stop listening", which ends the stream.
fn handle(core: &Arc<Core>, speaker: &str, text: &str) -> bool {
    let Ok(event) = serde_json::from_str::<Value>(text) else { return false };
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
            let raw = event["transcript"].as_str().unwrap_or_default();
            let words = sentence_case(raw.trim());
            // As heard and as kept, to tell the transcriber's punctuation from ours.
            core.trace.write(|| json!({"kind": "heard", "speaker": speaker, "raw": raw, "kept": words}));
            core.send_to(speaker, ServerMsg::Partial { text: String::new() });
            if !words.is_empty() {
                core.add_thought(speaker, &words);
                return crate::spoken::stops_listening(&words);
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
    false
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
    use super::{handle, handshake, hear, sentence_case, QUIET_MAX};
    use crate::protocol::{ServerMsg, View};
    use crate::world::{Journal, World};
    use crate::Core;
    use std::sync::Arc;

    /// A spoken "stop listening" pauses the window's mic and ends the stream (the caller stops reading it), so words
    /// the service still sends after it are never kept; a turn that only mentions it is a thought, and the stream goes on.
    #[test]
    fn stop_listening_ends_the_stream_and_keeps_nothing_after_it() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let turn = |words: &str| serde_json::json!({"type": "speechComplete", "transcript": words}).to_string();
        assert!(!handle(&core, "you", &turn("i should stop listening to podcasts at night")));
        assert!(handle(&core, "you", &turn("okay stop listening")));
        let paused = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Pause }));
        assert!(paused);
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["I should stop listening to podcasts at night"]);
        let _ = std::fs::remove_file(&path);
    }

    /// "Palace." and "Recap." said alone act only if the transcriber hears them: without its keywords they came back
    /// as "Palis" or "Alice" (the handshake's comment).
    #[test]
    fn the_transcriber_is_told_to_expect_palace_and_recap() {
        let sent = handshake("k");
        let keywords: Vec<&str> = sent["keywords"].as_array().expect("keywords").iter().filter_map(|w| w.as_str()).collect();
        for word in ["Palace", "Recap"] {
            assert!(keywords.contains(&word), "{word} isn't among the keywords {keywords:?}");
        }
    }

    #[test]
    fn a_finished_turn_starts_with_a_capital() {
        assert_eq!(sentence_case("oh and the dentist moved my cleaning"), "Oh and the dentist moved my cleaning");
        assert_eq!(sentence_case("éclair or cake"), "Éclair or cake");
        for same in ["Muse Spark places it", "iPhone battery is low", "eBay listing", "3 things to do", "", "\"quoted\" words"] {
            assert_eq!(sentence_case(same), same);
        }
    }

    /// "Stop listening" after other words in one turn (the transcriber joins them when the pause is short): the words
    /// before it are a thought, the mic pauses and the stream ends, so nothing after it is heard.
    #[test]
    fn stop_listening_at_the_end_of_a_turn_keeps_the_words_before_it_and_ends_the_stream() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let turn = |words: &str| serde_json::json!({"type": "speechComplete", "transcript": words}).to_string();
        assert!(handle(&core, "you", &turn("call mom tomorrow about the flight. Stop listening.")));
        let paused = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Pause }));
        assert!(paused, "the mic pauses");
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["Call mom tomorrow about the flight."]);
        assert!(handle(&core, "you", &turn("That's all for today, okay, stop listening, thanks.")));
        let _ = std::fs::remove_file(&path);
    }

    /// A stream that goes quiet (a dropped connection the socket never notices) ends with an error once it has been
    /// quiet longer than any turn takes to come back, so the window stops showing "Listening"; one that keeps
    /// reporting its progress through a long silence in the room goes on, and its reports never show as words.
    #[tokio::test(start_paused = true)]
    async fn a_stream_gone_quiet_ends_but_a_quiet_room_does_not() {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::Message;
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        assert_eq!(handshake("k")["emitAudioProgress"], true);
        let progress = |ms: u64| Ok(Message::Text(serde_json::json!({"type": "audioProgress", "audioProcessedMs": ms}).to_string().into()));

        // 30 s of nobody talking, reported every 80 ms, then the service closes: no error, nothing shown.
        let mut updates = core.updates.subscribe();
        let quiet_room = futures_util::stream::iter((1..=375u64).map(|n| n * 80)).then(|ms| async move {
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            progress(ms)
        });
        let mut quiet_room = Box::pin(quiet_room.chain(futures_util::stream::once(async { Ok(Message::Close(None)) })));
        assert!(hear(&core, "you", &mut quiet_room).await.is_ok());
        assert!(updates.try_recv().is_err(), "progress reports never reach the window");

        // One report, then nothing at all: an error just past QUIET_MAX, not a wait forever.
        let started = tokio::time::Instant::now();
        let mut gone = Box::pin(futures_util::stream::iter([progress(80)]).chain(futures_util::stream::pending()));
        let ended = hear(&core, "you", &mut gone).await;
        assert!(ended.is_err());
        let waited = started.elapsed();
        assert!(waited >= QUIET_MAX && waited < QUIET_MAX + std::time::Duration::from_millis(100), "{waited:?}");
        let _ = std::fs::remove_file(&path);
    }
}
