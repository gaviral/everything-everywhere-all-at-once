//! E2A2O core: holds the world in memory, journals every change, listens through
//! Muse Voice Transcribe, places thoughts with Muse Spark, and keeps every UI in sync.

mod asr;
mod placer;
mod protocol;
mod world;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, ServerMsg};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::{ServeDir, ServeFile};
use world::{Change, Journal, Thought, World};

pub struct Core {
    world: Mutex<World>,
    journal: Mutex<Journal>,
    updates: broadcast::Sender<ServerMsg>,
    placer_queue: mpsc::UnboundedSender<String>,
    pub key: Option<String>,
    pub placer_model: String,
    pub http: reqwest::Client,
}

impl Core {
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

    /// A new thought lands in the active thread at once; the placer moves it if needed.
    pub fn add_thought(&self, speaker: &str, text: &str) {
        let active = self.world.lock().unwrap().active.clone();
        let thought = Thought {
            id: format!("th-{}", uuid::Uuid::new_v4().simple()),
            speaker: speaker.into(),
            text: text.into(),
            point: String::new(),
            thread_id: active,
            placed: false,
            unclear: String::new(),
            complete: true,
            at_ms: now_ms(),
            place_ms: None,
        };
        let id = thought.id.clone();
        self.commit(vec![Change::ThoughtAdded { thought }]);
        let _ = self.placer_queue.send(id);
    }
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
        world: Mutex::new(world),
        journal: Mutex::new(journal),
        updates,
        placer_queue,
        key,
        placer_model: std::env::var("PLACER_MODEL").unwrap_or_else(|_| "muse-spark-1.2-contributor".into()),
        http: reqwest::Client::new(),
    });
    tokio::spawn(placer::run(core.clone(), queue));
    for id in pending {
        let _ = core.placer_queue.send(id);
    }

    let ui = std::env::var("E2A2O_UI").unwrap_or_else(|_| "../ui/dist".into());
    let app = Router::new()
        .route("/ws", get(connect))
        .fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(format!("{ui}/index.html"))))
        .with_state(core);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4321);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("E2A2O core on http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
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
    let forward = tokio::spawn(async move {
        loop {
            match updates.recv().await {
                Ok(message) => {
                    let text = serde_json::to_string(&message).unwrap();
                    if out.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    let mut audio: Option<mpsc::Sender<Vec<u8>>> = None;
    while let Some(Ok(message)) = incoming.next().await {
        match message {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(text.as_str()) {
                Ok(ClientMsg::Text { text }) if !text.trim().is_empty() => core.add_thought("you", text.trim()),
                Ok(ClientMsg::Listen { on: true }) if audio.is_none() => {
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
                Ok(ClientMsg::Listen { on: false }) => audio = None,
                Ok(ClientMsg::Focus { thread_id }) => {
                    if core.snapshot().thread(&thread_id).is_some() {
                        core.commit(vec![Change::ActiveChanged { thread_id }]);
                    }
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
}
