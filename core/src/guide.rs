//! Pointing, captions and held questions: another participant (an AI joined with a name, e.g. `?name=Claude`) shows
//! the person one exact part of the screen, with an arrow and a one-line caption, says a line as a caption, or holds a
//! question for the person's next pause, instead of adding a thought to the map. All are of the moment: relayed as
//! they come to every window but the one that sent them, never journaled, and no model is asked. Each window keeps
//! its held questions and asks one when the person pauses (ui/src/guide-core.ts). The names are the window's
//! `data-guide` names (docs/guide.md); ui/src/Guide.tsx draws them.

use crate::protocol::ServerMsg;
use crate::Core;
use serde::Serialize;
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
/// A part's name, in characters: `composer`, `view:palace`, `point:th-` and 32 hex digits (41), with room to spare.
pub const NAME_MAX: usize = 100;
/// At most this many from one window in any second. Someone guiding sends about one a second; a point, its spoken
/// caption and taking the last point down can come at once (3). More is a script stuck in a loop.
pub const PER_SECOND: usize = 4;

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

/// One window's last second of points and captions, for `PER_SECOND`.
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
    let Some(name) = target else { return send(core, speaker, window, pace, Kind::Point, None, String::new(), None) };
    let caption = one_line(&caption.unwrap_or_default());
    let refused = bad_name(&name).or_else(|| too_long(&caption, POINT_MAX, "A point's caption"));
    send(core, speaker, window, pace, Kind::Point, Some(name), caption, refused);
}

/// `text` as a caption in the corner of the other windows, from `speaker`'s window `window`.
pub fn caption(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String) {
    let text = one_line(&text);
    let refused = if text.is_empty() { Some("A caption needs words.".to_string()) } else { too_long(&text, CAPTION_MAX, "A caption") };
    send(core, speaker, window, pace, Kind::Caption, None, text, refused);
}

/// `text`, a question for the other windows to hold until the person pauses and then ask, with an arrow at `target`
/// once asked if given; from `speaker`'s window `window`. No words take back this speaker's questions still held
/// (any target with them is left out, as with taking a point down).
pub fn hold(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String, target: Option<String>) {
    let text = one_line(&text);
    if text.is_empty() {
        return send(core, speaker, window, pace, Kind::Hold, None, text, None);
    }
    let refused = target.as_deref().and_then(bad_name).or_else(|| too_long(&text, HOLD_MAX, "A held question"));
    send(core, speaker, window, pace, Kind::Hold, target, text, refused);
}

#[allow(clippy::too_many_arguments)]
fn send(core: &Core, speaker: &str, window: u64, pace: &mut Pace, kind: Kind, target: Option<String>, text: String, refused: Option<String>) {
    let now = Instant::now();
    let refused = refused.or_else(|| (!pace.allow(now)).then(|| format!("{PER_SECOND} a second at most.")));
    if let Some(why) = refused {
        // Only to the sender's own windows, and once a second at most: the other windows see nothing.
        if pace.tell(now) {
            core.send_to(speaker, ServerMsg::Notice { message: format!("Not shown: {why}") });
        }
        return;
    }
    core.send(ServerMsg::Guide { kind, target, text, by: speaker.into(), at_ms: crate::now_ms(), from: window });
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
    /// must be), served on a free port: the core, its address, its journal's path and the placer's queue.
    async fn served() -> (Arc<Core>, std::net::SocketAddr, std::path::PathBuf, tokio::sync::mpsc::UnboundedReceiver<crate::placer::Job>) {
        let path = std::env::temp_dir().join(format!("e2a2o-guide-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("test".into()), ..Core::test(journal, world) });
        core.commit(vec![Change::ThreadAdded { thread: crate::world::fixtures::thread("T1", "Rent", 1) }]);
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
        claude.send(send(serde_json::json!({"type": "hold", "text": "Bring chairs?"}))).await.unwrap();
        claude.send(send(serde_json::json!({"type": "hold", "text": "  ", "target": "thread:T1"}))).await.unwrap();
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
}
