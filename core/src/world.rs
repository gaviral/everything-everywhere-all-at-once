//! The world: every thread and thought, held in memory. Each change is applied here,
//! appended to the journal on disk, and sent to every connected UI.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

fn yes() -> bool {
    true
}

/// The speaker of changes from before rooms, when there was only one.
fn you() -> String {
    "you".into()
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
    /// While it's dropped: who left it unfinished, so only they are offered it back.
    #[serde(default)]
    pub dropped_by: String,
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
    /// Words the placer was sure it misheard and fixed without asking, as they were heard; empty when nothing was fixed.
    #[serde(default)]
    pub heard: String,
    /// What those words became, so one tap can put them back.
    #[serde(default)]
    pub fixed: String,
    /// False when the thought trailed off unfinished.
    #[serde(default = "yes")]
    pub complete: bool,
    pub at_ms: u64,
    /// How long placement took, for the speed readout.
    pub place_ms: Option<u64>,
}

impl Thought {
    /// When it was said, to tell which came last: imported points land last in the list with their old
    /// times, so list order won't do. A time ahead of the clock (a sample map dated for the demo, a wrong
    /// clock) counts as the earliest, so it can't hide what was just said.
    pub fn said_at(&self, now: u64) -> u64 {
        if self.at_ms > now { 0 } else { self.at_ms }
    }
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
    /// Where the talk is now: the thread whoever moved last is on.
    pub active: Option<String>,
    /// Each speaker's own active thread, so in a room placement and "where was I?" follow the person.
    #[serde(default)]
    pub active_by: std::collections::HashMap<String, String>,
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
    #[serde(default)]
    pub recaps: Vec<crate::recap::Recap>,
    /// Thought id → what the placer read into it: the words it carries on, an assumption, why it went there (chunks.rs).
    #[serde(default)]
    pub notes: std::collections::HashMap<String, crate::chunks::Note>,
    /// Legacy import times: keep skipping these when replaying timestamp-only journal records.
    #[serde(default, skip_serializing)]
    pub read_ms: std::collections::HashSet<u64>,
    /// Stable hashes of messages an import has read, including those that gave no point.
    #[serde(default, skip_serializing)]
    pub read_keys: std::collections::HashSet<String>,
}

