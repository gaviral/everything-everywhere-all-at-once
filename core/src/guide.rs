//! Pointing, captions, held questions and tours: another participant (an AI joined with a name, e.g. `?name=Claude`) shows
//! the person one exact part of the screen, with an arrow and a one-line caption, says a line as a caption, or holds a
//! question for the person's next pause, instead of adding a thought to the map. All are of the moment: relayed as
//! they come to every window but the one that sent them, never journaled, and no model is asked. Each window keeps
//! its held questions and asks one when the person pauses (ui/src/guide-core.ts). The names are the window's
//! `data-guide` names (docs/guide.md); ui/src/Guide.tsx draws them.

use crate::protocol::ServerMsg;
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// A point's caption, in characters: one line beside the arrow, about 25 words.
pub const POINT_MAX: usize = 140;
/// A caption in the corner, in characters: two or three spoken sentences, about 70 words.
pub const CAPTION_MAX: usize = 400;
/// A held question, in characters: read at a glance in the held stack, and two lines at most once it's asked, as a
/// point's caption is one.
pub const HOLD_MAX: usize = POINT_MAX;
/// At most this many ordered steps in one tour; an empty tour clears the sender's.
pub const TOUR_MAX: usize = 20;
/// A part's name, in characters: `composer`, `view:palace`, `point:th-` and 32 hex digits (41), with room to spare.
pub const NAME_MAX: usize = 100;
/// At most this many from one window in any second. Someone guiding sends about one a second; a point, its spoken
/// caption and taking the last point down can come at once (3). More is a script stuck in a loop.
pub const PER_SECOND: usize = 4;

/// One tour caption, optionally pointing at a named part of the screen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Step {
    #[serde(default)]
    pub target: Option<String>,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Point,
    Caption,
    Hold,
}

/// A number for a new window, so what it sends is never sent back to it (main.rs `forward`).
pub fn window() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// One window's last second of guide messages and tours, for `PER_SECOND`.
#[derive(Default)]
pub struct Pace {
    sent: VecDeque<Instant>,
    /// When it last heard why one wasn't shown: once a second at most, so a flood isn't answered with one.
    told: Option<Instant>,
}

impl Pace {
    /// Whether one more may go at `now`, counting it if so.
    fn allow(&mut self, now: Instant) -> bool {
        while self.sent.front().is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(1)) {
            self.sent.pop_front();
        }
        if self.sent.len() >= PER_SECOND {
            return false;
        }
        self.sent.push_back(now);
        true
    }

    /// Whether to tell the sender why one wasn't shown, at `now`.
    fn tell(&mut self, now: Instant) -> bool {
        let tell = self.told.is_none_or(|at| now.duration_since(at) >= Duration::from_secs(1));
        if tell {
            self.told = Some(now);
        }
        tell
    }
}

/// Why a name can't be one of the window's (docs/guide.md: lowercase words, `:` and an id), or none when it can.
fn bad_name(name: &str) -> Option<String> {
    let fits = !name.is_empty()
        && name.chars().count() <= NAME_MAX
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.'));
    (!fits).then(|| format!("“{}” isn't the name of a part of the screen (docs/guide.md).", clip(name)))
}

/// Why `text` is too long for `what`, or none.
fn too_long(text: &str, max: usize, what: &str) -> Option<String> {
    (text.chars().count() > max).then(|| format!("{what} is {max} characters at most."))
}

