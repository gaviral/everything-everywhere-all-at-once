use super::*;
#[test]
fn whole_turn_rule_numbers_cap_and_talk() {
    for (text, count, topic) in [
        ("put five helpers on the phone layout", 5, "phone layout"),
        ("Get ten helpers on the pitch.", 10, "pitch"),
        ("have three helpers look at X", 3, "x"),
        ("put helpers on the pitch", 3, "pitch"),
        ("get twenty-one helpers on the pitch", 12, "pitch"),
        ("get 100 helpers on the pitch", 12, "pitch"),
    ] {
        assert_eq!(
            read(text, 12),
            Some(Ask {
                count,
                topic: topic.into()
            }),
            "{text}"
        );
    }
    assert_eq!(
        read("put five helpers on the phone layout", 4)
            .unwrap()
            .count,
        4
    );
    for text in [
        "we could put five helpers on the phone layout",
        "I have three helpers look at X",
        "the helpers are working on the pitch",
        "get helpers",
        "put zero helpers on X",
        "have three helpers on the pitch",
        "get ten helpers on",
    ] {
        assert!(read(text, 12).is_none(), "{text}");
    }
}

fn fixture(full: bool, hosted: bool, guest: bool) -> (Arc<Core>, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("e2a2o-helpers-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, mut world) = crate::world::Journal::open(&path).unwrap();
    world.apply(&Change::ThreadAdded {
        thread: crate::world::fixtures::thread("pitch", "Pitch", crate::now_ms()),
    });
    let mut core = Core::test(journal, world);
    core.helpers.hosted = hosted;
    if full {
        core.messages.settings.preset = Preset::Full;
    }
    if guest {
        core.room = Some(crate::Room::from("test-code"));
    }
    (Arc::new(core), path)
}

#[tokio::test]
async fn unset_preset_and_switch_off_leave_the_words_as_talk() {
    for full in [false, true] {
        let (core, path) = fixture(full, false, false);
        if full {
            switch(&core, "you", false);
        }
        core.add_thought("you", "put five helpers on the phone layout");
        let world = core.snapshot();
        assert_eq!(world.thoughts.len(), 1);
        assert_eq!(
            world.thoughts[0].text,
            "put five helpers on the phone layout"
        );
        assert!(!counting(&core));
        assert!(core.guide.subscribe(&core).1.is_empty());
        std::fs::remove_file(path).unwrap();
    }
}

#[tokio::test]
async fn guests_and_hosted_cannot_start_helpers() {
    for (hosted, guest, expected) in [(true, false, "hosted"), (false, true, "Only the host")] {
        let (core, path) = fixture(true, hosted, guest);
        let mut out = core.updates.subscribe();
        core.add_thought("guest", "get ten helpers on the pitch");
        assert!(!counting(&core));
        assert!(core.snapshot().thoughts.is_empty());
        assert!(
            matches!(out.try_recv().unwrap().message, ServerMsg::Notice { message } if message.contains(expected))
        );
        assert!(core.guide.subscribe(&core).1.is_empty());
        std::fs::remove_file(path).unwrap();
    }
}

#[tokio::test(start_paused = true)]
async fn stop_button_voice_and_draft_cancel_before_thinking() {
    for mode in ["button", "voice", "draft", "switch"] {
        let (core, path) = fixture(true, false, false);
        core.add_thought("you", "put five helpers on the phone layout");
        assert!(counting(&core));
        let id = core
            .helpers
            .state
            .lock()
            .unwrap()
            .active
            .as_ref()
            .unwrap()
            .id;
        assert_eq!(
            core.guide.subscribe(&core).1.len(),
            6,
            "rows precede any model work"
        );
        match mode {
            "button" => assert!(stop(&core, id)),
            "voice" => core.add_thought("you", "Stop"),
            "switch" => switch(&core, "you", false),
            _ => {
                heard(&core, "you", "Stop");
                core.add_thought("you", "Stop");
            }
        }
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(30)).await;
        assert!(!counting(&core));
        assert!(core.snapshot().thoughts.is_empty());
        assert!(core
            .guide
            .subscribe(&core)
            .1
            .iter()
            .all(|m| matches!(m, ServerMsg::Job { job, .. } if job.status == "failed")));
        assert!(matches!(
            crate::messages::card_for(&core, "you"),
            Some(ServerMsg::SendCard {
                state: SendState::Stopped,
                ..
            })
        ));
        assert!(!stop(&core, id));
        std::fs::remove_file(path).unwrap();
    }
}

