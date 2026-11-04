//! Pointing, captions, held questions and tours: another participant (an AI joined with a name, e.g. `?name=Claude`) shows
//! the person one exact part of the screen, with an arrow and a one-line caption, says a line as a caption, or holds a
//! question for the person's next pause, instead of adding a thought to the map. All are of the moment: relayed as
//! they come to every window but the one that sent them, never journaled, and no model is asked. Jobs also replay
//! their latest states to joining windows; answers go only to their recipient's windows. Each window keeps
//! its held questions and asks one when the person pauses (ui/src/guide-core.ts). The names are the window's
//! `data-guide` names (docs/guide.md); ui/src/Guide.tsx draws them.

use crate::protocol::ServerMsg;
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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

/// A live job update; identity and time are added by the server when relaying it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default)]
    pub demo: bool,
}

/// This core's latest jobs, ordered by first appearance and never persisted.
#[derive(Default)]
pub struct Runtime {
    jobs: Mutex<VecDeque<ServerMsg>>,
}

impl Runtime {
    /// Subscribe and capture replay under the publication lock: queued jobs are strictly after this replay.
    pub fn subscribe(&self, core: &Core) -> (tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>, Vec<ServerMsg>) {
        let jobs = self.jobs.lock().unwrap();
        (core.updates.subscribe(), jobs.iter().cloned().collect())
    }

    /// Replay without abandoning a lagged receiver's buffered answers and other ephemeral messages.
    /// Its pending jobs precede this replay; jobs published after the lock is released must still be forwarded.
    pub fn recover(&self, updates: &tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>) -> (usize, Vec<ServerMsg>) {
        let jobs = self.jobs.lock().unwrap();
        (updates.len(), jobs.iter().cloned().collect())
    }

    /// Validate ownership and capacity under the same lock as replacement, replay and broadcast.
    fn publish(&self, core: &Core, job: Job, speaker: &str, window: u64, pace: &mut Pace, refused: Option<String>) {
        let mut jobs = self.jobs.lock().unwrap();
        let row = jobs.iter().position(|message| matches!(message, ServerMsg::Job { job: old, .. } if old.id == job.id));
        let refused = refused.or_else(|| jobs.iter().find_map(|message| match message {
            ServerMsg::Job { job: old, by, .. }
                if by != speaker && (old.id == job.id || Some(&old.id) == job.parent.as_ref()) =>
                    Some(format!("That job belongs to {by}.")),
            _ => None,
        })).or_else(|| {
            if row.is_some() {
                None
            } else if jobs.iter().filter(|message| matches!(message, ServerMsg::Job { by, .. } if by == speaker)).count() >= 20 {
                Some("Each speaker can keep 20 jobs at most.".into())
            } else if jobs.len() >= 60 {
                Some("There is room for 60 jobs at most.".into())
            } else {
                None
            }
        });
        if !allowed(core, speaker, pace, refused) {
            return;
        }
        let message = ServerMsg::Job { job, by: speaker.into(), at_ms: crate::now_ms(), from: window };
        if let Some(row) = row {
            jobs[row] = message.clone();
        } else {
            jobs.push_back(message.clone());
        }
        // Keep the lock through broadcast so a join cannot queue an older job behind a newer replay.
        core.send(message);
    }
}

/// One window's last second of guide messages, tours, jobs and answers, for `PER_SECOND`.
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
#[cfg(test)]
pub fn caption(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String) {
    caption_speaking(core, speaker, window, pace, text, false);
}