/// One line, as it will show: no control characters, runs of spaces and line breaks as one space.
fn one_line(text: &str) -> String {
    let shown: String = text.chars().map(|c| if c.is_control() && !c.is_whitespace() { ' ' } else { c }).collect();
    shown.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A name as a notice quotes it: at most 40 characters.
fn clip(name: &str) -> String {
    let clipped: String = name.chars().take(40).collect();
    if clipped.len() < name.len() { format!("{clipped}…") } else { clipped }
}

/// `target` with `caption`, from `speaker`'s window `window`; no target takes their point down.
pub fn point(core: &Core, speaker: &str, window: u64, pace: &mut Pace, target: Option<String>, caption: Option<String>) {
    // Taking a point down says nothing more than that: any caption with it is left out.
    let Some(name) = target else { return send(core, speaker, window, pace, Kind::Point, None, String::new(), false, None) };
    let caption = one_line(&caption.unwrap_or_default());
    let refused = bad_name(&name).or_else(|| too_long(&caption, POINT_MAX, "A point's caption"));
    send(core, speaker, window, pace, Kind::Point, Some(name), caption, false, refused);
}

/// `text` as a caption in the corner of the other windows, from `speaker`'s window `window`.
pub fn caption(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String) {
    let text = one_line(&text);
    let refused = if text.is_empty() { Some("A caption needs words.".to_string()) } else { too_long(&text, CAPTION_MAX, "A caption") };
    send(core, speaker, window, pace, Kind::Caption, None, text, false, refused);
}

/// `text`, a question for the other windows to hold until the person pauses and then ask, with an arrow at `target`
/// once asked if given; `urgent` (the Interrupt level) jumps the line of held questions. From `speaker`'s window
/// `window`. No words take back this speaker's questions still held (any target with them is left out, as with taking
/// a point down).
#[allow(clippy::too_many_arguments)]
pub fn hold(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String, target: Option<String>, urgent: bool) {
    let text = one_line(&text);
    if text.is_empty() {
        return send(core, speaker, window, pace, Kind::Hold, None, text, false, None);
    }
    let refused = target.as_deref().and_then(bad_name).or_else(|| too_long(&text, HOLD_MAX, "A held question"));
    send(core, speaker, window, pace, Kind::Hold, target, text, urgent, refused);
}

/// Relay an entire ordered tour, or clear this speaker's tour with no steps. Nothing is retained for reconnect.
pub fn tour(core: &Core, speaker: &str, window: u64, pace: &mut Pace, mut steps: Vec<Step>) {
    let refused = if steps.len() > TOUR_MAX {
        Some(format!("A tour has {TOUR_MAX} steps at most."))
    } else {
        steps.iter_mut().find_map(|step| {
            step.text = one_line(&step.text);
            step.target.as_deref().and_then(bad_name).or_else(|| {
                if step.text.is_empty() {
                    Some("A tour step needs words.".into())
                } else {
                    too_long(&step.text, POINT_MAX, "A tour step")
                }
            })
        })
    };
    if allowed(core, speaker, pace, refused) {
        core.send(ServerMsg::Tour { steps, by: speaker.into(), at_ms: crate::now_ms(), from: window });
    }
}

#[allow(clippy::too_many_arguments)]
fn send(core: &Core, speaker: &str, window: u64, pace: &mut Pace, kind: Kind, target: Option<String>, text: String, urgent: bool, refused: Option<String>) {
    if allowed(core, speaker, pace, refused) {
        core.send(ServerMsg::Guide { kind, target, text, by: speaker.into(), at_ms: crate::now_ms(), urgent, from: window });
    }
}

/// All guide messages share the window's budget and the sender's refusal route.
fn allowed(core: &Core, speaker: &str, pace: &mut Pace, refused: Option<String>) -> bool {
    let now = Instant::now();
    let refused = refused.or_else(|| (!pace.allow(now)).then(|| format!("{PER_SECOND} a second at most.")));
    if let Some(why) = refused {
        // Only to the sender's own windows, and once a second at most: the other windows see nothing.
        if pace.tell(now) {
            core.send_to(speaker, ServerMsg::Notice { message: format!("Not shown: {why}") });
        }
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{bad_name, one_line, Pace, PER_SECOND};
    use crate::world::Change;
    use crate::{Core, Link};
    use futures_util::{SinkExt, StreamExt};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio_tungstenite::tungstenite::Message;

    type Window = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    /// The window's names, and what isn't one.
    #[test]
    fn names_are_the_windows_and_nothing_else() {
        for name in ["composer", "mic", "view:palace", "thread:T12", "point:th-0123456789abcdef0123456789abcdef", "back-to-active"] {
            assert_eq!(bad_name(name), None, "{name}");
        }
        for name in ["", "thread T1", "<b>", "composer\n", "a\"b", &"x".repeat(101), "point:тест"] {
            assert!(bad_name(name).is_some(), "{name:?}");
        }
    }

    #[test]
    fn a_caption_is_one_line_as_shown() {
        assert_eq!(one_line("  Look at\n\nthis\tone \u{7}"), "Look at this one");
    }

    #[test]
    fn tour_wire_defaults_targets_and_never_serializes_the_origin() {
        let message = serde_json::from_value::<crate::protocol::ClientMsg>(serde_json::json!({
            "type": "tour", "steps": [{"text": "First"}, {"target": null, "text": "Second"}]
        })).unwrap();
        let crate::protocol::ClientMsg::Tour { steps } = message else { panic!("expected tour") };
        assert!(steps.iter().all(|step| step.target.is_none()));
        let wire = serde_json::to_value(crate::protocol::ServerMsg::Tour { steps, by: "Claude".into(), at_ms: 123, from: 42 }).unwrap();
        assert_eq!(wire, serde_json::json!({
            "type": "tour", "steps": [{"target": null, "text": "First"}, {"target": null, "text": "Second"}],
            "by": "Claude", "at_ms": 123
        }));
    }

    /// Four in any second, then the fifth waits until the first is a second old; why is told once a second.
    #[test]
    fn the_pace_is_four_a_second() {
        let mut pace = Pace::default();
        let start = Instant::now();
        for i in 0..PER_SECOND {
            assert!(pace.allow(start + Duration::from_millis(i as u64 * 10)));
        }
        assert!(!pace.allow(start + Duration::from_millis(500)));
        assert!(!pace.allow(start + Duration::from_millis(999)));
        assert!(pace.allow(start + Duration::from_millis(1000)));
        assert!(pace.tell(start));
        assert!(!pace.tell(start + Duration::from_millis(900)));
        assert!(pace.tell(start + Duration::from_millis(1000)));
    }

    /// The next message a window gets, as JSON, or none within `ms`.
    async fn next(window: &mut Window, ms: u64) -> Option<serde_json::Value> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
        loop {
            match tokio::time::timeout_at(deadline, window.next()).await {
                Ok(Some(Ok(Message::Text(text)))) => return Some(serde_json::from_str(text.as_str()).unwrap()),
                Ok(Some(Ok(_))) => continue,
                _ => return None,
            }
        }
    }

    /// Everything a window gets within `ms` of quiet.
    async fn drain(window: &mut Window, ms: u64) -> Vec<serde_json::Value> {
        let mut out = Vec::new();
        while let Some(message) = next(window, ms).await {
            out.push(message);
        }
        out
    }

    /// A core with one thread, T1 "Rent", and a key, so a typed thought would land and be queued for the placer (none
    /// must be): the core, its temporary journal's path and the placer's queue.
    fn prepared() -> (Arc<Core>, std::path::PathBuf, tokio::sync::mpsc::UnboundedReceiver<crate::placer::Job>) {
        let path = std::env::temp_dir().join(format!("e2a2o-guide-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("test".into()), ..Core::test(journal, world) });
        core.commit(vec![Change::ThreadAdded { thread: crate::world::fixtures::thread("T1", "Rent", 1) }]);
        (core, path, queue)
    }

    /// The prepared core served on an ephemeral port, with its journal and placer queue.
    async fn served() -> (Arc<Core>, std::net::SocketAddr, std::path::PathBuf, tokio::sync::mpsc::UnboundedReceiver<crate::placer::Job>) {
        let (core, path, queue) = prepared();
        let routes = axum::Router::new()
            .route("/ws", axum::routing::get(crate::connect))
            .layer(axum::middleware::from_fn_with_state(core.clone(), crate::gate))
            .with_state(core.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, routes.into_make_service_with_connect_info::<Link>()).await });
        (core, address, path, queue)
    }

    /// Windows on the core at `address`, by name ("" is the person's), each past its catch-up (the world, placing, the
    /// missing key), so what comes next is what the test sent.
    async fn windows<const N: usize>(address: std::net::SocketAddr, names: [&str; N]) -> [Window; N] {
        let mut out = Vec::new();
        for name in names {
            let url = format!("ws://{address}/ws{}", if name.is_empty() { String::new() } else { format!("?name={name}") });
            out.push(tokio_tungstenite::connect_async(url).await.unwrap().0);
        }
        for window in &mut out {
            drain(window, 300).await;
        }
        out.try_into().unwrap_or_else(|_| unreachable!())
    }

    fn send(json: serde_json::Value) -> Message {
        Message::Text(json.to_string().into())
    }

    /// A point and a caption from one window (Claude's, over the bridge) reach every other window, the person's two
    /// and another of Claude's, exactly as sent, with who sent them; never the window they came from; never the
    /// journal, the map or a model. Too long, not a name, or past 4 a second: only the sender hears why.
    #[tokio::test]
    async fn a_point_and_a_caption_reach_every_other_window_and_nothing_else() {
        let (core, address, path, mut queue) = served().await;
        let journaled = || std::fs::read_to_string(&path).unwrap();
        let before = journaled();
        let [mut claude, mut ears, mut you, mut other_tab] = windows(address, ["Claude", "Claude", "", ""]).await;

        claude.send(send(serde_json::json!({"type": "point", "target": "thread:T1", "caption": "Your rent notes are here."}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "caption", "text": "Do you see\nthe card I'm pointing at?"}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "point", "target": null}))).await.unwrap();
        for window in [&mut you, &mut other_tab, &mut ears] {
            let got = drain(window, 500).await;
            let shape = |m: &serde_json::Value| (m["type"].clone(), m["kind"].clone(), m["target"].clone(), m["text"].clone(), m["by"].clone());
            assert_eq!(
                got.iter().map(shape).collect::<Vec<_>>(),
                [
                    ("guide".into(), "point".into(), "thread:T1".into(), "Your rent notes are here.".into(), "Claude".into()),
                    ("guide".into(), "caption".into(), serde_json::Value::Null, "Do you see the card I'm pointing at?".into(), "Claude".into()),
                    ("guide".into(), "point".into(), serde_json::Value::Null, "".into(), "Claude".into()),
                ],
                "{got:?}"
            );
            assert!(got.iter().all(|m| m["at_ms"].as_u64().is_some_and(|at| at > 0) && m.get("from").is_none()), "{got:?}");
        }
        assert_eq!(drain(&mut claude, 300).await, Vec::<serde_json::Value>::new(), "never echoed to the window that sent it");

        // Refused: only the sender's own windows hear why (once a second at most), the others nothing.
        claude.send(send(serde_json::json!({"type": "point", "target": "thread:T1", "caption": "x".repeat(super::POINT_MAX + 1)}))).await.unwrap();
        let told = drain(&mut claude, 300).await;
        assert_eq!(told.len(), 1, "{told:?}");
        assert_eq!(told[0]["message"], "Not shown: A point's caption is 140 characters at most.");
        tokio::time::sleep(Duration::from_millis(1000)).await;
        claude.send(send(serde_json::json!({"type": "point", "target": "<img src=x>", "caption": "hi"}))).await.unwrap();
        assert_eq!(drain(&mut claude, 300).await[0]["message"], "Not shown: “<img src=x>” isn't the name of a part of the screen (docs/guide.md).");
        tokio::time::sleep(Duration::from_millis(1000)).await;
        claude.send(send(serde_json::json!({"type": "caption", "text": "y".repeat(super::CAPTION_MAX + 1)}))).await.unwrap();
        assert_eq!(drain(&mut claude, 300).await[0]["message"], "Not shown: A caption is 400 characters at most.");
        for window in [&mut you, &mut other_tab, &mut ears] {
            assert!(drain(window, 300).await.iter().all(|m| m["type"] != "guide"), "nothing refused reaches another window");
        }
        let caption_max = "y".repeat(super::CAPTION_MAX);
        claude.send(send(serde_json::json!({"type": "caption", "text": caption_max}))).await.unwrap();
        assert_eq!(next(&mut you, 500).await.unwrap()["text"], caption_max, "a caption at the cap is shown");

        // Past 4 a second from one window: the rest are dropped, and the sender hears why once.
        tokio::time::sleep(Duration::from_millis(1000)).await;
        for i in 0..10 {
            claude.send(send(serde_json::json!({"type": "point", "target": "composer", "caption": format!("step {i}")}))).await.unwrap();
        }
        let shown: Vec<_> = drain(&mut you, 500).await.into_iter().filter(|m| m["type"] == "guide").map(|m| m["text"].clone()).collect();
        assert_eq!(shown, ["step 0", "step 1", "step 2", "step 3"]);
        let told: Vec<_> = drain(&mut claude, 300).await.into_iter().map(|m| m["message"].clone()).collect();
        assert_eq!(told, ["Not shown: 4 a second at most."]);
        // A window's own pace: the person's window can still point (any window can), and Claude's other window sees it.
        you.send(send(serde_json::json!({"type": "point", "target": "mic", "caption": ""}))).await.unwrap();
        let seen = drain(&mut ears, 300).await;
        assert!(seen.iter().any(|m| m["type"] == "guide" && m["target"] == "mic" && m["by"] == "you"), "{seen:?}");

        // Nothing journaled, nothing on the map, nothing for the placer (so no model call).
        assert_eq!(journaled(), before, "never journaled");
        assert!(core.snapshot().thoughts.is_empty(), "nothing on the map");
        assert!(queue.try_recv().is_err(), "nothing queued for a model");
        let _ = std::fs::remove_file(&path);
    }

    /// A held question reaches every other window as it's sent, one line, with what it points at once asked (or
    /// nothing) and who holds it; no words take back that speaker's questions (no target with them). Too long, or a
    /// target that isn't a name: only the sender hears why. Never the journal, the map or a model.
    #[tokio::test]
    async fn a_held_question_reaches_every_other_window_and_nothing_else() {
        let (core, address, path, mut queue) = served().await;
        let journaled = || std::fs::read_to_string(&path).unwrap();
        let before = journaled();
        let [mut claude, mut ears, mut you] = windows(address, ["Claude", "Claude", ""]).await;

        claude.send(send(serde_json::json!({"type": "hold", "text": "Which Saturday?\nLena leaves on the 14th.", "target": "thread:T1"}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "hold", "text": "Bring chairs?", "urgent": true}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "hold", "text": "  ", "target": "thread:T1", "urgent": true}))).await.unwrap();
        for window in [&mut you, &mut ears] {
            let got = drain(window, 500).await;
            let shape = |m: &serde_json::Value| (m["type"].clone(), m["kind"].clone(), m["target"].clone(), m["text"].clone(), m["by"].clone());
            assert_eq!(
                got.iter().map(shape).collect::<Vec<_>>(),
                [
                    ("guide".into(), "hold".into(), "thread:T1".into(), "Which Saturday? Lena leaves on the 14th.".into(), "Claude".into()),
                    ("guide".into(), "hold".into(), serde_json::Value::Null, "Bring chairs?".into(), "Claude".into()),
                    ("guide".into(), "hold".into(), serde_json::Value::Null, "".into(), "Claude".into()),
                ],
                "{got:?}"
            );
            // Urgent (it jumps the line) only where it was asked for: not on a plain one, nor on taking them back.
            assert_eq!(got.iter().map(|m| m.get("urgent").cloned()).collect::<Vec<_>>(), [None, Some(serde_json::Value::Bool(true)), None], "{got:?}");
        }
        assert_eq!(drain(&mut claude, 300).await, Vec::<serde_json::Value>::new(), "never echoed to the window that sent it");

        // Refused: only the sender hears why; the others get nothing.
        tokio::time::sleep(Duration::from_millis(1000)).await;
        claude.send(send(serde_json::json!({"type": "hold", "text": "q".repeat(super::HOLD_MAX + 1)}))).await.unwrap();
        assert_eq!(drain(&mut claude, 300).await[0]["message"], "Not shown: A held question is 140 characters at most.");
        tokio::time::sleep(Duration::from_millis(1000)).await;
        claude.send(send(serde_json::json!({"type": "hold", "text": "Here?", "target": "<b>"}))).await.unwrap();
        assert_eq!(drain(&mut claude, 300).await[0]["message"], "Not shown: “<b>” isn't the name of a part of the screen (docs/guide.md).");
        assert!(drain(&mut you, 300).await.iter().all(|m| m["type"] != "guide"), "nothing refused reaches another window");
        let at_cap = "q".repeat(super::HOLD_MAX);
        claude.send(send(serde_json::json!({"type": "hold", "text": at_cap}))).await.unwrap();
        assert_eq!(next(&mut you, 500).await.unwrap()["text"], at_cap, "a question at the cap is held");

        assert_eq!(journaled(), before, "never journaled");
        assert!(core.snapshot().thoughts.is_empty(), "nothing on the map");
        assert!(queue.try_recv().is_err(), "nothing queued for a model");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn a_tour_reaches_every_other_window_in_order_and_nothing_else() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut claude, mut ears, mut you, mut other_tab] = windows(address, ["Claude", "Claude", "", ""]).await;
        let steps = serde_json::json!([
            {"target": "thread:T1", "text": "  Start\nhere.\t\u{7} "},
            {"text": "Then look around."},
            {"target": null, "text": "最后一步"}
        ]);
        claude.send(send(serde_json::json!({"type": "tour", "steps": steps}))).await.unwrap();
        // Once a recipient has the active tour, a newly connected window must not catch it up.
        let first = next(&mut ears, 500).await.unwrap();
        for window in [&mut you, &mut other_tab] {
            assert_eq!(next(window, 500).await.unwrap(), first, "the active tour reaches every recipient");
        }
        assert!(drain(&mut claude, 100).await.is_empty(), "no originating-window echo");
        let (mut reconnected, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Claude")).await.unwrap();
        let caught_up = drain(&mut reconnected, 100).await;
        assert!(caught_up.iter().any(|message| message["type"] == "snapshot"), "{caught_up:?}");
        assert!(caught_up.iter().all(|message| message["type"] != "tour"), "tours aren't retained for reconnect");
        // Reconnecting changes call presence. Consume that independent broadcast explicitly, so the relay and
        // no-echo assertions below still check every message produced by the tours themselves.
        for window in [&mut claude, &mut ears, &mut you, &mut other_tab] {
            let presence = drain(window, 100).await;
            assert_eq!(presence.len(), 1, "{presence:?}");
            assert_eq!(presence[0]["type"], "call", "{presence:?}");
        }
        claude.send(send(serde_json::json!({"type": "tour", "steps": [{"text": "Next tour."}]}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "tour", "steps": []}))).await.unwrap();
        let mut relayed = None;
        for window in [&mut you, &mut other_tab, &mut ears] {
            let mut got = vec![first.clone()];
            got.extend(drain(window, 100).await);
            let shape = |m: &serde_json::Value| (m["type"].clone(), m["steps"].clone(), m["by"].clone());
            assert_eq!(
                got.iter().map(shape).collect::<Vec<_>>(),
                [
                    ("tour".into(), serde_json::json!([
                        {"target": "thread:T1", "text": "Start here."},
                        {"target": null, "text": "Then look around."},
                        {"target": null, "text": "最后一步"}
                    ]), "Claude".into()),
                    ("tour".into(), serde_json::json!([{"target": null, "text": "Next tour."}]), "Claude".into()),
                    ("tour".into(), serde_json::json!([]), "Claude".into()),
                ],
                "{got:?}"
            );
            // As with points and captions, check the server timestamp separately from the ordered payload.
            for message in &got {
                assert!(message["at_ms"].as_u64().is_some_and(|at| at > 0));
                assert!(message.get("from").is_none());
                assert_eq!(message.as_object().unwrap().len(), 4);
            }
            if let Some(previous) = &relayed {
                assert_eq!(&got, previous, "all recipients get the same identity and timestamps");
            }
            relayed = Some(got);
        }
        assert!(drain(&mut claude, 100).await.is_empty(), "no originating-window echo");

        // An invalid later step must not leak the valid first one, even to another sender window.
        claude.send(send(serde_json::json!({"type": "tour", "steps": [
            {"text": "Must not escape."}, {"target": "<b>", "text": "Bad target."}
        ]}))).await.unwrap();
        for window in [&mut claude, &mut ears] {
            let got = drain(window, 100).await;
            assert_eq!(got.len(), 1, "{got:?}");
            assert_eq!(got[0]["type"], "notice");
            assert!(got[0]["message"].as_str().unwrap().starts_with("Not shown: "));
        }
        for window in [&mut you, &mut other_tab] {
            assert!(drain(window, 100).await.is_empty(), "other participants hear nothing refused");
        }

        assert_eq!(std::fs::read_to_string(&path).unwrap(), before, "never journaled");
        assert!(Arc::ptr_eq(&world, &core.snapshot()), "the entire map is unchanged");
        assert!(queue.try_recv().is_err(), "no model work");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn tour_limits_validate_the_whole_message_before_relay() {
        use super::Step;
        use crate::protocol::ServerMsg;
        let (core, path, mut queue) = prepared();
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let mut updates = core.updates.subscribe();
        let step = |text: String, target: Option<&str>| Step { text, target: target.map(str::to_string) };
        let cases = [
            (vec![step("界".repeat(140), None); 20], None),
            (vec![step("ok".into(), None); 21], Some("A tour has 20 steps at most.")),
            (vec![step("ok".into(), None), step(" \n\t\u{7} ".into(), None)], Some("A tour step needs words.")),
            (vec![step("ok".into(), None), step("界".repeat(141), None)], Some("A tour step is 140 characters at most.")),
            (vec![step("ok".into(), None), step("here".into(), Some("<b>"))], Some("“<b>” isn't the name of a part of the screen (docs/guide.md).")),
            (vec![step("here".into(), Some(""))], Some("“” isn't the name of a part of the screen (docs/guide.md).")),
            (vec![step(format!(" {} ", "界\n".repeat(70)), Some("composer"))], None),
            (vec![], None),
        ];
        for (steps, refusal) in cases {
            let mut pace = Pace::default();
            let count = steps.len();
            super::tour(&core, "Claude", 42, &mut pace, steps);
            let outgoing = updates.try_recv().unwrap();
            match (outgoing.message, refusal) {
                (ServerMsg::Notice { message }, Some(why)) => {
                    assert_eq!(outgoing.to.as_deref(), Some("Claude"));
                    assert_eq!(message, format!("Not shown: {why}"));
                    assert!(pace.sent.is_empty(), "invalid input doesn't consume the budget");
                }
                (ServerMsg::Tour { steps, by, at_ms, from }, None) => {
                    assert!(outgoing.to.is_none());
                    assert_eq!(steps.len(), count);
                    assert_eq!(by, "Claude");
                    assert_eq!(from, 42);
                    assert!(at_ms > 0);
                    assert!(steps.iter().all(|step| !step.text.is_empty() && step.text.chars().count() <= 140));
                    assert_eq!(pace.sent.len(), 1, "a whole tour is one message");
                }
                _ => panic!("unexpected relay or refusal"),
            }
            assert!(updates.try_recv().is_err(), "one atomic relay or notice, with no leaked steps");
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn tours_share_the_guide_budget() {
        use crate::protocol::ServerMsg;
        let (core, path, _) = prepared();
        let mut updates = core.updates.subscribe();
        let mut pace = Pace::default();
        super::tour(&core, "Claude", 42, &mut pace, vec![super::Step { target: None, text: "First".into() }; 20]);
        super::point(&core, "Claude", 42, &mut pace, Some("composer".into()), None);
        super::caption(&core, "Claude", 42, &mut pace, "Caption".into());
        super::hold(&core, "Claude", 42, &mut pace, "Question?".into(), None, false);
        assert!(matches!(updates.try_recv().unwrap().message, ServerMsg::Tour { .. }));
        for _ in 0..3 {
            assert!(matches!(updates.try_recv().unwrap().message, ServerMsg::Guide { .. }));
        }
        // Both a clear and an ordinary tour use the same allowance; repeated refusals are told only once.
        super::tour(&core, "Claude", 42, &mut pace, vec![]);
        super::tour(&core, "Claude", 42, &mut pace, vec![super::Step { target: None, text: "Later".into() }]);
        let refused = updates.try_recv().unwrap();
        assert_eq!(refused.to.as_deref(), Some("Claude"));
        assert!(matches!(refused.message, ServerMsg::Notice { message } if message == "Not shown: 4 a second at most."));
        assert!(updates.try_recv().is_err());

        // A full budget of tours also prevents a guide message, and a different window has its own budget.
        let mut pace = Pace::default();
        for _ in 0..PER_SECOND {
            super::tour(&core, "Claude", 43, &mut pace, vec![]);
            assert!(matches!(updates.try_recv().unwrap().message, ServerMsg::Tour { .. }));
        }
        super::caption(&core, "Claude", 43, &mut pace, "Too soon".into());
        assert!(matches!(updates.try_recv().unwrap().message, ServerMsg::Notice { .. }));

        let _ = std::fs::remove_file(&path);
    }
}
