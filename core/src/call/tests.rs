//! Tests for the call (call.rs): alone nothing is sent; once two are here, every window hears who is here, who has the
//! floor (once at a turn's start, once at its end, never the words), how far each has read and how far the Friend may
//! interrupt; who left stays listed with when; a Remote is listed as one and never starts a call or counts toward it;
//! and over real sockets, two windows in one call: the late one's catch-up starts with the call, a read mark and a
//! level reach the other, and a margin note reaches both.

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
            Change::ThoughtAdded { thought: thought("a", "T1", "Dinner before Guest leaves on the 14th", 2) },
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
    let colleague = join(&f.core, "Colleague", false);
    assert_eq!(calls(&mut updates), Vec::<Value>::new(), "one is not a call");
    let designer = join(&f.core, "Designer", false);
    let started = calls(&mut updates);
    assert_eq!(started.len(), 1, "{started:?}");
    assert!(started[0]["started_ms"].as_u64().is_some_and(|at| at > 0));
    assert_eq!(started[0]["level"], "speak", "the Friend speaks at a pause until someone caps it");
    assert_eq!(people(&started[0]), [("Colleague".into(), true, false, false, None), ("Designer".into(), true, false, false, None)]);
    assert!(started[0]["people"][0]["joined_ms"].as_u64().unwrap() <= started[0]["people"][1]["joined_ms"].as_u64().unwrap());

    // The floor: once as the turn starts, however many words come, once as it ends.
    speaking(&f.core, "Designer", true);
    speaking(&f.core, "Designer", true);
    speaking(&f.core, "Designer", false);
    speaking(&f.core, "Designer", false);
    let floor: Vec<bool> = calls(&mut updates).iter().map(|c| c["people"][1]["speaking"].as_bool().unwrap()).collect();
    assert_eq!(floor, [true, false]);

    // A read mark: only a thought on the map, and only when it moves.
    assert_eq!(read(&f.core, "Colleague", "nope"), Err(NOT_A_TURN));
    assert_eq!(read(&f.core, "Colleague", "b"), Ok(()));
    assert_eq!(read(&f.core, "Colleague", "b"), Ok(()));
    let marks = calls(&mut updates);
    assert_eq!(marks.len(), 1, "{marks:?}");
    assert_eq!(people(&marks[0])[0].4.as_deref(), Some("b"));

    // The level: anyone may set it; every window hears who did; the same again says nothing.
    level(&f.core, "Designer", Level::Hand);
    level(&f.core, "Designer", Level::Hand);
    let set = calls(&mut updates);
    assert_eq!(set.len(), 1);
    assert_eq!((set[0]["level"].as_str(), set[0]["level_by"].as_str()), (Some("hand"), Some("Designer")));
    assert_eq!(level_now(&f.core), Level::Hand);

    // Who left stays listed, with when, and the call goes on for whoever stays.
    drop(designer);
    let left = calls(&mut updates);
    assert_eq!(people(&left[0])[1], ("Designer".into(), false, false, false, None));
    assert!(left[0]["people"][1]["left_ms"].as_u64().is_some());
    assert!(message(&f.core).is_some(), "a window that connects now still hears the call");
    // Back again: the same person, here, joined when they first did.
    let joined = left[0]["people"][1]["joined_ms"].clone();
    let _designer = join(&f.core, "Designer", false);
    let back = calls(&mut updates);
    assert_eq!(people(&back[0])[1], ("Designer".into(), true, false, false, None));
    assert_eq!((back[0]["people"][1]["joined_ms"].clone(), back[0]["people"][1]["left_ms"].clone()), (joined, Value::Null));
    drop(colleague);
}

#[test]
fn a_mic_is_on_while_any_of_its_sessions_runs_and_its_end_ends_the_turn() {
    let f = Fixture::new();
    let (_colleague, _friend) = (join(&f.core, "Colleague", false), join(&f.core, "Friend", true));
    let mut updates = f.core.updates.subscribe();
    let first = mic_on(&f.core, "Colleague");
    let second = mic_on(&f.core, "Colleague");
    speaking(&f.core, "Colleague", true);
    drop(first);
    drop(second);
    let told: Vec<(bool, bool)> = calls(&mut updates).iter().map(|c| (c["people"][0]["mic"].as_bool().unwrap(), c["people"][0]["speaking"].as_bool().unwrap())).collect();
    assert_eq!(told, [(true, false), (true, true), (false, false)], "on once, the floor, then off with its turn when the last session ends");
    let call = message(&f.core).map(|m| json!(m)).unwrap();
    assert_eq!(call["people"][1]["ai"], true, "an AI participant is marked as one");
}

