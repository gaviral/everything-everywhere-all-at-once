//! Tests for places on the canvas (positions.rs): a person's and an AI participant's alike, sent to every window, in
//! the snapshot and kept through a restart; refused off the map or off the canvas; gone with what they placed; and a
//! drag's steps all sent while the journal keeps at most one line per item per `JOURNAL_EVERY`. No test calls a model.

use super::*;
use crate::protocol::Outgoing;
use crate::world::fixtures::{thought, thread};
use crate::world::Journal;
use serde_json::{json, Value};

/// T1 (Rent) holds a and b, T2 (Garden) holds c; journaled to a file of its own.
struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-positions-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, world));
        core.commit(vec![
            Change::ThreadAdded { thread: thread("T1", "Rent", 1) },
            Change::ThreadAdded { thread: thread("T2", "Garden", 2) },
            Change::ThoughtAdded { thought: thought("a", "T1", "The rent is due Friday", 3) },
            Change::ThoughtAdded { thought: thought("b", "T1", "Ask about the lease", 4) },
            Change::ThoughtAdded { thought: thought("c", "T2", "Plant the beans", 5) },
        ]);
        Self { core, path }
    }

    /// The journal's place lines, in order.
    fn lines(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.path).unwrap().lines().map(|l| serde_json::from_str::<Value>(l).unwrap()).filter(|c| c["type"] == "positioned").collect()
    }

    /// The map a restart opens.
    fn replayed(&self) -> World {
        Journal::open(&self.path).unwrap().1
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Every place, sorted by id, as (id, x, y, by).
fn places(world: &World) -> Vec<(String, f64, f64, String)> {
    let mut all: Vec<_> = world.positions.iter().map(|(id, p)| (id.clone(), p.x, p.y, p.by.clone())).collect();
    all.sort_by(|a, b| a.0.cmp(&b.0));
    all
}

fn placed(world: &World) -> Vec<String> {
    places(world).into_iter().map(|p| p.0).collect()
}

/// What the windows were sent since `updates` began, as JSON with whom each was for (none: every window).
fn told(updates: &mut tokio::sync::broadcast::Receiver<Outgoing>) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(o) = updates.try_recv() {
        out.push(json!({ "to": o.to, "message": o.message }));
    }
    out
}

/// The Undo offered for what `act` did (a notice's Undo button).
fn offered(core: &Arc<Core>, act: impl FnOnce()) -> u64 {
    let mut updates = core.updates.subscribe();
    act();
    told(&mut updates).iter().find_map(|m| (m["message"]["type"] == "undoable").then(|| m["message"]["id"].as_u64().unwrap())).expect("an Undo")
}

#[tokio::test]
async fn a_person_and_an_ai_participant_each_place_anything_and_every_window_and_a_restart_see_it() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    set(&f.core, "you", "T1", Some(120.5), Some(-40.0)).unwrap();
    set(&f.core, "AI", "c", Some(300.0), Some(80.25)).unwrap();
    let live = f.core.snapshot();
    assert_eq!(places(&live), [("T1".to_string(), 120.5, -40.0, "you".to_string()), ("c".to_string(), 300.0, 80.25, "AI".to_string())]);
    // Each to every window, as the protocol says it.
    let sent = told(&mut updates);
    assert_eq!(sent.len(), 2, "{sent:?}");
    let at_ms = live.positions["T1"].at_ms;
    assert!(at_ms > 0);
    assert_eq!(sent[0], json!({ "to": null, "message": { "type": "change", "change":
        { "type": "positioned", "id": "T1", "x": 120.5, "y": -40.0, "by": "you", "at_ms": at_ms } } }));
    assert_eq!(sent[1]["message"]["change"]["by"], "AI");
    // Each the first of its item, so its line is written at once; a restart opens both.
    assert_eq!(f.lines().len(), 2);
    assert_eq!(serde_json::to_value(&f.replayed().positions).unwrap(), serde_json::to_value(&live.positions).unwrap());
}