/// Journal lines, so old journals must keep loading: give every field added later `#[serde(default)]`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Change {
    RecapSaved { recap: crate::recap::Recap },
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
        /// A fix the placer was sure of: these words in the text become `fixed` (the point already has them).
        #[serde(default)]
        heard: String,
        #[serde(default)]
        fixed: String,
        #[serde(default = "yes")]
        complete: bool,
        place_ms: u64,
    },
    ThreadTouched { thread_id: String, last_point: String, at_ms: u64 },
    /// `speaker`: whose move it was; a thread is dropped for the person who left it.
    ThreadStatus {
        thread_id: String,
        status: ThreadStatus,
        #[serde(default = "you")]
        speaker: String,
    },
    ActiveChanged {
        thread_id: String,
        #[serde(default = "you")]
        speaker: String,
    },
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
    /// No to a fix made without asking puts the words back as heard.
    ThoughtCorrected {
        thought_id: String,
        accept: bool,
        /// A yes in the person's own words ("No, Muse Spark"): these replace the unclear words instead of the guess.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        with: String,
    },
    /// A turn that moved on to another topic partway: the thought keeps the words before (`text`),
    /// and `rest`, placed next, takes the others.
    ThoughtSplit { thought_id: String, text: String, rest: Thought },
    /// The placer found nothing to place ("yeah" when nothing was asked): the thought leaves the map
    /// and the world; this journal keeps its words.
    ThoughtSkipped { thought_id: String },
    /// What the placer read into a placed thought (chunks.rs); an empty note takes it away ("not one idea").
    ThoughtNoted { thought_id: String, note: crate::chunks::Note },
    /// An empty thread taken back with the words that started it, with nowhere to merge it (catalog.rs: "new thread
    /// about …" on an empty map, then Undo): it leaves the map, and nobody is on it any more. Only while it holds no
    /// thought and no branch; this journal keeps it.
    ThreadRemoved { thread_id: String },
    /// An Explain answer as the person saw it, kept so explanations can be judged and improved later. Journal only:
    /// the map doesn't change, and other windows aren't sent it.
    ExplainAnswered {
        id: String,
        phrase: String,
        context: String,
        #[serde(default)]
        thread_id: Option<String>,
        model: String,
        ms: u64,
        text: String,
        at_ms: u64,
    },
    /// The person marked an AI answer as off (`kind` "explain" or "recap"), or took the mark back. Journal only, the
    /// last mark for an answer counts: the labels a change to the prompt is checked against.
    AnswerMarked {
        kind: String,
        id: String,
        off: bool,
        #[serde(default = "you")]
        speaker: String,
        at_ms: u64,
    },
    /// An import finished reading these messages; old journal entries only recorded their times.
    MessagesRead {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        at_ms: Vec<u64>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        keys: Vec<String>,
    },
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
        let change = self.resolved(change);
        match change.as_ref() {
            Change::RecapSaved { recap } => {
                self.recaps.retain(|r| r.period != recap.period);
                self.recaps.push(recap.clone());
            }
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
                    let (purpose, publishers) = crate::apps::volume_choice(*sound);
                    (a.purpose, a.publishers) = (purpose.into(), publishers);
                }
            }
            Change::AppsSeeded => self.apps_seeded = true,
            Change::ThoughtAdded { thought } => {
                if !self.thoughts.iter().any(|t| t.id == thought.id) {
                    self.thoughts.push(thought.clone());
                }
            }
            Change::ThoughtSplit { thought_id, text, rest } => {
                let Some(i) = self.thoughts.iter().position(|t| &t.id == thought_id) else { return };
                self.thoughts[i].text = text.clone();
                // Right after its first part, so points stay in the order they were said.
                if !self.thoughts.iter().any(|t| t.id == rest.id) {
                    self.thoughts.insert(i + 1, rest.clone());
                }
            }
            Change::ThoughtSkipped { thought_id } => {
                self.thoughts.retain(|t| &t.id != thought_id);
                self.notes.remove(thought_id);
            }
            Change::ThoughtNoted { thought_id, note } => {
                if note.is_empty() {
                    self.notes.remove(thought_id);
                } else if self.thoughts.iter().any(|t| &t.id == thought_id) {
                    self.notes.insert(thought_id.clone(), note.clone());
                }
            }
            Change::ThreadRemoved { thread_id } => {
                let held = self.thoughts.iter().any(|t| t.thread_id.as_ref() == Some(thread_id))
                    || self.threads.iter().any(|t| t.parent_id.as_ref() == Some(thread_id));
                if !held {
                    self.threads.retain(|t| &t.id != thread_id);
                    if self.active.as_ref() == Some(thread_id) {
                        self.active = None;
                    }
                    self.active_by.retain(|_, id| id != thread_id);
                }
            }
            Change::ExplainAnswered { .. } | Change::AnswerMarked { .. } => {}
            Change::MessagesRead { at_ms, keys } => {
                self.read_ms.extend(at_ms);
                self.read_keys.extend(keys.iter().cloned());
            }
            Change::ThreadAdded { thread } => {
                if self.thread(&thread.id).is_none() {
                    self.threads.push(thread.clone());
                }
            }
            Change::ThoughtPlaced { thought_id, thread_id, point, unclear, guess, heard, fixed, complete, place_ms } => {
                if let Some(t) = self.thoughts.iter_mut().find(|t| &t.id == thought_id) {
                    t.thread_id = Some(thread_id.clone());
                    t.point = point.clone();
                    t.unclear = unclear.clone();
                    t.guess = guess.clone();
                    // Only on first placing, so a repeated change can't fix the text twice.
                    if !t.placed && !heard.is_empty() && !fixed.is_empty() {
                        t.text = swap(&t.text, heard, fixed);
                    }
                    t.heard = heard.clone();
                    t.fixed = fixed.clone();
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
                    th.dropped_by.clear();
                }
            }
            Change::ThreadStatus { thread_id, status, speaker } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.status = *status;
                    th.dropped_by = if *status == ThreadStatus::Dropped { speaker.clone() } else { String::new() };
                }
            }
            Change::ActiveChanged { thread_id, speaker } => {
                self.active = Some(thread_id.clone());
                self.active_by.insert(speaker.clone(), thread_id.clone());
            }
            Change::ThreadRenamed { thread_id, title } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.title = title.clone();
                }
            }
            Change::ThreadMerged { from, into } => self.merge(from, into),
            Change::ThoughtCorrected { thought_id, accept, with } => self.correct(thought_id, *accept, with),
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

    /// Folds thread `from` into `into`: its thoughts, branches, ideas and tasks, and everyone on it, move over,
    /// and a change still aimed at `from` lands on `into` (see `resolve`). Nothing happens when `into` is
    /// `from` or doesn't exist.
    fn merge(&mut self, from: &str, into: &str) {
        if from == into || self.thread(into).is_none() {
            return;
        }
        for t in self.thoughts.iter_mut().filter(|t| t.thread_id.as_deref() == Some(from)) {
            t.thread_id = Some(into.into());
        }
        for th in self.threads.iter_mut().filter(|t| t.parent_id.as_deref() == Some(from)) {
            th.parent_id = Some(into.into());
        }
        for s in self.suggestions.iter_mut().filter(|s| s.thread_id == from) {
            s.thread_id = into.into();
        }
        for a in self.actions.iter_mut().filter(|a| a.thread_id == from) {
            a.thread_id = into.into();
        }
        if self.active.as_deref() == Some(from) {
            self.active = Some(into.into());
        }
        for id in self.active_by.values_mut().filter(|id| **id == from) {
            *id = into.into();
        }
        self.threads.retain(|t| t.id != from);
        self.merged.insert(from.into(), into.into());
    }

    /// A "Did you mean …?" answered: see `Change::ThoughtCorrected`.
    fn correct(&mut self, thought_id: &str, accept: bool, with: &str) {
        let Some(t) = self.thoughts.iter_mut().find(|t| t.id == thought_id) else { return };
        let (old_point, thread_id) = (t.point.clone(), t.thread_id.clone());
        let to = if with.is_empty() { t.guess.clone() } else { with.to_string() };
        if accept && !t.unclear.is_empty() && !to.is_empty() {
            t.text = swap(&t.text, &t.unclear, &to);
            t.point = swap(&t.point, &t.unclear, &to);
        }
        if !accept && !t.heard.is_empty() && !t.fixed.is_empty() {
            t.text = swap(&t.text, &t.fixed, &t.heard);
            t.point = swap(&t.point, &t.fixed, &t.heard);
            t.heard.clear();
            t.fixed.clear();
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

    /// The same change with thread ids followed through merges.
    fn resolved<'a>(&self, change: &'a Change) -> Cow<'a, Change> {
        let id = match change {
            Change::ThoughtPlaced { thread_id, .. }
            | Change::ThreadTouched { thread_id, .. }
            | Change::ThreadStatus { thread_id, .. }
            | Change::ActiveChanged { thread_id, .. }
            | Change::ThreadRenamed { thread_id, .. }
            | Change::TagSuggested { thread_id, .. }
            | Change::TagKept { thread_id, .. }
            | Change::TagRemoved { thread_id, .. }
            | Change::ThreadPicture { thread_id, .. } => Some(thread_id),
            Change::SuggestionAdded { suggestion } => Some(&suggestion.thread_id),
            Change::ActionProposed { action } => Some(&action.thread_id),
            // Made from a snapshot taken before a slow step (an import's pauses, the placer's model call),
            // so a merge may have moved their thread or parent meanwhile.
            Change::ThoughtAdded { thought } => thought.thread_id.as_ref(),
            Change::ThreadAdded { thread } => thread.parent_id.as_ref(),
            _ => None,
        };
        // Most changes don't name a merged thread. Apply those directly instead of copying
        // every string (including full thoughts) just to discover there's nothing to resolve.
        if !id.is_some_and(|id| self.merged.contains_key(id)) {
            return Cow::Borrowed(change);
        }
        let mut c = change.clone();
        match &mut c {
            Change::ThoughtPlaced { thread_id, .. }
            | Change::ThreadTouched { thread_id, .. }
            | Change::ThreadStatus { thread_id, .. }
            | Change::ActiveChanged { thread_id, .. }
            | Change::ThreadRenamed { thread_id, .. }
            | Change::TagSuggested { thread_id, .. }
            | Change::TagKept { thread_id, .. }
            | Change::TagRemoved { thread_id, .. }
            | Change::ThreadPicture { thread_id, .. } => *thread_id = self.resolve(thread_id),
            Change::SuggestionAdded { suggestion } => suggestion.thread_id = self.resolve(&suggestion.thread_id),
            Change::ActionProposed { action } => action.thread_id = self.resolve(&action.thread_id),
            Change::ThoughtAdded { thought } => thought.thread_id = thought.thread_id.as_deref().map(|id| self.resolve(id)),
            Change::ThreadAdded { thread } => thread.parent_id = thread.parent_id.as_deref().map(|id| self.resolve(id)),
            _ => {}
        }
        Cow::Owned(c)
    }

    pub fn thread(&self, id: &str) -> Option<&Thread> {
        self.threads.iter().find(|t| t.id == id)
    }

    /// Where a speaker is: their own active thread, else where the talk is now (they just joined).
    pub fn active_for(&self, speaker: &str) -> Option<&String> {
        self.active_by.get(speaker).or(self.active.as_ref())
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
            let mut reader = BufReader::new(File::open(path)?);
            let mut line = String::new();
            let mut n = 0usize;
            loop {
                line.clear();
                n += 1;
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {}
                    // A crash mid-write can cut a character in half: skip that line rather than refuse to start.
                    Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                        tracing::warn!("skipping journal line {} that isn't valid text", n);
                        continue;
                    }
                    Err(e) => return Err(e.into()),
                }
                // Match BufRead::lines, reusing its allocation instead of allocating for every change.
                if line.ends_with('\n') {
                    line.pop();
                    if line.ends_with('\r') { line.pop(); }
                }
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Change>(&line) {
                    Ok(change) => world.apply(&change),
                    Err(e) => tracing::warn!("skipping journal line {} that I can't read: {e}", n),
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

/// Where `words` first appear in `text` as whole words, so "pairs" can't land inside "repairs".
pub fn find(text: &str, words: &str) -> Option<std::ops::Range<usize>> {
    matches(text, words).into_iter().next()
}

/// Everywhere `words` appear in `text` as whole words, in order. Ignores case when lowercasing keeps
/// the byte length (so offsets still line up), else matches exactly.
pub fn matches(text: &str, words: &str) -> Vec<std::ops::Range<usize>> {
    if words.is_empty() {
        return Vec::new();
    }
    let (lower, lower_words) = (text.to_lowercase(), words.to_lowercase());
    let (hay, needle) =
        if lower.len() == text.len() && lower_words.len() == words.len() { (lower.as_str(), lower_words.as_str()) } else { (text, words) };
    let whole = |r: &std::ops::Range<usize>| {
        text.is_char_boundary(r.start)
            && text.is_char_boundary(r.end)
            && !text[..r.start].ends_with(|c: char| c.is_ascii_alphanumeric())
            && !text[r.end..].starts_with(|c: char| c.is_ascii_alphanumeric())
    };
    hay.match_indices(needle).map(|(i, _)| i..i + words.len()).filter(whole).collect()
}

/// Replaces the first whole-word match of `from` in `text` with `to`; unchanged when there's none.
pub fn swap(text: &str, from: &str, to: &str) -> String {
    match find(text, from) {
        Some(r) => format!("{}{}{}", &text[..r.start], to, &text[r.end..]),
        None => text.to_string(),
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
        journal.append(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "you".into() }).unwrap();
        let (_, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T2"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_character_cut_in_half_at_the_end_doesnt_stop_the_core() {
        let path = std::env::temp_dir().join(format!("e2a2o-journal-utf8-{}.jsonl", uuid::Uuid::new_v4()));
        let mut bytes = b"{\"type\":\"active_changed\",\"thread_id\":\"T1\"}\n{\"type\":\"thread_renamed\",\"thread_id\":\"T1\",\"title\":\"caf".to_vec();
        bytes.extend_from_slice(&"é".as_bytes()[..1]);
        std::fs::write(&path, bytes).unwrap();
        let (mut journal, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T1"));
        journal.append(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "you".into() }).unwrap();
        let (_, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T2"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn replay_continues_after_bad_lines_and_reuses_the_buffer_for_shorter_lines() {
        let path = std::env::temp_dir().join(format!("e2a2o-journal-lines-{}.jsonl", uuid::Uuid::new_v4()));
        let mut bytes = b" \r\n{bad json}\ninvalid UTF-8: \xff\n".to_vec();
        bytes.extend_from_slice(b"{\"type\":\"active_changed\",\"thread_id\":\"a long thread id\"}\r\n\n");
        bytes.extend_from_slice(b"{\"type\":\"active_changed\",\"thread_id\":\"T2\"}");
        std::fs::write(&path, bytes).unwrap();
        let (mut journal, world) = super::Journal::open(&path).unwrap();
        assert_eq!(world.active.as_deref(), Some("T2"));
        journal.append(&Change::ActiveChanged { thread_id: "T3".into(), speaker: "Guest".into() }).unwrap();
        let (_, replayed) = super::Journal::open(&path).unwrap();
        assert_eq!(replayed.active_for("you").map(String::as_str), Some("T2"));
        assert_eq!(replayed.active_for("Guest").map(String::as_str), Some("T3"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn old_journals_load_as_one_speaker() {
        // From before rooms: no speaker on a move or a drop, no dropped_by on a thread.
        let lines = [
            r#"{"type":"thread_added","thread":{"id":"T1","title":"Rent","parent_id":null,"status":"open","last_point":"","touched_ms":1}}"#,
            r#"{"type":"active_changed","thread_id":"T1"}"#,
            r#"{"type":"thread_status","thread_id":"T1","status":"dropped"}"#,
        ];
        let mut world = World::default();
        for line in lines {
            world.apply(&serde_json::from_str::<Change>(line).unwrap());
        }
        assert_eq!(world.active_by.get("you").map(String::as_str), Some("T1"));
        assert_eq!(world.threads[0].dropped_by, "you");
    }

    #[test]
    fn each_speaker_keeps_their_own_place() {
        let thread = |id: &str| super::Thread {
            id: id.into(),
            title: id.into(),
            parent_id: None,
            status: super::ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        };
        let mut world = World { threads: vec![thread("T1"), thread("T2")], ..World::default() };
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "User".into() });
        world.apply(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "Sam".into() });
        assert_eq!(world.active.as_deref(), Some("T2"), "the talk is where the last move went");
        assert_eq!(world.active_for("User").map(String::as_str), Some("T1"));
        assert_eq!(world.active_for("Lee").map(String::as_str), Some("T2"), "someone new starts where the talk is");
        world.apply(&Change::ThreadStatus { thread_id: "T1".into(), status: super::ThreadStatus::Dropped, speaker: "User".into() });
        assert_eq!(world.threads[0].dropped_by, "User");
        world.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "back".into(), at_ms: 5 });
        assert_eq!(world.threads[0].dropped_by, "", "picking it up again clears the drop");
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        assert_eq!(world.active_for("User").map(String::as_str), Some("T2"), "a merge moves everyone on it");
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
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        let mut world = World { thoughts: vec![thought("a"), thought("b")], ..World::default() };
        world.apply(&Change::ThoughtCorrected { thought_id: "a".into(), accept: true, with: String::new() });
        world.apply(&Change::ThoughtCorrected { thought_id: "b".into(), accept: false, with: String::new() });
        assert_eq!(world.thoughts[0].text, "ask Muse Spark about it");
        assert_eq!(world.thoughts[0].point, "Ask Muse Spark");
        assert_eq!(world.thoughts[1].text, "ask muse bark about it");
        assert!(world.thoughts.iter().all(|t| t.unclear.is_empty() && t.guess.is_empty()));
        // Letters whose lowercase is longer can't shift the cut.
        assert_eq!(super::swap("İstanbul moose", "moose", "Muse"), "İstanbul Muse");
        // Whole words only.
        assert_eq!(super::swap("book repairs, then pairs", "pairs", "pears"), "book repairs, then pears");
        assert_eq!(super::swap("book repairs", "pairs", "pears"), "book repairs");
    }

    #[test]
    fn a_sure_fix_lands_on_placing_and_no_puts_the_words_back() {
        let mut world = World::default();
        let lines = [
            r#"{"type":"thread_added","thread":{"id":"T1","title":"Demo","parent_id":null,"status":"open","last_point":"","touched_ms":0}}"#,
            r#"{"type":"thought_added","thought":{"id":"a","speaker":"you","text":"muse bark is fast","point":"","thread_id":null,"placed":false,"unclear":"","at_ms":0,"place_ms":null}}"#,
            r#"{"type":"thought_placed","thought_id":"a","thread_id":"T1","point":"Muse Spark is fast","unclear":"","heard":"Muse Bark","fixed":"Muse Spark","place_ms":1}"#,
            r#"{"type":"thread_touched","thread_id":"T1","last_point":"Muse Spark is fast","at_ms":1}"#,
        ];
        for line in lines {
            world.apply(&serde_json::from_str(line).unwrap());
        }
        let placed = world.thoughts[0].clone();
        assert_eq!((placed.text.as_str(), placed.heard.as_str()), ("Muse Spark is fast", "Muse Bark"));
        assert!(placed.unclear.is_empty() && placed.guess.is_empty(), "nothing to ask");
        // The same change again (a lagging window replays it) doesn't fix twice.
        world.apply(&serde_json::from_str(lines[2]).unwrap());
        assert_eq!(world.thoughts[0].text, "Muse Spark is fast");

        world.apply(&Change::ThoughtCorrected { thought_id: "a".into(), accept: false, with: String::new() });
        let undone = &world.thoughts[0];
        assert_eq!((undone.text.as_str(), undone.point.as_str()), ("Muse Bark is fast", "Muse Bark is fast"));
        assert!(undone.heard.is_empty() && undone.fixed.is_empty());
        assert_eq!(world.threads[0].last_point, "Muse Bark is fast");
    }

    #[test]
    fn journals_from_before_sure_fixes_still_load() {
        let mut world = World::default();
        for line in [
            r#"{"type":"thought_added","thought":{"id":"a","speaker":"you","text":"ask moose","point":"","thread_id":null,"placed":false,"unclear":"","at_ms":0,"place_ms":null}}"#,
            r#"{"type":"thought_placed","thought_id":"a","thread_id":"T1","point":"Ask moose","unclear":"moose","guess":"Muse","complete":true,"place_ms":5}"#,
        ] {
            world.apply(&serde_json::from_str(line).unwrap());
        }
        let t = &world.thoughts[0];
        assert!(t.placed && t.heard.is_empty() && t.fixed.is_empty());
        assert_eq!((t.text.as_str(), t.guess.as_str()), ("ask moose", "Muse"));
    }

    #[test]
    fn a_split_keeps_the_order_said_and_a_skip_leaves_only_the_journal() {
        let thought = |id: &str, text: &str| Thought {
            id: id.into(),
            speaker: "you".into(),
            text: text.into(),
            point: String::new(),
            thread_id: None,
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        let path = std::env::temp_dir().join(format!("e2a2o-split-{}.jsonl", std::process::id()));
        let (mut journal, mut world) = super::Journal::open(&path).unwrap();
        let split = Change::ThoughtSplit {
            thought_id: "a".into(),
            text: "I need to pay rent".into(),
            rest: thought("b", "the demo is on Tuesday"),
        };
        for change in [
            Change::ThoughtAdded { thought: thought("a", "I need to pay rent and also the demo is on Tuesday") },
            Change::ThoughtAdded { thought: thought("c", "said after") },
            split.clone(),
            split,
            Change::ThoughtAdded { thought: thought("d", "yeah") },
            Change::ThoughtSkipped { thought_id: "d".into() },
        ] {
            world.apply(&change);
            journal.append(&change).unwrap();
        }
        let texts: Vec<&str> = world.thoughts.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, ["I need to pay rent", "the demo is on Tuesday", "said after"]);
        let (_, replayed) = super::Journal::open(&path).unwrap();
        assert_eq!(replayed.thoughts.len(), 3);
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"yeah\""), "the journal keeps what was set aside");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_merge_moves_everything_on_the_thread_and_later_changes_follow() {
        let mut world = World::default();
        for (id, parent) in [("T1", None), ("T2", None), ("T3", Some("T1"))] {
            world.apply(&Change::ThreadAdded { thread: test_thread(id, parent) });
        }
        let new = super::ItemStatus::New;
        world.apply(&Change::ThoughtAdded { thought: test_thought("a", "User", "T1") });
        world.apply(&Change::SuggestionAdded {
            suggestion: super::Suggestion { id: "s".into(), thread_id: "T1".into(), text: "Ask Sam".into(), status: new },
        });
        world.apply(&Change::ActionProposed {
            action: super::Action { id: "x".into(), thread_id: "T1".into(), kind: "reminder".into(), title: "Pay".into(), when: String::new(), status: new, done_ms: None },
        });
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "User".into() });
        // Never into itself, or into a thread that isn't there.
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T1".into() });
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T9".into() });
        assert!(world.thread("T1").is_some() && world.merged.is_empty());
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        assert!(world.thread("T1").is_none());
        assert_eq!(world.thoughts[0].thread_id.as_deref(), Some("T2"));
        assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T2"), "its branch");
        assert_eq!((world.suggestions[0].thread_id.as_str(), world.actions[0].thread_id.as_str()), ("T2", "T2"));
        assert_eq!((world.active.as_deref(), world.active_for("User").map(String::as_str)), (Some("T2"), Some("T2")));
        world.apply(&Change::ThreadRenamed { thread_id: "T1".into(), title: "Rent".into() });
        assert_eq!(world.thread("T2").unwrap().title, "Rent", "a late change follows the merge");
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

    #[test]
    fn late_changes_follow_merge_chains_without_changing_the_journal_record() {
        let mut world = World::default();
        for id in ["T1", "T2", "T3"] {
            let change = serde_json::json!({"type":"thread_added", "thread":{
                "id":id, "title":id, "parent_id":null, "status":"open", "last_point":"", "touched_ms":0
            }});
            world.apply(&serde_json::from_value(change).unwrap());
        }
        world.apply(&serde_json::from_str(r#"{"type":"thought_added","thought":{"id":"a","speaker":"Guest","text":"a point","point":"","thread_id":null,"placed":false,"unclear":"","at_ms":0,"place_ms":null}}"#).unwrap());
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T3".into() });
        let late: Vec<Change> = serde_json::from_value(serde_json::json!([
            {"type":"thought_placed", "thought_id":"a", "thread_id":"T1", "point":"a point", "unclear":"", "place_ms":5},
            {"type":"thread_touched", "thread_id":"T2", "last_point":"a point", "at_ms":5},
            {"type":"active_changed", "thread_id":"T1", "speaker":"Guest"},
            {"type":"suggestion_added", "suggestion":{"id":"s", "thread_id":"T1", "text":"an idea", "status":"new"}},
            {"type":"action_proposed", "action":{"id":"a", "thread_id":"T2", "kind":"reminder", "title":"a task", "when":"", "status":"new", "done_ms":null}},
            {"type":"tag_suggested", "thread_id":"T1", "tag":"#late"},
            // An imported point, and a branch the placer started, both aimed at a thread merged meanwhile.
            {"type":"thought_added", "thought":{"id":"b", "speaker":"you", "text":"imported", "point":"imported", "thread_id":"T1",
                "placed":true, "unclear":"", "at_ms":1, "place_ms":null}},
            {"type":"thread_added", "thread":{"id":"T4", "title":"T4", "parent_id":"T2", "status":"open", "last_point":"", "touched_ms":5}}
        ])).unwrap();
        let records = serde_json::to_string(&late).unwrap();
        for change in &late { world.apply(change); }
        assert_eq!(serde_json::to_string(&late).unwrap(), records);
        assert_eq!(world.thoughts[1].thread_id.as_deref(), Some("T3"), "not on a thread that's gone");
        assert_eq!(world.thread("T4").unwrap().parent_id.as_deref(), Some("T3"), "a branch, not a root");
        assert_eq!(world.thoughts[0].thread_id.as_deref(), Some("T3"));
        assert_eq!(world.active_for("Guest").map(String::as_str), Some("T3"));
        assert_eq!(world.thread("T3").unwrap().last_point, "a point");
        assert_eq!(world.thread("T3").unwrap().tags[0].name, "#late");
        assert_eq!(world.suggestions[0].thread_id, "T3");
        assert_eq!(world.actions[0].thread_id, "T3");
    }

    fn test_thread(id: &str, parent: Option<&str>) -> super::Thread {
        super::Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: parent.map(Into::into),
            status: super::ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 1,
            tags: vec![super::Tag { name: "#plans".into(), kept: true }],
            picture: Some(format!("/images/{id}-small.webp")),
            dropped_by: String::new(),
        }
    }

    fn test_thought(id: &str, speaker: &str, thread: &str) -> Thought {
        Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: format!("ask muse bark about {id}"),
            point: String::new(),
            thread_id: Some(thread.into()),
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 2,
            place_ms: None,
        }
    }

    fn item(thread_id: &str, text: &str) -> crate::recap::Item {
        crate::recap::Item { thread_id: thread_id.into(), text: text.into() }
    }

    /// A talk in two voices that uses every kind of change, with the fields added since the first journals
    /// (rooms, sure fixes, apps, recaps) set away from their defaults, so a field that doesn't survive shows.
    fn every_change() -> Vec<Change> {
        use crate::apps::{MiniApp, Prompt, Publisher, Watcher};
        let app = |id: &str, watcher| MiniApp {
            id: id.into(),
            name: format!("App {id}"),
            purpose: "Notice things.".into(),
            watcher,
            prompt: Some(Prompt { system: "Look.".into(), template: "{points}\n{thought}".into() }),
            publishers: vec![Publisher::Card { text: "{text}".into() }, Publisher::Reminder { title: "{text}".into(), when: "{when}".into() }],
            enabled: true,
            request: "notice things".into(),
            cooldown_secs: 45,
            created_ms: 100,
            last_run_ms: 0,
        };
        let placed = |thought_id: &str, thread_id: &str, heard: &str, fixed: &str, complete: bool| Change::ThoughtPlaced {
            thought_id: thought_id.into(),
            thread_id: thread_id.into(),
            point: format!("Ask Muse Spark about {thought_id}"),
            unclear: "Muse Bark".into(),
            guess: "Muse Spark".into(),
            heard: heard.into(),
            fixed: fixed.into(),
            complete,
            place_ms: 2400,
        };
        let changes = vec![
            Change::AppsSeeded,
            Change::AppRegistered { app: app("app-volume", Watcher::Volume { level: 0.2, seconds: 3 }) },
            Change::AppRegistered { app: app("app-timer", Watcher::Time { at_ms: 50, every_secs: 3600 }) },
            Change::AppEnabled { id: "app-volume".into(), enabled: false },
            Change::AppRan { id: "app-volume".into(), at_ms: 500 },
            Change::AppOutput { id: "app-volume".into(), sound: true },
            Change::AppRemoved { id: "app-timer".into() },
            Change::ThreadAdded { thread: test_thread("T1", None) },
            Change::ThreadAdded { thread: test_thread("T2", Some("T1")) },
            Change::ThreadAdded { thread: test_thread("T3", None) },
            Change::ThoughtAdded { thought: test_thought("a", "User", "T1") },
            placed("a", "T1", "", "", false),
            Change::ThreadTouched { thread_id: "T1".into(), last_point: "Ask Muse Spark about a".into(), at_ms: 10 },
            Change::ActiveChanged { thread_id: "T1".into(), speaker: "User".into() },
            Change::ThoughtAdded { thought: test_thought("b", "Sam", "T1") },
            placed("b", "T3", "muse bark", "Muse Spark", true),
            Change::ThreadTouched { thread_id: "T3".into(), last_point: "Ask Muse Spark about b".into(), at_ms: 20 },
            Change::ActiveChanged { thread_id: "T3".into(), speaker: "Sam".into() },
            Change::ThoughtNoted {
                thought_id: "b".into(),
                note: crate::chunks::Note { continues: "a".into(), assumed: String::new(), why: "names Muse Spark".into() },
            },
            Change::ThreadStatus { thread_id: "T1".into(), status: super::ThreadStatus::Dropped, speaker: "User".into() },
            Change::ThreadRenamed { thread_id: "T2".into(), title: "Budget".into() },
            Change::TagSuggested { thread_id: "T2".into(), tag: "#money".into() },
            Change::TagKept { thread_id: "T2".into(), tag: "#money".into() },
            Change::TagRemoved { thread_id: "T1".into(), tag: "#plans".into() },
            Change::ThreadPicture { thread_id: "T3".into(), path: "/images/T3-new-small.webp".into() },
            Change::SuggestionAdded {
                suggestion: super::Suggestion { id: "sg-1".into(), thread_id: "T2".into(), text: "Ask Sam".into(), status: super::ItemStatus::New },
            },
            Change::ActionProposed {
                action: super::Action {
                    id: "ac-1".into(),
                    thread_id: "T2".into(),
                    kind: "event".into(),
                    title: "Demo day".into(),
                    when: "2026-11-04".into(),
                    status: super::ItemStatus::New,
                    done_ms: None,
                },
            },
            Change::ItemStatus { id: "ac-1".into(), status: super::ItemStatus::Done, done_ms: Some(300) },
            Change::ThoughtCorrected { thought_id: "a".into(), accept: true, with: String::new() },
            Change::ThoughtCorrected { thought_id: "b".into(), accept: false, with: String::new() },
            Change::ThoughtAdded { thought: test_thought("c", "User", "T1") },
            Change::ThoughtSplit { thought_id: "c".into(), text: "ask muse bark".into(), rest: test_thought("d", "User", "T1") },
            Change::ThoughtSkipped { thought_id: "d".into() },
            Change::ThreadRemoved { thread_id: "T9".into() },
            Change::MessagesRead { at_ms: vec![1_791_000_000_000, 1_791_000_100_000], keys: Vec::new() },
            Change::ThreadMerged { from: "T2".into(), into: "T3".into() },
            // Kept for judging answers; replaying them changes nothing on the map.
            Change::ExplainAnswered {
                id: "x1".into(),
                phrase: "Muse Spark".into(),
                context: "Ask Muse Spark about a".into(),
                thread_id: Some("T1".into()),
                model: "muse-spark-1.2-contributor".into(),
                ms: 1_400,
                text: "Meta's fast model, which this app uses to place thoughts.".into(),
                at_ms: 40,
            },
            Change::AnswerMarked { kind: "explain".into(), id: "x1".into(), off: true, speaker: "User".into(), at_ms: 50 },
            // Aimed at the merged thread, so it follows the merge on replay too.
            Change::ThreadRenamed { thread_id: "T2".into(), title: "Budget and demo".into() },
            Change::RecapSaved {
                recap: crate::recap::Recap {
                    period: crate::recap::Period::Session,
                    since_ms: 1,
                    through_ms: 20,
                    generated_ms: 30,
                    source_key: "abc".into(),
                    summary: "You spent time on Topic T1 and Budget.".into(),
                    worked_on: vec![item("T1", "Asked about Muse Spark.")],
                    plans: vec![item("T3", "Show the Palace view at the end.")],
                    decisions: vec![item("T3", "Open with the mic.")],
                    questions: vec![item("T1", "Which model?")],
                    unfinished: vec![item("T1", "Topic T1 still has a loose end.")],
                    actions: Vec::new(),
                    thought_count: 2,
                    thread_count: 2,
                    limited: true,
                },
            },
        ];
        // Stops compiling when a kind of change is added: add one to the list above too.
        for change in &changes {
            match change {
                Change::RecapSaved { .. }
                | Change::AppRegistered { .. }
                | Change::AppEnabled { .. }
                | Change::AppRemoved { .. }
                | Change::AppRan { .. }
                | Change::AppOutput { .. }
                | Change::AppsSeeded
                | Change::ThoughtAdded { .. }
                | Change::ThreadAdded { .. }
                | Change::ThoughtPlaced { .. }
                | Change::ThreadTouched { .. }
                | Change::ThreadStatus { .. }
                | Change::ActiveChanged { .. }
                | Change::ThreadRenamed { .. }
                | Change::ThreadMerged { .. }
                | Change::SuggestionAdded { .. }
                | Change::ActionProposed { .. }
                | Change::ItemStatus { .. }
                | Change::TagSuggested { .. }
                | Change::TagKept { .. }
                | Change::TagRemoved { .. }
                | Change::ThreadPicture { .. }
                | Change::ThoughtCorrected { .. }
                | Change::ThoughtSplit { .. }
                | Change::ThoughtSkipped { .. }
                | Change::ThoughtNoted { .. }
                | Change::ThreadRemoved { .. }
                | Change::MessagesRead { .. }
                | Change::ExplainAnswered { .. }
                | Change::AnswerMarked { .. } => {}
            }
        }
        changes
    }

    #[test]
    fn every_change_variant_round_trips_through_serde() {
        let changes = every_change();
        let kinds: std::collections::HashSet<String> =
            changes.iter().map(|c| serde_json::to_value(c).unwrap()["type"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds.len(), 30, "one of each kind of change");
        for change in &changes {
            let json = serde_json::to_string(change).unwrap();
            let back: Change = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{json} didn't read back: {e}"));
            assert_eq!(json, serde_json::to_string(&back).unwrap(), "a field was lost");
        }
    }

    #[test]
    fn journal_replay_matches_direct_apply() {
        let changes = every_change();
        let mut direct = World::default();
        for change in &changes {
            direct.apply(change);
        }
        let path = std::env::temp_dir().join(format!("e2a2o-roundtrip-{}.jsonl", uuid::Uuid::new_v4()));
        {
            let (mut journal, _) = super::Journal::open(&path).unwrap();
            for change in &changes {
                journal.append(change).unwrap();
            }
        }
        let (_, replayed) = super::Journal::open(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        // As JSON values, so the speakers' map compares whatever order it iterates in.
        assert_eq!(serde_json::to_value(&direct).unwrap(), serde_json::to_value(&replayed).unwrap());

        // And the talk landed as told.
        let w = &replayed;
        assert_eq!(w.threads.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["T1", "T3"]);
        assert_eq!(w.thread("T3").unwrap().title, "Budget and demo", "a change aimed at a merged thread follows it");
        assert_eq!((w.active_for("User").unwrap().as_str(), w.active_for("Sam").unwrap().as_str()), ("T1", "T3"));
        assert_eq!(w.thread("T1").unwrap().dropped_by, "User");
        assert!(w.thread("T1").unwrap().tags.is_empty());
        assert_eq!(w.thoughts[0].text, "ask Muse Spark about a", "yes to Did you mean");
        assert_eq!(w.thoughts[1].text, "ask muse bark about b", "no to a sure fix puts the words back");
        assert!(!w.thoughts[0].complete && w.thoughts[1].complete);
        assert_eq!((w.suggestions[0].thread_id.as_str(), w.actions[0].thread_id.as_str()), ("T3", "T3"));
        assert_eq!((w.actions[0].status, w.actions[0].done_ms), (super::ItemStatus::Done, Some(300)));
        assert_eq!(w.apps.len(), 1);
        assert!(matches!(w.apps[0].publishers[..], [crate::apps::Publisher::Sound {}, crate::apps::Publisher::Card { .. }]) && !w.apps[0].enabled);
        assert!(w.apps[0].purpose.contains("tune"), "the purpose says what it does");
        assert_eq!(w.recaps[0].plans[0].text, "Show the Palace view at the end.");
    }

    #[test]
    fn pre_rooms_pre_autofix_journal_loads() {
        let lines = [
            // A thread without tags, a picture or dropped_by.
            r#"{"type":"thread_added","thread":{"id":"T1","title":"Rent","parent_id":null,"status":"open","last_point":"pay","touched_ms":1}}"#,
            // A thought without guess, heard, fixed or complete.
            r#"{"type":"thought_added","thought":{"id":"a","speaker":"you","text":"pay rent","point":"","thread_id":null,"placed":false,"unclear":"","at_ms":1,"place_ms":null}}"#,
            r#"{"type":"thought_placed","thought_id":"a","thread_id":"T1","point":"Pay rent","unclear":"","place_ms":3}"#,
            // Moves and drops without a speaker.
            r#"{"type":"active_changed","thread_id":"T1"}"#,
            r#"{"type":"thread_status","thread_id":"T1","status":"dropped"}"#,
            // A recap without plans.
            r#"{"type":"recap_saved","recap":{"period":"today","since_ms":0,"through_ms":5,"generated_ms":6,"source_key":"k","summary":"You spent time on Rent.","worked_on":[{"thread_id":"T1","text":"Paid rent."}],"decisions":[],"questions":[],"unfinished":[],"actions":[],"thought_count":1,"thread_count":1,"limited":false}}"#,
        ];
        let mut world = World::default();
        for line in lines {
            world.apply(&serde_json::from_str(line).unwrap_or_else(|e| panic!("{line} didn't load: {e}")));
        }
        let thread = &world.threads[0];
        assert_eq!(thread.dropped_by, "you", "one speaker, as before rooms");
        assert!(thread.tags.is_empty() && thread.picture.is_none());
        assert_eq!(world.active_for("you").map(String::as_str), Some("T1"));
        let t = &world.thoughts[0];
        assert!(t.placed && t.complete && t.guess.is_empty() && t.heard.is_empty() && t.fixed.is_empty());
        assert!(world.recaps[0].plans.is_empty() && world.recaps[0].worked_on.len() == 1);
    }
}