pub fn caption_speaking(core: &Core, speaker: &str, window: u64, pace: &mut Pace, text: String, speak: bool) {
    let text = one_line(&text);
    let refused = if text.is_empty() { Some("A caption needs words.".to_string()) } else { too_long(&text, CAPTION_MAX, "A caption") };
    if allowed(core, speaker, pace, refused) {
        core.send_speaking(ServerMsg::Guide { reply_id: None, kind: Kind::Caption, target: None, text, by: speaker.into(), at_ms: crate::now_ms(), urgent: false, from: window }, speak);
    }
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

/// Retain a job's latest state and relay it to every other window, without starting model work.
pub fn job(core: &Core, speaker: &str, window: u64, pace: &mut Pace, mut job: Job) {
    job.title = one_line(&job.title);
    job.result = job.result.as_deref().map(one_line);
    let refused = bad_name(&job.id)
        .or_else(|| job.parent.as_deref().and_then(bad_name))
        .or_else(|| {
            if job.title.is_empty() {
                Some("A job needs a title.".into())
            } else {
                too_long(&job.title, 80, "A job's title")
            }
        })
        .or_else(|| job.result.as_deref().and_then(|result| too_long(result, 160, "A job's result")))
        .or_else(|| (!matches!(job.status.as_str(), "running" | "done" | "failed" | "waiting"))
            .then(|| "A job's status must be running, done, failed or waiting.".into()));
    core.guide.publish(core, job, speaker, window, pace, refused);
}

/// A job that couldn't be decoded uses the same refusal route without spending the window's budget.
pub fn malformed_job(core: &Core, speaker: &str, pace: &mut Pace) {
    allowed(core, speaker, pace, Some("A job needs string id, title and status; result and parent must be strings when given, and demo must be a boolean.".into()));
}

/// Answer a speaker in all of their windows, using room identities rather than screen-target names.
pub fn answer(core: &Core, speaker: &str, pace: &mut Pace, to: String, text: String) {
    let text = one_line(&text);
    let to = crate::normalized_speaker_name(&to);
    let refused = if to.is_empty() {
        Some("An answer needs a recipient.".into())
    } else if text.is_empty() {
        Some("An answer needs words.".into())
    } else {
        too_long(&text, 280, "An answer")
    };
    if allowed(core, speaker, pace, refused) {
        core.send_to(&to, ServerMsg::Answer { by: speaker.into(), text, at_ms: crate::now_ms() });
    }
}

/// An undecodable answer shares the guide refusal throttle and leaves the budget available.
pub fn malformed_answer(core: &Core, speaker: &str, pace: &mut Pace) {
    allowed(core, speaker, pace, Some("An answer needs string to and text.".into()));
}

#[allow(clippy::too_many_arguments)]
fn send(core: &Core, speaker: &str, window: u64, pace: &mut Pace, kind: Kind, target: Option<String>, text: String, urgent: bool, refused: Option<String>) {
    if allowed(core, speaker, pace, refused) {
        core.send(ServerMsg::Guide { reply_id: None, kind, target, text, by: speaker.into(), at_ms: crate::now_ms(), urgent, from: window });
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

    #[test]
    fn speech_flags_are_live_only_and_silent_messages_keep_their_wire_shape() {
        let (core, path, _) = prepared();
        let mut updates = core.updates.subscribe();
        super::caption_speaking(&core, "Claude", 42, &mut Pace::default(), "Speak this caption.".into(), true);
        let outgoing = updates.try_recv().unwrap();
        assert!(serde_json::to_string(&outgoing).unwrap().starts_with("{\"type\":\"guide\""), "the page's prefix dispatch remains valid");
        let caption = serde_json::to_value(outgoing).unwrap();
        assert_eq!(caption["speak"], true);
        assert_eq!(caption["kind"], "caption");
        assert!(caption.get("to").is_none() && caption.get("from").is_none());
        super::caption(&core, "Claude", 42, &mut Pace::default(), "Silent caption.".into());
        let silent = updates.try_recv().unwrap();
        assert_eq!(serde_json::to_value(&silent).unwrap(), serde_json::to_value(&silent.message).unwrap());
        core.take_turn("Claude", "This is a spoken thought.", true, true, true, None);
        let mut thoughts = Vec::new();
        while let Ok(update) = updates.try_recv() {
            if matches!(update.message, crate::protocol::ServerMsg::Change { change: Change::ThoughtAdded { .. } }) {
                thoughts.push(serde_json::to_value(update).unwrap());
            }
        }
        assert_eq!(thoughts.len(), 1);
        assert_eq!(thoughts[0]["speak"], true);
        let journal = std::fs::read_to_string(&path).unwrap();
        assert!(!journal.contains("\"speak\""));
        assert!(!journal.contains("Speak this caption"));
        assert!(crate::catch_up(&core, "avi2").iter().all(|m| serde_json::to_value(m).unwrap().get("speak").is_none()));
        for kind in ["caption", "text"] {
            assert!(serde_json::from_value::<crate::protocol::ClientMsg>(serde_json::json!({"type":kind,"text":"Old clients remain silent."})).is_ok());
        }
        let _ = std::fs::remove_file(path);
    }

    /// The bridge is local; avi2 reaches the same room over its HTTPS LAN address. Guide delivery is room-wide,
    /// while a live speech flag is never written to the journal or replayed to a reconnecting page.
    #[tokio::test]
    async fn bridge_voice_reaches_named_room_guests_without_replaying_speech() {
        use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue};
        let (core, path, queue) = prepared();
        let core = Arc::new(Core { room: Some(crate::Room::from("bridgevoice")), ..Arc::try_unwrap(core).ok().unwrap() });
        let routes = axum::Router::new()
            .route("/ws", axum::routing::get(crate::connect))
            .layer(axum::middleware::from_fn_with_state(core.clone(), crate::gate))
            // A loopback test socket cannot itself have a LAN peer or TLS. Supply the Link that the HTTPS listener
            // gives the gate in production, keeping admission, identity and forwarding on their real paths.
            .layer(axum::middleware::from_fn(|mut request: axum::extract::Request, next: axum::middleware::Next| async move {
                if request.uri().query().unwrap_or_default().contains("name=avi2") {
                    request.extensions_mut().insert(axum::extract::ConnectInfo(crate::Link {
                        from: "192.168.1.20:51000".parse().unwrap(), to: "192.168.1.179:4360".parse().unwrap(), tls: true,
                    }));
                }
                next.run(request).await
            }))
            .with_state(core.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, routes.into_make_service_with_connect_info::<crate::Link>()).await });
        let guest = || {
            let mut request = format!("ws://{address}/ws?name=avi2&room=bridgevoice").into_client_request().unwrap();
            request.headers_mut().insert("host", HeaderValue::from_static("192.168.1.179:4360"));
            request.headers_mut().insert("origin", HeaderValue::from_static("https://192.168.1.179:4360"));
            request
        };
        let (mut claude, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Claude&ai")).await.unwrap();
        let (mut host, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=User")).await.unwrap();
        let (mut avi2, _) = tokio_tungstenite::connect_async(guest()).await.unwrap();
        for window in [&mut claude, &mut host, &mut avi2] { drain(window, 30).await; }
        let before = std::fs::read_to_string(&path).unwrap();
        for payload in [
            serde_json::json!({"type":"caption", "text":"Here is the answer.", "speak":true}),
            serde_json::json!({"type":"point", "target":"composer", "caption":"Type here."}),
            serde_json::json!({"type":"hold", "text":"Shall we continue?", "target":"mic"}),
        ] { claude.send(send(payload)).await.unwrap(); }
        let shown = drain(&mut host, 30).await;
        assert_eq!(drain(&mut avi2, 30).await, shown);
        assert_eq!(shown.len(), 3);
        assert_eq!(shown[0]["speak"], true);
        assert_eq!(shown[1]["kind"], "point");
        assert_eq!(shown[2]["kind"], "hold");
        assert!(shown.iter().all(|m| m["by"] == "Claude" && m.get("to").is_none() && m.get("from").is_none()));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        claude.send(send(serde_json::json!({"type":"text", "text":"I think the answer belongs here.", "speak":true}))).await.unwrap();
        let live = drain(&mut avi2, 30).await;
        let thought = live.iter().find(|m| m["change"]["type"] == "thought_added").unwrap();
        assert_eq!(thought["speak"], true);
        assert_eq!(thought["change"]["thought"]["speaker"], "Claude");
        let journal = std::fs::read_to_string(&path).unwrap();
        assert!(!journal.contains("\"speak\""), "playback is never journaled");
        assert!(!core.hosts.lock().unwrap().contains("avi2"), "exercise a genuine guest identity");
        let (mut rejoined, _) = tokio_tungstenite::connect_async(guest()).await.unwrap();
        let replay = drain(&mut rejoined, 30).await;
        assert!(replay.iter().any(|m| m["type"] == "snapshot"));
        assert!(replay.iter().all(|m| m.get("speak").is_none() && m["type"] != "guide"));
        drop(queue);
        server.abort();
        let _ = std::fs::remove_file(path);
    }

    /// Accepted updates from independent window budgets, for replay tests that fill the retained rows.
    fn publish(core: &Core, id: &str, revision: usize) {
        publish_as(core, "Helper", id, revision);
    }

    fn job_row(id: &str, revision: usize) -> super::Job {
        super::Job {
            id: id.into(), title: format!("Revision {revision}"), status: "running".into(),
            result: Some(revision.to_string()), parent: None, demo: false,
        }
    }

    fn publish_as(core: &Core, speaker: &str, id: &str, revision: usize) {
        super::job(core, speaker, 0, &mut Pace::default(), job_row(id, revision));
    }

    fn retained_jobs(core: &Core) -> Vec<serde_json::Value> {
        crate::subscribe_catch_up(core, "you").1.into_iter()
            .filter(|message| matches!(message, crate::protocol::ServerMsg::Job { .. }))
            .map(|message| serde_json::to_value(message).unwrap()).collect()
    }

    /// A refusal is private and throttled, spends no pacing slots and changes neither live jobs nor replay.
    fn refused_job(core: &Core, speaker: &str, job: super::Job, why: &str) {
        let before = retained_jobs(core);
        let (mut updates, _) = crate::subscribe_catch_up(core, "you");
        let mut pace = Pace::default();
        super::job(core, speaker, 99, &mut pace, job.clone());
        let outgoing = updates.try_recv().unwrap();
        assert_eq!(outgoing.to.as_deref(), Some(speaker));
        assert!(matches!(outgoing.message, crate::protocol::ServerMsg::Notice { message } if message == format!("Not shown: {why}")));
        super::job(core, speaker, 99, &mut pace, job);
        assert!(updates.try_recv().is_err(), "no live job and only one notice");
        assert!(pace.sent.is_empty(), "refusals leave the guide budget available");
        assert_eq!(retained_jobs(core), before, "refusals preserve every replay field");
    }

    #[test]
    fn jobs_require_ownership_of_both_id_and_retained_parent() {
        let (core, path, _) = prepared();
        publish_as(&core, "First", "parent", 0);
        publish_as(&core, "Second", "owned", 0);
        refused_job(&core, "Second", job_row("parent", 1), "That job belongs to First.");
        for id in ["new", "owned"] {
            let mut job = job_row(id, 1);
            job.parent = Some("parent".into());
            refused_job(&core, "Second", job, "That job belongs to First.");
        }
        let mut stolen = job_row("owned", 1);
        stolen.parent = Some("parent".into());
        refused_job(&core, "First", stolen, "That job belongs to Second.");

        let (mut updates, _) = crate::subscribe_catch_up(&core, "you");
        for (id, parent) in [("child", "parent"), ("child", "parent"), ("early", "later"), ("later", "parent")] {
            let mut job = job_row(id, 2);
            job.parent = Some(parent.into());
            super::job(&core, "First", 42, &mut Pace::default(), job);
            let outgoing = updates.try_recv().unwrap();
            assert!(outgoing.to.is_none());
            assert!(matches!(outgoing.message, crate::protocol::ServerMsg::Job { job, by, at_ms, from }
                if job.id == id && job.parent.as_deref() == Some(parent) && by == "First" && at_ms > 0 && from == 42));
        }
        assert!(updates.try_recv().is_err());
        let jobs = retained_jobs(&core);
        assert_eq!(jobs.iter().map(|job| job["id"].as_str().unwrap()).collect::<Vec<_>>(), ["parent", "owned", "child", "early", "later"]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_speakers_quota_cannot_displace_another_speakers_waiting_job() {
        let (core, path, _) = prepared();
        let mut waiting = job_row("waiting", 0);
        waiting.status = "waiting".into();
        super::job(&core, "Quiet", 7, &mut Pace::default(), waiting);
        let waiting = retained_jobs(&core)[0].clone();
        for i in 0..19 { publish_as(&core, "Flood", &format!("job:{i}"), i); }
        assert_eq!(retained_jobs(&core).len(), 20);
        publish_as(&core, "Flood", "job:19", 19);
        let before = retained_jobs(&core);
        assert_eq!(before.len(), 21, "the twentieth owned id is accepted");
        refused_job(&core, "Flood", job_row("job:20", 20), "Each speaker can keep 20 jobs at most.");
        let (mut updates, _) = crate::subscribe_catch_up(&core, "you");
        for i in 21..200 { publish_as(&core, "Flood", &format!("job:{i}"), i); }
        while let Ok(outgoing) = updates.try_recv() {
            assert_eq!(outgoing.to.as_deref(), Some("Flood"));
            assert!(matches!(outgoing.message, crate::protocol::ServerMsg::Notice { .. }));
        }
        assert_eq!(retained_jobs(&core), before, "fresh ids cannot remove waiting work");
        publish_as(&core, "Flood", "job:0", 200);
        assert!(matches!(updates.try_recv().unwrap().message, crate::protocol::ServerMsg::Job { job, by, .. }
            if job.id == "job:0" && job.result.as_deref() == Some("200") && by == "Flood"));
        let jobs = retained_jobs(&core);
        assert_eq!(jobs.len(), 21);
        assert_eq!(jobs[0], waiting, "the other speaker's status and attribution remain intact");
        assert_eq!(jobs[1]["id"], "job:0", "owned updates at quota keep their position");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn concurrent_job_claims_retain_one_owner_without_foreign_replacement() {
        use crate::protocol::ServerMsg;
        let (core, path, _) = prepared();
        let (mut updates, _) = crate::subscribe_catch_up(&core, "you");
        let barrier = std::sync::Barrier::new(16);
        std::thread::scope(|scope| {
            for n in 0..16 {
                let core = &core;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    for revision in 0..8 {
                        super::job(core, &format!("Helper{n}"), n, &mut Pace::default(), job_row("shared", revision));
                        std::thread::yield_now();
                    }
                });
            }
        });
        let jobs = retained_jobs(&core);
        assert_eq!(jobs.len(), 1);
        let owner = jobs[0]["by"].as_str().unwrap();
        assert_eq!(jobs[0]["result"], "7");
        let mut accepted = 0;
        let mut refused = 0;
        while let Ok(outgoing) = updates.try_recv() {
            match outgoing.message {
                ServerMsg::Job { job, by, from, .. } => {
                    assert_eq!(by, owner, "every live replacement belongs to the first claimant");
                    assert_eq!(by, format!("Helper{from}"), "server attribution follows the accepted sender");
                    assert_eq!(job.result, Some(accepted.to_string()));
                    accepted += 1;
                }
                ServerMsg::Notice { message } => {
                    assert_ne!(outgoing.to.as_deref(), Some(owner));
                    assert_eq!(message, format!("Not shown: That job belongs to {owner}."));
                    refused += 1;
                }
                _ => panic!("only jobs and private refusals expected"),
            }
        }
        assert_eq!(accepted, 8);
        assert_eq!(refused, 15 * 8);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn concurrent_new_jobs_cannot_exceed_speaker_or_total_capacity() {
        use crate::protocol::ServerMsg;
        for total in [false, true] {
            let (core, path, _) = prepared();
            let count = if total { 59 } else { 19 };
            for i in 0..count {
                let speaker = if total { ["First", "Second", "Third"][i / 20] } else { "Helper" };
                publish_as(&core, speaker, &format!("kept:{i}"), i);
            }
            let before = retained_jobs(&core);
            let (mut updates, _) = crate::subscribe_catch_up(&core, "you");
            let barrier = std::sync::Barrier::new(8);
            std::thread::scope(|scope| {
                for n in 0..8 {
                    let core = &core;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        let speaker = if total { format!("Claim{n}") } else { "Helper".into() };
                        barrier.wait();
                        publish_as(core, &speaker, &format!("new:{n}"), n);
                    });
                }
            });
            let jobs = retained_jobs(&core);
            assert_eq!(jobs.len(), count + 1, "exactly one concurrent insertion fits");
            assert_eq!(&jobs[..count], before, "no retained work is displaced");
            let mut accepted = 0;
            let mut refused = 0;
            while let Ok(outgoing) = updates.try_recv() {
                match outgoing.message {
                    ServerMsg::Job { .. } => accepted += 1,
                    ServerMsg::Notice { message } => {
                        let why = if total { "There is room for 60 jobs at most." } else { "Each speaker can keep 20 jobs at most." };
                        assert_eq!(message, format!("Not shown: {why}"));
                        assert!(outgoing.to.is_some());
                        refused += 1;
                    }
                    _ => panic!("only jobs and private refusals expected"),
                }
            }
            assert_eq!((accepted, refused), (1, 7));
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn concurrent_job_handoffs_and_lag_recovery_keep_only_newer_updates() {
        use crate::protocol::ServerMsg;
        let (core, path, _) = prepared();
        publish(&core, "work", 0);
        let barrier = std::sync::Barrier::new(2);
        let handoffs = std::thread::scope(|scope| {
            let writer = scope.spawn(|| {
                barrier.wait();
                for revision in 1..=256 {
                    publish(&core, "work", revision);
                    std::thread::yield_now();
                }
            });
            barrier.wait();
            let mut handoffs = Vec::new();
            for _ in 0..64 {
                handoffs.push(crate::subscribe_catch_up(&core, "you"));
                std::thread::yield_now();
            }
            writer.join().unwrap();
            handoffs
        });
        for (mut updates, replay) in handoffs {
            let mut revision: usize = replay.into_iter().find_map(|message| match message {
                ServerMsg::Job { job, .. } => job.result, _ => None,
            }).unwrap().parse().unwrap();
            while let Ok(outgoing) = updates.try_recv() {
                let ServerMsg::Job { job, .. } = outgoing.message else { continue };
                let next = job.result.unwrap().parse().unwrap();
                assert_eq!(next, revision + 1, "no missed, repeated or older updates after replay");
                revision = next;
            }
            assert_eq!(revision, 256);
        }
        let (mut lagged, _) = crate::subscribe_catch_up(&core, "you");
        for revision in 257..=1400 { publish(&core, "work", revision); }
        super::answer(&core, "Helper", &mut Pace::default(), "you".into(), "Buffered answer".into());
        assert!(matches!(lagged.try_recv(), Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_))));
        // Recovery marks queued jobs as superseded while preserving this receiver for non-jobs.
        let (pending, replay) = core.guide.recover(&lagged);
        assert!(replay.iter().any(|message| matches!(message, ServerMsg::Job { job, .. } if job.result.as_deref() == Some("1400"))));
        lagged.try_recv().unwrap();
        publish(&core, "work", 1401);
        let mut answers = 0;
        for _ in 1..pending {
            let outgoing = lagged.try_recv().unwrap();
            if let ServerMsg::Answer { text, .. } = outgoing.message {
                assert_eq!(outgoing.to.as_deref(), Some("you"));
                assert_eq!(text, "Buffered answer");
                answers += 1;
            }
        }
        assert_eq!(answers, 1, "recovery must preserve the buffered answer exactly once");
        assert!(matches!(lagged.try_recv().unwrap().message, ServerMsg::Job { job, .. } if job.result.as_deref() == Some("1401")));
        assert!(lagged.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn lag_recovery_preserves_buffered_answers_and_skips_superseded_jobs() {
        let (core, path, _) = prepared();
        // Start the real window's forwarder with a deterministically lagged subscription.
        let routes = axum::Router::new().route("/ws", axum::routing::get(
            |ws: axum::extract::WebSocketUpgrade, axum::extract::State(core): axum::extract::State<Arc<Core>>| async move {
                ws.on_upgrade(move |socket| async move {
                    let (updates, _) = crate::subscribe_catch_up(&core, "you");
                    for revision in 0..1100 { publish(&core, "work", revision); }
                    super::answer(&core, "Helper", &mut Pace::default(), "you".into(), "Buffered answer".into());
                    super::answer(&core, "Helper", &mut Pace::default(), "Other".into(), "Private answer".into());
                    super::caption(&core, "Helper", 8, &mut Pace::default(), "Buffered caption".into());
                    super::caption(&core, "you", 7, &mut Pace::default(), "Own caption".into());
                    core.send_to("you", crate::protocol::ServerMsg::Notice { message: "Buffered notice".into() });
                    let (out, _incoming) = socket.split();
                    crate::forward(out, updates, core, "you".into(), 7).await;
                })
            }
        )).with_state(core.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, routes).await.unwrap() });
        let (mut window, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws")).await.unwrap();
        let messages = drain(&mut window, 100).await;
        let jobs: Vec<_> = messages.iter().filter(|m| m["type"] == "job").collect();
        assert_eq!(jobs.len(), 1, "buffered older jobs must not follow the replay");
        assert_eq!(jobs[0]["result"], "1099");
        let ephemeral: Vec<_> = messages.iter().filter(|m| matches!(m["type"].as_str(), Some("answer" | "guide" | "notice")))
            .map(|m| (m["type"].as_str().unwrap(), m["text"].as_str().or(m["message"].as_str()).unwrap())).collect();
        assert_eq!(ephemeral, [("answer", "Buffered answer"), ("guide", "Buffered caption"), ("notice", "Buffered notice")]);
        // Updates after the replay boundary still arrive once, in order.
        publish(&core, "work", 1100);
        super::answer(&core, "Helper", &mut Pace::default(), "you".into(), "Live answer".into());
        let live = drain(&mut window, 100).await;
        assert_eq!(live.len(), 2);
        assert_eq!(live[0]["result"], "1100");
        assert_eq!(live[1]["text"], "Live answer");
        server.abort();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn answers_use_room_identities_and_share_the_guide_budget() {
        use crate::protocol::ServerMsg;
        let (core, path, mut queue) = prepared();
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let mut updates = core.updates.subscribe();
        let mut pace = Pace::default();
        super::answer(&core, "Helper", &mut pace, " \n\u{7}".into(), "Yes".into());
        assert!(matches!(updates.try_recv().unwrap().message, ServerMsg::Notice { .. }));
        super::malformed_answer(&core, "Helper", &mut pace);
        super::answer(&core, "Helper", &mut pace, "Asker".into(), "界".repeat(281));
        assert!(updates.try_recv().is_err(), "invalid input shares the refusal throttle");
        assert!(pace.sent.is_empty());
        for recipient in ["  Sam\n界!\u{7} ".to_string(), "x".repeat(25), "you".into(), "Guest".into()] {
            super::answer(&core, "Helper", &mut pace, recipient.clone(), format!(" \n{}\t", "界".repeat(280)));
            let outgoing = updates.try_recv().unwrap();
            assert_eq!(outgoing.to, Some(crate::speaker_name(&recipient, true)));
            assert!(matches!(outgoing.message, ServerMsg::Answer { by, text, at_ms } if by == "Helper" && text == "界".repeat(280) && at_ms > 0));
        }
        super::caption(&core, "Helper", 0, &mut pace, "Too soon".into());
        super::answer(&core, "Helper", &mut pace, "Asker".into(), "Too soon".into());
        assert!(updates.try_recv().is_err(), "answers spend the shared guide budget");
        assert!(crate::catch_up(&core, "Asker").iter().all(|m| !matches!(m, ServerMsg::Answer { .. })));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn jobs_replay_in_first_appearance_order_with_the_last_accepted_state() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut helper, mut you] = windows(address, ["Helper", ""]).await;
        for (id, status) in [("first", "running"), ("second", "waiting"), ("first", "done"), ("third", "failed")] {
            helper.send(send(serde_json::json!({"type": "job", "id": id, "title": id, "status": status}))).await.unwrap();
        }
        let live = drain(&mut you, 100).await;
        assert_eq!(live.len(), 4);
        // Neither an invalid update nor a valid but paced update may replace retained state.
        helper.send(send(serde_json::json!({"type": "job", "id": "first", "title": "", "status": "running"}))).await.unwrap();
        helper.send(send(serde_json::json!({"type": "job", "id": "first", "title": "Too soon", "status": "running"}))).await.unwrap();
        assert_eq!(next(&mut helper, 500).await.unwrap()["type"], "notice");
        let (mut joined, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Helper")).await.unwrap();
        let replay = drain(&mut joined, 100).await;
        let snapshot = replay.iter().position(|m| m["type"] == "snapshot").unwrap();
        assert!(replay.iter().enumerate().filter(|(_, m)| m["type"] == "job").all(|(i, _)| i > snapshot));
        let jobs: Vec<_> = replay.into_iter().filter(|m| m["type"] == "job").collect();
        assert_eq!(jobs, [live[2].clone(), live[1].clone(), live[3].clone()], "original attribution, timestamp and flat payload replay unchanged, even to the sender's identity");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        // Reopening the same journal creates a new runtime with no retained jobs.
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let reopened = Core::test(journal, world);
        assert!(crate::catch_up(&reopened, "you").iter().all(|m| !matches!(m, crate::protocol::ServerMsg::Job { .. })));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn job_replay_caps_distinct_rows_without_moving_updates() {
        let (core, path, _) = prepared();
        let (mut updates, _) = crate::subscribe_catch_up(&core, "you");
        let speakers = ["First", "Second", "Third"];
        for i in 0..60 {
            publish_as(&core, speakers[i / 20], &format!("job:{i}"), i);
        }
        publish_as(&core, "First", "job:0", 100);
        let mut live = Vec::new();
        while let Ok(outgoing) = updates.try_recv() {
            live.push(serde_json::to_value(outgoing.message).unwrap());
        }
        assert_eq!(live.len(), 61);
        let jobs = retained_jobs(&core);
        assert_eq!(jobs.len(), 60);
        assert_eq!(jobs[0], live[60], "updating the oldest row keeps it first");
        assert_eq!(&jobs[1..], &live[1..60]);
        refused_job(&core, "Fourth", job_row("job:60", 60), "There is room for 60 jobs at most.");
        publish_as(&core, "First", "job:2", 200);
        publish_as(&core, "First", "job:0", 300);
        let jobs = retained_jobs(&core);
        assert_eq!(jobs.len(), 60);
        for (i, job) in jobs.iter().enumerate() {
            assert_eq!(job["id"], format!("job:{i}"), "a refused 61st id leaves every row in its original position");
            assert_eq!(job["by"], speakers[i / 20]);
        }
        assert_eq!(jobs[0]["result"], "300");
        assert_eq!(jobs[2]["result"], "200");
        assert_eq!(&jobs[3..], &live[3..60], "updates at capacity leave other rows and their server stamps intact");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn job_updates_and_join_handoff_never_miss_or_reverse_state() {
        let (core, address, path, _) = served().await;
        publish(&core, "work", 0);
        // Exercise both sides of the handoff without relying on socket timing.
        let (mut updates, replay) = crate::subscribe_catch_up(&core, "you");
        publish(&core, "work", 1);
        let last = replay.into_iter().find_map(|m| match m {
            crate::protocol::ServerMsg::Job { job, .. } => job.result, _ => None,
        });
        assert_eq!(last.as_deref(), Some("0"));
        assert!(matches!(updates.try_recv().unwrap().message, crate::protocol::ServerMsg::Job { job, .. } if job.result.as_deref() == Some("1")));
        let (mut updates, replay) = crate::subscribe_catch_up(&core, "you");
        assert!(replay.iter().any(|m| matches!(m, crate::protocol::ServerMsg::Job { job, .. } if job.result.as_deref() == Some("1"))));
        assert!(updates.try_recv().is_err(), "pre-replay updates must not remain queued");

        let writer = tokio::spawn({
            let core = core.clone();
            async move {
                for i in 2..=200 {
                    publish(&core, "work", i);
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            }
        });
        let mut joining = Vec::new();
        for _ in 0..8 {
            let (window, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws")).await.unwrap();
            joining.push(window);
        }
        writer.await.unwrap();
        for window in &mut joining {
            let messages = drain(window, 50).await;
            let revisions: Vec<usize> = messages.iter().filter(|m| m["type"] == "job")
                .map(|m| m["result"].as_str().unwrap().parse().unwrap()).collect();
            assert_eq!(revisions.last(), Some(&200), "a join must receive the final accepted state");
            assert!(revisions.windows(2).all(|pair| pair[0] < pair[1]), "no older state or duplicate after replay: {revisions:?}");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn answers_reach_only_the_askers_windows_with_server_attribution() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut helper, mut ears, mut asker, mut asker_tab, mut unrelated, mut you] =
            windows(address, ["Helper", "Helper", "Sam%20%E7%95%8C!", "Sam%20%E7%95%8C!", "Other", ""]).await;
        let started = crate::now_ms();
        helper.send(send(serde_json::json!({"type": "answer", "to": "  Sam\n 界!\u{7} ", "text": "  Yes\n this\t one\u{7} ", "by": "Spoof", "at_ms": 1}))).await.unwrap();
        let shown = next(&mut asker, 500).await.unwrap();
        let at = shown["at_ms"].as_u64().unwrap();
        assert!((started..=crate::now_ms()).contains(&at));
        assert_eq!(shown, serde_json::json!({"type": "answer", "by": "Helper", "text": "Yes this one", "at_ms": at}));
        assert_eq!(next(&mut asker_tab, 500).await.unwrap(), shown);
        // A name with spaces, Unicode and punctuation is a speaker identity, not a screen target.
        helper.send(send(serde_json::json!({"type": "answer", "to": "Sam 界!", "text": "界".repeat(280)}))).await.unwrap();
        let shown = next(&mut asker, 500).await.unwrap();
        assert_eq!(shown["text"], "界".repeat(280), "the limit counts normalized characters, not bytes");
        assert_eq!(next(&mut asker_tab, 500).await.unwrap(), shown);
        for window in [&mut helper, &mut ears, &mut unrelated, &mut you] {
            assert!(drain(window, 50).await.is_empty(), "other speakers receive no answer");
        }
        helper.send(send(serde_json::json!({"type": "answer", "to": "you", "text": "Host"}))).await.unwrap();
        assert_eq!(next(&mut you, 500).await.unwrap()["text"], "Host");
        helper.send(send(serde_json::json!({"type": "answer", "to": "Helper", "text": "Self"}))).await.unwrap();
        let shown = next(&mut helper, 500).await.unwrap();
        assert_eq!(shown["text"], "Self");
        assert_eq!(next(&mut ears, 500).await.unwrap(), shown, "all recipient windows, including the origin");
        let (mut joined, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Sam%20%E7%95%8C!")).await.unwrap();
        assert!(drain(&mut joined, 50).await.iter().all(|m| m["type"] != "answer"), "answers aren't retained");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn invalid_answers_and_malformed_fields_share_refusals_and_pacing() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut ears, mut recipient, mut unrelated] = windows(address, ["Helper", "Asker", ""]).await;
        let valid = serde_json::json!({"type": "answer", "to": "Asker", "text": "Yes"});
        let mut invalid = vec![
            (serde_json::json!({"type": "answer", "to": "", "text": "Yes"}), "An answer needs a recipient."),
            (serde_json::json!({"type": "answer", "to": " \n\u{7} ", "text": "Yes"}), "An answer needs a recipient."),
            (serde_json::json!({"type": "answer", "to": "Asker", "text": " \t\n\u{7}"}), "An answer needs words."),
            (serde_json::json!({"type": "answer", "to": "Asker", "text": "界".repeat(281)}), "An answer is 280 characters at most."),
        ];
        for field in ["to", "text"] {
            let mut missing = valid.clone();
            missing.as_object_mut().unwrap().remove(field);
            invalid.push((missing, "An answer needs string to and text."));
            for value in [serde_json::Value::Null, serde_json::json!(42), serde_json::json!(false), serde_json::json!([]), serde_json::json!({})] {
                let mut payload = valid.clone();
                payload[field] = value;
                invalid.push((payload, "An answer needs string to and text."));
            }
        }
        for (payload, why) in invalid {
            let (mut origin, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Helper")).await.unwrap();
            drain(&mut origin, 20).await;
            for window in [&mut ears, &mut recipient, &mut unrelated] { drain(window, 20).await; }
            origin.send(send(payload.clone())).await.unwrap();
            origin.send(send(payload.clone())).await.unwrap();
            // Invalid guides and jobs share the same notice throttle, and leave all four slots available.
            origin.send(send(serde_json::json!({"type": "caption", "text": ""}))).await.unwrap();
            origin.send(send(serde_json::json!({"type": "job"}))).await.unwrap();
            for message in [
                valid.clone(),
                serde_json::json!({"type": "point", "target": "composer"}),
                serde_json::json!({"type": "tour", "steps": []}),
                serde_json::json!({"type": "job", "id": "work", "title": "Working", "status": "running"}),
                valid.clone(),
                serde_json::json!({"type": "job", "id": "rejected", "title": "Too soon", "status": "done"}),
                serde_json::json!({"type": "hold", "text": "Too soon?"}),
            ] {
                origin.send(send(message)).await.unwrap();
            }
            let notice = next(&mut origin, 500).await.unwrap();
            assert_eq!(notice, serde_json::json!({"type": "notice", "message": format!("Not shown: {why}")}), "{payload}");
            assert!(drain(&mut origin, 20).await.is_empty(), "all refusals share one throttle");
            let heard = drain(&mut ears, 20).await;
            assert_eq!(heard[0], notice);
            assert_eq!(heard.iter().skip(1).map(|m| m["type"].as_str().unwrap()).collect::<Vec<_>>(), ["guide", "tour", "job"]);
            let heard = drain(&mut recipient, 20).await;
            assert_eq!(heard.iter().map(|m| m["type"].as_str().unwrap()).collect::<Vec<_>>(), ["answer", "guide", "tour", "job"], "{payload}: {heard:?}");
            assert_eq!(heard[0]["text"], "Yes");
            let other = drain(&mut unrelated, 20).await;
            assert_eq!(other, heard[1..], "unrelated windows get no answers or notices");
        }
        let retained: Vec<_> = crate::catch_up(&core, "you").into_iter().filter_map(|m| match m {
            crate::protocol::ServerMsg::Job { job, .. } => Some(job.id), _ => None,
        }).collect();
        assert_eq!(retained, ["work"], "rejected jobs and answers never enter retention");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn live_jobs_relay_to_other_windows() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut claude, mut ears, mut you, mut other_tab] = windows(address, ["Claude", "Claude", "", ""]).await;
        let started = crate::now_ms();
        let jobs = [
            serde_json::json!({"id": "work:1", "title": "Starting", "status": "running"}),
            serde_json::json!({"id": "x".repeat(100), "title": "  Finished\nthis\t\u{7} ", "status": "done",
                "result": "  Ready\n to\tread\u{7} ", "parent": "p".repeat(100), "demo": true}),
            serde_json::json!({"id": "work:1", "title": "界".repeat(80), "status": "failed", "result": "界".repeat(160)}),
            serde_json::json!({"id": "work:1", "title": "Waiting", "status": "waiting", "result": " \n\u{7} ", "parent": null, "demo": false}),
        ];
        for mut payload in jobs.clone() {
            payload["type"] = "job".into();
            // These fields belong to the server, even when a client supplies them.
            payload["by"] = "Someone else".into();
            payload["at_ms"] = 1.into();
            payload["from"] = 1.into();
            claude.send(send(payload)).await.unwrap();
        }
        let mut relayed = None;
        for window in [&mut you, &mut other_tab, &mut ears] {
            let got = drain(window, 100).await;
            assert_eq!(got.len(), 4, "{got:?}");
            let mut expected = jobs.clone();
            expected[1]["title"] = "Finished this".into();
            expected[1]["result"] = "Ready to read".into();
            expected[3]["result"] = "".into();
            expected[3].as_object_mut().unwrap().remove("parent");
            for (message, mut payload) in got.iter().zip(expected) {
                payload["type"] = "job".into();
                payload["by"] = "Claude".into();
                if payload.get("demo").is_none() { payload["demo"] = false.into(); }
                let at = message["at_ms"].as_u64().unwrap();
                assert!((started..=crate::now_ms()).contains(&at), "server-owned timestamp: {message}");
                payload["at_ms"] = at.into();
                assert_eq!(message, &payload, "flat fields, server-owned identity and no internal origin");
            }
            if let Some(previous) = &relayed {
                assert_eq!(&got, previous, "every recipient gets the same updates");
            }
            relayed = Some(got);
        }
        assert!(drain(&mut claude, 100).await.is_empty(), "no echo to the originating window");

        claude.send(send(serde_json::json!({"type": "job", "id": "<b>", "title": "Refused", "status": "done"}))).await.unwrap();
        for window in [&mut claude, &mut ears] {
            let got = drain(window, 100).await;
            assert_eq!(got.len(), 1, "{got:?}");
            assert_eq!(got[0]["type"], "notice");
            assert!(got[0]["message"].as_str().unwrap().starts_with("Not shown: "));
        }
        for window in [&mut you, &mut other_tab] {
            assert!(drain(window, 100).await.is_empty(), "only the sender's windows hear a refusal");
        }

        let (mut reconnected, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Claude")).await.unwrap();
        let caught_up = drain(&mut reconnected, 100).await;
        assert!(caught_up.iter().any(|message| message["type"] == "snapshot"));
        let replay: Vec<_> = caught_up.into_iter().filter(|message| message["type"] == "job").collect();
        let relayed = relayed.unwrap();
        assert_eq!(replay, [relayed[3].clone(), relayed[1].clone()],
            "reconnect replays the last accepted states in first-appearance order with their original server attribution");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before, "never journaled");
        assert!(Arc::ptr_eq(&world, &core.snapshot()), "the entire map is unchanged");
        assert!(queue.try_recv().is_err(), "no model work");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn invalid_jobs_are_refused() {
        use crate::protocol::{ClientMsg, ServerMsg};
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let mut updates = core.updates.subscribe();
        let mut cases = Vec::new();
        for field in ["id", "parent"] {
            for name in ["", "bad name", "<b>", "job\n", "a\"b", &"x".repeat(101), "界"] {
                cases.push((field, name.to_string(), bad_name(name).unwrap()));
            }
        }
        cases.extend([
            ("title", " \n\t\u{7} ".into(), "A job needs a title.".into()),
            ("title", "界".repeat(81), "A job's title is 80 characters at most.".into()),
            ("result", "界".repeat(161), "A job's result is 160 characters at most.".into()),
        ]);
        for status in ["", "Running", "DONE", " running", "done ", "cancelled", "unknown"] {
            cases.push(("status", status.into(), "A job's status must be running, done, failed or waiting.".into()));
        }
        for (field, value, why) in cases {
            let mut payload = serde_json::json!({"type": "job", "id": "work:1", "title": "Work", "status": "running"});
            payload[field] = value.into();
            let ClientMsg::Job { job } = serde_json::from_value(payload).unwrap() else { panic!("expected job") };
            let mut pace = Pace::default();
            super::job(&core, "Claude", 42, &mut pace, job.clone());
            let outgoing = updates.try_recv().unwrap();
            assert_eq!(outgoing.to.as_deref(), Some("Claude"));
            assert!(matches!(outgoing.message, ServerMsg::Notice { message } if message == format!("Not shown: {why}")));
            assert!(pace.sent.is_empty(), "invalid input doesn't consume the budget");
            super::job(&core, "Claude", 42, &mut pace, job);
            super::caption(&core, "Claude", 42, &mut pace, "".into());
            assert!(updates.try_recv().is_err(), "invalid jobs and guides share refusal throttling");
            assert!(pace.sent.is_empty());
        }

        let valid = serde_json::json!({"type": "job", "id": "work:1", "title": "Work", "status": "running"});
        let mut malformed = Vec::new();
        for field in ["id", "title", "status"] {
            let mut payload = valid.clone();
            payload.as_object_mut().unwrap().remove(field);
            malformed.push(payload);
        }
        for field in ["id", "title", "status", "result", "parent", "demo"] {
            for value in [serde_json::Value::Null, serde_json::json!(42), serde_json::json!(false), serde_json::json!([]), serde_json::json!({}), serde_json::json!("true")] {
                if (value.is_null() && matches!(field, "result" | "parent"))
                    || (value.is_boolean() && field == "demo")
                    || (value.is_string() && field != "demo") {
                    continue;
                }
                let mut payload = valid.clone();
                payload[field] = value;
                malformed.push(payload);
            }
        }
        let [mut ears, mut you] = windows(address, ["Claude", ""]).await;
        for payload in malformed {
            assert!(serde_json::from_value::<ClientMsg>(payload.clone()).is_err(), "{payload}");
            // A fresh origin gives each malformed payload its own refusal throttle and budget.
            let (mut origin, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws?name=Claude")).await.unwrap();
            drain(&mut origin, 20).await;
            // Its arrival (and the last origin's departure) reaches the other windows as a presence update first.
            drain(&mut ears, 50).await;
            drain(&mut you, 50).await;
            origin.send(send(payload.clone())).await.unwrap();
            origin.send(send(payload.clone())).await.unwrap();
            origin.send(send(serde_json::json!({"type": "caption", "text": ""}))).await.unwrap();
            for _ in 0..=PER_SECOND {
                origin.send(send(valid.clone())).await.unwrap();
            }
            let notice = next(&mut origin, 500).await.unwrap();
            assert_eq!(notice["type"], "notice", "{payload}");
            assert!(notice["message"].as_str().unwrap().starts_with("Not shown: A job needs string"), "{payload}: {notice}");
            assert!(drain(&mut origin, 50).await.is_empty(), "malformed jobs, captions and pacing share refusal throttling: {payload}");
            assert_eq!(next(&mut ears, 500).await.unwrap(), notice, "the sender's other window hears the refusal");
            for _ in 0..PER_SECOND {
                let shown = next(&mut you, 500).await.unwrap();
                assert_eq!(shown["type"], "job", "only valid jobs relay: {payload}");
                assert_eq!(next(&mut ears, 500).await.unwrap(), shown);
            }
            assert!(drain(&mut you, 50).await.is_empty(), "no refusal reaches another speaker, and the fifth job is paced: {payload}");
            assert!(drain(&mut ears, 50).await.is_empty(), "invalid jobs leave all four budget slots available: {payload}");
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn jobs_share_the_guide_budget() {
        let (core, address, path, mut queue) = served().await;
        let before = std::fs::read_to_string(&path).unwrap();
        let world = core.snapshot();
        let [mut claude, mut ears, mut you] = windows(address, ["Claude", "Claude", ""]).await;
        let job = serde_json::json!({"type": "job", "id": "work:1", "title": "Working", "status": "running"});
        for payload in [
            job.clone(),
            serde_json::json!({"type": "point", "target": "composer"}),
            serde_json::json!({"type": "tour", "steps": [{"text": "First"}]}),
            job.clone(),
            job.clone(),
            serde_json::json!({"type": "caption", "text": "Too soon"}),
            serde_json::json!({"type": "hold", "text": "Too soon?"}),
            serde_json::json!({"type": "tour", "steps": []}),
            serde_json::json!({"type": "point", "target": "mic"}),
        ] {
            claude.send(send(payload)).await.unwrap();
        }
        let shown = drain(&mut you, 100).await;
        assert_eq!(shown.iter().map(|m| m["type"].as_str().unwrap()).collect::<Vec<_>>(), ["job", "guide", "tour", "job"]);
        let notice = serde_json::json!({"type": "notice", "message": "Not shown: 4 a second at most."});
        assert_eq!(drain(&mut claude, 100).await, [notice.clone()], "no echoes and only one refusal");
        let mut expected = shown;
        expected.push(notice);
        assert_eq!(drain(&mut ears, 100).await, expected);

        // Another window of the same speaker has its own budget and still relays to the first.
        ears.send(send(job)).await.unwrap();
        let shown = next(&mut you, 500).await.unwrap();
        assert_eq!(shown["type"], "job");
        assert_eq!(shown["by"], "Claude");
        assert_eq!(next(&mut claude, 500).await.unwrap(), shown);
        assert!(drain(&mut ears, 100).await.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(Arc::ptr_eq(&world, &core.snapshot()));
        assert!(queue.try_recv().is_err());
        let _ = std::fs::remove_file(&path);
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