#[tokio::test]
async fn the_snapshot_a_window_opens_with_holds_every_place() {
    let f = Fixture::new();
    let snapshot = || serde_json::to_value(ServerMsg::Snapshot { world: f.core.snapshot() }).unwrap();
    assert_eq!(snapshot()["world"]["positions"], json!({}), "an empty map's too, so a window always finds it");
    set(&f.core, "you", "T1", Some(120.5), Some(-40.0)).unwrap();
    set(&f.core, "AI", "a", Some(-8.0), Some(16.0)).unwrap();
    let places = &snapshot()["world"]["positions"];
    assert_eq!((places["T1"]["x"].as_f64(), places["T1"]["y"].as_f64(), places["T1"]["by"].as_str()), (Some(120.5), Some(-40.0), Some("you")));
    assert_eq!((places["a"]["x"].as_f64(), places["a"]["y"].as_f64(), places["a"]["by"].as_str()), (Some(-8.0), Some(16.0), Some("AI")));
    assert!(places["a"]["at_ms"].as_u64().is_some_and(|ms| ms > 0));
}

#[tokio::test(start_paused = true)]
async fn two_nulls_put_it_back_in_the_layout_for_every_window_and_after_a_restart() {
    let f = Fixture::new();
    set(&f.core, "AI", "T1", Some(1.0), Some(2.0)).unwrap();
    tokio::time::sleep(JOURNAL_EVERY).await;
    let mut updates = f.core.updates.subscribe();
    set(&f.core, "you", "T1", None, None).unwrap();
    assert!(f.core.snapshot().positions.is_empty());
    let sent = told(&mut updates);
    let at_ms = sent[0]["message"]["change"]["at_ms"].clone();
    assert_eq!(sent, [json!({ "to": null, "message": { "type": "change", "change":
        { "type": "positioned", "id": "T1", "x": null, "y": null, "by": "you", "at_ms": at_ms } } })]);
    assert_eq!(f.lines().len(), 2, "a line for each, a quarter second apart");
    assert!(f.replayed().positions.is_empty());
    // Back to the layout it's already in: nothing to send or keep.
    set(&f.core, "you", "T1", None, None).unwrap();
    set(&f.core, "you", "a", None, None).unwrap();
    assert!(told(&mut updates).is_empty());
    tokio::time::sleep(JOURNAL_EVERY * 2).await;
    assert_eq!(f.lines().len(), 2);
}

#[tokio::test]
async fn a_place_off_the_map_or_off_the_canvas_is_refused_and_nothing_is_sent_or_kept() {
    let f = Fixture::new();
    f.core.commit(vec![Change::ThreadMerged { from: "T2".into(), into: "T1".into() }]);
    let before = std::fs::read_to_string(&f.path).unwrap();
    let mut updates = f.core.updates.subscribe();
    let max = POSITION_MAX;
    for (id, x, y, why) in [
        ("T9", Some(1.0), Some(1.0), GONE),
        // Merged away: never followed to the thread it went into, whose card has a place of its own.
        ("T2", Some(1.0), Some(1.0), GONE),
        ("", Some(1.0), Some(1.0), GONE),
        ("T1", Some(1.0), None, OFF_CANVAS),
        ("T1", None, Some(1.0), OFF_CANVAS),
        ("T1", Some(f64::NAN), Some(1.0), OFF_CANVAS),
        ("T1", Some(0.0), Some(f64::NEG_INFINITY), OFF_CANVAS),
        ("T1", Some(max + 1.0), Some(0.0), OFF_CANVAS),
        ("a", Some(0.0), Some(-max - 0.5), OFF_CANVAS),
    ] {
        assert_eq!(set(&f.core, "AI", id, x, y), Err(why), "{id:?} {x:?} {y:?}");
    }
    assert_eq!(told(&mut updates), Vec::<Value>::new(), "nothing sent");
    assert_eq!(std::fs::read_to_string(&f.path).unwrap(), before, "nothing kept");
    assert!(f.core.snapshot().positions.is_empty());
    // The canvas's very edge is on it.
    set(&f.core, "AI", "T1", Some(-max), Some(max)).unwrap();
    assert_eq!(places(&f.core.snapshot()), [("T1".to_string(), -max, max, "AI".to_string())]);
    // The words name the bound the core holds.
    assert!(OFF_CANVAS.replace(',', "").contains(&format!("±{}", max as u64)), "{OFF_CANVAS}");
}

