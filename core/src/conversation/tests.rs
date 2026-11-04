use super::*;
use crate::{
    protocol::{Outgoing, ServerMsg},
    world::{Journal, World},
};
use axum::{routing::post, Json, Router};
use serde_json::Value;
use std::path::PathBuf;
use tokio::{net::TcpListener, sync::broadcast};

struct Fixture {
    core: Arc<Core>,
    path: PathBuf,
    server: tokio::task::JoinHandle<()>,
    seen: Arc<Mutex<Vec<Value>>>,
}
impl Fixture {
    async fn new(status: u16, text: &str, delay_ms: u64, key: bool) -> Self {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (calls, reply) = (seen.clone(), text.to_string());
        let router = Router::new().route(
            "/chat",
            post(move |Json(body): Json<Value>| {
                let (calls, reply) = (calls.clone(), reply.clone());
                async move {
                    calls.lock().unwrap().push(body);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    (
                        axum::http::StatusCode::from_u16(status).unwrap(),
                        Json(json!({"choices": [{"message": {"content": reply}}]})),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(![4360, 4399].contains(&port));
        let url = format!("http://127.0.0.1:{port}/chat");
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let path =
            std::env::temp_dir().join(format!("e2a2o-partner-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core {
            key: key.then(|| "fake".into()),
            conversation: Runtime {
                url,
                ..Runtime::default()
            },
            ..Core::test(journal, World::default())
        });
        Self {
            core,
            path,
            server,
            seen,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}
async fn state(updates: &mut broadcast::Receiver<Outgoing>, wanted: &str) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let ServerMsg::PartnerState { state, .. } = updates.recv().await.unwrap().message {
                if state == wanted {
                    break;
                }
            }
        }
    })
    .await
    .unwrap();
}
async fn called(f: &Fixture, count: usize) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while f.seen.lock().unwrap().len() < count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
fn captions(updates: &mut broadcast::Receiver<Outgoing>) -> Vec<Outgoing> {
    std::iter::from_fn(|| updates.try_recv().ok())
        .filter(|o| matches!(o.message, ServerMsg::Guide { .. }))
        .collect()
}

fn typed(core: &Arc<Core>, speaker: &str, window: u64, text: &str) {
    core.receive_typed(speaker, &uuid::Uuid::new_v4().to_string(), text, false, Some(window));
}

#[test]
fn questions_and_speech_bounds() {
    for text in [
        "Why is the sky blue",
        "What do you think?",
        "Partner, make it shorter",
        "Can you explain it",
    ] {
        assert!(question(text), "{text}");
    }
    for text in [
        "I wonder why this happens",
        "My question is still open",
        "A thought to keep",
    ] {
        assert!(!question(text), "{text}");
    }
    let long = format!("{} done", "éclair ".repeat(100));
    let bounded = bounded(&long);
    assert!(bounded.chars().count() <= 400 && bounded.split_whitespace().count() <= 60);
    assert_eq!(super::bounded("One. Two! Three? Four."), "One. Two! Three?");
    assert_eq!(super::bounded(" \n\t "), "");
}

#[test]
fn speech_bound_preserves_numbers_and_abbreviations() {
    for text in [
        "Use 127.0.0.1 for loopback.",
        "Try 3.14 as the value. Then use v2.1. Stop there.",
        "Ask Dr. Patel in the U.S. office. Try e.g. a short call. Then wait.",
        "Ask Prof. Lee and J. Smith about the Ph.D. course. Then wait.",
        "Use example.com for the link. It costs $2.50. Keep it simple.",
        "Say “ready.” Then ask “why?” Finally, wait!",
    ] {
        assert_eq!(bounded(text), text, "{text}");
    }
    let three = "Ask Dr. Patel at 127.0.0.1. Try e.g. version 2.1. Then wait.";
    assert_eq!(bounded(&format!("{three} An extra sentence.")), three);
    assert_eq!(bounded("One?! Two... Three! Four."), "One?! Two... Three!");
    assert_eq!(
        bounded("One. Two! Three? unfinished tail"),
        "One. Two! Three?"
    );
}

#[tokio::test]
async fn fake_meta_reply_speaks_three_intact_sentences() {
    let expected = "Ask Dr. Patel at 127.0.0.1. Try e.g. version 2.1. Then wait.";
    let f = Fixture::new(200, &format!("{expected} A fourth sentence."), 1, true).await;
    let _here = enable(&f.core, "you", 1);
    let mut updates = f.core.updates.subscribe();
    typed(&f.core, "you", 1, "Partner, explain loopback.");
    called(&f, 1).await;
    let reply = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let outgoing = updates.recv().await.unwrap();
            if matches!(outgoing.message, ServerMsg::Guide { .. }) {
                break outgoing;
            }
        }
    })
    .await
    .unwrap();
    assert!(reply.speak);
    let payload = serde_json::to_value(&reply).unwrap();
    let world = f.core.snapshot();
    assert_eq!(payload["reply_id"], world.thoughts[0].id, "cancellation identifies the question's reply");
    assert_eq!(payload["caption"]["id"], format!("reply-{}", world.thoughts[0].id));
    assert_eq!(payload["caption"]["text"], expected);
    assert_eq!(world.captions.len(), 1, "reply also has one durable caption");
    assert!(world.ai.iter().any(|name| name == NAME));
    assert!(world.thoughts.iter().any(|thought| thought.speaker == NAME && thought.text == expected), "reply survives playback on the existing map path");
    assert!(std::fs::read_to_string(&f.path).unwrap().contains(expected), "reply is journaled");
    assert!(matches!(reply.message, ServerMsg::Guide { text, .. } if text == expected));
}

