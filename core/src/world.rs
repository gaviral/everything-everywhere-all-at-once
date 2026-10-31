//! The world: every thread and thought, held in memory. Each change is applied here,
//! appended to the journal on disk, and sent to every connected UI.

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThreadStatus {
    Open,
    Dropped,
}

/// A branch of the talk: a topic or a tangent.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub status: ThreadStatus,
    pub last_point: String,
    pub touched_ms: u64,
}

/// One finished spoken or typed turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Thought {
    pub id: String,
    pub speaker: String,
    pub text: String,
    /// The short version the placer writes; empty until placed.
    pub point: String,
    /// Its thread; while pending, the thread that was active when it arrived.
    pub thread_id: Option<String>,
    pub placed: bool,
    pub unclear: String,
    /// False when the thought trailed off unfinished.
    #[serde(default = "yes")]
    pub complete: bool,
    pub at_ms: u64,
    /// How long placement took, for the speed readout.
    pub place_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct World {
    pub threads: Vec<Thread>,
    pub thoughts: Vec<Thought>,
    pub active: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Change {
    ThoughtAdded { thought: Thought },
    ThreadAdded { thread: Thread },
    ThoughtPlaced {
        thought_id: String,
        thread_id: String,
        point: String,
        unclear: String,
        #[serde(default = "yes")]
        complete: bool,
        place_ms: u64,
    },
    ThreadTouched { thread_id: String, last_point: String, at_ms: u64 },
    ThreadStatus { thread_id: String, status: ThreadStatus },
    ActiveChanged { thread_id: String },
}

impl World {
    pub fn apply(&mut self, change: &Change) {
        match change {
            Change::ThoughtAdded { thought } => {
                if !self.thoughts.iter().any(|t| t.id == thought.id) {
                    self.thoughts.push(thought.clone());
                }
            }
            Change::ThreadAdded { thread } => {
                if self.thread(&thread.id).is_none() {
                    self.threads.push(thread.clone());
                }
            }
            Change::ThoughtPlaced { thought_id, thread_id, point, unclear, complete, place_ms } => {
                if let Some(t) = self.thoughts.iter_mut().find(|t| &t.id == thought_id) {
                    t.thread_id = Some(thread_id.clone());
                    t.point = point.clone();
                    t.unclear = unclear.clone();
                    t.complete = *complete;
                    t.placed = true;
                    t.place_ms = Some(*place_ms);
                }
            }
            Change::ThreadTouched { thread_id, last_point, at_ms } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.last_point = last_point.clone();
                    th.touched_ms = *at_ms;
                    th.status = ThreadStatus::Open;
                }
            }
            Change::ThreadStatus { thread_id, status } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.status = *status;
                }
            }
            Change::ActiveChanged { thread_id } => self.active = Some(thread_id.clone()),
        }
    }

    pub fn thread(&self, id: &str) -> Option<&Thread> {
        self.threads.iter().find(|t| t.id == id)
    }

    fn thread_mut(&mut self, id: &str) -> Option<&mut Thread> {
        self.threads.iter_mut().find(|t| t.id == id)
    }

    pub fn next_thread_id(&self) -> String {
        format!("T{}", self.threads.len() + 1)
    }
}

/// Append-only log of changes, written immediately; replayed on start so the app
/// opens exactly where you left it.
pub struct Journal {
    file: File,
}

impl Journal {
    pub fn open(path: &Path) -> anyhow::Result<(Journal, World)> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut world = World::default();
        if path.exists() {
            for line in BufReader::new(File::open(path)?).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Change>(&line) {
                    Ok(change) => world.apply(&change),
                    Err(e) => tracing::warn!("skipping a journal line I can't read: {e}"),
                }
            }
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok((Journal { file }, world))
    }

    pub fn append(&mut self, change: &Change) -> anyhow::Result<()> {
        let mut line = serde_json::to_string(change)?;
        line.push('\n');
        self.file.write_all(line.as_bytes())?;
        self.file.flush()?;
        Ok(())
    }
}
