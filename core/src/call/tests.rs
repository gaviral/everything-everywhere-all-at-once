//! Tests for the call (call.rs): alone nothing is sent; once two are here, every window hears who is here, who has the
//! floor (once at a turn's start, once at its end, never the words), how far each has read and how far the Friend may
//! interrupt; who left stays listed with when; and over real sockets, two windows in one call: the late one's catch-up
//! starts with the call, a read mark and a level reach the other, and a margin note reaches both.

use super::*;
use crate::protocol::Outgoing;
use crate::world::fixtures::{thought, thread};
use crate::world::{Change, Journal, World};
use serde_json::{json, Value};

struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
}

impl Fixture {
    /// T1 (Dinner) with two of your thoughts, a and b.
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-call-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        core.commit(vec![
            Change::ThreadAdded { thread: thread("T1", "Dinner", 1) },
            Change::ThoughtAdded { thought: thought("a", "T1", "Dinner before Lena leaves on the 14th", 2) },
            Change::ThoughtAdded { thought: thought("b", "T1", "Pasta night: everyone brings a dessert", 3) },
        ]);
        Self { core, path }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// The call messages the windows were sent since `updates` began, as JSON, each with whom it was for.
fn calls(updates: &mut tokio::sync::broadcast::Receiver<Outgoing>) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(o) = updates.try_recv() {
        if matches!(o.message, ServerMsg::Call { .. }) {
            assert_eq!(o.to, None, "the call goes to every window");
            out.push(json!(o.message));
        }
    }
    out
}

/// Who each person is in a call message, in a line: name, here, mic, speaking, read.
fn people(call: &Value) -> Vec<(String, bool, bool, bool, Option<String>)> {
    call["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["name"].as_str().unwrap().into(), p["here"].as_bool().unwrap(), p["mic"].as_bool().unwrap(), p["speaking"].as_bool().unwrap(), p["read"].as_str().map(String::from)))
        .collect()
}

#[test]
fn alone_nothing_is_sent_and_a_second_window_of_yours_is_still_alone() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    let first = join(&f.core, "you", false);
    let second = join(&f.core, "you", false);
    speaking(&f.core, "you", true);
    level(&f.core, "you", Level::Hand);
    assert_eq!(read(&f.core, "you", "a"), Ok(()));
    drop((first, second));
    assert_eq!(calls(&mut updates), Vec::<Value>::new(), "alone, the map is as it was: no call");
    assert!(message(&f.core).is_none(), "nor in a catch-up");
}

#[test]
fn two_here_start_the_call_and_every_change_is_told_once() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    let sam = join(&f.core, "Sam", false);
    assert_eq!(calls(&mut updates), Vec::<Value>::new(), "one is not a call");
    let maya = join(&f.core, "Maya", false);
    let started = calls(&mut updates);
    assert_eq!(started.len(), 1, "{started:?}");
    assert!(started[0]["started_ms"].as_u64().is_some_and(|at| at > 0));
    assert_eq!(started[0]["level"], "speak", "the Friend speaks at a pause until someone caps it");
    assert_eq!(people(&started[0]), [("Sam".into(), true, false, false, None), ("Maya".into(), true, false, false, None)]);
    assert!(started[0]["people"][0]["joined_ms"].as_u64().unwrap() <= started[0]["people"][1]["joined_ms"].as_u64().unwrap());

    // The floor: once as the turn starts, however many words come, once as it ends.
    speaking(&f.core, "Maya", true);
    speaking(&f.core, "Maya", true);
    speaking(&f.core, "Maya", false);
    speaking(&f.core, "Maya", false);
    let floor: Vec<bool> = calls(&mut updates).iter().map(|c| c["people"][1]["speaking"].as_bool().unwrap()).collect();
    assert_eq!(floor, [true, false]);

    // A read mark: only a thought on the map, and only when it moves.
    assert_eq!(read(&f.core, "Sam", "nope"), Err(NOT_A_TURN));
    assert_eq!(read(&f.core, "Sam", "b"), Ok(()));
    assert_eq!(read(&f.core, "Sam", "b"), Ok(()));
    let marks = calls(&mut updates);
    assert_eq!(marks.len(), 1, "{marks:?}");
    assert_eq!(people(&marks[0])[0].4.as_deref(), Some("b"));

    // The level: anyone may set it; every window hears who did; the same again says nothing.
    level(&f.core, "Maya", Level::Hand);
    level(&f.core, "Maya", Level::Hand);
    let set = calls(&mut updates);
    assert_eq!(set.len(), 1);
    assert_eq!((set[0]["level"].as_str(), set[0]["level_by"].as_str()), (Some("hand"), Some("Maya")));
    assert_eq!(level_now(&f.core), Level::Hand);

    // Who left stays listed, with when, and the call goes on for whoever stays.
    drop(maya);
    let left = calls(&mut updates);
    assert_eq!(people(&left[0])[1], ("Maya".into(), false, false, false, None));
    assert!(left[0]["people"][1]["left_ms"].as_u64().is_some());
    assert!(message(&f.core).is_some(), "a window that connects now still hears the call");
    // Back again: the same person, here, joined when they first did.
    let joined = left[0]["people"][1]["joined_ms"].clone();
    let _maya = join(&f.core, "Maya", false);
    let back = calls(&mut updates);
    assert_eq!(people(&back[0])[1], ("Maya".into(), true, false, false, None));
    assert_eq!((back[0]["people"][1]["joined_ms"].clone(), back[0]["people"][1]["left_ms"].clone()), (joined, Value::Null));
    drop(sam);
}

