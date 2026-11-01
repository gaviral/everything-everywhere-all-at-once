//! The world: every thread and thought, held in memory. Each change is applied here,
//! appended to the journal on disk, and sent to every connected UI.

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
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
    /// Hashtags: AI-suggested ones stay faded until kept.
    #[serde(default)]
    pub tags: Vec<Tag>,
    /// A Muse Image picture that anchors the thread in memory.
    #[serde(default)]
    pub picture: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub kept: bool,
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
    /// What the unclear words most likely were, for "Did you mean …?"; empty when there's no good guess.
    #[serde(default)]
    pub guess: String,
    /// False when the thought trailed off unfinished.
    #[serde(default = "yes")]
    pub complete: bool,
    pub at_ms: u64,
    /// How long placement took, for the speed readout.
    pub place_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    New,
    Kept,
    Dismissed,
    Done,
}

/// An AI idea on a branch ("you could try this with that"); faded until kept.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Suggestion {
    pub id: String,
    pub thread_id: String,
    pub text: String,
    pub status: ItemStatus,
}

/// A task or event the talk decided on; waits for approval before it touches an app.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub thread_id: String,
    /// "reminder" or "event".
    pub kind: String,
    pub title: String,
    /// YYYY-MM-DD, or empty.
    pub when: String,
    pub status: ItemStatus,
    pub done_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct World {
    pub threads: Vec<Thread>,
    pub thoughts: Vec<Thought>,
    pub active: Option<String>,
    #[serde(default)]
    pub suggestions: Vec<Suggestion>,
    #[serde(default)]
    pub actions: Vec<Action>,
    /// Merged thread id → the thread it became, so late changes still land.
    #[serde(default)]
    pub merged: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub apps: Vec<crate::apps::MiniApp>,
    #[serde(default)]
    pub apps_seeded: bool,
}

/// Journal lines, so old journals must keep loading: give every field added later `#[serde(default)]`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Change {
    AppRegistered { app: crate::apps::MiniApp },
    AppEnabled { id: String, enabled: bool },
    AppRemoved { id: String },
    AppRan { id: String, at_ms: u64 },
    AppOutput { id: String, sound: bool },
    AppsSeeded,
    ThoughtAdded { thought: Thought },
    ThreadAdded { thread: Thread },
    ThoughtPlaced {
        thought_id: String,
        thread_id: String,
        point: String,
        unclear: String,
        #[serde(default)]
        guess: String,
        #[serde(default = "yes")]
        complete: bool,
        place_ms: u64,
    },
    ThreadTouched { thread_id: String, last_point: String, at_ms: u64 },
    ThreadStatus { thread_id: String, status: ThreadStatus },
    ActiveChanged { thread_id: String },
    ThreadRenamed { thread_id: String, title: String },
    ThreadMerged { from: String, into: String },
    SuggestionAdded { suggestion: Suggestion },
    ActionProposed { action: Action },
    ItemStatus { id: String, status: ItemStatus, done_ms: Option<u64> },
    TagSuggested { thread_id: String, tag: String },
    TagKept { thread_id: String, tag: String },
    TagRemoved { thread_id: String, tag: String },
    ThreadPicture { thread_id: String, path: String },
    /// "Did you mean …?" answered: yes swaps the unclear words for the guess, no keeps them; either way the question goes.
    ThoughtCorrected { thought_id: String, accept: bool },
}

impl World {
    /// Follows merges, so a change aimed at a merged thread lands on its successor.
    /// At most one hop per merge, so a corrupt journal with a cycle can't loop forever.
    pub fn resolve(&self, id: &str) -> String {
        let mut id = id.to_string();
        for _ in 0..self.merged.len() {
            match self.merged.get(&id) {
                Some(next) => id = next.clone(),
                None => break,
            }
        }
        id
    }

