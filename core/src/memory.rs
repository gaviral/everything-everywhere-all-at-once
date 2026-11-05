//! Opt-in, in-RAM memory. The index, context selection, speculation and answer
//! reuse are separate parts; no model, disk store or background task lives here.

mod answers;
mod context;
mod index;
#[cfg(test)]
mod tests;

use crate::{
    world::{Change, Thought, World},
    Core,
};
use answers::{Answers, Ticket};
use axum::{extract::State, Json};
pub(crate) use context::Context;
use index::Index;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Clone, Default, Serialize)]
pub struct Stats {
    pub enabled: bool,
    pub thoughts_indexed: usize,
    pub lookup_us: u64,
    pub bytes_saved: u64,
    pub last_bytes_saved: u64,
    pub context_calls: u64,
    pub cache_hits: u64,
    pub prefetch_hits: u64,
}

struct Prefetch {
    query: String,
    topic: Option<String>,
    context: Context,
}

#[derive(Default)]
struct Memory {
    index: Index,
    answers: Answers,
    prefetched: HashMap<String, Prefetch>,
    stats: Stats,
}

#[derive(Default)]
pub struct Runtime {
    enabled: AtomicBool,
    environment: bool,
    clients: Mutex<HashSet<u64>>,
    state: Mutex<Memory>,
}

impl Runtime {
    pub fn placement_context(
        &self,
        world: &World,
        thought: &Thought,
        model: &str,
        room: u32,
        new_thread: bool,
    ) -> Option<Context> {
        let mut context = self.context(
            &thought.speaker,
            &thought.text,
            world.active_for(&thought.speaker).map(String::as_str),
            Some(&thought.id),
        )?;
        context.prepare_placement(world, thought, model, room, new_thread);
        Some(context)
    }

    pub fn from_env(world: &World) -> Self {
        Self::configured(std::env::var("E2A2O_MEMORY").as_deref() == Ok("1"), world)
    }

    fn configured(environment: bool, world: &World) -> Self {
        let runtime = Self {
            environment,
            ..Self::default()
        };
        runtime.switch(0, false, world);
        runtime
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    /// Called under the world's commit lock. One window cannot disable another's
    /// feature, and disconnect releases only that window's opt-in.
    pub fn switch(&self, client: u64, on: bool, world: &World) {
        let mut clients = self.clients.lock().unwrap();
        if on {
            clients.insert(client);
        } else {
            clients.remove(&client);
        }
        let enabled = self.environment || !clients.is_empty();
        if enabled == self.enabled() {
            return;
        }
        let mut state = self.state.lock().unwrap();
        state.index = if enabled {
            Index::from_world(world)
        } else {
            Index::default()
        };
        state.answers.invalidate();
        state.prefetched.clear();
        state.stats = Stats::default();
        self.enabled.store(enabled, Ordering::Release);
    }

    /// Only committed changes enter the index. Simple thought changes update one
    /// posting list; topology/tag changes rebuild their derived membership.
    pub fn changed(&self, change: &Change, world: &World) {
        if !self.enabled() {
            return;
        }
        let mut state = self.state.lock().unwrap();
        if !state.index.changed(change, world) {
            return;
        }
        state.answers.invalidate();
        // A pending arrival does not invalidate the partial that predicted it.
        if !matches!(change, Change::ThoughtAdded { thought } if !thought.placed) {
            state.prefetched.clear();
        }
    }

    pub fn speculate(&self, speaker: &str, query: &str, topic: Option<&str>) {
        if !self.enabled() || query.trim().is_empty() {
            return;
        }
        let mut state = self.state.lock().unwrap();
        let query = context::normalized(query);
        if state
            .prefetched
            .get(speaker)
            .is_some_and(|p| p.query == query && p.topic.as_deref() == topic)
        {
            return;
        }
        let context = context::select(&state.index, &query, topic, None);
        state.stats.lookup_us = context.lookup_us;
        if state.prefetched.len() >= 64 {
            state.prefetched.clear();
        }
        state.prefetched.insert(
            speaker.into(),
            Prefetch {
                query,
                topic: topic.map(String::from),
                context,
            },
        );
    }

    pub fn context(
        &self,
        speaker: &str,
        query: &str,
        topic: Option<&str>,
        exclude: Option<&str>,
    ) -> Option<Context> {
        if !self.enabled() {
            return None;
        }
        let mut state = self.state.lock().unwrap();
        let normalized = context::normalized(query);
        let ready = state
            .prefetched
            .remove(speaker)
            .filter(|p| p.query == normalized && p.topic.as_deref() == topic);
        let context = match ready {
            Some(p) if !exclude.is_some_and(|id| p.context.thought_ids.contains(id)) => {
                state.stats.prefetch_hits += 1;
                p.context
            }
            _ => context::select(&state.index, query, topic, exclude),
        };
        state.stats.lookup_us = context.lookup_us;
        Some(context)
    }

    /// Count once per actual request (including racing lanes), never for a partial
    /// transcript or a cache hit. Each trace also carries this call's byte saving.
    pub fn sent(&self, extra: &Value) {
        if !self.enabled() {
            return;
        }
        if let Some(bytes) = extra["memory_bytes_saved"].as_u64() {
            let mut state = self.state.lock().unwrap();
            state.stats.last_bytes_saved = bytes;
            state.stats.bytes_saved += bytes;
            state.stats.context_calls += 1;
        }
    }

    pub fn answer(&self, url: &str, body: &Value) -> (Option<Value>, Option<Ticket>) {
        if !self.enabled() {
            return (None, None);
        }
        let mut state = self.state.lock().unwrap();
        let (answer, ticket) = state.answers.lookup(url, body);
        if answer.is_some() {
            state.stats.cache_hits += 1;
        }
        (answer, ticket)
    }

    pub fn remember(&self, ticket: Option<Ticket>, answer: &Value) {
        if !self.enabled() {
            return;
        }
        if let Some(ticket) = ticket {
            self.state.lock().unwrap().answers.remember(ticket, answer);
        }
    }

    pub fn stats(&self) -> Stats {
        let state = self.state.lock().unwrap();
        Stats {
            enabled: self.enabled(),
            thoughts_indexed: state.index.len(),
            ..state.stats.clone()
        }
    }
}

pub async fn read(State(core): State<Arc<Core>>) -> Json<Stats> {
    Json(core.memory.stats())
}

impl Core {
    pub(crate) fn memory_switch(&self, client: u64, on: bool) {
        let world = self.world.lock().unwrap();
        self.memory.switch(client, on, &world);
    }
}