#[tokio::test]
async fn retracting_a_pending_question_cancels_its_reply_for_typed_and_spoken_turns() {
    for voice in [false, true] {
        let f = Fixture::new(200, "This answer must never be spoken.", 120, true).await;
        let _here = enable(&f.core, "you", 1);
        let mut updates = f.core.updates.subscribe();
        if voice {
            spoken(&f.core, 1, "Why this approach?").await;
        } else {
            typed(&f.core, "you", 1, "Why this approach?");
        }
        called(&f, 1).await;
        let task = f.core.conversation.speakers.lock().unwrap()["you"]
            .pending
            .as_ref()
            .unwrap()
            .1
            .clone();
        if voice {
            spoken(&f.core, 1, "Scratch that").await;
        } else {
            typed(&f.core, "you", 1, "Scratch that");
        }
        assert!(
            f.core.snapshot().thoughts.is_empty(),
            "question was retracted"
        );
        assert!(
            f.core.conversation.speakers.lock().unwrap()["you"]
                .pending
                .is_none(),
            "retraction cancels pending work"
        );
        state(&mut updates, "cancelled").await;
        tokio::time::timeout(Duration::from_secs(3), async {
            while !task.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(160)).await;
        assert!(captions(&mut updates).is_empty(), "no stale spoken reply");
        assert!(f.core.conversation.speakers.lock().unwrap()["you"]
            .history
            .is_empty());
    }
}

#[tokio::test]
async fn unrelated_retractions_leave_pending_replies_alone_and_delete_cancels_only_its_question() {
    // Exceed the former 160 ms sleep so this exercises waiting for the reply.
    let f = Fixture::new(200, "A brief answer.", 240, true).await;
    let _you = enable(&f.core, "you", 1);
    let _guest = enable(&f.core, "guest", 2);
    let mut updates = f.core.updates.subscribe();
    typed(&f.core, "you", 1, "Why this approach?");
    let question_id = f.core.snapshot().thoughts[0].id.clone();
    typed(&f.core, "guest", 2, "Why another approach?");
    called(&f, 2).await;
    typed(&f.core, "you", 1, "An unrelated thought.");
    typed(&f.core, "you", 1, "Scratch that");
    {
        let speakers = f.core.conversation.speakers.lock().unwrap();
        assert!(
            speakers["you"].pending.is_some(),
            "only the unrelated thought was removed"
        );
        assert!(speakers["guest"].pending.is_some());
    }
    let undo = crate::catalog::take_off(&f.core, &[question_id.clone()]).unwrap();
    {
        let speakers = f.core.conversation.speakers.lock().unwrap();
        assert!(
            speakers["you"].pending.is_none(),
            "deleting the question cancels its reply"
        );
        assert!(
            speakers["guest"].pending.is_some(),
            "the other speaker's question is still pending"
        );
    }
    crate::catalog::run_undo(&f.core, "you", &undo);
    assert!(
        f.core
            .snapshot()
            .thoughts
            .iter()
            .any(|t| t.id == question_id),
        "Undo restores the question"
    );
    assert!(
        f.core.conversation.speakers.lock().unwrap()["you"]
            .pending
            .is_none(),
        "Undo never revives cancelled work"
    );
    // Wait for publication: saving the retained reply may outlast a fixed 160 ms under load.
    let mut replies = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let reply = updates.recv().await.unwrap();
            if matches!(reply.message, ServerMsg::Guide { .. }) {
                let guest = reply.to.as_deref() == Some("guest");
                replies.push(reply);
                if guest {
                    break;
                }
            }
        }
    })
    .await
    .expect("guest reply should arrive while the other speaker's reply stays cancelled");
    replies.extend(captions(&mut updates));
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].to.as_deref(), Some("guest"));
    let speakers = f.core.conversation.speakers.lock().unwrap();
    assert!(speakers["you"].history.is_empty());
    assert_eq!(speakers["guest"].history.len(), 1);
}

