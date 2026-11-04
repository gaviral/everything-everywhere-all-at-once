use super::*;

// Coordinated local processes and HTTP answers exercise ownership mechanics.
// They are never model, recording, hardware or delivery evidence.
struct Coexist {
    core: Arc<Core>,
    root: std::path::PathBuf,
    answers: Arc<tokio::sync::Semaphore>,
    calls: Arc<Mutex<Vec<Value>>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
impl Drop for Coexist {
    fn drop(&mut self) {
        let ids: Vec<_> = self.core.helpers.state.lock().unwrap().active.keys().copied().collect();
        for id in ids { stop(&self.core, id); }
        self.answers.add_permits(100);
        let _ = std::fs::write(self.root.join("release"), "release");
        for task in &self.tasks { task.abort(); }
        // Keep isolated repositories and receipts available for inspection.
    }
}
async fn wait_for(label: &str, mut ready: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(25), async {
        while !ready() { tokio::time::sleep(Duration::from_millis(15)).await; }
    }).await.unwrap_or_else(|_| panic!("timed out: {label}"));
}
fn jobs(core: &Core) -> Vec<Job> {
    core.guide.subscribe(core).1.into_iter().filter_map(|m| {
        if let ServerMsg::Job { job, .. } = m { Some(job) } else { None }
    }).collect()
}
fn child_running(core: &Core, parent: &str) -> usize {
    jobs(core).iter().filter(|j| j.parent.as_deref() == Some(parent) && j.started_ms.is_some() && j.ended_ms.is_none()).count()
}
async fn coexist_fixture() -> Coexist {
    let root = std::env::temp_dir().join(format!("e2a2o-coexist-{}", uuid::Uuid::new_v4()));
    let repo = root.join("source");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::write(repo.join("README.md"), "# Example\n").unwrap();
    for args in [vec!["init", "-q"], vec!["add", "README.md"], vec!["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "Isolated mechanics fixture"]] {
        assert!(tokio::process::Command::new("git").args(args).current_dir(&repo)
            .env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_NOSYSTEM", "1")
            .env_remove("GIT_AUTHOR_NAME").env_remove("GIT_AUTHOR_EMAIL").env_remove("GIT_COMMITTER_NAME").env_remove("GIT_COMMITTER_EMAIL")
            .status().await.unwrap().success());
    }
    let script = root.join("worker.py");
    std::fs::write(&script, r#"import json, pathlib, sys, time
root = pathlib.Path(sys.argv[1])
brief = pathlib.Path(sys.argv[sys.argv.index('--prompt-file') + 1])
assert brief.read_text().startswith('Coding helper')
print(json.dumps({'type':'progress', 'text':'Mechanics child waiting'}), flush=True)
until = time.monotonic() + 120
while not (root / 'release').exists() and time.monotonic() < until:
    time.sleep(0.02)
with open('README.md', 'a') as output:
    output.write('\nIsolated proposal.\n')
print(json.dumps({'type':'done', 'text':'Mechanics proposal retained'}), flush=True)
"#).unwrap();
    let answers = Arc::new(tokio::sync::Semaphore::new(0));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let gate = answers.clone();
    let record = calls.clone();
    let router = axum::Router::new().route("/", axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
        let gate = gate.clone(); let record = record.clone();
        async move {
            let system = body["messages"][0]["content"].as_str().unwrap().to_owned();
            let input: Value = serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
            record.lock().unwrap().push(body);
            let content = if system.starts_with("Split") {
                json!({"briefs":(0..input["count"].as_u64().unwrap()).map(|i| json!({"title":format!("Angle {i}"), "brief":format!("Examine angle {i}")})).collect::<Vec<_>>()}).to_string()
            } else if system.starts_with("Answer") {
                let permit = gate.acquire().await.unwrap(); permit.forget();
                format!("Mechanics answer for {}", input["title"].as_str().unwrap())
            } else { "Mechanics combined answer".into() };
            axum::Json(json!({"choices":[{"message":{"content":content},"finish_reason":"stop"}]}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let model = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
    let (mut core, _) = fixture(true, false, false);
    let (queue, mut placements) = tokio::sync::mpsc::unbounded_channel();
    let c = Arc::get_mut(&mut core).unwrap();
    c.key = Some("local-mechanics-fixture".into());
    c.helpers.url = url;
    c.placer_queue = queue;
    c.messages.settings.email_contacts = vec![("Reviewer".into(), "reviewer@example.invalid".into())];
    c.helpers.coding = coding::Settings { enabled: true, repo: Some(repo),
        command: Some(serde_json::to_string(&vec!["python3".to_string(), script.display().to_string(), root.display().to_string()]).unwrap()),
        test_only: true, ..coding::Settings::default() };
    c.trace = crate::trace::Trace::to(&root);
    core.commit(vec![Change::ThreadAdded { thread: crate::world::fixtures::thread("decision", "Decision", crate::now_ms()) }]);
    let placed = core.clone();
    // A deterministic placement driver, not a model quality or latency test.
    // It consumes the same queue as production and processes return commands.
    let placer = tokio::spawn(async move {
        while let Some(job) = placements.recv().await {
            if let crate::placer::Job::Place(id) = job {
                let world = placed.snapshot();
                let t = world.thoughts.iter().find(|t| t.id == id).unwrap();
                let complete = !t.text.ends_with("before");
                let topic = if complete { "decision" } else { "pitch" };
                let mut changes = vec![Change::ThoughtPlaced { thought_id: id, thread_id: topic.into(),
                    point: t.text.clone(), unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete, place_ms: 0, decided: false }];
                if let Some(old) = world.active_for(&t.speaker).filter(|old| old.as_str() != topic) {
                    if world.thoughts.iter().rev().find(|p| p.placed && p.thread_id.as_ref() == Some(old) && p.speaker == t.speaker).is_some_and(|p| !p.complete) {
                        changes.push(Change::ThreadStatus { thread_id: old.clone(), status: ThreadStatus::Dropped, speaker: t.speaker.clone() });
                    }
                }
                changes.push(Change::ActiveChanged { thread_id: topic.into(), speaker: t.speaker.clone() });
                placed.commit(changes);
            } else { placed.act(job); }
        }
    });
    Coexist { core, root, answers, calls, tasks: vec![model, placer] }
}

#[tokio::test]
async fn coexist_processes_thinking_email_return_and_owned_stop_mechanics() {
    let f = coexist_fixture().await;
    let core = &f.core;
    let _window = crate::messages::window(core, "you");
    let mut updates = core.updates.subscribe();
    core.add_thought("you", "A sample draft before");
    wait_for("source placement", || core.snapshot().thoughts.iter().any(|t| t.text == "A sample draft before" && t.placed)).await;
    let source = core.snapshot().thoughts[0].id.clone();
    assert!(said(core, "you", "put three helpers on coding the sample"));
    let coding = crate::messages::current_id(core, "you").unwrap();
    let coding_parent = format!("helpers:{coding}");
    wait_for("three OS processes", || child_running(core, &coding_parent) == 3).await;
    let coder = core.helpers.state.lock().unwrap().active.get(&coding).unwrap().clone();
    let original_context = coder.context.clone();
    assert!(said(core, "you", "get two helpers on the review question"));
    let thinking = crate::messages::current_id(core, "you").unwrap();
    let thinking_parent = format!("helpers:{thinking}");
    assert_ne!(coding, thinking);
    assert_eq!(child_running(core, &coding_parent), 3, "second admission retains all coders");
    // No simultaneous confirmations; a refused third request creates no parent.
    assert!(said(core, "you", "get one helpers on another question"));
    assert_eq!(core.helpers.state.lock().unwrap().active.len(), 2);
    wait_for("thinking HTTP calls during code", || child_running(core, &thinking_parent) == 2).await;
    assert_eq!(child_running(core, &coding_parent), 3);
    core.add_thought("you", "The sample needs a clear decision.");
    wait_for("ordinary decision placed during execution", || core.snapshot().thoughts.iter().any(|t| t.text == "The sample needs a clear decision." && t.placed)).await;
    core.add_thought("you", "where was I?");
    let mut returned = None;
    wait_for("exact-source return during execution", || {
        while let Ok(out) = updates.try_recv() {
            if let ServerMsg::Returned { anchor: Some(anchor), .. } = out.message { returned = Some(anchor.thought_id); }
        }
        returned.as_deref() == Some(&source)
    }).await;
    assert_eq!(coder.context, original_context, "later speech never rewrites the brief snapshot");
    for mode in ["button", "voice", "draft", "dry"] {
        assert!(crate::messages::act(core, "you", "email Reviewer that the sample needs review").is_some());
        let email = crate::messages::current_id(core, "you").unwrap();
        assert!(crate::messages::is_counting(core, email));
        assert!(matches!(crate::catch_up_with_jobs(core, "you", vec![]).first(), Some(ServerMsg::SendCard { id, channel: crate::messages::Channel::Email, .. }) if *id == email));
        end_card(core, &coder, SendState::Running, "late coder update");
        end_card(core, &coder, SendState::Sent, "late coder end");
        assert_eq!(crate::messages::current_id(core, "you"), Some(email));
        match mode {
            "button" => { assert!(crate::messages::stop(core, email)); },
            "voice" => core.add_thought("you", "Stop"),
            "draft" => {
                crate::messages::heard(core, "you", "Stop"); heard(core, "you", "Stop");
                core.add_thought("you", "Stop");
            },
            _ => wait_for("email dry run", || matches!(crate::messages::card_for(core, "you"), Some(ServerMsg::SendCard { state: SendState::DryRun, .. }))).await,
        }
        assert!(!coder.stopped.load(Ordering::Relaxed));
        assert_eq!(child_running(core, &coding_parent), 3);
        assert_eq!(child_running(core, &thinking_parent), 2);
    }
    // A third parent's explicit Stop must reap its PID without touching the
    // original three processes or the thinking requests.
    assert!(said(core, "you", "put one helpers on coding another sample"));
    let other = crate::messages::current_id(core, "you").unwrap();
    let other_parent = format!("helpers:{other}");
    wait_for("separate owned process", || child_running(core, &other_parent) == 1).await;
    assert!(stop(core, other));
    wait_for("owned PID reaped", || child_running(core, &other_parent) == 0).await;
    assert_eq!(child_running(core, &coding_parent), 3);
    assert_eq!(child_running(core, &thinking_parent), 2);
    std::fs::write(f.root.join("release"), "release").unwrap();
    f.answers.add_permits(2);
    wait_for("all parents finish", || core.helpers.state.lock().unwrap().active.is_empty()).await;
    let rows = jobs(core);
    for (parent, count) in [(&coding_parent, 3), (&thinking_parent, 2)] {
        assert!(rows.iter().any(|j| &j.id == parent && j.status == "done" && j.result.is_some()));
        assert_eq!(rows.iter().filter(|j| j.parent.as_ref() == Some(parent)).count(), count);
        assert!(rows.iter().filter(|j| j.parent.as_ref() == Some(parent)).all(|j| j.status == "done" && j.result.is_some()));
    }
    let trace = std::fs::read_to_string(f.root.join("trace.jsonl")).unwrap();
    let trace: Vec<Value> = trace.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert!(!trace.iter().any(|v| v["kind"] == "delivery" && v["event"] == "sent"));
    let pids: Vec<_> = trace.iter().filter(|v| v["kind"] == "helpers_execution" && v["phase"] == "start").filter_map(|v| v["pid"].as_u64()).collect();
    assert_eq!(pids.len(), 4);
    for pid in pids {
        assert!(!tokio::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().await.unwrap().success(), "owned PID was reaped");
    }
    assert_eq!(f.calls.lock().unwrap().len(), 4, "one split, two thinking calls and one summary");
}

/// Browser-owned mechanics fixture; never film/model/send evidence.
#[tokio::test]
#[ignore]
async fn coexist_app() {
    let f = coexist_fixture().await;
    let release = f.root.join("release");
    let answers = f.answers.clone();
    let voice = f.core.clone();
    let cleanup = f.core.clone();
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/dist");
    let router = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .route("/room", axum::routing::get(crate::room_info))
        .route("/__mechanics/release", axum::routing::post(move || async move {
            std::fs::write(release, "release").unwrap(); answers.add_permits(100); "released"
        }))
        .route("/__mechanics/stop", axum::routing::post(move || async move {
            crate::messages::heard(&voice, "you", "Stop"); heard(&voice, "you", "Stop");
            voice.add_thought("you", "Stop"); "stopped"
        }))
        .route("/__mechanics/cleanup", axum::routing::post(move || async move {
            let ids: Vec<_> = cleanup.helpers.state.lock().unwrap().active.keys().copied().collect();
            for id in ids { stop(&cleanup, id); }
            wait_for("fixture children reaped", || cleanup.helpers.state.lock().unwrap().active.is_empty()).await;
            "reaped"
        }))
        .fallback_service(tower_http::services::ServeDir::new(ui))
        .layer(axum::middleware::from_fn_with_state(f.core.clone(), crate::gate))
        .with_state(f.core.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("COEXIST_APP http://{}", listener.local_addr().unwrap());
    println!("COEXIST_TRACE {}", f.root.join("trace.jsonl").display());
    axum::serve(listener, router.into_make_service_with_connect_info::<crate::Link>()).await.unwrap();
}
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

pub(super) fn fixture(full: bool, hosted: bool, guest: bool) -> (Arc<Core>, std::path::PathBuf) {
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
            .pending
            .unwrap();
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
            .all(|m| matches!(m, ServerMsg::Job { job, .. } if job.status == "stopped")));
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
                assert_eq!(m["status"], "preparing");
                assert!(m["started_ms"].is_null());
                break;
            }
        }
        assert!(
            began.elapsed() < Duration::from_millis(300),
            "first row precedes the delayed splitter"
        );
        let initial = core.guide.subscribe(&core).1;
        assert_eq!(initial.iter().filter(|m| matches!(m, ServerMsg::Job { job, .. } if job.parent.is_some() && job.status == "queued" && job.started_ms.is_none())).count(), 3);
        tokio::time::sleep(Duration::from_millis(350)).await;
        assert!(core.guide.subscribe(&core).1.iter().all(|m| matches!(m, ServerMsg::Job { job, .. } if job.status != "running" && job.started_ms.is_none())), "delayed split and countdown never start children");
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
                if m["parent"].is_null() && matches!(m["status"].as_str(), Some("done" | "failed")) {
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
            assert!(child["ended_ms"].as_u64().unwrap() >= child["started_ms"].as_u64().unwrap());
            assert_eq!(child["helper_kind"], "thinking");
            assert_eq!(child["requested_count"], 3);
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
        let receipts: Vec<_> = trace.iter().filter(|l| l["kind"] == "helpers_execution").collect();
        assert_eq!(receipts.len(), 6);
        for start in receipts.iter().filter(|l| l["phase"] == "start") {
            let end = receipts.iter().find(|l| l["phase"] == "end" && l["call_id"] == start["call_id"]).unwrap();
            let child = children.iter().find(|l| l["id"] == start["child_id"]).unwrap();
            assert_eq!(start["at"], child["started_ms"]);
            assert_eq!(end["at"], child["ended_ms"]);
            assert_eq!(start["provider"], "meta");
            assert_eq!(start["model"], MODEL);
        }
        assert_eq!(rows.values().find(|r| r["parent"].is_null()).unwrap()["outcome"], if fail_one { "partial" } else { "done" });
        let replay = core.guide.subscribe(&core).1;
        for child in &children {
            let replayed = replay.iter().find_map(|m| match m { ServerMsg::Job { job, .. } if job.id == child["id"].as_str().unwrap() => Some(job), _ => None }).unwrap();
            assert_eq!(replayed.started_ms, child["started_ms"].as_u64());
            assert_eq!(replayed.ended_ms, child["ended_ms"].as_u64());
        }
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
        .pending
        .unwrap();
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
