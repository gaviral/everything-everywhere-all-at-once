//! E2A2O core: holds the world in memory, journals every change, listens through
//! Muse Voice Transcribe, places thoughts with Muse Spark, and keeps every UI in sync.

mod apple;
mod apps;
mod asr;
mod explain;
mod pictures;
mod placer;
mod refiner;
mod recap;
mod protocol;
mod world;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, ServerMsg};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::{ServeDir, ServeFile};
use world::{Change, Journal, Thought, ThreadStatus, World};

pub struct Core {
    recap: recap::Runtime,
    apps: apps::Runtime,
    world: Mutex<World>,
    journal: Mutex<Journal>,
    updates: broadcast::Sender<ServerMsg>,
    placer_queue: mpsc::UnboundedSender<placer::Job>,
    pub key: Option<String>,
    pub placer_model: String,
    pub http: reqwest::Client,
    /// When the person last spoke or typed; background work waits for a pause.
    last_activity: std::sync::atomic::AtomicU64,
    /// Set when the person comes back to the window (e.g. opens their eyes).
    looked: std::sync::atomic::AtomicBool,
    /// Wakes the background passes early.
    pub wake: tokio::sync::Notify,
}

impl Core {
    pub fn touch(&self) {
        self.last_activity.store(now_ms(), std::sync::atomic::Ordering::Relaxed);
    }

    /// Milliseconds since the person last spoke or typed.
    pub fn quiet_ms(&self) -> u64 {
        now_ms().saturating_sub(self.last_activity.load(std::sync::atomic::Ordering::Relaxed))
    }