#[tokio::test]
async fn withdrawn_request_never_starts_and_switch_off_keeps_it_as_talk() {
    let text = "put five helpers on the phone layout, no, stop, please";
    let (core, path) = fixture(true, false, false);
    let mut out = core.updates.subscribe();
    core.add_thought("you", text);
    assert!(matches!(out.try_recv().unwrap().message, ServerMsg::Notice { message } if message.contains("stop")));
    assert!(!counting(&core));
    assert!(core.snapshot().thoughts.is_empty());
    assert!(core.guide.subscribe(&core).1.is_empty());
    switch(&core, "you", false);
    core.add_thought("you", text);
    assert_eq!(core.snapshot().thoughts[0].text, text);
    std::fs::remove_file(path).unwrap();
}

#[derive(Default)]
struct Calls {
    bodies: Vec<Value>,
    active: usize,
    peak: usize,
}
async fn stub(fail_one: bool) -> (String, Arc<Mutex<Calls>>, tokio::task::JoinHandle<()>) {
    let calls = Arc::new(Mutex::new(Calls::default()));
    let record = calls.clone();
    let router = axum::Router::new().route("/", axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
        let record = record.clone();
        async move {
            let system = body["messages"][0]["content"].as_str().unwrap().to_string();
            let input: Value = serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
            record.lock().unwrap().bodies.push(body);
            let content = if system.starts_with("Split") {
                tokio::time::sleep(Duration::from_millis(300)).await;
                json!({"briefs":(0..input["count"].as_u64().unwrap()).map(|i| json!({"title":format!("Examine pitch angle {i} with a deliberately long title"), "brief":format!("Review angle {i}")})).collect::<Vec<_>>()}).to_string()
            } else if system.starts_with("Answer") {
                {
                    let mut calls = record.lock().unwrap();
                    calls.active += 1;
                    calls.peak = calls.peak.max(calls.active);
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
                record.lock().unwrap().active -= 1;
                if fail_one && input["brief"] == "Review angle 1" { return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(json!({"error":"stub failure"}))); }
                "Useful finding. ".repeat(100)
            } else { "Lead with the user problem; show a concrete phone layout and a clear demo.".into() };
            (axum::http::StatusCode::OK, axum::Json(json!({"choices":[{"message":{"content":content},"finish_reason":"stop"}]})))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (url, calls, task)
}

#[tokio::test]
async fn stub_run_on_free_port_rows_parallel_finish_and_land_without_blocking_talk() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    for fail_one in [false, true] {
        let (url, calls, model) = stub(fail_one).await;
        let (mut core, path) = fixture(true, false, false);
        let trace_dir = path.with_extension("trace");
        std::fs::create_dir(&trace_dir).unwrap();
        let c = Arc::get_mut(&mut core).unwrap();
        let (placer_queue, mut placements) = tokio::sync::mpsc::unbounded_channel();
        c.placer_queue = placer_queue;
        c.key = Some("stub".into());
        c.helpers.url = url;
        c.trace = crate::trace::Trace::to(&trace_dir);
        let router = axum::Router::new()
            .route("/ws", axum::routing::get(crate::connect))
            .layer(axum::middleware::from_fn_with_state(
                core.clone(),
                crate::gate,
            ))
            .with_state(core.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = tokio::spawn(async move {
            axum::serve(
                listener,
                router.into_make_service_with_connect_info::<crate::Link>(),
            )
            .await
            .unwrap();
        });
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
            .await
            .unwrap();
        let send =
            |text: &str| Message::Text(json!({"type":"text","text":text}).to_string().into());
        speech_end(&core, "you");
        let began = Instant::now();
        ws.send(send("get three helpers on the pitch"))
            .await
            .unwrap();
        let mut saw_card = false;
        loop {
            let m = tokio::time::timeout(Duration::from_secs(2), ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let Ok(m) = serde_json::from_str::<Value>(m.to_text().unwrap_or("")) else {
                continue;
            };
            if m["type"] == "send_card" {
                saw_card = true;
                assert_eq!(m["purpose"], "helpers");
            }
            if m["type"] == "job" {
                assert!(saw_card);
                break;
            }
        }
        assert!(
            began.elapsed() < Duration::from_millis(300),
            "first row precedes the delayed splitter"
        );
        ws.send(send("The phone needs a clear primary action"))
            .await
            .unwrap();
        ws.send(send("where was I?")).await.unwrap();
        let mut rows = HashMap::new();
        let until = Instant::now() + Duration::from_secs(12);
        while Instant::now() < until {
            let m = tokio::time::timeout_at(until, ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let Ok(m) = serde_json::from_str::<Value>(m.to_text().unwrap_or("")) else {
                continue;
            };
            if m["type"] == "job" {
                rows.insert(m["id"].as_str().unwrap().to_string(), m.clone());
                if m["parent"].is_null() && m["status"] == "done" {
                    break;
                }
            }
        }
        assert_eq!(rows.len(), 4);
        let queued = std::iter::from_fn(|| placements.try_recv().ok()).collect::<Vec<_>>();
        assert!(
            queued
                .iter()
                .any(|j| matches!(j, crate::placer::Job::Place(_))),
            "ordinary speech still reaches placement"
        );
        let children = rows
            .values()
            .filter(|r| !r["parent"].is_null())
            .collect::<Vec<_>>();
        assert_eq!(
            children.iter().filter(|r| r["status"] == "failed").count(),
            usize::from(fail_one)
        );
        for child in &children {
            assert!(child["started_ms"].as_u64().is_some());
            assert!(
                child["at_ms"].as_u64().unwrap() - child["started_ms"].as_u64().unwrap() < 1000,
                "helper seconds exclude the countdown"
            );
            assert!(child["title"].as_str().unwrap().split_whitespace().count() <= 6);
            assert!(child["result"].as_str().unwrap().split_whitespace().count() <= 120);
        }
        let world = core.snapshot();
        let landed = world
            .thoughts
            .iter()
            .filter(|t| t.speaker == "Helpers")
            .collect::<Vec<_>>();
        assert_eq!(landed.len(), 1);
        assert_eq!(landed[0].thread_id.as_deref(), Some("pitch"));
        assert!(landed[0].placed && landed[0].text.starts_with("Helpers:"));
        assert!(world
            .thoughts
            .iter()
            .any(|t| t.text == "The phone needs a clear primary action"));
        assert!(!world
            .thoughts
            .iter()
            .any(|t| t.text.contains("three helpers") || t.text == "where was I?"));
        let calls = calls.lock().unwrap();
        assert_eq!(
            calls.bodies.len(),
            5,
            "one split, three parallel answers, one synthesis"
        );
        assert_eq!(calls.peak, 3);
        assert!(calls.bodies.iter().all(|b| b["model"] == MODEL));
        drop(calls);
        let trace = std::fs::read_to_string(trace_dir.join("trace.jsonl")).unwrap();
        let trace = trace
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(trace.iter().filter(|l| l["kind"] == "call").count(), 5);
        assert!(trace.iter().any(|l| l["kind"] == "helpers_first_row"
            && l["speech_end_to_first_row_ms"].as_u64().unwrap() < 300));
        assert!(trace.iter().any(|l| l["kind"] == "helpers_landed"));
        app.abort();
        model.abort();
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir_all(trace_dir).unwrap();
    }
}

/// A real core and built UI, with a local stub model; used by scripts/helpers-check.mjs.
#[tokio::test]
#[ignore]
async fn stub_app() {
    let (url, _calls, model) = stub(false).await;
    let (mut core, path) = fixture(true, false, false);
    let trace_dir = path.with_extension("trace");
    std::fs::create_dir(&trace_dir).unwrap();
    let c = Arc::get_mut(&mut core).unwrap();
    c.key = Some("stub".into());
    c.helpers.url = url;
    c.trace = crate::trace::Trace::to(&trace_dir);
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/dist");
    let router = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .route("/room", axum::routing::get(crate::room_info))
        .fallback_service(tower_http::services::ServeDir::new(ui))
        .layer(axum::middleware::from_fn_with_state(
            core.clone(),
            crate::gate,
        ))
        .with_state(core);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("SWARM_APP http://{}", listener.local_addr().unwrap());
    println!("SWARM_TRACE {}", trace_dir.join("trace.jsonl").display());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<crate::Link>(),
        )
        .await
        .unwrap();
    });
    // Allow both browser sizes to start on a busy shared runner; the harness owns this PID.
    tokio::time::sleep(Duration::from_secs(300)).await;
    task.abort();
    model.abort();
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir_all(trace_dir).unwrap();
}

#[tokio::test]
async fn stop_during_split_traces_the_cancelled_call_and_never_runs_helpers() {
    let (url, calls, model) = stub(false).await;
    let (mut core, path) = fixture(true, false, false);
    let trace_dir = path.with_extension("trace");
    std::fs::create_dir(&trace_dir).unwrap();
    let c = Arc::get_mut(&mut core).unwrap();
    c.key = Some("stub".into());
    c.helpers.url = url;
    c.trace = crate::trace::Trace::to(&trace_dir);
    core.add_thought("you", "put five helpers on the pitch");
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.lock().unwrap().bodies.is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let id = core
        .helpers
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .id;
    assert!(stop(&core, id));
    tokio::time::sleep(Duration::from_millis(350)).await;
    assert_eq!(
        calls.lock().unwrap().bodies.len(),
        1,
        "only the cancelled split reached the stub"
    );
    assert!(core.snapshot().thoughts.is_empty());
    let trace = std::fs::read_to_string(trace_dir.join("trace.jsonl")).unwrap();
    let trace = trace
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .collect::<Vec<_>>();
    assert!(trace.iter().any(|l| l["kind"] == "call"
        && l["feature"] == "helpers_split"
        && l["error"].as_str().is_some_and(|s| s.contains("dropped"))));
    model.abort();
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir_all(trace_dir).unwrap();
}
