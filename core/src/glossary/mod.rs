//! Optional vocabulary: a separate, bounded connection owns its opt-in; old speech is never rewritten.
use std::{collections::HashMap, fs::OpenOptions, io::Write, path::Path, sync::{Arc, Mutex}};
use axum::{extract::{ConnectInfo, Query, State, ws::{Message, WebSocket, WebSocketUpgrade}}, response::{IntoResponse, Response}, http::StatusCode};
use serde::{Deserialize, Serialize};
use crate::{Core, Link, Seat};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Term { pub term: String, pub explanation: String }
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Record { pub revision: u64, pub terms: Vec<Term> }
#[derive(Deserialize, Serialize)]
struct Entry { version: u8, map: String, owner: String, record: Record }
#[derive(Default)]
pub struct Runtime {
    active: Mutex<HashMap<String, usize>>,
    records: Mutex<Option<Result<HashMap<String, Record>, String>>>,
}

pub fn key(text: &str) -> String { text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase() }
fn validate(terms: &[Term]) -> Result<(), String> {
    if terms.len() > 30 { return Err("Keep at most 30 terms.".into()); }
    let mut seen = std::collections::HashSet::new();
    for item in terms {
        if key(&item.term).is_empty() || item.term.chars().count() > 40 || item.term.chars().any(char::is_control) {
            return Err("Each term needs 1–40 characters on one line.".into());
        }
        if item.explanation.chars().count() > 160 || item.explanation.chars().any(char::is_control) {
            return Err("Keep each explanation to 160 characters on one line.".into());
        }
        if !seen.insert(key(&item.term)) { return Err("That term is already in the list, ignoring case and spacing.".into()); }
    }
    if terms.iter().map(|t| t.term.chars().count() + 2).sum::<usize>() > 1200 {
        return Err("Shorten the vocabulary to 1,200 characters including separators.".into());
    }
    Ok(())
}
fn load(path: &Path, map: &str) -> Result<HashMap<String, Record>, String> {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(_) => return Err("Saved vocabulary is unreadable. Existing data has been preserved.".into()),
    };
    let mut records = HashMap::new();
    for line in source.lines() {
        let entry: Entry = serde_json::from_str(line).map_err(|_| "Saved vocabulary needs recovery. Existing data has been preserved.")?;
        if entry.version != 1 || entry.map != map || validate(&entry.record.terms).is_err() {
            return Err("Saved vocabulary belongs to another version or map. Existing data has been preserved.".into());
        }
        records.insert(entry.owner, entry.record);
    }
    Ok(records)
}
impl Runtime {
    fn access<T>(&self, path: &Path, map: &str, run: impl FnOnce(&mut HashMap<String, Record>) -> Result<T, String>) -> Result<T, String> {
        let mut state = self.records.lock().unwrap();
        let result = state.get_or_insert_with(|| load(path, map));
        run(result.as_mut().map_err(|e| e.clone())?)
    }
    fn read(&self, path: &Path, map: &str, owner: &str) -> Result<Record, String> {
        self.access(path, map, |records| Ok(records.get(owner).cloned().unwrap_or_default()))
    }
    fn save(&self, path: &Path, map: &str, owner: &str, revision: u64, terms: Vec<Term>) -> Result<Record, String> {
        validate(&terms)?;
        // Hold the lock through fsync, so another window cannot acknowledge an obsolete revision.
        let mut state = self.records.lock().unwrap();
        let records = state.get_or_insert_with(|| load(path, map)).as_mut().map_err(|e| e.clone())?;
        let current = records.get(owner).cloned().unwrap_or_default();
        if current.revision != revision { return Err("Another window changed your words. Reconnect to review its saved list; your draft stays here.".into()); }
        if records.len() >= 100 && !records.contains_key(owner) { return Err("This map has vocabulary for 100 people already.".into()); }
        let record = Record { revision: revision.checked_add(1).ok_or("Vocabulary revision limit reached.")?, terms };
        let entry = Entry { version: 1, map: map.into(), owner: owner.into(), record: record.clone() };
        let mut bytes = serde_json::to_vec(&entry).map_err(|_| "Could not encode vocabulary.")?;
        bytes.push(b'\n');
        let saved = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new().create(true).append(true).open(path)?;
            file.write_all(&bytes)?; file.sync_all()?;
            if let Some(parent) = path.parent() { std::fs::File::open(parent)?.sync_all()?; }
            Ok(())
        })();
        if saved.is_err() {
            // A partial append must never be followed by another write in this process.
            *state = Some(Err("Could not save vocabulary. Reconnect after storage is repaired; the previous data is preserved.".into()));
            return Err("Could not save vocabulary. It has not been acknowledged as saved.".into());
        }
        records.insert(owner.into(), record.clone());
        Ok(record)
    }
    pub fn keywords(&self, speaker: &str) -> Vec<String> {
        if !self.active.lock().unwrap().get(speaker).is_some_and(|n| *n > 0) { return vec![]; }
        let state = self.records.lock().unwrap();
        state.as_ref().and_then(|r| r.as_ref().ok()).and_then(|r| r.get(speaker))
            .map(|r| r.terms.iter().map(|t| t.term.clone()).collect()).unwrap_or_default()
    }
}
struct Enabled { core: Arc<Core>, speaker: String }
impl Enabled {
    fn new(core: Arc<Core>, speaker: String) -> Self {
        *core.glossary.active.lock().unwrap().entry(speaker.clone()).or_default() += 1;
        Self { core, speaker }
    }
}
impl Drop for Enabled {
    fn drop(&mut self) {
        let mut active = self.core.glossary.active.lock().unwrap();
        if let Some(n) = active.get_mut(&self.speaker) { *n -= 1; if *n == 0 { active.remove(&self.speaker); } }
    }
}
#[derive(Deserialize)]
pub struct Join { name: String, map: String }
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Request { Enable, Save { revision: u64, terms: Vec<Term> } }

