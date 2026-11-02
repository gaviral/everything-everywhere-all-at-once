//! The placement deciding, as the map hears it (`Route`): true to what the placer does.
use super::{candidates, decide_ruled, rules, Candidate, Pick, Placement, Route};
use crate::protocol::ServerMsg;
use crate::world::{Change, Thought, Thread, ThreadStatus, World};
use crate::Core;
use serde_json::json;

fn thread(id: &str, parent: Option<&str>) -> Thread {
    Thread {
        id: id.into(),
        title: format!("Topic {id}"),
        parent_id: parent.map(Into::into),
        status: ThreadStatus::Open,
        last_point: String::new(),
        touched_ms: 0,
        tags: Vec::new(),
        picture: None,
        dropped_by: String::new(),
    }
}

fn said(id: &str, text: &str, thread: Option<&str>, at_ms: u64, complete: bool) -> Thought {
    Thought {
        id: id.into(),
        speaker: "you".into(),
        text: text.into(),
        point: text.into(),
        thread_id: thread.map(Into::into),
        placed: thread.is_some(),
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete,
        at_ms,
        place_ms: None,
        decided: false,
    }
}

/// T1 (active) with a branch T2, and T3 on its own.
fn map(thoughts: Vec<Thought>) -> World {
    World {
        threads: vec![thread("T1", None), thread("T2", Some("T1")), thread("T3", None)],
        thoughts,
        active: Some("T1".into()),
        ..World::default()
    }
}

fn answer(value: serde_json::Value) -> Placement {
    serde_json::from_value(value).unwrap()
}

/// The threads lit while the calls race are the ones the prompt names, each once: where you are, where your words
/// just went, the words left unfinished; never a thread off the map.
#[test]
fn candidates_are_the_threads_the_prompt_names() {
    let world = map(vec![
        said("a", "I never finish my", Some("T3"), 1_000, false),
        said("b", "The flight is at nine", Some("T2"), 2_000, true),
        said("c", "Sentences.", None, 3_000, true),
    ]);
    let c = |thread_id: &str, why| Candidate { thread_id: thread_id.into(), why };
    assert_eq!(candidates(&world, &world.thoughts[2]), [c("T1", "active"), c("T2", "said just before"), c("T3", "left unfinished")]);
    // Said just before on the active thread: named once, as the active one.
    let world = map(vec![said("b", "Rent is due", Some("T1"), 2_000, true), said("c", "Friday.", None, 3_000, true)]);
    assert_eq!(candidates(&world, &world.thoughts[1]), [c("T1", "active")]);
    // A first thought on an empty map: nothing to light.
    let empty = World { thoughts: vec![said("c", "Hello", None, 1, true)], ..World::default() };
    assert!(candidates(&empty, &empty.thoughts[0]).is_empty());
}

/// Each rule that puts a thought somewhere other than the model's pick says so; a pick the rules keep says nothing.
#[test]
fn a_rule_that_overrides_the_pick_is_named() {
    let world = map(vec![]);
    let turn = |text: &str| said("n", text, None, 5_000, true);
    let ruled = |text: &str, value| decide_ruled(&world, &turn(text), answer(value), 0, false, true).1;
    assert_eq!(ruled("The rent went up", json!({"action": "continue", "thread_id": "T1"})), None);
    assert_eq!(ruled("Book a hostel", json!({"action": "new", "title": "Hostel", "parent_id": "T1"})), None);
    // The model named a branch as the parent: one level only, so it's a thread of its own.
    assert_eq!(ruled("The seat is 14C", json!({"action": "new", "title": "Seat", "parent_id": "T2"})), Some(rules::ONE_LEVEL));
    // A decision branched off the thread it decides goes on that thread.
    assert_eq!(ruled("Decided: I'm booking it", json!({"action": "new", "title": "Booking", "parent_id": "T3"})), Some(rules::DECISION));
    // A thread id that isn't on the map: it stays on the active thread.
    assert_eq!(ruled("And the deposit", json!({"action": "return", "thread_id": "T9"})), Some(rules::NO_SUCH));
    // The speaker asked for a new thread; the model said continue.
    let asked = decide_ruled(&world, &turn("Gardening"), answer(json!({"action": "continue", "thread_id": "T1"})), 0, true, true).1;
    assert_eq!(asked, Some(rules::ASKED));
}

