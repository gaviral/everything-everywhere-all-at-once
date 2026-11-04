//! Synthetic fixtures: upstream events are hypotheses, not a recovered live service trace.
use super::*;
use crate::world::{Change, Thread, ThreadStatus};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;

pub const WORDS: &str = "The amber lantern belongs beside the blue notebook.";

#[test]
fn voice_identity_anonymous_partial_final_stop_and_replay() {
    let path = std::env::temp_dir().join(format!("voice-identity-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, _) = Journal::open(&path).unwrap();
    let core = Arc::new(Core::test(journal, World::default()));
    let mut state = Primer::default();
    for event in [
        json!({"type":"transcript", "transcript":WORDS, "audioProcessedMs":PRIMER_MS+800}),
        json!({"type":"speechComplete", "transcript":WORDS, "turnId":12, "audioProcessedMs":PRIMER_MS+1600}),
    ] { handle(&core, "you", &mut state, &event.to_string(), None); }
    state.recover(&core);
    let (_, world) = Journal::open(&path).unwrap();
    assert_eq!(world.thoughts.len(), 1);
    assert!(world.speech_drafts.is_empty(), "a saved source cannot replay as unfinished");
    assert_eq!(world.captures.len(), 1);
}

#[test]
fn voice_identity_event_variants_survive_stop_repetition_and_replay() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../scripts/voice-recovery-identity-events.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let path = std::env::temp_dir().join(format!("voice-identity-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let mut state = Primer::default();
        for event in case["events"].as_array().unwrap() {
            handle(&core, "you", &mut state, &event.to_string(), None);
        }
        state.recover(&core);
        state.recover(&core); // error followed by close is harmless
        let (journal, world) = Journal::open(&path).unwrap();
        let thought_words: Vec<_> = world.thoughts.iter().map(|t| t.text.as_str()).collect();
        let expected: Vec<_> = case["thoughts"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        assert_eq!(thought_words, expected, "{}", case["name"]);
        let mut unfinished: Vec<_> = world.speech_drafts.values().map(|d| d.text.as_str()).collect();
        let mut expected: Vec<_> = case["unfinished"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        unfinished.sort(); expected.sort();
        assert_eq!(unfinished, expected, "{}", case["name"]);
        if expected.len() == 1 {
            let last_partial = std::iter::from_fn(|| updates.try_recv().ok()).filter_map(|out| match out.message {
                ServerMsg::Partial { text } => Some(text), _ => None,
            }).last().unwrap();
            assert_eq!(last_partial, expected[0], "late final cannot erase live unfinished words: {}", case["name"]);
        }
        assert_eq!(world.captures.len(), world.thoughts.len(), "each accepted turn has one source receipt");
        let count = world.thoughts.len();
        let reopened = Arc::new(Core::test(journal, world));
        for draft in reopened.snapshot().speech_drafts.values() {
            reopened.recover_speech("you", &draft.id, true);
            reopened.recover_speech("you", &draft.id, true);
        }
        let (_, twice) = Journal::open(&path).unwrap();
        assert_eq!(twice.thoughts.len(), count + expected.len(), "recovery accepted once");
        assert!(twice.speech_drafts.is_empty());
    }
}

#[test]
fn voice_identity_failed_final_can_retry_without_false_saved_or_loss() {
    let path = std::env::temp_dir().join(format!("voice-identity-failed-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = Journal::open(&path).unwrap();
    drop(journal);
    let core = Arc::new(Core::test(Journal::read_only(&path).unwrap(), world));
    let mut updates = core.updates.subscribe();
    let mut state = Primer::default();
    let draft = json!({"type":"transcript","transcript":"Amber","audioProcessedMs":5600});
    let final_words = json!({"type":"speechComplete","transcript":WORDS,"turnId":12,"audioProcessedMs":6400});
    handle(&core, "you", &mut state, &draft.to_string(), None);
    handle(&core, "you", &mut state, &final_words.to_string(), None);
    state.recover(&core);
    assert!(core.snapshot().thoughts.is_empty());
    assert!(core.snapshot().speech_resolved.is_empty());
    assert!(std::iter::from_fn(|| updates.try_recv().ok()).all(|out| !matches!(out.message, ServerMsg::CaptureSaved { .. })));
    *core.journal.lock().unwrap() = Journal::open(&path).unwrap().0;
    state.recover(&core);
    assert_eq!(core.snapshot().speech_drafts.values().next().unwrap().text, WORDS);
    handle(&core, "you", &mut state, &final_words.to_string(), None);
    state.recover(&core);
    let (_, replay) = Journal::open(&path).unwrap();
    assert_eq!(replay.thoughts.len(), 1);
    assert_eq!(replay.captures.len(), 1);
    assert!(replay.speech_drafts.is_empty());
}

/// Real /ws, relay, event handler, journal, receipts and UI; only ASR and placement are synthetic.
/// Separate process, opt-in only. No real model, microphone, account, or external network.
#[tokio::test]
#[ignore = "owned Chrome fixture server; run via scripts/voice-recovery-identity-check.mjs"]
async fn chrome_fixture_core() {
    let data = std::path::PathBuf::from(std::env::var("VOICE_IDENTITY_DATA").expect("fixture data"));
    let replay = std::env::var("VOICE_IDENTITY_REPLAY").as_deref() == Ok("1");
    let (journal, world) = Journal::open(&data.join("journal.jsonl")).unwrap();
    let asr = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/v1/asr/realtime", asr.local_addr().unwrap());
    let (queue, mut jobs) = tokio::sync::mpsc::unbounded_channel();
    let core = Arc::new(Core { key: if replay { None } else { Some("synthetic-fixture".into()) },
        asr_test_url: Some(url), placer_queue: queue, ..Core::test(journal, world) });
    let placer = core.clone();
    tokio::spawn(async move {
        while let Some(job) = jobs.recv().await {
            if let crate::placer::Job::Place(id) = job {
                placer.commit(vec![Change::ThreadAdded { thread: Thread {
                    id:"fixture".into(), title:"Synthetic voice".into(), parent_id:None, status:ThreadStatus::Open,
                    last_point:String::new(), touched_ms:crate::now_ms(), tags:vec![], picture:None, dropped_by:String::new(),
                } }, Change::ThoughtPlaced { thought_id:id, thread_id:"fixture".into(), point:WORDS.into(),
                    unclear:String::new(), guess:String::new(), heard:String::new(), fixed:String::new(), complete:true,
                    place_ms:0, decided:false }, Change::ActiveChanged { thread_id:"fixture".into(), speaker:"you".into() }]);
            }
        }
    });
    let output = data.clone();
    tokio::spawn(async move {
        let (tcp, _) = asr.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
        socket.next().await.unwrap().unwrap(); // synthetic handshake; do not log credentials
        socket.send(Message::Text(json!({"type":"sessionStarted","sessionId":"synthetic"}).to_string().into())).await.unwrap();
        let target: usize = std::env::var("VOICE_IDENTITY_FRAMES").unwrap().parse().unwrap();
        let mut frames = 0;
        let mut times = vec![];
        let clock = std::time::Instant::now();
        let mut events = vec![];
        let mut pcm = vec![];
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Binary(frame) => {
                    assert_eq!(frame.len(), FRAME_BYTES);
                    frames += 1;
                    if frames > 60 {
                        times.push(clock.elapsed().as_millis() as u64);
                        pcm.extend_from_slice(&frame);
                    }
                    let event = if frames == 80 {
                        Some(json!({"type":"transcript","transcript":WORDS,"audioProcessedMs":6400}))
                    } else if frames == 60 + target {
                        Some(json!({"type":"speechComplete","transcript":WORDS,"turnId":12,"audioProcessedMs":frames*80}))
                    } else { None };
                    if let Some(event) = event {
                        events.push(event.clone());
                        socket.send(Message::Text(event.to_string().into())).await.unwrap();
                    }
                }
                Message::Text(t) if t.contains("endStream") => break,
                _ => {}
            }
        }
        std::fs::write(output.join("mic-pcm.raw"), pcm).unwrap();
        std::fs::write(output.join("asr-observed.json"), serde_json::to_vec_pretty(&json!({"frames":frames,"mic_frame_times_ms":times,"synthetic_events":events})).unwrap()).unwrap();
        let _ = socket.close(None).await;
    });
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/dist");
    let routes = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .route("/room", axum::routing::get(crate::room_info))
        .route("/fixture.wav", axum::routing::get({ let data = data.clone(); move || async move {
            ([("content-type", "audio/wav")], std::fs::read(data.join("speech.wav")).unwrap())
        }}))
        .fallback_service(tower_http::services::ServeDir::new(ui))
        .with_state(core);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::fs::write(data.join("ready.json"), json!({"port":listener.local_addr().unwrap().port()}).to_string()).unwrap();
    axum::serve(listener, routes.into_make_service_with_connect_info::<crate::Link>()).await.unwrap();
}