#[tokio::test]
async fn off_is_inert_then_question_reply_follow_up_and_identity() {
    let f = Fixture::new(200, "Try one small step. What matters most?", 1, true).await;
    assert!(!request(&f.core, "you", 1, "What matters?"));
    assert!(f.seen.lock().unwrap().is_empty());
    let _here = enable(&f.core, "you", 1);
    assert!(!request(&f.core, "you", 1, "A normal thought."));
    let mut updates = f.core.updates.subscribe();
    typed(&f.core, "you", 1, "What should I try?");
    state(&mut updates, "thinking").await;
    // Collect until idle without dropping the caption.
    let caption = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let o = updates.recv().await.unwrap();
            if matches!(o.message, ServerMsg::Guide { .. }) {
                break o;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(caption.to.as_deref(), Some("you"));
    assert!(caption.speak);
    assert!(
        matches!(caption.message, ServerMsg::Guide { by, ref text, .. } if by == NAME && text == "Try one small step. What matters most?")
    );
    state(&mut updates, "idle").await;
    assert_eq!(
        f.core.snapshot().thoughts.len(),
        2,
        "question and reply use existing map path"
    );
    assert!(request(&f.core, "you", 1, "Partner, make that more concrete."));
    state(&mut updates, "idle").await;
    let calls = f.seen.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[1]["messages"][1]["content"], "What should I try?");
    assert_eq!(calls[1]["messages"][2]["role"], "assistant");
    assert_eq!(
        calls[1]["messages"][3]["content"],
        "Partner, make that more concrete."
    );
    assert_eq!(calls[0]["model"], "muse-spark-1.2");
    assert!(std::fs::read_to_string(&f.path)
        .unwrap()
        .contains("What should I try?"));
    let journal = std::fs::read_to_string(&f.path).unwrap();
    assert!(journal.contains("Try one small step"), "reply words remain on the spine");
    assert!(journal.lines().all(|line| {
        let change: Value = serde_json::from_str(line).unwrap();
        change["type"] != "guide" && change.get("speak").is_none() && change.get("reply_id").is_none()
    }), "playback events stay transient and cannot replay from the journal");
}

