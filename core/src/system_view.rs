//! A passive, local-only projection. No prompts, words, identities, paths or journal reads.
use axum::{extract::{ConnectInfo, State}, response::{IntoResponse, Response, Sse}, response::sse::{Event, KeepAlive}};
use serde::Serialize;
use std::{collections::BTreeMap, convert::Infallible, sync::Arc, time::Duration};
use tokio::sync::broadcast;
use crate::{Core, Link, ServerMsg};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct Message {
    from: &'static str,
    to: &'static str,
    label: &'static str,
}
impl Message {
    fn new(from: &'static str, to: &'static str, label: &'static str) -> Self { Self { from, to, label } }
}

pub struct Runtime { updates: broadcast::Sender<Message> }
impl Default for Runtime {
    fn default() -> Self { Self { updates: broadcast::channel(256).0 } }
}
impl Runtime {
    fn emit(&self, message: Message) { let _ = self.updates.send(message); }
    pub fn saved(&self, changes: usize) {
        if changes > 0 { self.emit(Message::new("core", "journal", "transaction saved")); }
    }
    pub fn frame(&self, frame: &axum::extract::ws::Message) {
        use axum::extract::ws::Message::*;
        let label = match frame { Text(_) => "text frame", Binary(_) => "audio frame", _ => return };
        self.emit(Message::new("browser", "core", label));
    }
    pub fn observe(&self, message: &ServerMsg) {
        if self.updates.receiver_count() == 0 { return; }
        if let Some(message) = project(message) { self.emit(message); }
    }
}

fn component(step: &str) -> Option<&'static str> {
    match step {
        "placer" => Some("placer"), "refiner" => Some("refiner"),
        "listen" => Some("speech"), "flow" | "flow-plan" => Some("flow"),
        "coding" => Some("agents"),
        s if s.starts_with("helpers_") => Some("helpers"),
        _ => None,
    }
}
fn project(message: &ServerMsg) -> Option<Message> {
    match message {
        ServerMsg::Step { step, model: Some(_), done, ok, dropped, .. } => {
            let part = component(step)?;
            let label = if !done { "started" } else if *dropped { "cancelled" } else if *ok { "completed" } else { "failed" };
            Some(if *done { Message::new(part, "core", label) } else { Message::new("core", part, label) })
        }
        ServerMsg::Change { .. } => Some(Message::new("core", "browser", "map change")),
        ServerMsg::Partial { .. } => Some(Message::new("core", "browser", "speech draft")),
        ServerMsg::Job { job, .. } if !job.demo => job_message(&job.status),
        _ => None,
    }
}
fn job_message(status: &str) -> Option<Message> {
    let label = match status {
        "preparing" => "job preparing", "queued" => "job queued", "running" => "job running",
        "waiting" => "job waiting", "done" => "job done", "failed" => "job failed", "stopped" => "job stopped",
        _ => return None,
    };
    Some(Message::new("agents", "core", label))
}

#[derive(Serialize)]
struct Counted { #[serde(flatten)] message: Message, count: u64 }
#[derive(Serialize)]
struct Batch { sequence: u64, observed_at: u64, messages: Vec<Counted>, missed: u64 }
struct Subscription {
    updates: broadcast::Receiver<Message>,
    tick: tokio::time::Interval,
    pending: BTreeMap<Message, u64>,
    sequence: u64,
    missed: u64,
}
impl Subscription {
    fn new(runtime: &Runtime) -> Self {
        let period = Duration::from_millis(800);
        Self { updates: runtime.updates.subscribe(), tick: tokio::time::interval_at(tokio::time::Instant::now() + period, period), pending: BTreeMap::new(), sequence: 0, missed: 0 }
    }
    fn flush(&mut self) -> Batch {
        self.sequence += 1;
        Batch { sequence: self.sequence, observed_at: crate::now_ms(),
            messages: std::mem::take(&mut self.pending).into_iter().map(|(message, count)| Counted { message, count }).collect(),
            missed: std::mem::take(&mut self.missed) }
    }
    async fn next(&mut self) -> Option<Event> {
        loop {
            tokio::select! {
                result = self.updates.recv() => match result {
                    Ok(message) => *self.pending.entry(message).or_default() += 1,
                    Err(broadcast::error::RecvError::Lagged(n)) => self.missed += n,
                    Err(broadcast::error::RecvError::Closed) => return None,
                },
                _ = self.tick.tick() => {
                    if !self.pending.is_empty() || self.missed > 0 { return Some(Event::default().json_data(self.flush()).expect("static metadata serializes")); }
                }
            }
        }
    }
}

pub async fn events(State(core): State<Arc<Core>>, ConnectInfo(link): ConnectInfo<Link>) -> Response {
    if let Err(status) = crate::code_canvas::admission(std::env::var("E2A2O_CODE_CANVAS").as_deref() == Ok("1"), link.from.ip(), link.to.ip()) {
        return status.into_response();
    }
    let stream = futures_util::stream::unfold(Subscription::new(&core.system_view), |mut source| async move {
        source.next().await.map(|event| (Ok::<_, Infallible>(event), source))
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))).into_response()
}

#[cfg(test)]
mod tests;
