//! E2A2O core: holds the world in memory, journals every change, listens through
//! Muse Voice Transcribe, places thoughts with Muse Spark, and keeps every UI in sync.
//! With a room code, a second laptop on the same network joins the same map.

mod apple;
mod apps;
mod asr;
mod explain;
mod pictures;
mod placer;
mod refiner;
mod protocol;
mod world;

use axum::extract::connect_info::{ConnectInfo, Connected};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, Outgoing, ServerMsg};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::{ServeDir, ServeFile};
use world::{Change, Journal, Thought, ThreadStatus, World};

pub struct Core {
    apps: apps::Runtime,
    world: Mutex<World>,
    journal: Mutex<Journal>,
    updates: broadcast::Sender<Outgoing>,
    placer_queue: mpsc::UnboundedSender<String>,
    /// Set when a room is open: the code another laptop needs (see `gate`).
    room: Option<String>,
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

    /// To every window.
    pub fn send(&self, message: ServerMsg) {
        let _ = self.updates.send(Outgoing { to: None, message });
    }

    /// Only to one speaker's windows.
    pub fn send_to(&self, speaker: &str, message: ServerMsg) {
        let _ = self.updates.send(Outgoing { to: Some(speaker.into()), message });
    }

    /// Makes a thread the speaker's active one; going back to a dropped thread reopens it.
    pub fn focus(&self, speaker: &str, thread_id: &str) {
        let world = self.snapshot();
        let Some(thread) = world.thread(thread_id) else { return };
        let mut changes = vec![Change::ActiveChanged { thread_id: thread_id.into(), speaker: speaker.into() }];
        if thread.status == ThreadStatus::Dropped {
            changes.push(Change::ThreadStatus { thread_id: thread_id.into(), status: ThreadStatus::Open, speaker: speaker.into() });
        }
        self.commit(changes);
    }

    /// "Where was I?": see `way_back`.
    fn go_back(&self, speaker: &str) {
        let world = self.snapshot();
        if let Some(id) = way_back(&world, speaker) {
            let title = world.thread(&id).map(|t| t.title.clone()).unwrap_or_default();
            self.send_to(speaker, ServerMsg::Notice { message: format!("Back to {title}") });
            self.focus(speaker, &id);
        }
    }

    /// "Next one": the thread after the speaker's, in the order they were started.
    fn go_next(&self, speaker: &str) {
        let world = self.snapshot();
        let position = world.active_for(speaker).and_then(|a| world.threads.iter().position(|t| &t.id == a));
        let next = match position {
            Some(i) => world.threads.get(i + 1).or_else(|| world.threads.first()),
            None => world.threads.first(),
        };
        if let Some(thread) = next {
            self.send_to(speaker, ServerMsg::Notice { message: format!("On to {}", thread.title) });
            self.focus(speaker, &thread.id.clone());
        }
    }

    /// A new thought lands in the speaker's active thread at once; the placer moves it if needed.
    pub fn add_thought(self: &Arc<Self>, speaker: &str, text: &str) {
        self.touch();
        if let Some(request) = apps::command(text) {
            return apps::compose(self.clone(), request);
        }
        if is_go_back(text) {
            return self.go_back(speaker);
        }
        if is_go_next(text) {
            return self.go_next(speaker);
        }
        let active = self.world.lock().unwrap().active_for(speaker).cloned();
        let thought = Thought {
            id: format!("th-{}", uuid::Uuid::new_v4().simple()),
            speaker: speaker.into(),
            text: text.into(),
            point: String::new(),
            thread_id: active,
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            complete: true,
            at_ms: now_ms(),
            place_ms: None,
        };
        let id = thought.id.clone();
        self.commit(vec![Change::ThoughtAdded { thought }]);
        let _ = self.placer_queue.send(id);
    }
}

/// Where "where was I?" takes a speaker: the thread they most recently dropped, else the last other
/// one they spoke on. Never the other person's: in a room each has their own way back.
fn way_back(world: &World, speaker: &str) -> Option<String> {
    let current = world.active_by.get(speaker);
    let dropped = world
        .threads
        .iter()
        .filter(|t| t.status == ThreadStatus::Dropped && t.dropped_by == speaker)
        .max_by_key(|t| t.touched_ms)
        .map(|t| t.id.clone());
    dropped.or_else(|| {
        world
            .thoughts
            .iter()
            .rev()
            .filter(|t| t.placed && t.speaker == speaker)
            .filter_map(|t| t.thread_id.clone())
            .find(|id| Some(id) != current)
    })
}

