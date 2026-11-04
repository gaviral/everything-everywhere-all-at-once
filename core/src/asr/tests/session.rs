//! One listening session against a stand-in Voice Transcribe on this machine.
use super::super::run_at;
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

/// A stand-in for Voice Transcribe on this machine: answers the handshake with `first`; given a session, reads the
/// primer and the mic until the stream's end, sends `then`, and closes. Returns its URL, and later the handshake it
/// got, how many audio bytes it heard, and whether the stream was ended rather than dropped.
async fn stand_in(first: serde_json::Value, then: Vec<serde_json::Value>) -> (String, tokio::task::JoinHandle<(serde_json::Value, usize, bool)>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/v1/asr/realtime", listener.local_addr().unwrap());
    let served = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
        let Some(Ok(Message::Text(hello))) = ws.next().await else { panic!("no handshake") };
        ws.send(Message::Text(first.to_string().into())).await.unwrap();
        let (mut heard, mut ended) = (0, false);
        if first.get("sessionId").is_some() {
            while let Some(Ok(message)) = ws.next().await {
                match message {
                    Message::Binary(frame) => heard += frame.len(),
                    Message::Text(t) if t.as_str().contains("endStream") => {
                        ended = true;
                        break;
                    }
                    _ => {}
                }
            }
            for event in then {
                ws.send(Message::Text(event.to_string().into())).await.unwrap();
            }
        }
        let _ = ws.close(None).await;
        (serde_json::from_str(hello.as_str()).unwrap(), heard, ended)
    });
    (url, served)
}

fn keyed(key: &str) -> (Arc<Core>, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, _) = Journal::open(&path).unwrap();
    (Arc::new(Core { key: Some(key.into()), ..Core::test(journal, World::default()) }), path)
}

fn texts(core: &Core) -> Vec<String> {
    core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect()
}

/// One session from start to end, against a stand-in service: the key goes in the handshake, "Listening" shows only
/// once the service answers with a session, the primer and every mic frame reach it, a window that stops ends the
/// stream (so the last words still come back and are kept), and the live line is cleared at the end.
#[tokio::test]
async fn a_session_listens_once_answered_relays_everything_and_cleans_up() {
    let (url, served) = stand_in(
        serde_json::json!({"type": "sessionStarted", "sessionId": "s1"}),
        vec![
            serde_json::json!({"type": "transcript", "transcript": "rent is", "audioProcessedMs": PRIMER_MS + 700}),
            serde_json::json!({"type": "speechComplete", "transcript": "rent is due Friday.", "audioProcessedMs": PRIMER_MS + 1_500, "turnId": 1}),
        ],
    )
    .await;
    let (core, path) = keyed("test-key");
    let mut updates = core.updates.subscribe();
    let (tx, rx) = tokio::sync::mpsc::channel(8);
    tx.send(vec![7u8; FRAME_BYTES]).await.unwrap();
    tx.send(vec![8u8; FRAME_BYTES]).await.unwrap();
    drop(tx);
    run_at(&url, core.clone(), "you".into(), rx, None).await.unwrap();
    let (hello, heard, ended) = served.await.unwrap();
    assert_eq!(hello, handshake("test-key"));
    assert_eq!(heard, primer().len() + 2 * FRAME_BYTES, "the primer, then every mic frame");
    assert!(ended, "the stream is ended, not dropped, so the last turn comes back");
    assert_eq!(texts(&core), ["Rent is due Friday."]);
    let said: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
        .filter_map(|out| match out.message {
            ServerMsg::Status { listening, note } => Some(format!("status {listening} {note}")),
            ServerMsg::Partial { text } => Some(format!("words “{text}”")),
            ServerMsg::Step { step, done, .. } if step == "listen" => Some(format!("listen {}", if done { "done" } else { "started" })),
            _ => None,
        })
        .collect();
    assert_eq!(said, ["status true Listening", "listen started", "words “rent is”", "words “”", "words “”", "listen done"]);
    let _ = std::fs::remove_file(&path);
}

/// A refused session never says "Listening". A wrong key is told as any model call's; any other refusal reaches the
/// window's "The mic stopped" notice (notice-rules.ts `micStopped`) as the service's words, never its raw JSON.
#[tokio::test]
async fn a_refused_session_never_listens_and_says_why_in_words() {
    let (url, served) = stand_in(serde_json::json!({"type": "error", "errorType": "authentication_error", "message": "Invalid API key"}), vec![]).await;
    let (core, path) = keyed("bad-key");
    let mut updates = core.updates.subscribe();
    let (_tx, rx) = tokio::sync::mpsc::channel(8);
    assert!(run_at(&url, core.clone(), "you".into(), rx, None).await.is_err());
    served.await.unwrap();
    assert!(core.key_refused());
    assert!(std::iter::from_fn(|| updates.try_recv().ok()).all(|out| !matches!(out.message, ServerMsg::Status { listening: true, .. })));

    let (url, served) = stand_in(serde_json::json!({"type": "error", "errorType": "invalid_request_error", "message": "Unknown model"}), vec![]).await;
    let (core, path2) = keyed("test-key");
    let (_tx, rx) = tokio::sync::mpsc::channel(8);
    let error = run_at(&url, core.clone(), "you".into(), rx, None).await.unwrap_err().to_string();
    served.await.unwrap();
    assert!(!core.key_refused());
    assert!(error.contains("Unknown model") && !error.contains('{'), "the notice would read: {error}");
    for p in [path, path2] {
        let _ = std::fs::remove_file(&p);
    }
}