    /// True once after the person came back to the window.
    pub fn take_looked(&self) -> bool {
        self.looked.swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> World {
        self.world.lock().unwrap().clone()
    }

    /// Applies a batch of changes together, journals each one, then tells every UI.
    pub fn commit(&self, changes: Vec<Change>) {
        {
            let mut world = self.world.lock().unwrap();
            let mut journal = self.journal.lock().unwrap();
            for change in &changes {
                world.apply(change);
                if let Err(e) = journal.append(change) {
                    tracing::error!("journal write failed: {e:#}");
                }
            }
        }
        for change in changes {
            self.send(ServerMsg::Change { change });
        }
    }

    pub fn send(&self, message: ServerMsg) {
        let _ = self.updates.send(message);
    }

    /// Makes a thread the active one; going back to a dropped thread reopens it.
    pub fn focus(&self, thread_id: &str) {
        let world = self.snapshot();
        let Some(thread) = world.thread(thread_id) else { return };
        let mut changes = vec![Change::ActiveChanged { thread_id: thread_id.into() }];
        if thread.status == ThreadStatus::Dropped {
            changes.push(Change::ThreadStatus { thread_id: thread_id.into(), status: ThreadStatus::Open });
        }
        self.commit(changes);
    }

    /// "Where was I?": back to the most recently dropped thread, else the previous one.
    fn go_back(&self) {
        let world = self.snapshot();
        let dropped = world
            .threads
            .iter()
            .filter(|t| t.status == ThreadStatus::Dropped)
            .max_by_key(|t| t.touched_ms)
            .map(|t| t.id.clone());
        let previous = || {
            world
                .thoughts
                .iter()
                .rev()
                .filter(|t| t.placed)
                .filter_map(|t| t.thread_id.clone())
                .find(|id| Some(id) != world.active.as_ref())
        };
        if let Some(id) = dropped.or_else(previous) {
            let title = world.thread(&id).map(|t| t.title.clone()).unwrap_or_default();
            self.send(ServerMsg::Notice { message: format!("Back to {title}") });
            self.focus(&id);
        }
    }

    /// "Next one": the thread after the active one, in the order they were started.
    fn go_next(&self) {
        let world = self.snapshot();
        let position = world.active.as_ref().and_then(|a| world.threads.iter().position(|t| &t.id == a));
        let next = match position {
            Some(i) => world.threads.get(i + 1).or_else(|| world.threads.first()),
            None => world.threads.first(),
        };
        if let Some(thread) = next {
            self.send(ServerMsg::Notice { message: format!("On to {}", thread.title) });
            self.focus(&thread.id.clone());
        }
    }

    /// A new thought lands in the active thread at once; the placer moves it if needed. Filler never
    /// becomes a thought, and a spoken command waits behind the thoughts said before it.
    pub fn add_thought(self: &Arc<Self>, speaker: &str, text: &str) {
        self.touch();
        if let Some(period) = recap::command(text) {
            return recap::request(self.clone(), period);
        }
        if let Some(request) = apps::command(text) {
            return apps::compose(self.clone(), request);
        }
        let (text, then) = match command(text) {
            Some((before, job)) => (before, Some(job)),
            None => (text, None),
        };
        let (active, asked) = {
            let world = self.world.lock().unwrap();
            (world.active.clone(), world.thoughts.last().is_some_and(|t| t.text.trim_end().ends_with('?')))
        };
        if !filler(text, asked) {
            let thought = Thought {
                id: format!("th-{}", uuid::Uuid::new_v4().simple()),
                speaker: speaker.into(),
                text: text.into(),
                point: String::new(),
                thread_id: active,
                placed: false,
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                at_ms: now_ms(),
                place_ms: None,
            };
            let id = thought.id.clone();
            self.commit(vec![Change::ThoughtAdded { thought }]);
            let _ = self.placer_queue.send(placer::Job::Place(id));
        }
        if let Some(job) = then {
            let _ = self.placer_queue.send(job);
        }
    }
}

/// Lowercase words, with punctuation as spaces ("Mm-hmm." → "mm hmm").
fn words(text: &str) -> Vec<String> {
    let clean: String =
        text.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' }).collect();
    clean.split_whitespace().map(String::from).collect()
}

/// Sounds and connectors that carry nothing on their own.
const FILLER: [&str; 32] = [
    "um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hmm", "hm", "hmmm", "mm", "mmm", "oh", "so", "well", "like",
    "and", "but", "anyway", "anyways", "wait", "actually", "basically", "i mean", "you know", "hold on", "let me think", "let me see",
    "let s see",
];
/// Acknowledgements: filler too, unless they may answer a question just asked. Not "yes": said on its
/// own it's usually meant ("I wonder if I should take it." "Yes."), so the placer judges it in context.
const ACKS: [&str; 15] =
    ["yeah", "yep", "yup", "okay", "ok", "alright", "all right", "right", "sure", "mhm", "mm hmm", "uh huh", "cool", "got it", "i see"];

/// True when a turn holds nothing for the map: only sounds and connectors ("um, so"), or only
/// acknowledgements ("yeah, okay") when the last thing said wasn't a question. "No", a name or a
/// time never is; whatever this lets through, the placer can still set aside in context.
fn filler(text: &str, asked: bool) -> bool {
    let acks: &[&str] = if asked { &[] } else { &ACKS };
    // Longest first, so "uh huh" isn't read as "uh" and then a stray "huh".
    let mut phrases: Vec<Vec<&str>> = FILLER.iter().chain(acks).map(|p| p.split(' ').collect()).collect();
    phrases.sort_by_key(|p| std::cmp::Reverse(p.len()));
    let words = words(text);
    let mut rest = words.as_slice();
    while !rest.is_empty() {
        match phrases.iter().find(|p| rest.len() >= p.len() && rest.iter().zip(p.iter()).all(|(w, p)| w == p)) {
            Some(p) => rest = &rest[p.len()..],
            None => return false,
        }
    }
    true
}

/// A spoken "where was I?" or "next one": the whole turn, or its end after a pause in it ("…it starts
/// at two, okay, where was I?"), with the words said before it, which are still a thought.
fn command(text: &str) -> Option<(&str, placer::Job)> {
    let job = |t: &str| {
        if is_go_back(t) {
            Some(placer::Job::Back)
        } else if is_go_next(t) {
            Some(placer::Job::Next)
        } else {
            None
        }
    };
    if let Some(job) = job(text) {
        return Some(("", job));
    }
    starts(text)
        .into_iter()
        .find_map(|i| job(&text[i..]).map(|job| (text[..i].trim_end().trim_end_matches([',', ';', ':', '—', '–']).trim_end(), job)))
}

/// Where a command may begin partway through a turn: a word after a punctuation mark, or a word that
/// turns to one ("okay", "anyway"). So "fly there and go back" and "that song would take me back" stay thoughts.
fn starts(text: &str) -> Vec<usize> {
    const PAUSE: [char; 9] = [',', '.', ';', ':', '?', '!', '…', '—', '–'];
    const TURN: [&str; 11] = ["okay", "ok", "alright", "anyway", "anyways", "so", "wait", "hmm", "um", "uh", "oh"];
    let mut out = Vec::new();
    let mut in_word = false;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            in_word = false;
        } else if !in_word {
            in_word = true;
            let word = words(text[i..].split_whitespace().next().unwrap_or(""));
            let turns = word.first().is_some_and(|w| TURN.contains(&w.as_str()));
            if i > 0 && (text[..i].trim_end().ends_with(PAUSE) || turns) {
                out.push(i);
            }
        }
    }
    out
}

