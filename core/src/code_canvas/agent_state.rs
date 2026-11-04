//! Explicitly configured local feed and durable answer receipts. No model or git writes.
use axum::{extract::ConnectInfo, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}};

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Lane {
    id: String,
    branch: String,
    who: String,
    now: String,
    finished: Vec<String>,
    state: String,
    updated_at: String,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Need { pub id: String, title: String, detail: String, lane: String }
#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct AgentState {
    pub updated_at: String,
    pub lanes: Vec<Lane>,
    pub needs_you: Vec<Need>,
    pub summary: Vec<String>,
    pub notice: String,
    pub available: bool,
}

fn configured_path() -> Option<PathBuf> { std::env::var_os("E2A2O_AGENT_STATE").filter(|p| !p.is_empty()).map(PathBuf::from) }
fn answer_directory(path: &Path) -> PathBuf { path.with_extension("answers") }
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
fn load(path: &Path) -> Result<AgentState, ()> {
    if fs::metadata(path).map_err(|_| ())?.len() > 1_048_576 { return Err(()) }
    serde_json::from_slice(&fs::read(path).map_err(|_| ())?).map_err(|_| ())
}
fn read_path(path: &Path) -> AgentState {
    match load(path) {
        Ok(mut state) => {
            state.available = true;
            state.needs_you.retain(|need| valid_id(&need.id) && !answer_directory(path).join(format!("{}.json", need.id)).is_file());
            state
        }
        Err(_) => AgentState { notice: "Agent updates unavailable. Waiting for the local feed; prior cards stay until answered.".into(), ..Default::default() },
    }
}
pub fn read() -> AgentState {
    configured_path().map(|p| read_path(&p)).unwrap_or_else(|| AgentState { notice: "Agent feed is off. Connect a local state file to see who is working.".into(), ..Default::default() })
}

#[derive(Deserialize, Serialize)]
pub struct Answer { id: String, answer: String }
fn save_answer(path: &Path, answer: &Answer) -> Result<(), StatusCode> {
    if !valid_id(&answer.id) || answer.answer.trim().is_empty() || answer.answer.len() > 4000 { return Err(StatusCode::BAD_REQUEST) }
    let state = load(path).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !state.needs_you.iter().any(|n| n.id == answer.id) { return Err(StatusCode::CONFLICT) }
    let directory = answer_directory(path);
    fs::create_dir_all(&directory).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let pending = directory.join(format!(".{}.json", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&pending).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    file.write_all(&serde_json::to_vec(answer).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?).and_then(|_| file.sync_all()).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    fs::rename(pending, directory.join(format!("{}.json", answer.id))).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
pub async fn answer(ConnectInfo(link): ConnectInfo<crate::Link>, Json(answer): Json<Answer>) -> Response {
    if let Err(status) = super::admission(std::env::var("E2A2O_CODE_CANVAS").as_deref() == Ok("1"), link.from.ip(), link.to.ip()) { return status.into_response() }
    let Some(path) = configured_path() else { return StatusCode::SERVICE_UNAVAILABLE.into_response() };
    match tokio::task::spawn_blocking(move || save_answer(&path, &answer)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(status)) => status.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_answers_survive_feed_refresh_and_reject_unknown_requests() {
        let root = std::env::temp_dir().join(format!("agent-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("state.json");
        fs::write(&path, r#"{"needs_you":[{"id":"ask-1","title":"Choose a direction"}]}"#).unwrap();
        assert_eq!(read_path(&path).needs_you.len(), 1);
        assert_eq!(save_answer(&path, &Answer { id: "../bad".into(), answer: "Yes".into() }), Err(StatusCode::BAD_REQUEST));
        assert_eq!(save_answer(&path, &Answer { id: "missing".into(), answer: "Yes".into() }), Err(StatusCode::CONFLICT));
        save_answer(&path, &Answer { id: "ask-1".into(), answer: "Use the first direction".into() }).unwrap();
        assert_eq!(read_path(&path).needs_you.len(), 0);
        assert!(answer_directory(&path).join("ask-1.json").is_file());
        fs::write(&path, "broken update").unwrap();
        assert!(!read_path(&path).available);
    }
}