/// Spoken or typed "where was I?" style requests, kept strict so ordinary thoughts
/// like "go back to the drawing board" stay thoughts.
fn is_go_back(text: &str) -> bool {
    is_command(text, &["where was i", "what was i saying", "go back", "take me back", "where were we"], &["to where i was", "to that", "to it", "there"])
}

/// "Go to the next one" style requests.
fn is_go_next(text: &str) -> bool {
    is_command(text, &["go to the next one", "next one", "next thread", "go next", "next"], &["one", "thread", "topic"])
}

/// True when the whole utterance is one of the asks, after filler words and before a short allowed tail.
fn is_command(text: &str, asks: &[&str], tails: &[&str]) -> bool {
    const FILLER: [&str; 9] = ["and", "so", "ok", "okay", "wait", "um", "uh", "hmm", "now"];
    let clean: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = clean.split_whitespace().skip_while(|w| FILLER.contains(w)).collect();
    let rest = words.join(" ");
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
    let room = room_code()?;
    let data = std::env::var("E2A2O_DATA").unwrap_or_else(|_| "../data".into());
    let (journal, world) = Journal::open(&Path::new(&data).join("journal.jsonl"))?;
    let pending: Vec<String> = world.thoughts.iter().filter(|t| !t.placed).map(|t| t.id.clone()).collect();

    let (updates, _) = broadcast::channel(1024);
    let (placer_queue, queue) = mpsc::unbounded_channel();
    let core = Arc::new(Core {
        apps: apps::Runtime::default(),
        world: Mutex::new(world),
        journal: Mutex::new(journal),
        updates,
        placer_queue,
        room: room.clone(),
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
        let _ = core.placer_queue.send(id);
    }

    let ui = std::env::var("E2A2O_UI").unwrap_or_else(|_| "../ui/dist".into());
    let app = Router::new()
        .route("/ws", get(connect))
        .route("/room", get(room_info))
        .nest_service("/images", ServeDir::new(images))
        .fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(format!("{ui}/index.html"))))
        .layer(middleware::from_fn_with_state(core.clone(), gate))
        .with_state(core);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4321);
    // Alone, only this machine can reach the core; a room opens it to the local network, behind the code.
    let address = if room.is_some() { "0.0.0.0" } else { "127.0.0.1" };
    let listener = tokio::net::TcpListener::bind((address, port)).await?;
    tracing::info!("E2A2O core on http://localhost:{port}");
    if let Some(code) = &room {
        let host = lan_ip().map_or_else(|| "<this laptop's address>".into(), |ip| ip.to_string());
        tracing::info!("Room open. On the other laptop, open http://{host}:{port}/?room={code}");
    }
    axum::serve(listener, app.into_make_service_with_connect_info::<Link>()).await?;
    Ok(())
}

/// ROOM_CODE opens a room. Codes compare as lowercase letters and digits, so "K7M2-X9QP" and
/// "k7m2x9qp" are the same code and none needs escaping in a link or a cookie.
fn room_code() -> anyhow::Result<Option<String>> {
    let Some(raw) = std::env::var("ROOM_CODE").ok().filter(|c| !c.trim().is_empty()) else { return Ok(None) };
    let code = normal_code(&raw);
    if code.is_empty() {
        anyhow::bail!("ROOM_CODE needs letters or digits");
    }
    if code.len() < 8 {
        tracing::warn!("ROOM_CODE is short: anyone on the network could guess it (./run.sh room makes a longer one)");
    }
    Ok(Some(code))
}

fn normal_code(code: &str) -> String {
    code.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect()
}

/// Compares in constant time, so response times don't hint at how much of a guess was right.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// This laptop's address on the local network, for the link to share: the one it would use to reach
/// the internet, else a private network. Connecting a UDP socket sends nothing; it only picks a route.
fn lan_ip() -> Option<std::net::IpAddr> {
    ["8.8.8.8:80", "192.168.0.1:80", "10.0.0.1:80"].into_iter().find_map(|target| {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect(target).ok()?;
        Some(socket.local_addr().ok()?.ip()).filter(|ip| !ip.is_unspecified() && !ip.is_loopback())
    })
}

/// Both ends of a connection: where it came from, and which of this machine's addresses it reached.
#[derive(Clone, Copy, Debug)]
struct Link {
    from: SocketAddr,
    to: SocketAddr,
}

impl Link {
    /// The request comes from this machine itself.
    fn here(&self) -> bool {
        self.from.ip().is_loopback()
    }
}