#[tokio::test]
async fn cancel_replacement_disable_and_disconnect_never_publish_stale_answers() {
    let f = Fixture::new(200, "A late answer.", 120, true).await;
    let here = enable(&f.core, "you", 1);
    let mut updates = f.core.updates.subscribe();
    request(&f.core, "you", 1, "Why one?");
    called(&f, 1).await;
    cancel(&f.core, "you");
    tokio::time::sleep(Duration::from_millis(160)).await;
    assert!(captions(&mut updates).is_empty());
    assert!(f.core.conversation.speakers.lock().unwrap()["you"]
        .history
        .is_empty());
    request(&f.core, "you", 1, "Why two?");
    called(&f, 2).await;
    request(&f.core, "you", 1, "Why three?");
    state(&mut updates, "idle").await;
    assert_eq!(
        f.core.conversation.speakers.lock().unwrap()["you"]
            .history
            .len(),
        1
    );
    assert_eq!(
        f.core.conversation.speakers.lock().unwrap()["you"].history[0].0,
        "Why three?"
    );
    request(&f.core, "you", 1, "Why four?");
    called(&f, 4).await;
    drop(here); // same guard for disable and socket disconnect
    tokio::time::sleep(Duration::from_millis(160)).await;
    assert!(captions(&mut updates).is_empty());
    assert!(f.core.conversation.speakers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failures_keyless_and_empty_answers_finish_without_speech() {
    for (status, text, key) in [
        (500, "no", true),
        (401, "no", true),
        (429, "no", true),
        (200, " ", true),
        (200, "unused", false),
    ] {
        let f = Fixture::new(status, text, 1, key).await;
        let _here = enable(&f.core, "you", 1);
        let mut updates = f.core.updates.subscribe();
        assert!(request(&f.core, "you", 1, "Why?"));
        state(&mut updates, "error").await;
        assert!(captions(&mut updates).is_empty());
        assert_eq!(f.seen.lock().unwrap().len(), usize::from(key));
    }
}

#[tokio::test]
async fn history_is_bounded_and_never_crosses_speakers_and_commands_win() {
    let f = Fixture::new(200, "A brief answer.", 1, true).await;
    let _you = enable(&f.core, "you", 1);
    let second = enable(&f.core, "you", 2);
    let other = enable(&f.core, "guest", 3);
    let mut updates = f.core.updates.subscribe();
    for i in 0..6 {
        typed(&f.core, "you", 1, &format!("Partner, question {i}"));
        state(&mut updates, "idle").await;
    }
    assert_eq!(
        f.core.conversation.speakers.lock().unwrap()["you"]
            .history
            .len(),
        HISTORY_PAIRS
    );
    typed(&f.core, "you", 1, "Where was I?");
    assert_eq!(
        f.seen.lock().unwrap().len(),
        6,
        "existing commands take priority"
    );
    request(&f.core, "guest", 3, "What do you think?");
    state(&mut updates, "idle").await;
    assert_eq!(
        f.seen.lock().unwrap().last().unwrap()["messages"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    drop(second);
    assert!(
        f.core
            .conversation
            .speakers
            .lock()
            .unwrap()
            .contains_key("you"),
        "one enabled window remains"
    );
    drop(other);
    assert!(!f
        .core
        .conversation
        .speakers
        .lock()
        .unwrap()
        .contains_key("guest"));
}

#[tokio::test(start_paused = true)]
async fn timeout_ends_thinking() {
    let f = Fixture::new(200, "Too late.", 60_000, true).await;
    let _here = enable(&f.core, "you", 1);
    let mut updates = f.core.updates.subscribe();
    request(&f.core, "you", 1, "Why?");
    called(&f, 1).await;
    tokio::time::advance(PATIENCE + Duration::from_secs(1)).await;
    state(&mut updates, "error").await;
    assert!(captions(&mut updates).is_empty());
}

/// Exactly one real Meta request with a synthetic question; no app, microphone or personal map is loaded.
#[tokio::test]
#[ignore = "requires MODEL_API_KEY; opt-in single live call"]
async fn one_real_meta_call() {
    let key = std::env::var("MODEL_API_KEY").expect("MODEL_API_KEY required");
    let path =
        std::env::temp_dir().join(format!("e2a2o-partner-live-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = Journal::open(&path).unwrap();
    let core = Core {
        key: Some(key),
        ..Core::test(journal, world)
    };
    let answer = ask(
        &core,
        &VecDeque::new(),
        &[],
        "What is one simple way to break a large task into a first step?",
    )
    .await;
    let _ = std::fs::remove_file(path);
    let answer = answer.expect("Meta conversation reply");
    assert!(
        !answer.is_empty()
            && answer.chars().count() <= 400
            && answer.split_whitespace().count() <= 60
    );
    println!(
        "Meta partner reply passed: {} words, {} characters",
        answer.split_whitespace().count(),
        answer.chars().count()
    );
}

#[tokio::test]
async fn websocket_opt_in_uses_fake_meta_and_sends_live_spoken_caption() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let f = Fixture::new(200, "Start with one small task.", 1, true).await;
    let routes = Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .layer(axum::middleware::from_fn_with_state(
            f.core.clone(),
            crate::gate,
        ))
        .with_state(f.core.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            routes.into_make_service_with_connect_info::<crate::Link>(),
        )
        .await
        .unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"type": "partner", "on": true}).to_string().into(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"type": "text", "text": "Partner, suggest one small step."})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let mut identity = false;
    let caption = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let msg = socket.next().await.unwrap().unwrap();
            let Message::Text(text) = msg else {
                continue;
            };
            let msg: Value = serde_json::from_str(&text).unwrap();
            if msg["type"] == "call" {
                identity |= msg["people"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["name"] == NAME && p["ai"] == true && p["here"] == true);
            }
            if msg["type"] == "guide" {
                break msg;
            }
        }
    })
    .await
    .unwrap();
    assert!(
        identity,
        "the built-in partner uses the existing AI participant identity"
    );
    assert_eq!(caption["by"], NAME);
    assert_eq!(caption["speak"], true);
    assert_eq!(caption["text"], "Start with one small task.");
    assert_eq!(f.seen.lock().unwrap().len(), 1);
    // Same speaker, separate socket: A's opt-in must never authorize B's typed entries.
    let (mut disabled, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws")).await.unwrap();
    for explicitly_off in [false, true] {
        if explicitly_off {
            disabled.send(Message::Text(json!({"type": "partner", "on": false}).to_string().into())).await.unwrap();
        }
        for reliable in [false, true] {
            let mut entry = json!({"type": "text", "text": "Partner, this window is disabled."});
            if reliable { entry["id"] = json!(uuid::Uuid::new_v4().to_string()); }
            disabled.send(Message::Text(entry.to_string().into())).await.unwrap();
            // A receipt on the same socket is a deterministic barrier after either form of text.
            let marker = uuid::Uuid::new_v4().to_string();
            disabled.send(Message::Text(json!({"type": "text", "text": "ok", "id": marker}).to_string().into())).await.unwrap();
            tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    if let Message::Text(text) = disabled.next().await.unwrap().unwrap() {
                        let msg: Value = serde_json::from_str(&text).unwrap();
                        if msg["type"] == "text_received" && msg["id"] == marker { break; }
                    }
                }
            }).await.unwrap();
            let speakers = f.core.conversation.speakers.lock().unwrap();
            assert!(speakers["you"].pending.is_none(), "disabled B must not start or replace A's request");
            assert_eq!(speakers["you"].history.len(), 1);
            assert_eq!(f.seen.lock().unwrap().len(), 1);
        }
    }
    disabled.close(None).await.unwrap();
    socket.close(None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !f.core.conversation.speakers.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    server.abort();
}