/// Two windows in one call over real sockets, as the pages connect: the second's catch-up starts with the call (before
/// the world, so a window that hears the world first knows its call is over); Designer's read mark and her level reach
/// Colleague's window; a margin note from Colleague reaches both windows; and Designer's leaving reaches Colleague's.
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

    let mut colleague = open("Colleague").await;
    let alone = drain(&mut colleague, 300).await;
    assert!(!kinds(&alone).contains(&"call".to_string()), "alone, no call: {:?}", kinds(&alone));
    let mut designer = open("Designer").await;
    let first = drain(&mut designer, 300).await;
    assert_eq!(&kinds(&first)[..2], ["call", "snapshot"], "the call comes first in the catch-up");
    assert_eq!(people(&first[0]).iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), ["Colleague", "Designer"]);
    let told = drain(&mut colleague, 300).await;
    assert_eq!(kinds(&told), ["call"], "Colleague's window hears Designer join");

    let send = |json: Value| Message::Text(json.to_string().into());
    designer.send(send(json!({"type": "read", "thought_id": "b"}))).await.unwrap();
    designer.send(send(json!({"type": "level", "level": "note"}))).await.unwrap();
    let heard = drain(&mut colleague, 300).await;
    assert_eq!(people(heard.last().unwrap())[1].4.as_deref(), Some("b"), "{heard:?}");
    assert_eq!((heard.last().unwrap()["level"].as_str(), heard.last().unwrap()["level_by"].as_str()), (Some("note"), Some("Designer")));
    let _ = drain(&mut designer, 300).await;

    colleague.send(send(json!({"type": "annotate", "thought_id": "b", "quote": "everyone brings a dessert", "text": "yes please!"}))).await.unwrap();
    for window in [&mut colleague, &mut designer] {
        let got = drain(window, 300).await;
        let note = got.iter().find(|m| m["type"] == "change" && m["change"]["type"] == "thought_added").expect("the note reaches every window");
        assert_eq!((note["change"]["thought"]["speaker"].as_str(), note["change"]["thought"]["text"].as_str()), (Some("Colleague"), Some("yes please!")));
        assert!(got.iter().any(|m| m["change"]["type"] == "anchored" && m["change"]["quote"] == "everyone brings a dessert"));
    }

    designer.close(None).await.unwrap();
    let gone = drain(&mut colleague, 500).await;
    let last = gone.iter().rev().find(|m| m["type"] == "call").expect("Colleague's window hears Designer leave");
    assert_eq!(people(last)[1].1, false);
}

/// Who each window is in a call message, in a line: name, and whether it's a Remote, here, and an AI participant.
fn kinds(call: &Value) -> Vec<(String, bool, bool, bool)> {
    call["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["name"].as_str().unwrap().into(), p["remote"].as_bool().unwrap(), p["here"].as_bool().unwrap(), p["ai"].as_bool().unwrap()))
        .collect()
}

#[test]
fn a_remote_is_listed_as_one_and_is_never_another_person() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    let colleague = join(&f.core, "Colleague", false);
    assert_eq!(calls(&mut updates), Vec::<Value>::new(), "one person is alone");
    // Their phone's Remote joins under a name of its own: the room is told it's there, as a Remote, and no call starts.
    let phone = join_remote(&f.core, "Colleague's phone");
    let told = calls(&mut updates);
    assert_eq!(told.len(), 1, "{told:?}");
    assert_eq!(told[0]["started_ms"], 0, "no call has started: a Remote is no one to talk with");
    assert_eq!(kinds(&told[0]), [("Colleague".into(), false, true, false), ("Colleague's phone".into(), true, true, false)]);
    let again = message(&f.core).map(|m| json!(m)).expect("a window that connects now hears the Remote too");
    assert_eq!(kinds(&again), kinds(&told[0]));
    // More Remotes, still no call.
    let other = join_remote(&f.core, "Speaker's phone");
    assert_eq!(calls(&mut updates).last().map(|c| c["started_ms"].clone()), Some(json!(0)));
    // An AI participant beside the person is a call, as it was; the Remotes are listed in it and aren't counted.
    let agent = join(&f.core, "agent", true);
    let started = calls(&mut updates);
    assert_eq!(started.len(), 1, "{started:?}");
    assert!(started[0]["started_ms"].as_u64().is_some_and(|at| at > 0), "the call starts with the AI participant");
    assert_eq!(kinds(&started[0]), [("Colleague".into(), false, true, false), ("Colleague's phone".into(), true, true, false), ("Speaker's phone".into(), true, true, false), ("agent".into(), false, true, true)]);
    // A Remote leaving is told like anyone leaving, and stays a Remote (never "someone who left").
    drop(phone);
    let left = calls(&mut updates);
    assert_eq!(kinds(left.last().unwrap())[1], ("Colleague's phone".into(), true, false, false));
    assert!(left.last().unwrap()["people"][1]["left_ms"].as_u64().is_some());
    drop((other, agent, colleague));
}