    pub fn apply(&mut self, change: &Change) {
        let change = &self.resolved(change);
        match change {
            Change::AppRegistered { app } => {
                if !self.apps.iter().any(|a| a.id == app.id) { self.apps.push(app.clone()); }
            }
            Change::AppEnabled { id, enabled } => {
                if let Some(a) = self.apps.iter_mut().find(|a| &a.id == id) { a.enabled = *enabled; }
            }
            Change::AppRemoved { id } => self.apps.retain(|a| &a.id != id),
            Change::AppRan { id, at_ms } => {
                if let Some(a) = self.apps.iter_mut().find(|a| &a.id == id) { a.last_run_ms = *at_ms; }
            }
            Change::AppOutput { id, sound } => {
                if let Some(a) = self.apps.iter_mut().find(|a| &a.id == id && matches!(a.watcher, crate::apps::Watcher::Volume { .. })) {
                    a.publishers = if *sound { vec![crate::apps::Publisher::Sound {}] }
                        else { vec![crate::apps::Publisher::Card { text: "Voices have been loud for a little while. A small pause might help.".into() }] };
                }
            }
            Change::AppsSeeded => self.apps_seeded = true,
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
            Change::ThoughtPlaced { thought_id, thread_id, point, unclear, guess, complete, place_ms } => {
                if let Some(t) = self.thoughts.iter_mut().find(|t| &t.id == thought_id) {
                    t.thread_id = Some(thread_id.clone());
                    t.point = point.clone();
                    t.unclear = unclear.clone();
                    t.guess = guess.clone();
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
            Change::ThreadRenamed { thread_id, title } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.title = title.clone();
                }
            }
            Change::ThreadMerged { from, into } => {
                if from == into || self.thread(into).is_none() {
                    return;
                }
                for t in self.thoughts.iter_mut().filter(|t| t.thread_id.as_deref() == Some(from.as_str())) {
                    t.thread_id = Some(into.clone());
                }
                for th in self.threads.iter_mut().filter(|t| t.parent_id.as_deref() == Some(from.as_str())) {
                    th.parent_id = Some(into.clone());
                }
                for s in self.suggestions.iter_mut().filter(|s| &s.thread_id == from) {
                    s.thread_id = into.clone();
                }
                for a in self.actions.iter_mut().filter(|a| &a.thread_id == from) {
                    a.thread_id = into.clone();
                }
                if self.active.as_deref() == Some(from.as_str()) {
                    self.active = Some(into.clone());
                }
                self.threads.retain(|t| &t.id != from);
                self.merged.insert(from.clone(), into.clone());
            }
            Change::ThoughtCorrected { thought_id, accept } => {
                let Some(t) = self.thoughts.iter_mut().find(|t| &t.id == thought_id) else { return };
                let (old_point, thread_id) = (t.point.clone(), t.thread_id.clone());
                if *accept && !t.unclear.is_empty() && !t.guess.is_empty() {
                    t.text = swap(&t.text, &t.unclear, &t.guess);
                    t.point = swap(&t.point, &t.unclear, &t.guess);
                }
                t.unclear.clear();
                t.guess.clear();
                let point = t.point.clone();
                // The thread's last point is a copy; keep it in step.
                if let Some(th) = thread_id.and_then(|id| self.thread_mut(&id)) {
                    if th.last_point == old_point {
                        th.last_point = point;
                    }
                }
            }
            Change::SuggestionAdded { suggestion } => {
                if !self.suggestions.iter().any(|s| s.id == suggestion.id) {
                    self.suggestions.push(suggestion.clone());
                }
            }
            Change::ActionProposed { action } => {
                if !self.actions.iter().any(|a| a.id == action.id) {
                    self.actions.push(action.clone());
                }
            }
            Change::TagSuggested { thread_id, tag } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    if !th.tags.iter().any(|t| t.name == *tag) {
                        th.tags.push(Tag { name: tag.clone(), kept: false });
                    }
                }
            }
            Change::TagKept { thread_id, tag } => {
                if let Some(t) = self.thread_mut(thread_id).and_then(|th| th.tags.iter_mut().find(|t| t.name == *tag)) {
                    t.kept = true;
                }
            }
            Change::TagRemoved { thread_id, tag } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.tags.retain(|t| t.name != *tag);
                }
            }
            Change::ThreadPicture { thread_id, path } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.picture = Some(path.clone());
                }
            }
            Change::ItemStatus { id, status, done_ms } => {
                if let Some(s) = self.suggestions.iter_mut().find(|s| &s.id == id) {
                    s.status = *status;
                }
                if let Some(a) = self.actions.iter_mut().find(|a| &a.id == id) {
                    a.status = *status;
                    a.done_ms = *done_ms;
                }
            }
        }
    }

    /// The same change with thread ids followed through merges.
    fn resolved(&self, change: &Change) -> Change {
        let mut c = change.clone();
        match &mut c {
            Change::ThoughtPlaced { thread_id, .. }
            | Change::ThreadTouched { thread_id, .. }
            | Change::ThreadStatus { thread_id, .. }
            | Change::ActiveChanged { thread_id }
            | Change::ThreadRenamed { thread_id, .. }
            | Change::TagSuggested { thread_id, .. }
            | Change::TagKept { thread_id, .. }
            | Change::TagRemoved { thread_id, .. }
            | Change::ThreadPicture { thread_id, .. } => *thread_id = self.resolve(thread_id),
            Change::SuggestionAdded { suggestion } => suggestion.thread_id = self.resolve(&suggestion.thread_id),
            Change::ActionProposed { action } => action.thread_id = self.resolve(&action.thread_id),
            _ => {}
        }
        c
    }

    pub fn thread(&self, id: &str) -> Option<&Thread> {
        self.threads.iter().find(|t| t.id == id)
    }

    fn thread_mut(&mut self, id: &str) -> Option<&mut Thread> {
        self.threads.iter_mut().find(|t| t.id == id)
    }

    /// Never reuses an id, even after merges remove threads.
    pub fn next_thread_id(&self) -> String {
        format!("T{}", self.threads.len() + self.merged.len() + 1)
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
            for (n, line) in BufReader::new(File::open(path)?).lines().enumerate() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Change>(&line) {
                    Ok(change) => world.apply(&change),
                    Err(e) => tracing::warn!("skipping journal line {} that I can't read: {e}", n + 1),
                }
            }
        }
        let mut file = OpenOptions::new().create(true).read(true).append(true).open(path)?;
        // A crash mid-write can leave a partial last line; start the next change on a fresh one.
        let len = file.metadata()?.len();
        if len > 0 {
            let mut last = [0u8];
            file.seek(SeekFrom::Start(len - 1))?;
            file.read_exact(&mut last)?;
            if last[0] != b'\n' {
                file.write_all(b"\n")?;
            }
        }
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