#[tokio::test]
async fn a_place_goes_with_what_it_placed_and_undo_brings_that_back_in_the_layout() {
    let f = Fixture::new();
    for (by, id) in [("you", "a"), ("you", "T1"), ("AI", "T2"), ("AI", "c")] {
        set(&f.core, by, id, Some(10.0), Some(20.0)).unwrap();
    }
    // A point deleted by hand takes its place with it; its thread keeps its own.
    let undo = offered(&f.core, || crate::moves::click_delete(&f.core, "you", "a"));
    assert_eq!(placed(&f.core.snapshot()), ["T1", "T2", "c"]);
    // Undo brings the point back, in the layout: what Undo puts back doesn't hold a place yet.
    crate::catalog::undo_click(&f.core, "you", undo);
    let w = f.core.snapshot();
    assert!(w.thoughts.iter().any(|t| t.id == "a"), "the point is back");
    assert_eq!(placed(&w), ["T1", "T2", "c"]);
    // A thread merged away: its card's place goes; the thread it went into keeps its own, and its points theirs.
    f.core.commit(vec![Change::ThreadMerged { from: "T2".into(), into: "T1".into() }]);
    assert_eq!(placed(&f.core.snapshot()), ["T1", "c"]);
    assert_eq!(set(&f.core, "you", "T2", Some(1.0), Some(1.0)), Err(GONE), "a late step for the card merged away moves nothing");
    // An empty thread taken off.
    f.core.commit(vec![Change::ThreadAdded { thread: thread("T3", "Bills", 6) }]);
    set(&f.core, "AI", "T3", Some(-5.0), Some(5.0)).unwrap();
    f.core.commit(vec![Change::ThreadRemoved { thread_id: "T3".into() }]);
    assert_eq!(placed(&f.core.snapshot()), ["T1", "c"]);
    // A restart opens the same places.
    flush_all(&f.core);
    assert_eq!(places(&f.replayed()), places(&f.core.snapshot()));
}

#[tokio::test]
async fn a_drag_after_a_delete_leaves_the_deletes_undo_working() {
    let f = Fixture::new();
    let undo = offered(&f.core, || crate::moves::click_delete(&f.core, "you", "a"));
    set(&f.core, "you", "T1", Some(4.0), Some(4.0)).unwrap();
    set(&f.core, "you", "T1", Some(9.0), Some(9.0)).unwrap();
    crate::catalog::undo_click(&f.core, "you", undo);
    assert!(f.core.snapshot().thoughts.iter().any(|t| t.id == "a"), "a place is arrangement, not a turn: the Undo still works");
}