#[test]
fn a_remote_with_a_person_of_its_name_is_only_what_stays_open() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    let (_colleague, _friend) = (join(&f.core, "Colleague", false), join(&f.core, "Friend", true));
    let _ = calls(&mut updates);
    // Two windows of one name, one a Remote: the name is a person while their other window is open.
    let laptop = join(&f.core, "Designer", false);
    let phone = join_remote(&f.core, "Designer");
    assert_eq!(kinds(calls(&mut updates).last().unwrap())[2], ("Designer".into(), false, true, false), "a person with a Remote is a person");
    // The Remote closing changes nothing about them: nothing to tell for a window of someone who stays.
    drop(phone);
    assert_eq!(calls(&mut updates), Vec::<Value>::new());
    let phone = join_remote(&f.core, "Designer");
    let _ = calls(&mut updates);
    // The laptop closing leaves only the Remote: no longer a person, and listed as here.
    drop(laptop);
    let left = calls(&mut updates);
    assert_eq!(kinds(left.last().unwrap())[2], ("Designer".into(), true, true, false));
    // Coming back as a person makes them one again.
    let _laptop = join(&f.core, "Designer", false);
    assert_eq!(kinds(calls(&mut updates).last().unwrap())[2], ("Designer".into(), false, true, false));
    drop(phone);
}

/// A Remote's window over a real socket, as the phone's page connects (`?remote`): in with a name of its own, listed to
/// the other windows as a Remote with no call started, heard in its own catch-up before the world, and counted for
/// nothing; an AI participant that asks to be a Remote stays an AI participant.
#[tokio::test]
async fn a_remote_window_joins_as_any_window_and_starts_no_call() {
    use futures_util::StreamExt;
    use tokio_tungstenite::tungstenite::Message;
    let f = Fixture::new();
    let routes = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .layer(axum::middleware::from_fn_with_state(f.core.clone(), crate::gate))
        .with_state(f.core.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, routes.into_make_service_with_connect_info::<crate::Link>()).await });
    let open = |query: &'static str| async move { tokio_tungstenite::connect_async(format!("ws://{address}/ws?{query}")).await.unwrap().0 };
    async fn drain(window: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, ms: u64) -> Vec<Value> {
        let mut got = Vec::new();
        while let Ok(Some(Ok(frame))) = tokio::time::timeout(std::time::Duration::from_millis(ms), window.next()).await {
            if let Message::Text(text) = frame {
                got.push(serde_json::from_str(text.as_str()).unwrap());
            }
        }
        got
    }
    let kinds_of = |got: &[Value]| got.iter().map(|m| m["type"].as_str().unwrap_or_default().to_string()).collect::<Vec<_>>();

    let mut colleague = open("name=Colleague").await;
    assert!(!kinds_of(&drain(&mut colleague, 300).await).contains(&"call".to_string()), "alone, no call");
    let mut phone = open("name=Colleague%27s+phone&remote=1").await;
    let first = drain(&mut phone, 300).await;
    assert_eq!(&kinds_of(&first)[..2], ["call", "snapshot"], "the Remote's catch-up starts with who is here, as any window's");
    assert_eq!(first[0]["started_ms"], 0, "{first:?}");
    assert_eq!(kinds(&first[0]), [("Colleague".into(), false, true, false), ("Colleague's phone".into(), true, true, false)]);
    let told = drain(&mut colleague, 300).await;
    assert_eq!(kinds_of(&told), ["call"], "Colleague's window hears the Remote is there");
    assert_eq!((told[0]["started_ms"].clone(), kinds(&told[0])[1].clone()), (json!(0), ("Colleague's phone".into(), true, true, false)));
    // Asking to be both: an AI participant (listed as one, a call with Colleague) and not a Remote.
    let mut agent = open("name=agent&ai=true&remote=1").await;
    let joined = drain(&mut agent, 300).await;
    assert!(joined[0]["started_ms"].as_u64().is_some_and(|at| at > 0), "an AI participant and a person are a call, as before: {joined:?}");
    assert_eq!(kinds(&joined[0])[2], ("agent".into(), false, true, true));
    let _ = drain(&mut colleague, 300).await;
    // The Remote closing is heard, and the call goes on for those who stay.
    phone.close(None).await.unwrap();
    let gone = drain(&mut colleague, 500).await;
    let last = gone.iter().rev().find(|m| m["type"] == "call").expect("Colleague's window hears the Remote leave");
    assert_eq!(kinds(last)[1], ("Colleague's phone".into(), true, false, false));
    assert!(last["started_ms"].as_u64().is_some_and(|at| at > 0));
}