/// Spoken or typed "where was I?" style requests, kept strict so ordinary thoughts
/// like "go back to the drawing board" stay thoughts.
fn is_go_back(text: &str) -> bool {
    is_command(
        text,
        &["where was i", "what was i saying", "what was i talking about", "where were we", "take me back", "go back"],
        &["to where i was", "to that", "to it", "there", "again", "going with this", "going with that"],
    )
}

/// "Go to the next one" style requests.
fn is_go_next(text: &str) -> bool {
    is_command(text, &["go to the next one", "next one", "next thread", "go next", "next"], &["one", "thread", "topic"])
}

/// True when the whole utterance is one of the asks, after words that lead into it and before a short allowed tail.
fn is_command(text: &str, asks: &[&str], tails: &[&str]) -> bool {
    const LEAD: [&str; 14] = ["and", "so", "ok", "okay", "wait", "um", "uh", "hmm", "now", "anyway", "anyways", "alright", "oh", "right"];
    let words = words(text);
    let rest = words.iter().skip_while(|w| LEAD.contains(&w.as_str())).cloned().collect::<Vec<_>>().join(" ");
    asks.iter().any(|ask| {
        rest.strip_prefix(ask)
            .map(|tail| {
                let tail = tail.trim();
                tail.is_empty() || tail == "please" || tails.contains(&tail)
            })
            .unwrap_or(false)
    })
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let key = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty());
    if key.is_none() {
        tracing::warn!("MODEL_API_KEY is not set: listening and placement are off (see .env.example)");
    }
    let data = std::env::var("E2A2O_DATA").unwrap_or_else(|_| "../data".into());
    let (journal, world) = Journal::open(&Path::new(&data).join("journal.jsonl"))?;
    let pending: Vec<String> = world.thoughts.iter().filter(|t| !t.placed).map(|t| t.id.clone()).collect();

    let (updates, _) = broadcast::channel(1024);
    let (placer_queue, queue) = mpsc::unbounded_channel();
    let core = Arc::new(Core {
        recap: recap::Runtime::default(),
        apps: apps::Runtime::default(),
        world: Mutex::new(world),
        journal: Mutex::new(journal),
        updates,
        placer_queue,
        key,
        placer_model: std::env::var("PLACER_MODEL").unwrap_or_else(|_| "muse-spark-1.2-contributor".into()),
        // Without a limit, one hung model call stalls its block for good; two minutes is far past any real answer.
        http: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()?,
        last_activity: std::sync::atomic::AtomicU64::new(0),
        looked: std::sync::atomic::AtomicBool::new(false),
        wake: tokio::sync::Notify::new(),
    });
    apps::seed(&core, Path::new(&data).file_name().is_some_and(|name| name == "demo"));
    tokio::spawn(apps::run(core.clone()));
    tokio::spawn(placer::run(core.clone(), queue));
    tokio::spawn(refiner::run(core.clone()));
    let images = Path::new(&data).join("images");
    tokio::spawn(pictures::run(core.clone(), images.clone()));
    for id in pending {
        let _ = core.placer_queue.send(placer::Job::Place(id));
    }

    let ui = std::env::var("E2A2O_UI").unwrap_or_else(|_| "../ui/dist".into());
    let app = Router::new()
        .route("/ws", get(connect))
        .nest_service("/images", ServeDir::new(images))
        .fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(format!("{ui}/index.html"))))
        .layer(middleware::from_fn(only_local))
        .with_state(core);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4321);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("E2A2O core on http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Only pages served from this machine may use the core. A browser always sends Origin with a
/// WebSocket handshake, so a site you happen to have open can't read your map or approve actions;
/// checking Host too stops DNS rebinding (a site whose name resolves to 127.0.0.1).
async fn only_local(request: Request, next: Next) -> Response {
    let allowed = {
        let value = |name| request.headers().get(name).and_then(|v| v.to_str().ok());
        value(header::HOST).is_some_and(local) && value(header::ORIGIN).is_none_or(local)
    };
    if !allowed {
        tracing::warn!("refused a request from origin {:?}", request.headers().get(header::ORIGIN));
        return StatusCode::FORBIDDEN.into_response();
    }
    // Pages elsewhere can't even embed our files (an <img> sends no Origin).
    let mut response = next.run(request).await;
    response.headers_mut().insert("cross-origin-resource-policy", header::HeaderValue::from_static("same-origin"));
    response
}

/// True for localhost, 127.0.0.1 and [::1], with or without a scheme and a port.
fn local(value: &str) -> bool {
    let host = value.rsplit("://").next().unwrap_or(value);
    let host = match host.rsplit_once(':') {
        Some((name, port)) if port.bytes().all(|b| b.is_ascii_digit()) => name,
        _ => host,
    };
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

async fn connect(upgrade: WebSocketUpgrade, State(core): State<Arc<Core>>) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| session(socket, core))
}