pub async fn connect(upgrade: WebSocketUpgrade, Query(join): Query<Join>, ConnectInfo(link): ConnectInfo<Link>, State(core): State<Arc<Core>>) -> Response {
    if join.map != core.journal.lock().unwrap().map_id() {
        return (StatusCode::CONFLICT, "Wait for this map to identify itself.").into_response();
    }
    let speaker = crate::speaker_name(&join.name, link.here());
    let Some(seat) = Seat::take(&core, &speaker, link) else { return (StatusCode::CONFLICT, "That name is taken.").into_response(); };
    upgrade.max_message_size(16 << 10).max_frame_size(16 << 10)
        .on_upgrade(move |socket| session(socket, core, speaker, join.map, seat))
}
async fn reply(socket: &mut WebSocket, result: Result<Record, String>, saved: bool) -> bool {
    let value = match result {
        Ok(record) => serde_json::json!({"ok":true,"saved":saved,"record":record}),
        Err(message) => serde_json::json!({"ok":false,"message":message}),
    };
    socket.send(Message::Text(value.to_string().into())).await.is_ok()
}
async fn session(mut socket: WebSocket, core: Arc<Core>, speaker: String, map: String, _seat: Seat) {
    let path = Path::new(&crate::data_dir()).join("my-words.jsonl");
    let mut enabled = None;
    while let Some(Ok(message)) = socket.recv().await {
        let Message::Text(text) = message else { if matches!(message, Message::Close(_)) { break; } continue; };
        let result = match serde_json::from_str::<Request>(&text) {
            Ok(Request::Enable) => {
                let record = core.glossary.read(&path, &map, &speaker);
                if record.is_ok() && enabled.is_none() { enabled = Some(Enabled::new(core.clone(), speaker.clone())); }
                if !reply(&mut socket, record, false).await { break; }
                continue;
            }
            Ok(Request::Save { revision, terms }) if enabled.is_some() => core.glossary.save(&path, &map, &speaker, revision, terms),
            Ok(_) => Err("Enable My words before saving.".into()),
            Err(_) => Err("The vocabulary request was not understood.".into()),
        };
        if !reply(&mut socket, result, true).await { break; }
    }
}

#[cfg(test)]
mod tests;