/// A placement against a stand-in model: the map hears the calls go with the threads they weigh, then where the
/// thought went (after it's on the map), the model's pick, and the parent rule that moved it.
#[tokio::test]
async fn the_map_hears_the_placement_deciding_and_the_parent_rule() {
    let placement = json!({"action": "new", "title": "Seat", "parent_id": "T2", "point": "The seat is 14C", "why": "names the flight"});
    let body = json!({"choices": [{"finish_reason": "stop", "message": {"content": placement.to_string()}}]});
    let service = move |_: axum::Json<serde_json::Value>| {
        let body = body.clone();
        async move { axum::Json(body) }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, axum::Router::new().route("/v1/chat/completions", axum::routing::post(service))).await });

    let path = std::env::temp_dir().join(format!("e2a2o-route-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, _) = crate::world::Journal::open(&path).unwrap();
    let core = Core { key: Some("good".into()), placer_race: 2, ..Core::test(journal, map(vec![])) };
    let mut updates = core.updates.subscribe();
    let id = core.keep("you", "The seat is 14C");
    super::place(&core, &id, &url, super::patience).await.unwrap();
    let _ = std::fs::remove_file(&path);

    let mut heard = Vec::new();
    while let Ok(out) = updates.try_recv() {
        match out.message {
            ServerMsg::Route { route } => heard.push(format!("{:?}", route)),
            ServerMsg::Change { change: Change::ThoughtPlaced { .. } } => heard.push("placed".into()),
            _ => {}
        }
    }
    assert_eq!(heard.len(), 3, "{heard:#?}");
    let weighing = Route::Weighing { thought_id: id.clone(), candidates: vec![Candidate { thread_id: "T1".into(), why: "active" }], lanes: 2 };
    assert_eq!(heard[0], format!("{weighing:?}"));
    assert_eq!(heard[1], "placed", "decided is told only once the thought is on the map");
    let new_id = core.snapshot().thoughts[0].thread_id.clone().unwrap();
    assert_eq!(core.snapshot().thread(&new_id).unwrap().parent_id, None, "a branch of a branch is a thread of its own");
    let decided = &heard[2];
    for part in [
        format!("path: [{new_id:?}]"),
        "new: true".into(),
        "skipped: false".into(),
        format!("{:?}", Pick { action: "new".into(), thread_id: "T2".into() }),
        format!("rule: Some({:?})", rules::ONE_LEVEL),
        "lanes: 2".into(),
    ] {
        assert!(decided.contains(&part), "{part} in {decided}");
    }
    // What the window reads.
    let json = serde_json::to_value(ServerMsg::Route { route: Route::Weighing { thought_id: "x".into(), candidates: vec![], lanes: 1 } }).unwrap();
    assert_eq!(json, json!({"type": "route", "route": {"stage": "weighing", "thought_id": "x", "candidates": [], "lanes": 1}}));
}

/// Landing on a branch of an existing thread: the path runs from its top thread down.
#[test]
fn a_branch_landing_has_its_parent_first() {
    let world = map(vec![]);
    let (changes, rule) =
        decide_ruled(&world, &said("n", "The flight moved", None, 5_000, true), answer(json!({"action": "return", "thread_id": "T2"})), 0, false, true);
    assert_eq!(rule, None);
    assert_eq!(super::path_of(&world, &changes), (vec!["T1".to_string(), "T2".to_string()], false));
    let (changes, _) =
        decide_ruled(&world, &said("n", "Book a hostel", None, 5_000, true), answer(json!({"action": "new", "title": "Hostel", "parent_id": "T3"})), 0, false, true);
    let (path, new) = super::path_of(&world, &changes);
    assert_eq!((path.len(), path[0].as_str(), new), (2, "T3", true));
}