#[test]
fn a_mic_is_on_while_any_of_its_sessions_runs_and_its_end_ends_the_turn() {
    let f = Fixture::new();
    let (_sam, _friend) = (join(&f.core, "Sam", false), join(&f.core, "Friend", true));
    let mut updates = f.core.updates.subscribe();
    let first = mic_on(&f.core, "Sam");
    let second = mic_on(&f.core, "Sam");
    speaking(&f.core, "Sam", true);
    drop(first);
    drop(second);
    let told: Vec<(bool, bool)> = calls(&mut updates).iter().map(|c| (c["people"][0]["mic"].as_bool().unwrap(), c["people"][0]["speaking"].as_bool().unwrap())).collect();
    assert_eq!(told, [(true, false), (true, true), (false, false)], "on once, the floor, then off with its turn when the last session ends");
    let call = message(&f.core).map(|m| json!(m)).unwrap();
    assert_eq!(call["people"][1]["ai"], true, "an AI participant is marked as one");
}

/// Two windows in one call over real sockets, as the pages connect: the second's catch-up starts with the call (before
/// the world, so a window that hears the world first knows its call is over); Maya's read mark and her level reach
/// Sam's window; a margin note from Sam reaches both windows; and Maya's leaving reaches Sam's.
#[tokio::test]
async fn two_windows_in_one_call_hear_each_other() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let f = Fixture::new();
    let routes = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .layer(axum::middleware::from_fn_with_state(f.core.clone(), crate::gate))
        .with_state(f.core.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, routes.into_make_service_with_connect_info::<crate::Link>()).await });
    let open = |name: &'static str| async move { tokio_tungstenite::connect_async(format!("ws://{address}/ws?name={name}")).await.unwrap().0 };
    // Every message within `ms`, as JSON.
    async fn drain(window: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, ms: u64) -> Vec<Value> {
        let mut got = Vec::new();
        while let Ok(Some(Ok(frame))) = tokio::time::timeout(std::time::Duration::from_millis(ms), window.next()).await {
            if let Message::Text(text) = frame {
                got.push(serde_json::from_str(text.as_str()).unwrap());
            }
        }
        got
    }
    let kinds = |got: &[Value]| got.iter().map(|m| m["type"].as_str().unwrap_or_default().to_string()).collect::<Vec<_>>();

    let mut sam = open("Sam").await;
    let alone = drain(&mut sam, 300).await;
    assert!(!kinds(&alone).contains(&"call".to_string()), "alone, no call: {:?}", kinds(&alone));
    let mut maya = open("Maya").await;
    let first = drain(&mut maya, 300).await;
    assert_eq!(&kinds(&first)[..2], ["call", "snapshot"], "the call comes first in the catch-up");
    assert_eq!(people(&first[0]).iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), ["Sam", "Maya"]);
    let told = drain(&mut sam, 300).await;
    assert_eq!(kinds(&told), ["call"], "Sam's window hears Maya join");

    let send = |json: Value| Message::Text(json.to_string().into());
    maya.send(send(json!({"type": "read", "thought_id": "b"}))).await.unwrap();
    maya.send(send(json!({"type": "level", "level": "note"}))).await.unwrap();
    let heard = drain(&mut sam, 300).await;
    assert_eq!(people(heard.last().unwrap())[1].4.as_deref(), Some("b"), "{heard:?}");
    assert_eq!((heard.last().unwrap()["level"].as_str(), heard.last().unwrap()["level_by"].as_str()), (Some("note"), Some("Maya")));
    let _ = drain(&mut maya, 300).await;

    sam.send(send(json!({"type": "annotate", "thought_id": "b", "quote": "everyone brings a dessert", "text": "yes please!"}))).await.unwrap();
    for window in [&mut sam, &mut maya] {
        let got = drain(window, 300).await;
        let note = got.iter().find(|m| m["type"] == "change" && m["change"]["type"] == "thought_added").expect("the note reaches every window");
        assert_eq!((note["change"]["thought"]["speaker"].as_str(), note["change"]["thought"]["text"].as_str()), (Some("Sam"), Some("yes please!")));
        assert!(got.iter().any(|m| m["change"]["type"] == "anchored" && m["change"]["quote"] == "everyone brings a dessert"));
    }

    maya.close(None).await.unwrap();
    let gone = drain(&mut sam, 500).await;
    let last = gone.iter().rev().find(|m| m["type"] == "call").expect("Sam's window hears Maya leave");
    assert_eq!(people(last)[1].1, false);
}