/// Replaces the first match of `from` in `text` with `to`; unchanged when there's none. Ignores case
/// when lowercasing keeps the byte length (so offsets still line up), else matches exactly.
fn swap(text: &str, from: &str, to: &str) -> String {
    let (lower, lower_from) = (text.to_lowercase(), from.to_lowercase());
    let found = if lower.len() == text.len() && lower_from.len() == from.len() { lower.find(&lower_from) } else { text.find(from) };
    match found {
        Some(i) if text.is_char_boundary(i) && text.is_char_boundary(i + from.len()) => {
            format!("{}{}{}", &text[..i], to, &text[i + from.len()..])
        }
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{Change, Thought, World};

    #[test]
    fn a_partial_last_line_doesnt_swallow_the_next_change() {
        let path = std::env::temp_dir().join(format!("e2a2o-journal-{}.jsonl", std::process::id()));
        std::fs::write(&path, "{\"type\":\"active_changed\",\"thread_id\":\"T1\"}\n{\"type\":\"active_ch").unwrap();
        let (mut journal, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T1"));
        journal.append(&Change::ActiveChanged { thread_id: "T2".into() }).unwrap();
        let (_, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T2"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn did_you_mean_swaps_the_words_or_keeps_them() {
        let thought = |id: &str| Thought {
            id: id.into(),
            speaker: "you".into(),
            text: "ask muse bark about it".into(),
            point: "Ask Muse Bark".into(),
            thread_id: None,
            placed: true,
            unclear: "Muse Bark".into(),
            guess: "Muse Spark".into(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        let mut world = World { thoughts: vec![thought("a"), thought("b")], ..World::default() };
        world.apply(&Change::ThoughtCorrected { thought_id: "a".into(), accept: true });
        world.apply(&Change::ThoughtCorrected { thought_id: "b".into(), accept: false });
        assert_eq!(world.thoughts[0].text, "ask Muse Spark about it");
        assert_eq!(world.thoughts[0].point, "Ask Muse Spark");
        assert_eq!(world.thoughts[1].text, "ask muse bark about it");
        assert!(world.thoughts.iter().all(|t| t.unclear.is_empty() && t.guess.is_empty()));
        // Letters whose lowercase is longer can't shift the cut.
        assert_eq!(super::swap("İstanbul moose", "moose", "Muse"), "İstanbul Muse");
    }

    #[test]
    fn resolve_follows_merges_and_survives_a_cycle() {
        let mut world = World::default();
        world.merged.insert("T1".into(), "T2".into());
        world.merged.insert("T2".into(), "T3".into());
        assert_eq!(world.resolve("T1"), "T3");
        world.merged.insert("T3".into(), "T1".into());
        world.resolve("T1"); // returns instead of looping forever
    }
}