impl Connected<axum::serve::IncomingStream<'_, tokio::net::TcpListener>> for Link {
    fn connect_info(stream: axum::serve::IncomingStream<'_, tokio::net::TcpListener>) -> Self {
        // Unknown only if the socket already closed; an unspecified address matches no Host.
        let to = stream.io().local_addr().unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
        Link { from: *stream.remote_addr(), to }
    }
}

/// What a request may reach.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Access {
    /// Nothing: another site, or a name that isn't this machine's.
    None,
    /// Only the app's own files, so another laptop can open the page and type the code.
    Page,
    /// The map too: the WebSocket and pictures.
    Map,
}

/// Who may use the core. Alone, only pages served from this machine: a browser always sends Origin
/// with a WebSocket handshake, so a site you happen to have open can't read your map or approve
/// actions; checking Host too stops DNS rebinding (a site whose name resolves to 127.0.0.1).
/// In a room the core is on the network: a page may also come from the address the connection
/// reached (the laptop's IP, never a name a site could point at it), and the map needs the code
/// unless the request comes from this machine.
async fn gate(State(core): State<Arc<Core>>, mut request: Request, next: Next) -> Response {
    let link = request.extensions().get::<ConnectInfo<Link>>().map(|c| c.0);
    let access = {
        let value = |name| request.headers().get(name).and_then(|v| v.to_str().ok());
        let has_code = core.room.as_deref().is_some_and(|code| codes(&request).iter().any(|c| same(&normal_code(c), code)));
        link.map_or(Access::None, |link| access(core.room.is_some(), link, value(header::HOST), value(header::ORIGIN), has_code))
    };
    if access == Access::None || (access == Access::Page && !public(request.uri().path())) {
        tracing::warn!(
            "refused {} from {} (origin {:?})",
            request.uri().path(),
            link.map_or_else(|| "an unknown address".into(), |l| l.from.ip().to_string()),
            request.headers().get(header::ORIGIN)
        );
        return StatusCode::FORBIDDEN.into_response();
    }
    request.extensions_mut().insert(access);
    // Pages elsewhere can't even embed our files (an <img> sends no Origin).
    let mut response = next.run(request).await;
    response.headers_mut().insert("cross-origin-resource-policy", header::HeaderValue::from_static("same-origin"));
    response
}

fn access(room: bool, link: Link, host: Option<&str>, origin: Option<&str>, has_code: bool) -> Access {
    // "localhost" means this machine only when the request comes from it.
    let ours = |value: &str| (link.here() && local(value)) || (room && reached(value, link.to));
    let Some(host) = host.filter(|h| ours(h)) else { return Access::None };
    // Our pages are plain http, so their Origin is "http://" and the Host they were loaded from.
    let ours_too = |origin: &str| (link.here() && local(origin)) || (room && origin.strip_prefix("http://") == Some(host));
    if !origin.is_none_or(ours_too) {
        return Access::None;
    }
    if !room || link.here() || has_code {
        Access::Map
    } else {
        Access::Page
    }
}

/// True when a Host names the address the connection reached, e.g. "192.168.1.20:4321".
fn reached(host: &str, to: SocketAddr) -> bool {
    !to.ip().is_unspecified() && (host == to.to_string() || (to.port() == 80 && host == to.ip().to_string()))
}

/// The app's own files, which hold nothing of the map. Everything else needs the code in a room.
fn public(path: &str) -> bool {
    matches!(path, "/" | "/index.html" | "/room" | "/pcm-worklet.js") || path.starts_with("/assets/")
}

/// The room codes a request carries: `?room=` on the WebSocket, or the `room` cookie the page sets
/// for pictures (an <img> can't add a query).
fn codes(request: &Request) -> Vec<String> {
    let query = Query::<HashMap<String, String>>::try_from_uri(request.uri()).ok().and_then(|Query(q)| q.get("room").cloned());
    let cookies = request
        .headers()
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix("room=").map(str::to_string));
    query.into_iter().chain(cookies).collect()
}

/// Whether a room is open and whether this page may join it, so the page knows to ask for a name
/// and, on another laptop, the code.
async fn room_info(State(core): State<Arc<Core>>, request: Request) -> Json<serde_json::Value> {
    let member = request.extensions().get::<Access>() == Some(&Access::Map);
    Json(serde_json::json!({ "room": core.room.is_some(), "member": member }))
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

#[derive(serde::Deserialize)]
struct Join {
    /// The name this window joined a room with; none alone.
    #[serde(default)]
    name: String,
}

async fn connect(
    upgrade: WebSocketUpgrade,
    Query(join): Query<Join>,
    ConnectInfo(link): ConnectInfo<Link>,
    State(core): State<Arc<Core>>,
) -> impl IntoResponse {
    let speaker = speaker_name(&join.name);
    upgrade.on_upgrade(move |socket| session(socket, core, speaker, link.here()))
}

/// What a window's thoughts are labeled with: its name in the room, on one line and at most 24
/// characters; alone, "you".
fn speaker_name(name: &str) -> String {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).take(24).collect();
    match name.trim() {
        "" => "you".into(),
        name => name.into(),
    }
}