/// A drag at a frame every 10 ms for 0.6 s, then let go back into the layout 5 ms after its last step.
#[tokio::test(start_paused = true)]
async fn a_drag_reaches_every_window_live_and_the_journal_keeps_a_line_a_quarter_second_ending_on_its_last_step() {
    let f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    for i in 0..60 {
        set(&f.core, "you", "T1", Some(i as f64), Some(-(i as f64))).unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    set(&f.core, "you", "T1", None, None).unwrap();
    let sent: Vec<Value> = told(&mut updates).into_iter().map(|m| m["message"]["change"]["x"].clone()).collect();
    let mut every: Vec<Value> = (0..60).map(|i| json!(i as f64)).collect();
    every.push(Value::Null);
    assert_eq!(sent, every, "every step to every window, in order");
    assert!(f.core.snapshot().positions.is_empty());
    // A step at once, the newest at each quarter second after, and the drag's last word: four lines, not 61.
    tokio::time::sleep(JOURNAL_EVERY).await;
    let kept: Vec<Option<f64>> = f.lines().iter().map(|l| l["x"].as_f64()).collect();
    assert_eq!(kept.len(), 4, "{kept:?}");
    assert_eq!(kept[0], Some(0.0));
    assert!(kept[1].is_some_and(|x| (24.0..=25.0).contains(&x)) && kept[2].is_some_and(|x| (49.0..=50.0).contains(&x)), "{kept:?}");
    assert_eq!(kept[3], None, "letting go within a quarter second of the last step wins");
    assert!(f.replayed().positions.is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_held_line_never_puts_a_place_back_on_a_point_deleted_and_brought_back() {
    let f = Fixture::new();
    set(&f.core, "you", "a", Some(1.0), Some(1.0)).unwrap();
    set(&f.core, "you", "a", Some(2.0), Some(2.0)).unwrap();
    let undo = offered(&f.core, || crate::moves::click_delete(&f.core, "you", "a"));
    crate::catalog::undo_click(&f.core, "you", undo);
    tokio::time::sleep(JOURNAL_EVERY * 2).await;
    let live = f.core.snapshot();
    assert!(live.thoughts.iter().any(|t| t.id == "a") && live.positions.is_empty(), "back, in the layout");
    assert_eq!(f.lines().len(), 1, "the held step went with the point it placed");
    assert!(f.replayed().positions.is_empty(), "a restart opens it in the layout too");
}

/// Held lines simulated against a clock: two items dragged at once at uneven frame times, one let go into the layout,
/// each held line written when due.
#[test]
fn an_items_lines_are_a_quarter_second_apart_and_its_newest_step_is_written_last() {
    let start = Instant::now();
    let step = |id: &str, x: Option<f64>| Change::Positioned { id: id.into(), x, y: x, by: "you".into(), at_ms: 0 };
    let mut steps: Vec<(u64, &str, Option<f64>)> = (0..70).map(|i| (i * 16, "T1", Some(i as f64))).collect();
    steps.extend((0..90).map(|i| (100 + i * 7 + i % 3, "a", Some(i as f64))));
    steps.push((100 + 89 * 7 + 89 % 3 + 2, "a", None));
    steps.sort_by_key(|s| s.0);
    let mut held = Held::default();
    let (mut due, mut written): (Vec<(Instant, String)>, Vec<(String, Instant, String)>) = (Vec::new(), Vec::new());
    /// Writes each held line due by `now`, at the time it was due.
    fn run_due(held: &mut Held, due: &mut Vec<(Instant, String)>, now: Instant, written: &mut Vec<(String, Instant, String)>) {
        due.sort();
        while due.first().is_some_and(|(at, _)| *at <= now) {
            let (at, id) = due.remove(0);
            if let Some(step) = held.due(&id, at) {
                written.push((id, at, serde_json::to_string(&step).unwrap()));
            }
        }
    }
    for (ms, id, x) in &steps {
        let now = start + std::time::Duration::from_millis(*ms);
        run_due(&mut held, &mut due, now, &mut written);
        match held.offer(id, step(id, *x), now) {
            Line::Now(step) => written.push((id.to_string(), now, serde_json::to_string(&step).unwrap())),
            Line::Until(at) => due.push((at, id.to_string())),
            Line::Replaced => {}
        }
    }
    run_due(&mut held, &mut due, start + std::time::Duration::from_secs(10), &mut written);
    for id in ["T1", "a"] {
        let lines: Vec<&(String, Instant, String)> = written.iter().filter(|w| w.0 == id).collect();
        for pair in lines.windows(2) {
            assert!(pair[1].1 - pair[0].1 >= JOURNAL_EVERY, "{id}: two lines under a quarter second apart");
        }
        let last = steps.iter().rev().find(|s| s.1 == id).unwrap();
        assert_eq!(lines.last().unwrap().2, serde_json::to_string(&step(id, last.2)).unwrap(), "{id}: its newest step is the last line");
        // One at once, then one a quarter second at most.
        let span = (lines.last().unwrap().1 - lines[0].1).as_millis() as usize;
        assert!(lines.len() <= 1 + span / 250, "{id}: {} lines over {span} ms", lines.len());
    }
    assert!(held.waiting.is_empty());
}

#[tokio::test]
async fn a_place_never_asks_a_model_or_counts_as_talk() {
    let path = std::env::temp_dir().join(format!("e2a2o-positions-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = Journal::open(&path).unwrap();
    let (placer_queue, mut queue) = tokio::sync::mpsc::unbounded_channel();
    let core = Arc::new(Core { placer_queue, key: Some("test".into()), ..Core::test(journal, world) });
    core.commit(vec![Change::ThreadAdded { thread: thread("T1", "Rent", 1) }]);
    let mut updates = core.updates.subscribe();
    for i in 0..20 {
        set(&core, if i % 2 == 0 { "you" } else { "AI" }, "T1", Some(i as f64), Some(0.0)).unwrap();
    }
    set(&core, "you", "T1", None, None).unwrap();
    assert!(queue.try_recv().is_err(), "nothing for the placer");
    let sent = told(&mut updates);
    assert_eq!(sent.len(), 21);
    assert!(sent.iter().all(|m| m["to"].is_null() && m["message"]["change"]["type"] == "positioned"), "only the places: no model step, notice or turn");
    assert_eq!(core.last_activity.load(std::sync::atomic::Ordering::Relaxed), 0, "not talk: the pause background work waits for still holds");
    let _ = std::fs::remove_file(&path);
}

/// Two windows over real WebSockets, as the page and an AI participant connect.
#[tokio::test]
async fn a_person_and_an_ai_participant_place_things_over_their_sockets_and_each_window_sees_both() {
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
    type Window = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
    async fn next(window: &mut Window) -> Value {
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), window.next()).await.expect("a message within 5 s");
            if let Message::Text(text) = frame.unwrap().unwrap() {
                return serde_json::from_str(text.as_str()).unwrap();
            }
        }
    }
    async fn open(address: std::net::SocketAddr, name: &str) -> (Window, Value) {
        let (mut window, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name={name}")).await.unwrap();
        let snapshot = next(&mut window).await;
        assert_eq!(snapshot["type"], "snapshot");
        // Where placing stands, and that there's no key.
        next(&mut window).await;
        next(&mut window).await;
        (window, snapshot)
    }
    let send = |json: Value| Message::Text(json.to_string().into());
    let (mut person, _) = open(address, "you").await;
    let (mut ai, _) = open(address, "AI").await;

    person.send(send(json!({"type": "position", "id": "T1", "x": 120.5, "y": -40}))).await.unwrap();
    for window in [&mut person, &mut ai] {
        let change = next(window).await;
        assert_eq!((change["type"].as_str(), change["change"]["type"].as_str()), (Some("change"), Some("positioned")));
        assert_eq!((&change["change"]["id"], &change["change"]["x"], &change["change"]["y"], &change["change"]["by"]), (&json!("T1"), &json!(120.5), &json!(-40.0), &json!("you")));
    }
    ai.send(send(json!({"type": "position", "id": "c", "x": 300, "y": 80.25}))).await.unwrap();
    for window in [&mut person, &mut ai] {
        let change = next(window).await;
        assert_eq!((&change["change"]["id"], &change["change"]["by"]), (&json!("c"), &json!("AI")));
    }
    // Three refused in a row on one item are said once, to the window that sent them; then one number alone; then the
    // AI's card back in the layout.
    for _ in 0..3 {
        ai.send(send(json!({"type": "position", "id": "T9", "x": 1, "y": 1}))).await.unwrap();
    }
    ai.send(send(json!({"type": "position", "id": "c", "x": 5}))).await.unwrap();
    ai.send(send(json!({"type": "position", "id": "c", "x": null, "y": null}))).await.unwrap();
    let mut heard = Vec::new();
    loop {
        let message = next(&mut ai).await;
        if message["type"] == "change" {
            assert_eq!((&message["change"]["id"], &message["change"]["x"], &message["change"]["y"]), (&json!("c"), &Value::Null, &Value::Null));
            break;
        }
        heard.push(message["message"].as_str().unwrap_or_default().to_string());
    }
    assert_eq!(heard, [GONE, OFF_CANVAS]);
    let change = next(&mut person).await;
    assert_eq!((change["change"]["id"].as_str(), change["change"]["by"].as_str()), (Some("c"), Some("AI")), "no notice for the person, only the change");
    // A window that opens now finds the person's place in its snapshot.
    let (_, snapshot) = open(address, "Sam").await;
    assert_eq!(snapshot["world"]["positions"]["T1"]["by"], "you");
    assert_eq!(snapshot["world"]["positions"].as_object().unwrap().len(), 1);
}

#[test]
fn a_position_message_reads_two_numbers_or_two_nulls() {
    let read = |json: &str| match serde_json::from_str::<crate::protocol::ClientMsg>(json) {
        Ok(crate::protocol::ClientMsg::Position { id, x, y }) => Some((id, x, y)),
        _ => None,
    };
    assert_eq!(read(r#"{"type":"position","id":"T1","x":12,"y":-3.5}"#), Some(("T1".into(), Some(12.0), Some(-3.5))));
    assert_eq!(read(r#"{"type":"position","id":"th-1","x":null,"y":null}"#), Some(("th-1".into(), None, None)));
    assert_eq!(read(r#"{"type":"position","id":"T1"}"#), Some(("T1".into(), None, None)), "left out reads as null");
    assert_eq!(read(r#"{"type":"position","id":"T1","x":"12","y":3}"#), None, "a number as text isn't read");
    assert_eq!(read(r#"{"type":"position","x":1,"y":1}"#), None, "no id");
}