#[tokio::test]
async fn recent_thoughts_are_bounded_and_private_and_the_call_cap_still_holds() {
    let mut f = Fixture::new(200, "Try a small task.", 1, true).await;
    Arc::get_mut(&mut f.core).unwrap().service = model::Service::with_limit(1);
    f.core.keep("guest", "A different person's context.");
    for i in 0..6 {
        f.core
            .keep("you", &format!("Cake plan {i}: {}", "a".repeat(800)));
    }
    let _here = enable(&f.core, "you", 1);
    let mut updates = f.core.updates.subscribe();
    typed(&f.core, "you", 1, "How should I start?");
    state(&mut updates, "idle").await;
    {
        let calls = f.seen.lock().unwrap();
        let background = calls[0]["messages"][1]["content"].as_str().unwrap();
        assert!(background.contains("Cake plan 5") && background.contains("Cake plan 2"));
        assert!(
            !background.contains("Cake plan 1")
                && !background.contains("different person's context")
        );
        assert!(background.chars().count() < 2600);
    }
    typed(&f.core, "you", 1, "Partner, one more idea.");
    state(&mut updates, "error").await;
    assert_eq!(
        f.seen.lock().unwrap().len(),
        1,
        "the shared hourly cap blocks a second request"
    );
}

async fn spoken(core: &Arc<Core>, window: u64, text: &str) {
    use tokio_tungstenite::tungstenite::Message;
    let event = json!({"type": "speechComplete", "transcript": text});
    let mut stream = futures_util::stream::iter([Ok(Message::Text(event.to_string().into()))]);
    crate::asr::hear(core, "you", &mut stream, Some(window)).await.unwrap();
}