/// One UI connection: sends the world, then every change and whatever is meant for its speaker;
/// takes typed thoughts and audio as that speaker. `here`: the window is on this machine.
async fn session(socket: WebSocket, core: Arc<Core>, speaker: String, here: bool) {
    let (mut out, mut incoming) = socket.split();
    if core.room.is_some() {
        tracing::info!("{speaker} joined the room");
    }
    let mut updates = core.updates.subscribe();
    let snapshot = ServerMsg::Snapshot { world: core.snapshot() };
    if out.send(Message::Text(serde_json::to_string(&snapshot).unwrap().into())).await.is_err() {
        return;
    }
    if let Some(build) = apps::build(&core) {
        let message = ServerMsg::AppsBuild { build };
        if out.send(Message::Text(serde_json::to_string(&message).unwrap().into())).await.is_err() { return; }
    }
    let (source, reader) = (core.clone(), speaker.clone());
    let forward = tokio::spawn(async move {
        loop {
            match updates.recv().await {
                // Someone else's live words, mic and notices.
                Ok(Outgoing { to: Some(to), .. }) if to != reader => {}
                Ok(Outgoing { message, .. }) => {
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
                Ok(ClientMsg::ComposeApp { request }) => apps::compose(core.clone(), request),
                Ok(ClientMsg::DecideApp { build_id, keep }) => apps::decide(&core, &build_id, keep),
                Ok(ClientMsg::ToggleApp { id, enabled }) => apps::toggle(&core, id, enabled),
                Ok(ClientMsg::RemoveApp { id }) => core.commit(vec![Change::AppRemoved { id }]),
                Ok(ClientMsg::AppVolume { level }) => apps::volume(&core, &volume_source, level),
                Ok(ClientMsg::AppOutput { id, sound }) => apps::volume_output(&core, id, sound),
                Ok(ClientMsg::Text { text }) if !text.trim().is_empty() => core.add_thought(&speaker, text.trim()),
                // A listener whose voice service ended has a closed channel; start a fresh one.
                Ok(ClientMsg::Listen { on: true }) if audio.as_ref().is_none_or(|tx| tx.is_closed()) => {
                    let (tx, rx) = mpsc::channel(256);
                    audio = Some(tx);
                    let (core, speaker) = (core.clone(), speaker.clone());
                    tokio::spawn(async move {
                        if let Err(e) = asr::run(core.clone(), speaker.clone(), rx).await {
                            tracing::warn!("listening stopped: {e:#}");
                            core.send_to(&speaker, ServerMsg::Error { message: format!("{e}") });
                            core.send_to(&speaker, ServerMsg::Status { listening: false, note: "Not listening".into() });
                        }
                    });
                }
                Ok(ClientMsg::Listen { on: false }) => { audio = None; apps::disconnect(&core, &volume_source); }
                Ok(ClientMsg::Focus { thread_id }) => core.focus(&speaker, &thread_id),
                Ok(ClientMsg::Explain { id, text, context }) => {
                    tokio::spawn(explain::run(core.clone(), id, text, context));
                }
                Ok(ClientMsg::Item { id, status }) => {
                    core.commit(vec![Change::ItemStatus { id, status, done_ms: None }]);
                }
                // It goes into Reminders or Calendar on the laptop running the core, so it's that person's call.
                Ok(ClientMsg::Approve { id }) if here => {
                    tokio::spawn(apple::approve(core.clone(), id));
                }
                Ok(ClientMsg::Approve { .. }) => {
                    core.send_to(&speaker, ServerMsg::Notice { message: "Only the host can add this: it goes into their apps.".into() });
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
    if core.room.is_some() {
        tracing::info!("{speaker} left the room");
    }
}

#[cfg(test)]
mod tests {
    use super::{access, local, normal_code, public, same, speaker_name, way_back, Access, Link};
    use crate::world::{Thought, Thread, ThreadStatus, World};

    #[test]
    fn only_this_machine_counts_as_local() {
        for ok in ["localhost:4321", "127.0.0.1:4321", "[::1]:4321", "http://localhost:5173", "http://127.0.0.1:4321", "localhost"] {
            assert!(local(ok), "{ok}");
        }
        for bad in ["evil.com:4321", "http://localhost.evil.com:4321", "http://127.0.0.1.nip.io", "null", "http://evil.com", "[::1"] {
            assert!(!local(bad), "{bad}");
        }
    }

    fn link(from: &str, to: &str) -> Link {
        Link { from: from.parse().unwrap(), to: to.parse().unwrap() }
    }

    #[test]
    fn alone_only_this_machines_pages_get_in() {
        let here = link("127.0.0.1:50000", "127.0.0.1:4321");
        assert_eq!(access(false, here, Some("localhost:4321"), Some("http://localhost:4321"), false), Access::Map);
        assert_eq!(access(false, here, Some("127.0.0.1:4321"), None, false), Access::Map);
        assert_eq!(access(false, here, Some("localhost:4321"), Some("https://example.com"), false), Access::None);
        assert_eq!(access(false, here, Some("example.com:4321"), None, false), Access::None, "DNS rebinding");
        assert_eq!(access(false, here, None, None, false), Access::None);
    }

    #[test]
    fn a_room_lets_the_other_laptop_in_with_the_code() {
        let guest = link("192.168.1.9:51000", "192.168.1.5:4321");
        let (host, page) = (Some("192.168.1.5:4321"), Some("http://192.168.1.5:4321"));
        assert_eq!(access(true, guest, host, page, true), Access::Map);
        assert_eq!(access(true, guest, host, None, true), Access::Map);
        // Without the code: the page, to type it in, but not the map.
        assert_eq!(access(true, guest, host, page, false), Access::Page);
        assert!(public("/") && public("/assets/index-abc.js") && public("/room") && public("/pcm-worklet.js"));
        assert!(!public("/ws") && !public("/images/T1-x.webp") && !public("/anything-else"));
        // Other sites stay out, code or not: their own Origin, or a name pointed at this laptop.
        assert_eq!(access(true, guest, host, Some("https://example.com"), true), Access::None);
        assert_eq!(access(true, guest, host, Some("http://192.168.1.5:3000"), true), Access::None);
        assert_eq!(access(true, guest, Some("example.com:4321"), Some("http://example.com:4321"), true), Access::None);
        // From another laptop, "localhost" means that laptop.
        assert_eq!(access(true, guest, Some("localhost:4321"), None, true), Access::None);
        assert_eq!(access(true, guest, host, Some("http://localhost:4321"), true), Access::None);
        // The host's own window needs no code.
        let here = link("127.0.0.1:50000", "127.0.0.1:4321");
        assert_eq!(access(true, here, Some("localhost:4321"), Some("http://localhost:4321"), false), Access::Map);
    }

    #[test]
    fn codes_ignore_case_and_dashes() {
        assert_eq!(normal_code(" K7M2-x9qp "), "k7m2x9qp");
        assert!(same("k7m2x9qp", "k7m2x9qp"));
        assert!(!same("k7m2x9qp", "k7m2x9qq") && !same("k7m2", "k7m2x9qp"));
    }

    #[test]
    fn names_label_thoughts() {
        assert_eq!(speaker_name("  Sam \n Lee "), "Sam Lee");
        assert_eq!(speaker_name(""), "you");
        assert_eq!(speaker_name(&"x".repeat(40)).len(), 24);
    }

    #[test]
    fn where_was_i_is_each_speakers_own() {
        let thread = |id: &str, touched_ms, dropped_by: &str| Thread {
            id: id.into(),
            title: id.into(),
            parent_id: None,
            status: if dropped_by.is_empty() { ThreadStatus::Open } else { ThreadStatus::Dropped },
            last_point: String::new(),
            touched_ms,
            tags: Vec::new(),
            picture: None,
            dropped_by: dropped_by.into(),
        };
        let said = |id: &str, speaker: &str, thread: &str| Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: String::new(),
            point: String::new(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        let mut world = World {
            threads: vec![thread("T1", 1, "User"), thread("T2", 2, "Sam"), thread("T3", 3, ""), thread("T4", 4, "")],
            thoughts: vec![said("a", "Lee", "T3"), said("b", "Sam", "T4"), said("c", "Lee", "T4")],
            ..World::default()
        };
        world.active_by.insert("Lee".into(), "T4".into());
        // Sam dropped T2 more recently, but User's way back is User's own.
        assert_eq!(way_back(&world, "User").as_deref(), Some("T1"));
        assert_eq!(way_back(&world, "Sam").as_deref(), Some("T2"));
        // Nothing dropped: the last other thread Lee spoke on.
        assert_eq!(way_back(&world, "Lee").as_deref(), Some("T3"));
    }
}