/// One UI connection: sends the world, then every change; takes typed thoughts and audio.
async fn session(socket: WebSocket, core: Arc<Core>) {
    let (mut out, mut incoming) = socket.split();
    let mut updates = core.updates.subscribe();
    let snapshot = ServerMsg::Snapshot { world: core.snapshot() };
    if out.send(Message::Text(serde_json::to_string(&snapshot).unwrap().into())).await.is_err() {
        return;
    }
    if let Some(build) = apps::build(&core) {
        let message = ServerMsg::AppsBuild { build };
        if out.send(Message::Text(serde_json::to_string(&message).unwrap().into())).await.is_err() { return; }
    }
    let source = core.clone();
    let forward = tokio::spawn(async move {
        loop {
            match updates.recv().await {
                Ok(message) => {
                    let text = serde_json::to_string(&message).unwrap();
                    if out.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                // Fell too far behind to replay the missed changes: send the whole world again.
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let snapshot = ServerMsg::Snapshot { world: source.snapshot() };
                    if out.send(Message::Text(serde_json::to_string(&snapshot).unwrap().into())).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut audio: Option<mpsc::Sender<Vec<u8>>> = None;
    let volume_source = uuid::Uuid::new_v4().to_string();
    while let Some(Ok(message)) = incoming.next().await {
        match message {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(text.as_str()) {
                Ok(ClientMsg::Recap { period }) => recap::request(core.clone(), period),
                Ok(ClientMsg::ComposeApp { request }) => apps::compose(core.clone(), request),
                Ok(ClientMsg::DecideApp { build_id, keep }) => apps::decide(&core, &build_id, keep),
                Ok(ClientMsg::ToggleApp { id, enabled }) => apps::toggle(&core, id, enabled),
                Ok(ClientMsg::RemoveApp { id }) => core.commit(vec![Change::AppRemoved { id }]),
                Ok(ClientMsg::AppVolume { level }) => apps::volume(&core, &volume_source, level),
                Ok(ClientMsg::AppOutput { id, sound }) => apps::volume_output(&core, id, sound),
                Ok(ClientMsg::Text { text }) if !text.trim().is_empty() => core.add_thought("you", text.trim()),
                // A listener whose voice service ended has a closed channel; start a fresh one.
                Ok(ClientMsg::Listen { on: true }) if audio.as_ref().is_none_or(|tx| tx.is_closed()) => {
                    let (tx, rx) = mpsc::channel(256);
                    audio = Some(tx);
                    let core = core.clone();
                    tokio::spawn(async move {
                        if let Err(e) = asr::run(core.clone(), rx).await {
                            tracing::warn!("listening stopped: {e:#}");
                            core.send(ServerMsg::Error { message: format!("{e}") });
                            core.send(ServerMsg::Status { listening: false, note: "Not listening".into() });
                        }
                    });
                }
                Ok(ClientMsg::Listen { on: false }) => { audio = None; apps::disconnect(&core, &volume_source); }
                Ok(ClientMsg::Focus { thread_id }) => core.focus(&thread_id),
                Ok(ClientMsg::Explain { id, text, context, thread_id }) => {
                    tokio::spawn(explain::run(core.clone(), id, text, context, thread_id));
                }
                Ok(ClientMsg::Item { id, status }) => {
                    core.commit(vec![Change::ItemStatus { id, status, done_ms: None }]);
                }
                Ok(ClientMsg::Approve { id }) => {
                    tokio::spawn(apple::approve(core.clone(), id));
                }
                Ok(ClientMsg::Visible) => {
                    core.looked.store(true, std::sync::atomic::Ordering::Relaxed);
                    core.wake.notify_waiters();
                }
                Ok(ClientMsg::Tag { thread_id, tag, keep }) => {
                    let change = if keep { Change::TagKept { thread_id, tag } } else { Change::TagRemoved { thread_id, tag } };
                    core.commit(vec![change]);
                }
                Ok(ClientMsg::Correct { thought_id, accept }) => {
                    core.commit(vec![Change::ThoughtCorrected { thought_id, accept }]);
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("ignoring a message I can't read: {e}"),
            },
            Message::Binary(frame) => {
                if let Some(tx) = &audio {
                    let _ = tx.try_send(frame.to_vec());
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    forward.abort();
    apps::disconnect(&core, &volume_source);
}

#[cfg(test)]
mod tests {
    use super::{command, filler, local, placer::Job, Core};
    use std::sync::{Arc, Mutex};
    use tokio::sync::{broadcast, mpsc};

    #[test]
    fn filler_is_only_sounds_connectors_and_acknowledgements_after_no_question() {
        for text in ["yeah", "so", "hmm okay", "right right right", "Um, so...", "Mm-hmm.", "you know", "let's see", "okay, yeah"] {
            assert!(filler(text, false), "{text}");
        }
        // After a question an acknowledgement may be the answer: the placer decides.
        for text in ["yeah", "hmm, okay", "uh-huh", "yes"] {
            assert!(!filler(text, true), "{text}");
        }
        assert!(filler("um, let me think", true));
        // Never filler: a yes or a no, a maybe, a name, a time, or anything with real words.
        for text in ["yes", "no", "nope", "maybe", "Dad", "Tuesday", "oh wow", "yeah, the demo is Tuesday", "I don't know"] {
            assert!(!filler(text, false), "{text}");
        }
    }

    #[test]
    fn a_command_at_the_end_of_a_turn_still_acts() {
        let said = |text: &str| {
            command(text).map(|(before, job)| (before.to_string(), if matches!(job, Job::Back) { "back" } else { "next" }))
        };
        let back = |before: &str| Some((before.to_string(), "back"));
        assert_eq!(said("where was I"), back(""));
        assert_eq!(said("So, um, where was I going with this"), back(""));
        assert_eq!(said("Right, where were we?"), back(""));
        assert_eq!(said("It starts at two in the afternoon, okay, where was I?"), back("It starts at two in the afternoon"));
        assert_eq!(said("the budget, now where was I"), back("the budget"));
        assert_eq!(said("the budget um where was I"), back("the budget"));
        assert_eq!(said("I'll pay it on Thursday. Anyway, next one."), Some(("I'll pay it on Thursday.".into(), "next")));
        // Ordinary speech stays a thought: no pause before the words, or more words after them.
        for text in [
            "go back to the drawing board on this",
            "that song would take me back",
            "I'd fly to Paris and go back",
            "you can't just now go back",
            "Where was I when the power went out?",
            "Tuesday, next week",
            "What's next?",
            "Anyway back to the hackathon. The placement needs to be under three seconds.",
        ] {
            assert_eq!(said(text), None, "{text}");
        }
    }

    #[test]
    fn filler_never_becomes_a_thought_and_a_command_waits_behind_the_words_before_it() {
        let path = std::env::temp_dir().join(format!("e2a2o-main-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let (updates, _) = broadcast::channel(64);
        let (placer_queue, mut queue) = mpsc::unbounded_channel();
        let core = Arc::new(Core {
            recap: crate::recap::Runtime::default(),
            apps: crate::apps::Runtime::default(),
            world: Mutex::new(world),
            journal: Mutex::new(journal),
            updates,
            placer_queue,
            key: None,
            placer_model: "test".into(),
            http: reqwest::Client::new(),
            last_activity: std::sync::atomic::AtomicU64::new(0),
            looked: std::sync::atomic::AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
        });
        let mut jobs = || {
            let mut out = Vec::new();
            while let Ok(job) = queue.try_recv() {
                out.push(match job {
                    Job::Place(_) => "place",
                    Job::Back => "back",
                    Job::Next => "next",
                });
            }
            out
        };
        let texts = |core: &Core| core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect::<Vec<_>>();

        core.add_thought("you", "um, so");
        core.add_thought("you", "right right right");
        assert!(texts(&core).is_empty() && jobs().is_empty());
        core.add_thought("you", "It starts at two in the afternoon, okay, where was I?");
        assert_eq!(texts(&core), ["It starts at two in the afternoon"]);
        assert_eq!(jobs(), ["place", "back"]);
        core.add_thought("you", "Okay, where was I?");
        assert_eq!(jobs(), ["back"]);
        // "yeah" after a question goes to the placer, which can tell an answer from filler.
        core.add_thought("you", "Should I take the Google offer?");
        core.add_thought("you", "yeah");
        assert_eq!(texts(&core)[1..], ["Should I take the Google offer?", "yeah"]);
        assert_eq!(jobs(), ["place", "place"]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn only_this_machine_counts_as_local() {
        for ok in ["localhost:4321", "127.0.0.1:4321", "[::1]:4321", "http://localhost:5173", "http://127.0.0.1:4321", "localhost"] {
            assert!(local(ok), "{ok}");
        }
        for bad in ["evil.com:4321", "http://localhost.evil.com:4321", "http://127.0.0.1.nip.io", "null", "http://evil.com", "[::1"] {
            assert!(!local(bad), "{bad}");
        }
    }
}
