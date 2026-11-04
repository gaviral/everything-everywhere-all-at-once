//! Optional local build notifications; disabled unless a build file is supplied.
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock}};
use axum::{extract::State, Json};
use serde::Deserialize;
use crate::{Core, ServerMsg};

fn clients() -> &'static Mutex<HashMap<String, (bool, u64)>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, (bool, u64)>>> = OnceLock::new();
    CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn id() -> Option<String> {
    let path = std::env::var("E2A2O_BUILD_FILE").ok()?;
    std::fs::read_to_string(path).ok().map(|id| id.trim().to_owned())
}
#[derive(Deserialize)]
pub struct Activity { tab: String, busy: bool, #[serde(default)] closed: bool }
pub async fn activity(Json(value): Json<Activity>) {
    if id().is_none() || value.tab.len() > 100 { return; }
    let mut clients = clients().lock().unwrap();
    if value.closed { clients.remove(&value.tab); }
    else { clients.insert(value.tab, (value.busy, crate::now_ms())); }
}
pub async fn status(State(core): State<Arc<Core>>) -> Json<serde_json::Value> {
    let now = crate::now_ms();
    let mut clients = clients().lock().unwrap();
    clients.retain(|_, (_, at)| now.saturating_sub(*at) < 90_000);
    let idle = clients.values().all(|(busy, _)| !busy) && core.quiet_ms() >= 3_000;
    Json(serde_json::json!({"id": id(), "idle": idle}))
}
pub async fn watch(core: Arc<Core>) {
    if std::env::var_os("E2A2O_BUILD_FILE").is_none() { return; }
    let mut previous = id();
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tick.tick().await;
        let current = id();
        if current != previous {
            if let Some(id) = &current { core.send(ServerMsg::BuildAvailable { id: id.clone() }); }
            previous = current;
        }
    }
}
