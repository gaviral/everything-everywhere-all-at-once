use super::*;
use crate::world::{
    fixtures::{thought, thread},
    Journal, Tag,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::{Duration, Instant},
};

fn sample() -> World {
    let mut world = World::default();
    world.threads = vec![thread("orbit", "Orbit", 10), thread("garden", "Garden", 20)];
    world.threads[0].tags.push(Tag {
        name: "launch".into(),
        kept: true,
    });
    world.thoughts = vec![
        thought("one", "orbit", "Orbit budget and timeline", 10),
        thought("two", "orbit", "Orbit budget and timeline", 20),
        thought("three", "garden", "Water the ferns #green", 30),
    ];
    world
}

fn apply(runtime: &Runtime, world: &mut World, change: Change) {
    world.apply(&change);
    runtime.changed(&change, world);
}

#[test]
fn default_off_and_multiple_feature_owners() {
    let world = sample();
    let memory = Runtime::configured(false, &world);
    assert!(!memory.enabled());
    assert_eq!(memory.stats().thoughts_indexed, 0);
    assert!(memory.context("you", "budget", None, None).is_none());
    assert!(memory.answer("unused", &json!({})).1.is_none());
    memory.switch(1, true, &world);
    memory.switch(2, true, &world);
    memory.switch(1, false, &world);
    assert_eq!(memory.stats().thoughts_indexed, 3);
    memory.switch(2, false, &world);
    assert!(!memory.enabled());
    assert_eq!(memory.stats().thoughts_indexed, 0);
    let pinned = Runtime::configured(true, &world);
    pinned.switch(1, false, &world);
    assert!(pinned.enabled());
}

#[test]
fn index_tracks_words_hashtags_edits_moves_splits_and_removals() {
    let mut world = sample();
    let runtime = Runtime::configured(true, &world);
    let top = |runtime: &Runtime, text: &str| {
        let state = runtime.state.lock().unwrap();
        let slots = state.index.lookup(text, None, None);
        state.index.documents[slots[0]]
            .as_ref()
            .unwrap()
            .thought
            .id
            .clone()
    };
    assert_eq!(top(&runtime, "#launch"), "two");
    assert_eq!(top(&runtime, "#green"), "three");
    apply(
        &runtime,
        &mut world,
        Change::TagSuggested {
            thread_id: "orbit".into(),
            tag: "early-bird".into(),
        },
    );
    assert_eq!(top(&runtime, "#early-bird"), "two");
    let added = thought("four", "garden", "Cobalt prototype", 40);
    apply(
        &runtime,
        &mut world,
        Change::ThoughtAdded { thought: added },
    );
    assert_eq!(top(&runtime, "cobalt"), "four");
    apply(
        &runtime,
        &mut world,
        Change::ThoughtRepointed {
            thought_id: "four".into(),
            point: "Violet prototype".into(),
        },
    );
    assert_eq!(top(&runtime, "violet"), "four");
    apply(
        &runtime,
        &mut world,
        Change::ThoughtMoved {
            thought_id: "four".into(),
            thread_id: "orbit".into(),
            from: "garden".into(),
            undo: false,
        },
    );
    assert_eq!(top(&runtime, "#launch"), "four");
    apply(
        &runtime,
        &mut world,
        Change::ThoughtSplit {
            thought_id: "four".into(),
            text: "Cobalt".into(),
            rest: thought("five", "orbit", "Prototype parts", 40),
        },
    );
    assert_eq!(runtime.stats().thoughts_indexed, 5);
    apply(
        &runtime,
        &mut world,
        Change::ThoughtSkipped {
            thought_id: "four".into(),
        },
    );
    assert_eq!(runtime.stats().thoughts_indexed, 4);
    let state = runtime.state.lock().unwrap();
    assert!(!state
        .index
        .documents
        .iter()
        .flatten()
        .any(|d| d.thought.id == "four"));
    assert!(!state
        .index
        .lookup("cobalt", None, None)
        .iter()
        .any(|&slot| !state
            .index
            .coverage(slot, &index::words("cobalt"))
            .is_empty()));
}

#[test]
fn context_covers_words_once_prefers_topic_and_recency_and_is_bounded() {
    let world = sample();
    let memory = Runtime::configured(true, &world);
    let selected = memory
        .context("you", "orbit budget", Some("orbit"), None)
        .unwrap();
    assert_eq!(selected.thought_ids, HashSet::from(["two".into()]));
    assert!(selected.notes.contains("Orbit budget and timeline"));
    assert!(!selected.notes.contains("ferns"));
    assert!(selected.bytes_saved > 0);
    let tagged = memory.context("you", "#launch #green", None, None).unwrap();
    assert!(tagged.thought_ids.contains("three"));
    assert!(tagged.thought_ids.contains("two"));
    assert_eq!(tagged.thought_ids.len(), 2);
    let recent = memory.context("you", "unseen words", None, None).unwrap();
    assert_eq!(recent.thought_ids, HashSet::from(["three".into()]));
    let excluded = memory
        .context("you", "orbit budget", Some("orbit"), Some("two"))
        .unwrap();
    assert_eq!(excluded.thought_ids, HashSet::from(["one".into()]));
    let huge = World {
        thoughts: vec![thought("large", "orbit", &"x".repeat(13 * 1024), 1)],
        ..sample()
    };
    let bounded = Runtime::configured(true, &huge)
        .context("you", "x", None, None)
        .unwrap();
    assert!(bounded.notes.len() <= 12 * 1024);
}