#[tokio::test]
async fn asr_checks_the_originating_windows_current_opt_in() {
    let f = Fixture::new(200, "A short answer.", 1, true).await;
    let _a = enable(&f.core, "you", 1);
    let mut updates = f.core.updates.subscribe();
    spoken(&f.core, 2, "Why from disabled B?").await;
    assert!(f.seen.lock().unwrap().is_empty());
    assert!(f.core.conversation.speakers.lock().unwrap()["you"].pending.is_none());
    let b = enable(&f.core, "you", 2);
    spoken(&f.core, 2, "Why from enabled B?").await;
    state(&mut updates, "idle").await;
    drop(b);
    spoken(&f.core, 2, "Why after disabling B?").await;
    spoken(&f.core, 1, "Why from enabled A?").await;
    state(&mut updates, "idle").await;
    let calls = f.seen.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["messages"].as_array().unwrap().last().unwrap()["content"], "Why from enabled B?");
    assert_eq!(calls[1]["messages"].as_array().unwrap().last().unwrap()["content"], "Why from enabled A?");
    assert_eq!(f.core.snapshot().thoughts.len(), 6, "all words still use the map path");
}

#[tokio::test]
async fn mixed_turn_commands_keep_their_order_and_only_remaining_words_reach_meta() {
    for voice in [false, true] {
        for enabled in [false, true] {
            for (text, remaining, expected_jobs, asks) in [
                ("Where was I? Oh right, the rent is due Friday.", "Oh right, the rent is due Friday.", vec!["back", "place"], false),
                ("Where was I? Partner, suggest one step.", "Partner, suggest one step.", vec!["back", "place"], true),
                ("Partner, suggest one step. Okay, next one.", "Partner, suggest one step.", vec!["place", "next"], true),
                ("Where was I? Partner, suggest one step. Okay, next one.", "Partner, suggest one step.", vec!["back", "place", "next"], true),
                ("Partner, suggest one step. Stop listening.", "Partner, suggest one step.", vec!["place"], true),
            ] {
                let mut f = Fixture::new(200, "Try a small step.", 1, true).await;
                let (tx, mut queue) = tokio::sync::mpsc::unbounded_channel();
                Arc::get_mut(&mut f.core).unwrap().placer_queue = tx;
                f.core.keep("you", "An earlier thought waiting for placement.");
                queue.try_recv().unwrap();
                let _here = enabled.then(|| enable(&f.core, "you", 1));
                let mut updates = f.core.updates.subscribe();
                if voice { spoken(&f.core, 1, text).await; }
                else { typed(&f.core, "you", 1, text); }
                let mut jobs = Vec::new();
                while let Ok(job) = queue.try_recv() {
                    jobs.push(match job {
                        crate::placer::Job::Place(_) => "place",
                        crate::placer::Job::Back(_) => "back",
                        crate::placer::Job::Next(_) => "next",
                        crate::placer::Job::Previous(_) => "previous",
                        crate::placer::Job::Resume { .. } => "resume",
                    });
                }
                assert_eq!(jobs, expected_jobs, "voice={voice}, enabled={enabled}: {text}");
                assert_eq!(f.core.snapshot().thoughts[1].text, remaining);
                if enabled && asks {
                    state(&mut updates, "idle").await;
                    let calls = f.seen.lock().unwrap();
                    assert_eq!(calls.len(), 1);
                    assert_eq!(calls[0]["messages"].as_array().unwrap().last().unwrap()["content"], remaining);
                } else {
                    assert!(f.seen.lock().unwrap().is_empty());
                    assert!(std::iter::from_fn(|| updates.try_recv().ok()).all(|o| !matches!(o.message, ServerMsg::PartnerState { .. })));
                }
            }
        }
    }
}