#[test]
fn partial_context_survives_its_arrival_but_not_edits() {
    let mut world = sample();
    let memory = Runtime::configured(true, &world);
    memory.speculate("you", "Orbit budget", Some("orbit"));
    let mut arriving = thought("arriving", "orbit", "Orbit budget.", 50);
    arriving.placed = false;
    apply(
        &memory,
        &mut world,
        Change::ThoughtAdded { thought: arriving },
    );
    let ready = memory
        .context("you", "Orbit budget.", Some("orbit"), Some("arriving"))
        .unwrap();
    assert_eq!(ready.thought_ids, HashSet::from(["two".into()]));
    assert_eq!(memory.stats().prefetch_hits, 1);
    memory.speculate("you", "Orbit budget", Some("orbit"));
    apply(
        &memory,
        &mut world,
        Change::ThoughtSkipped {
            thought_id: "two".into(),
        },
    );
    let fresh = memory
        .context("you", "Orbit budget", Some("orbit"), None)
        .unwrap();
    assert!(!fresh.thought_ids.contains("two"));
    assert_eq!(memory.stats().prefetch_hits, 1);
    memory.speculate("you", "Orbit", Some("orbit"));
    memory.context("you", "Orbit budget with new facts", Some("orbit"), None);
    assert_eq!(
        memory.stats().prefetch_hits,
        1,
        "changed speech must assemble its new terms"
    );
}

#[test]
fn answer_reuse_is_exact_bounded_and_revision_safe() {
    let mut world = sample();
    let memory = Runtime::configured(true, &world);
    let body = json!({"model":"muse-spark-1.3","messages":[{"role":"user","content":"What is the budget?"}]});
    let answer =
        json!({"choices":[{"finish_reason":"stop","message":{"content":"The recorded budget."}}]});
    let (_, ticket) = memory.answer("endpoint", &body);
    memory.remember(ticket, &answer);
    assert_eq!(memory.answer("endpoint", &body).0, Some(answer.clone()));
    assert_eq!(memory.stats().cache_hits, 1);
    let changed = json!({"model":"muse-spark-1.3","messages":[{"role":"user","content":"What is the budget ?"}]});
    assert!(memory.answer("endpoint", &changed).0.is_none());
    assert!(memory.answer("other-endpoint", &body).0.is_none());
    let mut model = body.clone();
    model["model"] = json!("muse-spark-1.2");
    assert!(memory.answer("endpoint", &model).0.is_none());
    let (_, stale) = memory.answer("endpoint", &changed);
    apply(
        &memory,
        &mut world,
        Change::ThoughtSkipped {
            thought_id: "one".into(),
        },
    );
    memory.remember(stale, &answer);
    assert!(memory.answer("endpoint", &changed).0.is_none());
    assert!(memory.answer("endpoint", &body).0.is_none());
    let (_, ticket) = memory.answer("endpoint", &body);
    memory.remember(
        ticket,
        &json!({"choices":[{"finish_reason":"length","message":{"content":"cut off"}}]}),
    );
    assert!(memory.answer("endpoint", &body).0.is_none());
    assert!(memory
        .answer(
            "endpoint",
            &json!({"messages":[{"content":[{"type":"image_url"}]}]})
        )
        .1
        .is_none());
    let switched = Runtime::configured(false, &world);
    switched.switch(1, true, &world);
    let (_, old_ticket) = switched.answer("endpoint", &body);
    switched.switch(1, false, &world);
    switched.switch(1, true, &world);
    switched.remember(old_ticket, &answer);
    assert!(
        switched.answer("endpoint", &body).0.is_none(),
        "a reply from a disabled session stays invalid"
    );
}

#[test]
fn placement_request_uses_selected_context_and_off_keeps_the_full_map() {
    let mut world = sample();
    world.active_by.insert("you".into(), "orbit".into());
    let arriving = thought("new", "orbit", "Orbit budget", 100);
    let memory = Runtime::configured(true, &world);
    let selected = memory
        .context("you", &arriving.text, Some("orbit"), Some("new"))
        .unwrap();
    let full =
        crate::placer::request_with_context(&world, &arriving, "muse-spark-1.3", 2000, false, None);
    let small = crate::placer::request_with_context(
        &world,
        &arriving,
        "muse-spark-1.3",
        2000,
        false,
        Some(&selected),
    );
    assert!(full.to_string().contains("Garden"));
    assert!(!small.to_string().contains("Garden"));
    assert!(small.to_string().contains("Orbit budget"));
    let saved = full.to_string().len() - small.to_string().len();
    memory.sent(&json!({"memory_bytes_saved":saved}));
    let stats = memory.stats();
    assert_eq!(stats.last_bytes_saved, saved as u64);
    assert_eq!(stats.bytes_saved, saved as u64);
    assert_eq!(stats.context_calls, 1);
}

fn test_core(world: World) -> (Core, std::path::PathBuf) {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/memory-tests")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&directory).unwrap();
    let (journal, _) = Journal::open(&directory.join("journal.jsonl")).unwrap();
    (
        Core {
            key: Some("memory-test".into()),
            ..Core::test(journal, world)
        },
        directory,
    )
}

#[tokio::test]
async fn feature_protocol_live_stats_and_model_cache_use_the_real_core() {
    use tokio_tungstenite::tungstenite::Message;
    let (core, directory) = test_core(sample());
    let core = Arc::new(core);
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let app = crate::surface::router(core.clone(), &directory, &directory, crate::surface::Policy::default())
        .route("/v1/chat/completions", axum::routing::post(move || {
            seen.fetch_add(1, Ordering::SeqCst);
            async { Json(json!({"choices":[{"finish_reason":"stop","message":{"content":"Example answer"}}]})) }
        }));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<crate::Link>(),
        )
        .await
        .unwrap();
    });
    let client = &core.http;
    let stats = || async {
        client
            .get(format!("{url}/memory/stats"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    };
    assert_eq!(stats().await["enabled"], false);
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "{}/ws?identity=1",
        url.replacen("http", "ws", 1)
    ))
    .await
    .unwrap();
    for on in [true, false] {
        socket
            .send(Message::Text(
                json!({"type":"memory_feature","on":on}).to_string().into(),
            ))
            .await
            .unwrap();
        socket
            .send(Message::Text(
                json!({"type":"heartbeat","id":"memory-fence"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while let Some(message) = socket.next().await {
                let message = message.unwrap();
                if let Ok(value) = serde_json::from_slice::<Value>(&message.into_data()) {
                    if value["type"] == "heartbeat" && value["id"] == "memory-fence" {
                        break;
                    }
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(stats().await["enabled"], on);
        let body = json!({"model":"muse-spark-1.3","messages":[{"role":"user","content":"Repeat this question"}]});
        let endpoint = format!("{url}/v1/chat/completions");
        let before = calls.load(Ordering::SeqCst);
        for _ in 0..2 {
            core.call_model_noting(
                &endpoint,
                &body,
                Duration::from_secs(3),
                json!({"memory_bytes_saved": 17}),
            )
            .await
            .unwrap();
        }
        assert_eq!(
            calls.load(Ordering::SeqCst) - before,
            if on { 1 } else { 2 }
        );
        if on {
            assert_eq!(stats().await["thoughts_indexed"], 3);
            assert_eq!(stats().await["cache_hits"], 1);
            assert_eq!(stats().await["context_calls"], 1);
            assert_eq!(stats().await["bytes_saved"], 17);
            let setting = crate::model::Setting::from("muse-spark-1.2");
            let before = calls.load(Ordering::SeqCst);
            for _ in 0..2 {
                core.ask_model(&setting, &endpoint, Duration::from_secs(3), |model| json!({"model":model,"messages":[{"role":"user","content":"A second question"}]}), Value::Null).await.unwrap();
            }
            assert_eq!(calls.load(Ordering::SeqCst) - before, 1);
            core.send_to(
                "you",
                crate::protocol::ServerMsg::Partial {
                    text: "Orbit budget".into(),
                },
            );
            core.memory.context("you", "Orbit budget", None, None);
            assert_eq!(stats().await["prefetch_hits"], 1);
            core.commit(vec![Change::ThoughtAdded {
                thought: thought("four", "orbit", "Fresh data", 100),
            }]);
            assert_eq!(stats().await["thoughts_indexed"], 4);
        }
    }
    socket.close(None).await.unwrap();
    server.abort();
    let _ = server.await;
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "benchmark: run cargo test --release memory::"
)]
fn lookup_10000_thoughts_bench() {
    let mut world = World::default();
    world.threads.push(thread("bench", "Benchmark", 0));
    for i in 0..10_000 {
        world.thoughts.push(thought(
            &format!("thought-{i}"),
            "bench",
            &format!("Shared record token{i} #tag{}", i % 100),
            i,
        ));
    }
    let index = Index::from_world(&world);
    let mut timings = Vec::new();
    for _ in 0..128 {
        for query in ["shared", "token9821", "#tag42"] {
            let started = Instant::now();
            let found = std::hint::black_box(index.lookup(std::hint::black_box(query), None, None));
            timings.push(started.elapsed().as_micros());
            assert!(!found.is_empty());
        }
    }
    timings.sort_unstable();
    let p95 = timings[timings.len() * 95 / 100];
    println!(
        "memory lookup: 10,000 thoughts, {} queries; p50={} µs p95={p95} µs max={} µs",
        timings.len(),
        timings[timings.len() / 2],
        timings.last().unwrap()
    );
    assert!(
        p95 < 1000,
        "10,000-thought lookup p95 must be below 1 ms; run this benchmark in release mode"
    );
}
