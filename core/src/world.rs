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
    /// The words say a decision was made ("Decided: …", decided.rs): marked on the point and led with in Recap.
    #[serde(default)]
    pub decided: bool,
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

/// What an idea or task says and where it stands: what the refiner made it, or what it was before (`Change::ItemRefined`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ItemState {
    pub status: ItemStatus,
    /// An idea's text, or a task's title.
    pub text: String,
    /// A task's day (YYYY-MM-DD), or empty.
    #[serde(default)]
    pub when: String,
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

/// A completed conversational caption. Playback flags belong only to its live relay.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Caption {
    pub id: String,
    pub by: String,
    pub text: String,
    pub at_ms: u64,
    pub order: u64,
    pub ai: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

/// An exact unfinished source at a committed departure. Later edits never rewrite its excerpt.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pause {
    pub id: String,
    pub thought_id: String,
    pub speaker: String,
    pub thread_id: String,
    pub revision: u64,
    pub excerpt: String,
    pub at_ms: u64,
    #[serde(default)] pub resolved: bool,
    #[serde(default)] pub later_count: u32,
    #[serde(default)] pub offer_after_ms: u64,
    #[serde(default)] pub hidden: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReturnAnchor {
    pub pause: Option<Pause>,
    pub thought_id: String,
    pub thread_id: Option<String>,
    pub excerpt: String,
    pub current_text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureReceipt {
    pub id: String,
    pub text: String,
    pub thought_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpeechDraft {
    pub id: String,
    pub speaker: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct World {
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub pauses: Vec<Pause>,
    #[serde(default, skip_serializing)] pub returning: std::collections::HashMap<String, (String, usize)>,
    #[serde(default, skip_serializing)]
    pub captures: std::collections::HashMap<(String, String), CaptureReceipt>,
    #[serde(default, skip_serializing)]
    pub speech_drafts: std::collections::HashMap<String, SpeechDraft>,
    #[serde(default, skip_serializing)]
    pub speech_resolved: std::collections::HashSet<String>,
    pub threads: Vec<Thread>,
    pub thoughts: Vec<Thought>,
    #[serde(default)]
    pub captions: Vec<Caption>,
    /// Saved receipts survive a restart even if the thought is later moved or deleted.
    #[serde(default, skip_serializing)]
    pub received_text: std::collections::HashSet<(String, String)>,
    /// Where the talk is now: the thread whoever moved last is on.
    pub active: Option<String>,
    /// Each speaker's own active thread, so in a room placement and "where was I?" follow the person.
    #[serde(default)]
    pub active_by: std::collections::HashMap<String, String>,
    /// One topic for every speaker's new thoughts, kept whole until released.
    #[serde(default)]
    pub stay_here: Option<String>,
    #[serde(default)]
    pub suggestions: Vec<Suggestion>,
    #[serde(default)]
    pub actions: Vec<Action>,
    /// Merged thread id → the thread it became, so late changes still land.
    #[serde(default)]
    pub merged: std::collections::HashMap<String, String>,
    /// How many threads a ThreadRemoved took off the map, so new ids keep counting up and never land on a
    /// thread made after the removed one. Rebuilt by replay, as the journal keeps every removal.
    #[serde(default, skip_serializing)]
    pub removed: usize,
    #[serde(default)]
    pub apps: Vec<crate::apps::MiniApp>,
    #[serde(default)]
    pub apps_seeded: bool,
    #[serde(default)]
    pub recaps: Vec<crate::recap::Recap>,
    /// Thought id → what the placer read into it: the words it carries on, an assumption, why it went there (chunks.rs).
    #[serde(default)]
    pub notes: std::collections::HashMap<String, crate::chunks::Note>,
    /// Thread or thought id → where a person or an AI participant put it on the canvas (positions.rs); one not here
    /// is laid out automatically. A place goes with its thread or thought when that leaves the map.
    #[serde(default)]
    pub positions: std::collections::HashMap<String, crate::positions::Position>,
    /// Margin notes: each note's thread id → the words it's tied to (annotate.rs). Kept when the thread leaves the map,
    /// so an Undo that brings it back brings its anchor; only a thread on the map is shown as a note.
    #[serde(default)]
    pub anchors: std::collections::HashMap<String, crate::annotate::Anchor>,
    /// The speakers who joined as an AI participant (`?ai`, as the Friend's bridge does), in the order they first
    /// came: every window marks their words as an AI's (✦).
    #[serde(default)]
    pub ai: Vec<String>,
    /// Top thread id → the topic it's under, by name (topics.rs): the AI's, or a person's rename or move. A branch goes
    /// with its top thread. Kept when the thread leaves the map, as `anchors` are, so an Undo that brings it back brings
    /// its topic; only a thread on the map counts.
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub topics: std::collections::HashMap<String, String>,
    /// Threads whose theme a person chose by moving the thread or renaming its theme. Rebuilt by journal replay.
    #[serde(default, skip_serializing)]
    pub topics_chosen: std::collections::HashSet<String>,
    /// The thread count at the last grouping baseline. Rebuilt by journal replay.
    #[serde(default, skip_serializing)]
    pub topics_grouped: usize,
    /// Legacy import times: keep skipping these when replaying timestamp-only journal records.
    #[serde(default, skip_serializing)]
    pub read_ms: std::collections::HashSet<u64>,
    /// Stable hashes of messages an import has read, including those that gave no point.
    #[serde(default, skip_serializing)]
    pub read_keys: std::collections::HashSet<String>,
    /// Renames and merges the refiner wasn't sure of, waiting on their cards (tidy.rs).
    #[serde(default)]
    pub proposals: Vec<crate::tidy::Proposal>,
    /// Threads whose title is the refiner's own, with the title before it, for Undo.
    #[serde(default, skip_serializing)]
    pub retitled: std::collections::HashMap<String, String>,
    /// Threads whose title the person chose: the refiner leaves it alone.
    #[serde(default, skip_serializing)]
    pub titled: std::collections::HashSet<String>,
    /// Merged thread id → what its merge moved, to undo it exactly.
    #[serde(default, skip_serializing)]
    pub unmerge: std::collections::HashMap<String, crate::tidy::Unmerge>,
    /// The person's moves of thoughts, oldest first, as (thought, from, to) with the ids they named (moves.rs). Two
    /// threads a move set apart are never merged by the refiner (`apart`); an undone move takes its record back.
    #[serde(default, skip_serializing)]
    pub moves: Vec<(String, String, String)>,
    /// Ideas and tasks the refiner withdrew or corrected, with what its latest change made each (`now`) and what it
    /// was before (`was`), for Undo (refiner.rs `refine`).
    #[serde(default, skip_serializing)]
    pub refined: std::collections::HashMap<String, (ItemState, ItemState)>,
    /// Ideas and tasks the person put back after the refiner changed them: theirs now, never changed by it again.
    #[serde(default, skip_serializing)]
    pub restored: std::collections::HashSet<String>,
    /// The rest of each turn the placer cut in two → the part it was cut from (`ThoughtSplit`): which words were one
    /// turn, never guessed from a shared time (two turns flushed together on a reconnect can share a millisecond).
    #[serde(default, skip_serializing)]
    pub split_from: std::collections::HashMap<String, String>,
}

/// Journal lines, so old journals must keep loading: give every field added later `#[serde(default)]`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Change {
    CaptionAdded { caption: Caption },
    Paused { pause: Pause },
    PauseResolved { id: String, by_thought: String },
    PauseChoice { id: String, later_count: u32, offer_after_ms: u64, hidden: bool },
    ReturnFocused { speaker: String, pause_id: String, #[serde(default)] after: usize },
    SpeechRecovered { draft: SpeechDraft },
    SpeechResolved { id: String },
    TextReceived { speaker: String, id: String },
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
        /// The words say a decision was made (decided.rs); placements journaled before this have none.
        #[serde(default)]
        decided: bool,
    },
    ThreadTouched { thread_id: String, last_point: String, at_ms: u64 },
    /// A card's last point said again after its points changed (a delete, a move, their Undo): unlike `ThreadTouched`,
    /// it neither reopens nor touches the thread, so a thread left unfinished stays so, and Undo is one step back.
    LastPoint { thread_id: String, last_point: String },
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
    /// A map-wide choice, independent of each speaker's focus; none releases it.
    StayChanged { thread_id: Option<String> },
    /// A rename whose maker isn't said: in journals from before tidy.rs, the refiner's own.
    ThreadRenamed { thread_id: String, title: String },
    ThreadMerged { from: String, into: String },
    /// A rename the refiner was sure of (tidy.rs); `was` is the title before it, for Undo.
    ThreadRetitled { thread_id: String, title: String, was: String },
    /// A title the person chose (a proposal's Rename, or an AI rename undone): the refiner leaves it alone (tidy.rs).
    TitleChosen { thread_id: String, title: String },
    /// The person moved a thought to another thread (moves.rs), said or clicked: it stays where they put it, and the
    /// refiner never merges `from` and `thread_id` (`World::apart`). `undo`: a move of theirs taken back (then
    /// `thread_id` is where it was, `from` where they had put it), which drops what that move set apart.
    ThoughtMoved {
        thought_id: String,
        thread_id: String,
        from: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        undo: bool,
    },
    /// A merge undone: the thread comes back with what it held (tidy.rs).
    ThreadUnmerged { unmerge: crate::tidy::Unmerge },
    /// A rename or merge the refiner wasn't sure of, proposed on the card (tidy.rs).
    TidyProposed { proposal: crate::tidy::Proposal },
    SuggestionAdded { suggestion: Suggestion },
    ActionProposed { action: Action },
    ItemStatus { id: String, status: ItemStatus, done_ms: Option<u64> },
    /// A waiting idea or task goes with the words it was made from to another thread (moves.rs `made_from`): a move,
    /// or that move's Undo.
    ItemMoved { id: String, thread_id: String },
    /// The refiner brought a waiting idea or task in line with something said after it (refiner.rs `refine`): `now`
    /// is what it became (dismissed when cancelled, done or no longer true; else a new day or wording), `was` what
    /// it was, for Undo, and `why` the later words in short ("conference cancelled").
    ItemRefined { id: String, now: ItemState, was: ItemState, why: String },
    /// That change's Undo: the idea or task is `to` again, and the refiner leaves it alone after.
    ItemRestored { id: String, to: ItemState },
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
    /// A placed thought's decision mark read again after its words changed (a correction, or a join taken apart):
    /// decided.rs `remarked`.
    ThoughtDecided { thought_id: String, decided: bool },
    /// What the placer read into a placed thought (chunks.rs); an empty note takes it away ("not one idea").
    ThoughtNoted { thought_id: String, note: crate::chunks::Note },
    /// A point said anew: a joined thought taken apart says only its own words again (chunks.rs `unlink`).
    ThoughtRepointed { thought_id: String, point: String },
    /// An empty thread taken back with the words that started it, with nowhere to merge it (catalog.rs: "new thread
    /// about …" on an empty map, then Undo): it leaves the map, and nobody is on it any more. Only while it holds no
    /// thought and no branch; this journal keeps it.
    ThreadRemoved { thread_id: String },
    /// A thread or thought an Undo brought back goes where it stood, just before `before` (catalog.rs `places`), so
    /// the map's order, its colors and "next one" are as they were. Either missing: nothing moves.
    PutBack { id: String, before: String },
    /// A thread's card or a thought's point put somewhere on the canvas, by a person's window or an AI participant
    /// (`by`: the speaker): `x` and `y` are absolute canvas coordinates of its top-left; both none puts it back in the
    /// automatic layout. Only for a thread on the map or a thought (positions.rs refuses the rest, and one of the two
    /// missing). Every step of a drag reaches every window; the journal keeps at most one line per item per
    /// `positions::JOURNAL_EVERY`, its latest.
    Positioned { id: String, x: Option<f64>, y: Option<f64>, by: String, at_ms: u64 },
    /// A margin note's thread tied to words: `quote`, as picked in thought `thought_id`'s point (annotate.rs). Only for
    /// a thread on the map; kept after it leaves, so an Undo brings the note back as a note.
    Anchored { thread_id: String, thought_id: String, quote: String, #[serde(default)] context: Option<crate::annotate::AnchorContext> },
    /// A window joined as an AI participant (`?ai`) under `speaker`: from now on its words are marked as an AI's.
    AiJoined { speaker: String },
    /// The AI's pass put these top threads under these topics (topics.rs): only threads on the map, a name each.
    TopicsAssigned {
        assigned: Vec<crate::topics::Assigned>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grouped: Option<usize>,
    },
    /// A person moved a top thread under a topic (topics.rs `set`): theirs, whatever the AI said.
    TopicSet { thread_id: String, topic: String },
    /// A person renamed a topic: every thread under `from` is under `to` now (an existing name: the two are one).
    TopicRenamed { from: String, to: String },
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
    /// Add recovery facts only to a batch that actually places a new thought and moves its speaker away.
    pub(crate) fn with_pauses(&self, mut changes: Vec<Change>, now: u64) -> Vec<Change> {
        for change in &mut changes { if let Change::ReturnFocused { after, .. } = change { *after=self.thoughts.len(); } }
        let thought = |id: &str| self.thoughts.iter().find(|t| t.id == id).or_else(|| changes.iter().find_map(|change| match change {
            Change::ThoughtAdded { thought } if thought.id == id => Some(thought), _ => None,
        }));
        let mut extra = Vec::new();
        for change in &changes {
            let Change::ThoughtPlaced { thought_id, thread_id, .. } = change else { continue };
            let Some(next) = thought(thought_id).filter(|t| !t.placed) else { continue };
            // Focus changes and panning do not identify the interrupted sentence. The speaker's
            // immediately preceding committed words do; a late placement behind newer words does not.
            let next_index=self.thoughts.iter().position(|t|t.id==next.id).unwrap_or(usize::MAX);
            let leaves = changes.iter().any(|change|matches!(change,Change::ActiveChanged {thread_id:to,speaker} if speaker==&next.speaker&&self.resolve(to)==self.resolve(thread_id)))
                || self.active_by.get(&next.speaker).is_some_and(|id|self.resolve(id)==self.resolve(thread_id));
            let late = self.returning.get(&next.speaker).is_some_and(|(_,after)|next_index<*after);
            let source=self.thoughts.iter().enumerate().filter(|(_,t)|t.placed&&t.speaker==next.speaker)
                .max_by_key(|(i,t)|(t.said_at(now),*i))
                .filter(|(i,t)|!t.complete&&(t.said_at(now),*i)<(next.said_at(now),next_index))
                .map(|(_,t)|t).or_else(||self.returning.get(&next.speaker).filter(|(_,after)|next_index>=*after)
                    .and_then(|(id,_)|self.pauses.iter().find(|p|p.id==*id&&!p.resolved))
                    .and_then(|p|self.thoughts.iter().find(|t|t.id==p.thought_id&&!t.complete)))
                .filter(|t|t.thread_id.as_ref().is_some_and(|id|self.resolve(id)!=self.resolve(thread_id)));
            if let Some(source)=source.filter(|_|leaves&&!late) {
                let revision=self.pauses.iter().filter(|p|p.thought_id==source.id).map(|p|p.revision).max().unwrap_or(0)+1;
                extra.push(Change::Paused {pause:Pause {id:format!("pause-{}-{revision}",source.id),thought_id:source.id.clone(),speaker:source.speaker.clone(),thread_id:self.resolve(source.thread_id.as_ref().unwrap()),revision,
                    excerpt:source.text.clone(),at_ms:now,resolved:false,later_count:0,offer_after_ms:0,hidden:false}});
            }
            let continued = changes.iter().find_map(|change| match change {
                Change::ThoughtNoted { thought_id: id, note } if id == thought_id && !note.continues.is_empty() => Some(&note.continues), _ => None,
            });
            if let Some(source) = continued {
                let candidates = self.pauses.iter().filter(|p| !p.resolved && p.speaker == next.speaker && &p.thought_id == source);
                let pause = self.returning.get(&next.speaker).and_then(|(id,_)| candidates.clone().find(|p| &p.id == id)).or_else(|| candidates.max_by_key(|p| (p.at_ms,p.revision)));
                if let Some(pause) = pause { extra.push(Change::PauseResolved { id: pause.id.clone(), by_thought: thought_id.clone() }); }
            }
        }
        changes.extend(extra);
        changes
    }

    pub(crate) fn return_anchor(&self, pause: &Pause) -> ReturnAnchor {
        let thought = self.thoughts.iter().find(|t| t.id == pause.thought_id && t.speaker == pause.speaker);
        ReturnAnchor { pause: Some(pause.clone()), thought_id: pause.thought_id.clone(),
            thread_id: thought.and_then(|t| t.thread_id.as_ref()).map(|id|self.resolve(id)).filter(|id|self.thread(id).is_some()),
            excerpt: pause.excerpt.clone(), current_text: thought.map(|t|t.text.clone()) }
    }

    pub(crate) fn capture(&mut self, speaker: &str, id: &str, text: Option<&str>, change: &Change) {
        let receipt = self.captures.entry((speaker.into(), id.into())).or_insert_with(|| CaptureReceipt {
            id: id.into(), text: text.unwrap_or_default().into(), thought_ids: Vec::new(),
        });
        if let Some(text) = text { receipt.text = text.into(); }
        if let Change::ThoughtAdded { thought } = change {
            if receipt.text.is_empty() { receipt.text = thought.text.clone(); }
            if !receipt.thought_ids.contains(&thought.id) { receipt.thought_ids.push(thought.id.clone()); }
        }
    }

    /// Sets an idea's or a task's words, day and status; false when there's no such item.
    fn set_item(&mut self, id: &str, to: &ItemState) -> bool {
        if let Some(s) = self.suggestions.iter_mut().find(|s| s.id == id) {
            (s.status, s.text) = (to.status, to.text.clone());
            return true;
        }
        if let Some(a) = self.actions.iter_mut().find(|a| a.id == id) {
            (a.status, a.title, a.when) = (to.status, to.text.clone(), to.when.clone());
            return true;
        }
        false
    }

    /// An idea's or a task's state now, if it exists.
    pub fn item_state(&self, id: &str) -> Option<ItemState> {
        let idea = self.suggestions.iter().find(|s| s.id == id).map(|s| ItemState { status: s.status, text: s.text.clone(), when: String::new() });
        idea.or_else(|| self.actions.iter().find(|a| a.id == id).map(|a| ItemState { status: a.status, text: a.title.clone(), when: a.when.clone() }))
    }

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
        crate::tidy::follow(self, &change);
        match change.as_ref() {
            Change::CaptionAdded { caption } => {
                if !self.captions.iter().any(|c| c.id == caption.id && c.by == caption.by) {
                    self.captions.push(caption.clone());
                }
            }
            Change::Paused { pause } => { self.returning.remove(&pause.speaker); if !self.pauses.iter().any(|p|p.id == pause.id) { self.pauses.push(pause.clone()); } }
            Change::PauseResolved { id, .. } => { if let Some(pause)=self.pauses.iter_mut().find(|p| &p.id==id) { pause.resolved=true; } self.returning.retain(|_,(value,_)|value!=id); }
            Change::PauseChoice { id, later_count, offer_after_ms, hidden } => { if let Some(pause)=self.pauses.iter_mut().find(|p| &p.id==id) { pause.later_count=*later_count;pause.offer_after_ms=*offer_after_ms;pause.hidden=*hidden; } }
            Change::ReturnFocused { speaker, pause_id, after } => { self.returning.insert(speaker.clone(),(pause_id.clone(),*after)); }
            Change::SpeechRecovered { draft } => { if !self.speech_resolved.contains(&draft.id) { self.speech_drafts.insert(draft.id.clone(), draft.clone()); } }
            Change::SpeechResolved { id } => { self.speech_drafts.remove(id); self.speech_resolved.insert(id.clone()); }
            Change::TextReceived { speaker, id } => { self.received_text.insert((speaker.clone(), id.clone())); }
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
                self.split_from.insert(rest.id.clone(), thought_id.clone());
                for capture in self.captures.values_mut().filter(|capture| capture.thought_ids.contains(thought_id)) {
                    if !capture.thought_ids.contains(&rest.id) { capture.thought_ids.push(rest.id.clone()); }
                }
            }
            // Its note stays, as the journal keeps its words: "scratch that", then Undo, brings the thought back joined
            // as it was (chunks.rs); a note for a thought off the map shows nothing. Its place on the canvas goes.
            Change::ThoughtSkipped { thought_id } => {
                self.thoughts.retain(|t| &t.id != thought_id);
                self.positions.remove(thought_id);
            }
            Change::ThoughtDecided { thought_id, decided } => {
                if let Some(t) = self.thoughts.iter_mut().find(|t| &t.id == thought_id) {
                    t.decided = *decided;
                }
            }
            Change::ThoughtNoted { thought_id, note } => {
                if note.is_empty() {
                    self.notes.remove(thought_id);
                } else if self.thoughts.iter().any(|t| &t.id == thought_id) {
                    self.notes.insert(thought_id.clone(), note.clone());
                }
            }
            Change::ThoughtRepointed { thought_id, point } => self.repoint(thought_id, |_| point.clone()),
            Change::ThreadRemoved { thread_id } => {
                // Words still being placed don't hold it: they only name where they were said (placer.rs places
                // them on the map as it is when they land).
                let held = self.thoughts.iter().any(|t| t.placed && t.thread_id.as_ref() == Some(thread_id))
                    || self.threads.iter().any(|t| t.parent_id.as_ref() == Some(thread_id));
                if !held && self.thread(thread_id).is_some() {
                    self.threads.retain(|t| &t.id != thread_id);
                    self.positions.remove(thread_id);
                    self.removed += 1;
                    if self.active.as_ref() == Some(thread_id) {
                        self.active = None;
                    }
                    self.active_by.retain(|_, id| id != thread_id);
                    if self.stay_here.as_ref() == Some(thread_id) {
                        self.stay_here = None;
                    }
                }
            }
            Change::PutBack { id, before } => {
                put_back(&mut self.threads, |t| &t.id, id, before);
                put_back(&mut self.thoughts, |t| &t.id, id, before);
            }
            Change::Positioned { id, x, y, by, at_ms } => match (x, y) {
                (Some(x), Some(y)) if self.placeable(id) => {
                    self.positions.insert(id.clone(), crate::positions::Position { x: *x, y: *y, by: by.clone(), at_ms: *at_ms });
                }
                (None, None) => {
                    self.positions.remove(id);
                }
                // Off the map, or only one of the two: positions.rs refuses both, so only an edited journal holds one.
                _ => {}
            },
            Change::Anchored { thread_id, thought_id, quote, context } => {
                if self.thread(thread_id).is_some() {
                    // Replay old journals at their original source revision; ambiguous entries remain unresolved.
                    let context = context.clone().or_else(|| match self.anchors.get(thread_id) {
                        Some(existing) => existing.context.clone(),
                        None => self.thoughts.iter().find(|t| t.id == *thought_id).and_then(|t| crate::annotate::resolve(t, quote, None).ok()),
                    });
                    self.anchors.insert(thread_id.clone(), crate::annotate::Anchor { thought_id: thought_id.clone(), quote: quote.clone(), context });
                }
            }
            Change::AiJoined { speaker } => {
                if !self.ai.contains(speaker) {
                    self.ai.push(speaker.clone());
                }
            }
            // By the ids as given (topics.rs never names a thread merged away), and never an empty name.
            Change::TopicsAssigned { assigned, grouped } => {
                if let Some(grouped) = grouped {
                    self.topics_grouped = *grouped;
                }
                for a in assigned {
                    if !a.topic.trim().is_empty() && self.thread(&a.thread_id).is_some() {
                        self.topics.insert(a.thread_id.clone(), a.topic.clone());
                    }
                }
            }
            Change::TopicSet { thread_id, topic } => {
                if !topic.trim().is_empty() && self.thread(thread_id).is_some() {
                    self.topics_chosen.insert(thread_id.clone());
                    self.topics.insert(thread_id.clone(), topic.clone());
                }
            }
            Change::TopicRenamed { from, to } => {
                if !to.trim().is_empty() {
                    for (id, name) in self.topics.iter_mut().filter(|(_, name)| *name == from) {
                        self.topics_chosen.insert(id.clone());
                        *name = to.clone();
                    }
                }
            }
            Change::ExplainAnswered { .. } | Change::AnswerMarked { .. } => {}
            Change::ItemRefined { id, now, was, .. } => {
                if self.set_item(id, now) {
                    // The latest change's: its Undo puts back what the person saw just before it.
                    self.refined.insert(id.clone(), (now.clone(), was.clone()));
                }
            }
            Change::ItemRestored { id, to } => {
                if self.set_item(id, to) {
                    self.refined.remove(id);
                    self.restored.insert(id.clone());
                }
            }
            Change::MessagesRead { at_ms, keys } => {
                self.read_ms.extend(at_ms);
                self.read_keys.extend(keys.iter().cloned());
            }
            Change::ThreadAdded { thread } => {
                if self.thread(&thread.id).is_none() {
                    self.threads.push(thread.clone());
                }
            }
            Change::ThoughtPlaced { thought_id, thread_id, point, unclear, guess, heard, fixed, complete, place_ms, decided } => {
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
                    t.decided = *decided;
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
            Change::LastPoint { thread_id, last_point } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.last_point = last_point.clone();
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
            Change::StayChanged { thread_id } => {
                self.stay_here = thread_id.as_deref().map(|id| self.resolve(id)).filter(|id| self.thread(id).is_some());
            }
            Change::ThreadRenamed { thread_id, title } | Change::TitleChosen { thread_id, title } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.title = title.clone();
                }
            }
            Change::ThreadMerged { from, into } => self.merge(from, into),
            Change::ThreadRetitled { thread_id, title, was } => {
                if let Some(th) = self.thread_mut(thread_id) {
                    th.title = title.clone();
                    self.retitled.insert(thread_id.clone(), was.clone());
                }
            }
            Change::ThreadUnmerged { unmerge } => crate::tidy::unmerge(self, unmerge),
            Change::TidyProposed { proposal } => {
                if !self.proposals.iter().any(|p| p.id == proposal.id) {
                    self.proposals.push(proposal.clone());
                }
            }
            Change::ThoughtCorrected { thought_id, accept, with } => self.correct(thought_id, *accept, with),
            Change::ThoughtMoved { thought_id, thread_id, from, undo } => self.moved(thought_id, thread_id, from, *undo),
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
            Change::ItemMoved { id, thread_id } => {
                let to = self.resolve(thread_id);
                if self.thread(&to).is_some() {
                    let (mut idea, mut task) = (false, false);
                    if let Some(s) = self.suggestions.iter_mut().find(|s| &s.id == id) {
                        s.thread_id = to.clone();
                        idea = true;
                    }
                    if let Some(a) = self.actions.iter_mut().find(|a| &a.id == id) {
                        a.thread_id = to.clone();
                        task = true;
                    }
                    // As a thought moved (`moved`): a card moved is where it was put, not where a merge took it; one
                    // sent to a thread merged away since goes with that thread if its merge is undone.
                    for u in self.unmerge.values_mut() {
                        u.suggestions.retain(|x| x != id);
                        u.actions.retain(|x| x != id);
                    }
                    if to != *thread_id {
                        if let Some(u) = self.unmerge.get_mut(thread_id) {
                            if idea {
                                u.suggestions.push(id.clone());
                            }
                            if task {
                                u.actions.push(id.clone());
                            }
                        }
                    }
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
                if let Some(p) = self.proposals.iter_mut().find(|p| &p.id == id) {
                    p.status = *status;
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
        if let Some(record) = crate::tidy::record(self, from, into) {
            self.unmerge.insert(from.into(), record);
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
        if self.stay_here.as_deref() == Some(from) {
            self.stay_here = Some(into.into());
        }
        self.threads.retain(|t| t.id != from);
        // Its card's place goes with it; `into` keeps its own (a late place for `from` isn't followed through the merge).
        self.positions.remove(from);
        self.merged.insert(from.into(), into.into());
    }

    /// A person's move (`Change::ThoughtMoved`): the thought goes to `to` (or the thread it was merged into), and only
    /// to a thread on the map. An undone merge brings back what that merge moved, never a thought the person moved
    /// since; one moved back to a thread merged away since comes back with that thread if its merge is undone.
    fn moved(&mut self, thought_id: &str, to: &str, from: &str, undo: bool) {
        let on = self.resolve(to);
        if self.thread(&on).is_none() {
            return;
        }
        let Some(t) = self.thoughts.iter_mut().find(|t| t.id == thought_id) else { return };
        t.thread_id = Some(on.clone());
        for u in self.unmerge.values_mut() {
            u.thoughts.retain(|id| id != thought_id);
        }
        if on != to {
            if let Some(u) = self.unmerge.get_mut(to) {
                u.thoughts.push(thought_id.into());
            }
        }
        if undo {
            if let Some(i) = self.moves.iter().rposition(|(id, f, t)| id == thought_id && f == to && t == from) {
                self.moves.remove(i);
            }
        } else {
            self.moves.push((thought_id.into(), from.into(), to.into()));
        }
    }

    /// Whether the person set threads `a` and `b` apart by moving a thought from one to the other: the refiner never
    /// merges them, nor proposes to (refiner.rs). Followed through merges.
    pub fn apart(&self, a: &str, b: &str) -> bool {
        let (a, b) = (self.resolve(a), self.resolve(b));
        a != b && self.moves.iter().any(|(_, f, t)| {
            let (f, t) = (self.resolve(f), self.resolve(t));
            (f == a && t == b) || (f == b && t == a)
        })
    }

    /// A "Did you mean …?" answered: see `Change::ThoughtCorrected`.
    fn correct(&mut self, thought_id: &str, accept: bool, with: &str) {
        let Some(t) = self.thoughts.iter_mut().find(|t| t.id == thought_id) else { return };
        let (old_point, thread_id) = (t.point.clone(), t.thread_id.clone());
        let to = if with.is_empty() { t.guess.clone() } else { with.to_string() };
        let mut swapped = None;
        // Asked about words its own don't hold: they were said in a part it carries on (the joined point reads both).
        let in_heads = accept && find(&t.text, &t.unclear).is_none();
        if accept && !t.unclear.is_empty() && !to.is_empty() {
            t.text = swap(&t.text, &t.unclear, &to);
            t.point = swap(&t.point, &t.unclear, &to);
            swapped = Some((t.unclear.clone(), to));
        }
        if !accept && !t.heard.is_empty() && !t.fixed.is_empty() {
            t.text = swap(&t.text, &t.fixed, &t.heard);
            t.point = swap(&t.point, &t.fixed, &t.heard);
            swapped = Some((t.fixed.clone(), t.heard.clone()));
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
        // A point that carries these words on across a pause says them too (chunks.rs): the same swap there.
        if let Some((from, to)) = swapped {
            let carriers: Vec<String> = crate::chunks::carriers(self, thought_id).map(|t| t.id.clone()).collect();
            for id in carriers {
                self.repoint(&id, |p| swap(p, &from, &to));
            }
            // And the parts it carries on, when that's where they were: each one's point reads the parts before it
            // too, so each takes the swap (shown if the parts are kept apart); the part that said them has its words
            // said fixed (each part's own text is what "words said" quotes), and its own question about the same
            // words answered with it.
            if in_heads {
                let mut seen = vec![thought_id.to_string()];
                while let Some(head) = self.notes.get(seen.last().unwrap()).map(|n| n.continues.clone()).filter(|h| !h.is_empty() && !seen.contains(h)) {
                    if let Some(h) = self.thoughts.iter_mut().find(|t| t.id == head && find(&t.text, &from).is_some()) {
                        h.text = swap(&h.text, &from, &to);
                        if h.unclear.eq_ignore_ascii_case(&from) {
                            h.unclear.clear();
                            h.guess.clear();
                        }
                    }
                    self.repoint(&head, |p| swap(p, &from, &to));
                    seen.push(head);
                }
            }
        }
    }

    /// Thought `id`'s point becomes `point(old)`; the thread's last point, a copy, keeps in step.
    fn repoint(&mut self, id: &str, point: impl FnOnce(&str) -> String) {
        let Some(t) = self.thoughts.iter_mut().find(|t| t.id == id) else { return };
        let new = point(&t.point);
        let old = std::mem::replace(&mut t.point, new);
        let (new, thread_id) = (t.point.clone(), t.thread_id.clone());
        if let Some(th) = thread_id.and_then(|id| self.thread_mut(&id)) {
            if th.last_point == old {
                th.last_point = new;
            }
        }
    }

    /// The same change with thread ids followed through merges.
    fn resolved<'a>(&self, change: &'a Change) -> Cow<'a, Change> {
        let id = match change {
            Change::ThoughtPlaced { thread_id, .. }
            | Change::ThreadTouched { thread_id, .. }
            | Change::LastPoint { thread_id, .. }
            | Change::ThreadStatus { thread_id, .. }
            | Change::ActiveChanged { thread_id, .. }
            | Change::ThreadRenamed { thread_id, .. }
            | Change::ThreadRetitled { thread_id, .. }
            | Change::TitleChosen { thread_id, .. }
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
            | Change::LastPoint { thread_id, .. }
            | Change::ThreadStatus { thread_id, .. }
            | Change::ActiveChanged { thread_id, .. }
            | Change::ThreadRenamed { thread_id, .. }
            | Change::ThreadRetitled { thread_id, .. }
            | Change::TitleChosen { thread_id, .. }
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

    /// Whether the canvas can place `id`: a thread on the map (not one merged away), or a thought (positions.rs).
    pub fn placeable(&self, id: &str) -> bool {
        self.thread(id).is_some() || self.thoughts.iter().any(|t| t.id == id)
    }

    /// Where a speaker is: their own active thread, else where the talk is now (they just joined).
    /// Every part of the turn `id` belongs to, cut by the placer however many times, itself included.
    pub fn turn_parts(&self, id: &str) -> Vec<String> {
        let first = |id: &str| {
            let mut at = id.to_string();
            // Each rest names the part before it; the bound only guards a malformed journal.
            for _ in 0..=self.split_from.len() {
                match self.split_from.get(&at) {
                    Some(up) => at = up.clone(),
                    None => break,
                }
            }
            at
        };
        let head = first(id);
        let mut parts: Vec<String> = self.thoughts.iter().filter(|t| first(&t.id) == head).map(|t| t.id.clone()).collect();
        if !parts.iter().any(|p| p == id) {
            parts.push(id.to_string());
        }
        parts
    }

    pub fn active_for(&self, speaker: &str) -> Option<&String> {
        self.active_by.get(speaker).or(self.active.as_ref())
    }

    fn thread_mut(&mut self, id: &str) -> Option<&mut Thread> {
        self.threads.iter_mut().find(|t| t.id == id)
    }

    /// Every thread id ever made: on the map, merged away or removed. New ids count up from here.
    pub fn threads_made(&self) -> usize {
        self.threads.len() + self.merged.len() + self.removed
    }

    /// Never reuses an id, even after merges or removals take threads off the map; skips any id
    /// still in use, as a backstop.
    pub fn next_thread_id(&self) -> String {
        let mut n = self.threads_made() + 1;
        loop {
            let id = format!("T{n}");
            if self.thread(&id).is_none() && !self.merged.contains_key(&id) {
                return id;
            }
            n += 1;
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct SourceStatus { pub accepted: bool, pub failed: bool }
#[derive(Clone)]
struct Source { speaker: String, id: String, text: String, status: SourceStatus }
thread_local! { static SOURCE: std::cell::RefCell<Option<Source>> = const { std::cell::RefCell::new(None) }; }
pub(crate) fn source_capture() -> Option<(String, String, String)> {
    SOURCE.with(|source| source.borrow().as_ref().map(|s| (s.speaker.clone(), s.id.clone(), s.text.clone())))
}

/// A synchronous accepted turn: only this thread's writes receive its source ID, never unrelated background work.
pub(crate) fn with_source<T>(speaker: &str, id: &str, text: &str, work: impl FnOnce() -> T) -> (T, SourceStatus) {
    struct Restore(Option<Source>);
    impl Drop for Restore { fn drop(&mut self) { SOURCE.with(|source| { source.replace(self.0.take()); }); } }
    let old = SOURCE.with(|source| source.replace(Some(Source { speaker: speaker.into(), id: id.into(), text: text.into(), status: SourceStatus::default() })));
    let _restore = Restore(old);
    let result = work();
    let status = SOURCE.with(|source| source.borrow().as_ref().unwrap().status.clone());
    (result, status)
}

/// A companion identity belongs to the journal, never to its address or current contents.
fn map_identity(path: &Path) -> anyhow::Result<String> {
    let identity = path.with_file_name(format!("{}.map-id", path.file_name().unwrap().to_string_lossy()));
    if !identity.exists() {
        let id = uuid::Uuid::new_v4().to_string();
        let temporary = identity.with_extension(format!("{id}.tmp"));
        let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary)?;
        file.write_all(id.as_bytes())?;
        file.sync_all()?;
        let linked = std::fs::hard_link(&temporary, &identity);
        std::fs::remove_file(&temporary)?;
        if let Err(error) = linked { if error.kind() != std::io::ErrorKind::AlreadyExists { return Err(error.into()); } }
    }
    let id = std::fs::read_to_string(identity)?;
    uuid::Uuid::parse_str(&id)?;
    Ok(id)
}

/// Append-only log of changes, written immediately; replayed on start so the app
/// opens exactly where you left it.
pub struct Journal {
    file: File,
    map_id: String,
}

impl Journal {
    /// An existing test file whose appends fail regardless of the process's permission to change it.
    #[cfg(test)]
    pub(crate) fn read_only(path: &Path) -> anyhow::Result<Journal> {
        Ok(Journal { file: File::open(path)?, map_id: map_identity(path)? })
    }

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
                    Ok(change) => {
                        world.apply(&change);
                        // The source is in the same durable record as its effect, so a missing later receipt is safe.
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let (Some(speaker), Some(id)) = (value["source"]["speaker"].as_str(), value["source"]["id"].as_str()) {
                                if uuid::Uuid::parse_str(id).is_ok() { world.received_text.insert((speaker.into(), id.into())); world.capture(speaker, id, value["source"]["text"].as_str(), &change); }
                            }
                        }
                    }
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
        Ok((Journal { file, map_id: map_identity(path)? }, world))
    }

    pub fn map_id(&self) -> &str { &self.map_id }

    pub fn append(&mut self, change: &Change) -> anyhow::Result<()> { self.append_many(std::slice::from_ref(change)) }

    pub fn append_many(&mut self, changes: &[Change]) -> anyhow::Result<()> {
        if changes.is_empty() { return Ok(()); }
        let source = SOURCE.with(|source| source.borrow().clone());
        let result = (|| {
            let mut batch = String::new();
            for change in changes {
                let mut value = serde_json::to_value(change)?;
                if let Some(source) = &source {
                    value["source"] = serde_json::json!({ "speaker": source.speaker, "id": source.id, "text": source.text });
                }
                batch.push_str(&serde_json::to_string(&value)?);
                batch.push('\n');
            }
            self.file.write_all(batch.as_bytes())?;
            self.file.flush()?;
            self.file.sync_data()?;
            Ok(())
        })();
        SOURCE.with(|source| { if let Some(source) = source.borrow_mut().as_mut() {
            source.status.accepted |= result.is_ok();
            source.status.failed |= result.is_err();
        } });
        result
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

/// Moves the item `id` names to just before the one `before` names (`Change::PutBack`); either missing: as it was.
fn put_back<T>(list: &mut Vec<T>, key: impl Fn(&T) -> &String, id: &str, before: &str) {
    if !list.iter().any(|x| key(x) == before) {
        return;
    }
    let Some(from) = list.iter().position(|x| key(x) == id) else { return };
    let item = list.remove(from);
    let to = list.iter().position(|x| key(x) == before).unwrap_or(from);
    list.insert(to, item);
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
    fn a_removed_threads_id_is_never_handed_out_again() {
        // Scratch that on Sam's first thread removes T3 while Ana's T4 stays: the next new topic must not get T4,
        // or it lands in Ana's thread; nor T3, or a late picture drawn for the old T3 lands on it.
        let line = |id: &str| format!(r#"{{"type":"thread_added","thread":{{"id":"{id}","title":"{id}","parent_id":null,"status":"open","last_point":"","touched_ms":1}}}}"#);
        let mut world = World::default();
        for id in ["T1", "T2", "T3", "T4"] {
            world.apply(&serde_json::from_str::<Change>(&line(id)).unwrap());
        }
        world.apply(&Change::ThreadRemoved { thread_id: "T3".into() });
        let next = world.next_thread_id();
        assert!(!["T1", "T2", "T3", "T4"].contains(&next.as_str()), "reused {next}");
        assert!(!["S1", "S2", "S3", "S4"].contains(&crate::spoken::fresh_id(&world).as_str()));
        // Removing a thread that isn't there changes nothing, and a merged id is skipped too.
        let mut merged = World::default();
        merged.apply(&serde_json::from_str::<Change>(&line("T1")).unwrap());
        merged.merged.insert("T2".into(), "T1".into());
        merged.apply(&Change::ThreadRemoved { thread_id: "T9".into() });
        assert_eq!(merged.next_thread_id(), "T3");
        merged.merged.insert("T3".into(), "T1".into());
        merged.merged.remove("T2");
        assert_eq!(merged.next_thread_id(), "T4");
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
    fn stay_here_defaults_off_follows_a_merge_and_releases_when_its_topic_leaves() {
        let mut world: World = serde_json::from_str(r#"{"threads":[],"thoughts":[],"active":null}"#).unwrap();
        assert!(world.stay_here.is_none(), "old snapshots have no pin");
        world.threads.extend([test_thread("T1", None), test_thread("T2", None)]);
        world.apply(&Change::StayChanged { thread_id: Some("T1".into()) });
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        assert_eq!(world.stay_here.as_deref(), Some("T2"));
        world.apply(&Change::StayChanged { thread_id: Some("T1".into()) });
        assert_eq!(world.stay_here.as_deref(), Some("T2"), "a late pin follows the merge too");
        world.apply(&Change::ThreadRemoved { thread_id: "T2".into() });
        assert!(world.stay_here.is_none(), "an empty topic removed by Undo cannot keep an invisible pin");
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
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "Ana".into() });
        world.apply(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "Sam".into() });
        assert_eq!(world.active.as_deref(), Some("T2"), "the talk is where the last move went");
        assert_eq!(world.active_for("Ana").map(String::as_str), Some("T1"));
        assert_eq!(world.active_for("Lee").map(String::as_str), Some("T2"), "someone new starts where the talk is");
        world.apply(&Change::ThreadStatus { thread_id: "T1".into(), status: super::ThreadStatus::Dropped, speaker: "Ana".into() });
        assert_eq!(world.threads[0].dropped_by, "Ana");
        world.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "back".into(), at_ms: 5 });
        assert_eq!(world.threads[0].dropped_by, "", "picking it up again clears the drop");
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        assert_eq!(world.active_for("Ana").map(String::as_str), Some("T2"), "a merge moves everyone on it");
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
            decided: false,
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
            decided: false,
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
        world.apply(&Change::ThoughtAdded { thought: test_thought("a", "Ana", "T1") });
        world.apply(&Change::SuggestionAdded {
            suggestion: super::Suggestion { id: "s".into(), thread_id: "T1".into(), text: "Ask Sam".into(), status: new },
        });
        world.apply(&Change::ActionProposed {
            action: super::Action { id: "x".into(), thread_id: "T1".into(), kind: "reminder".into(), title: "Pay".into(), when: String::new(), status: new, done_ms: None },
        });
        world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "Ana".into() });
        // Never into itself, or into a thread that isn't there.
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T1".into() });
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T9".into() });
        assert!(world.thread("T1").is_some() && world.merged.is_empty());
        world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
        assert!(world.thread("T1").is_none());
        assert_eq!(world.thoughts[0].thread_id.as_deref(), Some("T2"));
        assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T2"), "its branch");
        assert_eq!((world.suggestions[0].thread_id.as_str(), world.actions[0].thread_id.as_str()), ("T2", "T2"));
        assert_eq!((world.active.as_deref(), world.active_for("Ana").map(String::as_str)), (Some("T2"), Some("T2")));
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

    const TOPICS_MEMORY_LEGACY: &str = r#"{"type":"topics_assigned","assigned":[{"thread_id":"T1","topic":"Work"},{"thread_id":"T2","topic":"Work"},{"thread_id":"T3","topic":"Money"},{"thread_id":"T4","topic":"Family"}]}"#;

    fn topics_memory_world() -> World {
        let mut world = World::default();
        for id in ["T1", "T2", "T3", "T4"] {
            world.apply(&Change::ThreadAdded { thread: test_thread(id, None) });
        }
        world.apply(&serde_json::from_str::<Change>(TOPICS_MEMORY_LEGACY).unwrap());
        world
    }

    #[test]
    fn topics_memory_manual_choices_include_the_existing_theme() {
        let mut world = topics_memory_world();
        assert!(world.topics_chosen.is_empty(), "AI assignments are not personal choices");
        world.apply(&Change::TopicSet { thread_id: "T1".into(), topic: "Work".into() });
        assert_eq!(world.topics_chosen, ["T1".into()].into());
        world.apply(&Change::TopicSet { thread_id: "T2".into(), topic: "Travel".into() });
        assert_eq!(world.topics["T2"], "Travel");
        assert_eq!(world.topics_chosen, ["T1".into(), "T2".into()].into());

        world.apply(&Change::TopicsAssigned {
            assigned: vec![
                crate::topics::Assigned { thread_id: "T1".into(), topic: "Plans".into() },
                crate::topics::Assigned { thread_id: "T3".into(), topic: "Bills".into() },
                crate::topics::Assigned { thread_id: "T4".into(), topic: " ".into() },
                crate::topics::Assigned { thread_id: "missing".into(), topic: "Plans".into() },
            ],
            grouped: None,
        });
        assert_eq!(world.topics["T1"], "Plans", "assignment behavior is unchanged");
        assert_eq!(world.topics["T3"], "Bills");
        assert_eq!(world.topics["T4"], "Family");
        assert!(!world.topics.contains_key("missing"));
        assert_eq!(world.topics_chosen, ["T1".into(), "T2".into()].into());
    }

    #[test]
    fn topics_memory_rename_marks_only_source_members_before_joining() {
        let mut world = topics_memory_world();
        world.apply(&Change::ThreadRemoved { thread_id: "T2".into() });
        world.apply(&Change::TopicRenamed { from: "Work".into(), to: "Money".into() });
        assert_eq!(world.topics_chosen, ["T1".into(), "T2".into()].into(), "retained themes follow renames too");
        for id in ["T1", "T2", "T3"] {
            assert_eq!(world.topics[id], "Money");
        }
        assert_eq!(world.topics["T4"], "Family");
        world.apply(&Change::TopicRenamed { from: "Family".into(), to: "Family".into() });
        assert_eq!(world.topics_chosen, ["T1".into(), "T2".into(), "T4".into()].into());
    }

    #[test]
    fn topics_memory_invalid_manual_changes_leave_choices_unchanged() {
        let mut world = topics_memory_world();
        let before = world.topics.clone();
        for change in [
            Change::TopicSet { thread_id: "missing".into(), topic: "Work".into() },
            Change::TopicSet { thread_id: "T1".into(), topic: " \n ".into() },
            Change::TopicRenamed { from: "Work".into(), to: " \t ".into() },
            Change::TopicRenamed { from: "missing".into(), to: "Work".into() },
        ] {
            world.apply(&change);
        }
        assert_eq!(world.topics, before);
        assert!(world.topics_chosen.is_empty());
        assert_eq!(world.topics_grouped, 0);
    }

    #[test]
    fn topics_memory_legacy_decoding_and_optional_grouped() {
        let legacy: Change = serde_json::from_str(TOPICS_MEMORY_LEGACY).unwrap();
        assert!(matches!(&legacy, Change::TopicsAssigned { grouped: None, .. }));
        let value = serde_json::to_value(&legacy).unwrap();
        assert!(value.get("grouped").is_none());
        assert_eq!(value, serde_json::from_str::<serde_json::Value>(TOPICS_MEMORY_LEGACY).unwrap());

        let mut world = topics_memory_world();
        world.apply(&Change::TopicsAssigned { assigned: vec![], grouped: Some(8) });
        world.apply(&legacy);
        world.apply(&Change::TopicsAssigned { assigned: vec![], grouped: None });
        assert_eq!(world.topics_grouped, 8);
        world.apply(&Change::TopicsAssigned { assigned: vec![], grouped: Some(0) });
        assert_eq!(world.topics_grouped, 0, "an explicit zero replaces the baseline");
        assert!(world.topics_chosen.is_empty());
    }

    #[test]
    fn topics_memory_world_serialization_omits_bookkeeping() {
        let mut world = topics_memory_world();
        world.apply(&Change::TopicSet { thread_id: "T1".into(), topic: "Work".into() });
        world.apply(&Change::TopicsAssigned { assigned: vec![], grouped: Some(8) });
        let value = serde_json::to_value(&world).unwrap();
        assert!(value.get("topics_chosen").is_none());
        assert!(value.get("topics_grouped").is_none());
        let snapshot: World = serde_json::from_value(value).unwrap();
        assert_eq!(snapshot.topics, world.topics);
        assert!(snapshot.topics_chosen.is_empty());
        assert_eq!(snapshot.topics_grouped, 0);
    }

    #[test]
    fn topics_memory_journal_reopening_preserves_choices_and_baseline() {
        let path = std::env::temp_dir().join(format!("e2a2o-topics-memory-{}.jsonl", uuid::Uuid::new_v4()));
        let mut lines = Vec::new();
        for id in ["T1", "T2", "T3", "T4"] {
            lines.push(serde_json::to_string(&Change::ThreadAdded { thread: test_thread(id, None) }).unwrap());
        }
        lines.push(TOPICS_MEMORY_LEGACY.into());
        std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();
        {
            let (mut journal, mut world) = super::Journal::open(&path).unwrap();
            assert_eq!(world.topics["T1"], "Work", "legacy records replay");
            assert!(world.topics_chosen.is_empty());
            assert_eq!(world.topics_grouped, 0);
            for change in [
                Change::TopicSet { thread_id: "T1".into(), topic: "Work".into() },
                Change::TopicRenamed { from: "Work".into(), to: "Money".into() },
                Change::TopicsAssigned { assigned: vec![], grouped: Some(8) },
            ] {
                world.apply(&change);
                journal.append(&change).unwrap();
            }
        }
        {
            let (mut journal, mut world) = super::Journal::open(&path).unwrap();
            assert_eq!(world.topics_chosen, ["T1".into(), "T2".into()].into());
            assert_eq!(world.topics_grouped, 8);
            let change = Change::TopicsAssigned {
                assigned: vec![crate::topics::Assigned { thread_id: "T4".into(), topic: "Travel".into() }],
                grouped: None,
            };
            world.apply(&change);
            journal.append(&change).unwrap();
            assert_eq!(world.topics_grouped, 8);
            assert_eq!(world.topics_chosen, ["T1".into(), "T2".into()].into());
        }
        let (_, replayed) = super::Journal::open(&path).unwrap();
        assert_eq!(replayed.topics_chosen, ["T1".into(), "T2".into()].into());
        assert_eq!(replayed.topics_grouped, 8);
        assert_eq!(replayed.topics["T1"], "Money");
        assert_eq!(replayed.topics["T2"], "Money");
        assert_eq!(replayed.topics["T4"], "Travel");
        std::fs::remove_file(path).unwrap();
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
            decided: false,
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
            decided: false,
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
            Change::ThoughtAdded { thought: test_thought("a", "Ana", "T1") },
            placed("a", "T1", "", "", false),
            Change::ThreadTouched { thread_id: "T1".into(), last_point: "Ask Muse Spark about a".into(), at_ms: 10 },
            // Another point than the one just touched, so a window that skips this kind is caught at this step.
            Change::LastPoint { thread_id: "T1".into(), last_point: "Muse Spark, about a".into() },
            Change::ActiveChanged { thread_id: "T1".into(), speaker: "Ana".into() },
            Change::ThoughtAdded { thought: test_thought("b", "Sam", "T1") },
            placed("b", "T3", "muse bark", "Muse Spark", true),
            Change::ThreadTouched { thread_id: "T3".into(), last_point: "Ask Muse Spark about b".into(), at_ms: 20 },
            Change::ActiveChanged { thread_id: "T3".into(), speaker: "Sam".into() },
            // Places on the canvas: a person's and an AI participant's, one at the edge then back in the layout; none
            // for a thread off the map, nor with one number missing (only an edited journal holds either).
            Change::Positioned { id: "T1".into(), x: Some(120.5), y: Some(-40.0), by: "Ana".into(), at_ms: 21 },
            Change::Positioned { id: "b".into(), x: Some(300.0), y: Some(80.25), by: "AI".into(), at_ms: 22 },
            Change::Positioned { id: "T3".into(), x: Some(-1_000_000.0), y: Some(1_000_000.0), by: "Sam".into(), at_ms: 23 },
            Change::Positioned { id: "T3".into(), x: None, y: None, by: "Sam".into(), at_ms: 24 },
            Change::Positioned { id: "T9".into(), x: Some(1.0), y: Some(1.0), by: "Ana".into(), at_ms: 25 },
            Change::Positioned { id: "T2".into(), x: Some(5.0), y: None, by: "Ana".into(), at_ms: 26 },
            Change::ThoughtNoted {
                thought_id: "b".into(),
                note: crate::chunks::Note { continues: "a".into(), assumed: String::new(), why: "names Muse Spark".into(), later: false },
            },
            Change::ThoughtRepointed { thought_id: "b".into(), point: "Ask Muse Spark about b".into() },
            Change::ThreadStatus { thread_id: "T1".into(), status: super::ThreadStatus::Dropped, speaker: "Ana".into() },
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
            Change::ItemMoved { id: "sg-1".into(), thread_id: "T2".into() },
            Change::ItemRefined {
                id: "sg-1".into(),
                now: super::ItemState { status: super::ItemStatus::New, text: "Ask Sam and Ana".into(), when: String::new() },
                was: super::ItemState { status: super::ItemStatus::New, text: "Ask Sam".into(), when: String::new() },
                why: "Ana joins".into(),
            },
            Change::ItemRestored {
                id: "sg-1".into(),
                to: super::ItemState { status: super::ItemStatus::New, text: "Ask Sam".into(), when: String::new() },
            },
            Change::TidyProposed {
                proposal: crate::tidy::Proposal {
                    id: "tp-1".into(),
                    kind: crate::tidy::Kind::Merge,
                    thread_id: "T3".into(),
                    title: String::new(),
                    into: "T1".into(),
                    status: super::ItemStatus::New,
                },
            },
            Change::ThreadRetitled { thread_id: "T3".into(), title: "Muse Spark questions".into(), was: "Topic T3".into() },
            Change::TitleChosen { thread_id: "T3".into(), title: "Muse Spark".into() },
            Change::ThreadAdded { thread: test_thread("T4", None) },
            // A margin note's thread tied to words, its anchor kept through the merge and its Undo below; none for a
            // thread off the map. An AI participant joined, once however often it says so.
            Change::Anchored { thread_id: "T4".into(), thought_id: "a".into(), quote: "Muse Spark".into(), context: None },
            Change::Anchored { thread_id: "T99".into(), thought_id: "a".into(), quote: "nowhere".into(), context: None },
            Change::AiJoined { speaker: "Friend".into() },
            Change::AiJoined { speaker: "Claude".into() },
            Change::AiJoined { speaker: "Friend".into() },
            // A place on a thread that's merged away goes with it; its merge undone, it's back in the layout.
            Change::Positioned { id: "T4".into(), x: Some(40.0), y: Some(40.0), by: "AI".into(), at_ms: 30 },
            Change::StayChanged { thread_id: Some("T4".into()) },
            Change::ThreadMerged { from: "T4".into(), into: "T1".into() },
            Change::ThreadUnmerged {
                unmerge: crate::tidy::Unmerge {
                    thread: test_thread("T4", None),
                    into: "T1".into(),
                    at: 3,
                    thoughts: Vec::new(),
                    branches: Vec::new(),
                    suggestions: Vec::new(),
                    actions: Vec::new(),
                    proposals: Vec::new(),
                    active: false,
                    active_by: Vec::new(),
                    last_point: Some("Its card's point, read when the undo was made".into()),
                },
            },
            Change::ThoughtCorrected { thought_id: "a".into(), accept: true, with: String::new() },
            Change::ThoughtCorrected { thought_id: "b".into(), accept: false, with: String::new() },
            Change::ThoughtMoved { thought_id: "b".into(), thread_id: "T3".into(), from: "T2".into(), undo: false },
            Change::ThoughtMoved { thought_id: "b".into(), thread_id: "T2".into(), from: "T3".into(), undo: true },
            Change::ThoughtMoved { thought_id: "a".into(), thread_id: "T3".into(), from: "T1".into(), undo: false },
            Change::ThoughtAdded { thought: test_thought("c", "Ana", "T1") },
            Change::ThoughtSplit { thought_id: "c".into(), text: "ask muse bark".into(), rest: test_thought("d", "Ana", "T1") },
            // A thought's place goes when it's set aside, and an empty thread's when it's taken off.
            Change::Positioned { id: "d".into(), x: Some(7.0), y: Some(8.0), by: "Ana".into(), at_ms: 31 },
            Change::ThoughtSkipped { thought_id: "d".into() },
            Change::ThoughtDecided { thought_id: "c".into(), decided: true },
            Change::ThreadAdded { thread: test_thread("T5", None) },
            Change::Positioned { id: "T5".into(), x: Some(-3.5), y: Some(0.0), by: "Sam".into(), at_ms: 32 },
            Change::StayChanged { thread_id: Some("T5".into()) },
            Change::ThreadRemoved { thread_id: "T5".into() },
            Change::ThreadRemoved { thread_id: "T9".into() },
            Change::PutBack { id: "T9".into(), before: "T1".into() },
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
            Change::AnswerMarked { kind: "explain".into(), id: "x1".into(), off: true, speaker: "Ana".into(), at_ms: 50 },
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
            // A yes on a joined point about words said in its first part: that part's words are fixed too.
            Change::ThoughtAdded { thought: test_thought("e", "Ana", "T1") },
            placed("e", "T1", "", "", false),
            Change::ThoughtAdded { thought: Thought { text: "the lease".into(), ..test_thought("f", "Ana", "T1") } },
            placed("f", "T1", "", "", true),
            Change::ThoughtNoted { thought_id: "f".into(), note: crate::chunks::Note { continues: "e".into(), ..crate::chunks::Note::default() } },
            Change::ThoughtCorrected { thought_id: "f".into(), accept: true, with: String::new() },
            // Three parts, the yes on the last: the middle one's point reads the first's words, so it takes the fix.
            Change::ThoughtAdded { thought: test_thought("g", "Ana", "T1") },
            placed("g", "T1", "", "", false),
            Change::ThoughtAdded { thought: Thought { text: "and".into(), ..test_thought("h", "Ana", "T1") } },
            Change::ThoughtPlaced {
                thought_id: "h".into(),
                thread_id: "T1".into(),
                point: "Ask Muse Bark about g and".into(),
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: false,
                place_ms: 2400,
                decided: false,
            },
            Change::ThoughtAdded { thought: Thought { text: "the lease".into(), ..test_thought("i", "Ana", "T1") } },
            placed("i", "T1", "", "", true),
            Change::ThoughtNoted { thought_id: "h".into(), note: crate::chunks::Note { continues: "g".into(), ..crate::chunks::Note::default() } },
            Change::ThoughtNoted { thought_id: "i".into(), note: crate::chunks::Note { continues: "h".into(), ..crate::chunks::Note::default() } },
            Change::ThoughtCorrected { thought_id: "i".into(), accept: true, with: String::new() },
            // A branch's merge undone after its parent merged away: it comes back under where the parent went, and
            // with no point carried (a journal from before), its card's point is read as it always was.
            Change::ThreadAdded { thread: test_thread("T6", None) },
            Change::ThreadAdded { thread: test_thread("T7", Some("T6")) },
            Change::ThreadAdded { thread: test_thread("T8", None) },
            // A topic goes nowhere when its thread leaves the map: the merge's Undo below brings it back with it.
            Change::TopicSet { thread_id: "T7".into(), topic: "Kept through a merge".into() },
            Change::ThreadMerged { from: "T7".into(), into: "T8".into() },
            Change::ThreadMerged { from: "T6".into(), into: "T1".into() },
            Change::ThreadUnmerged {
                unmerge: crate::tidy::Unmerge {
                    thread: test_thread("T7", Some("T6")),
                    into: "T8".into(),
                    at: 0,
                    thoughts: Vec::new(),
                    branches: Vec::new(),
                    suggestions: Vec::new(),
                    actions: Vec::new(),
                    proposals: Vec::new(),
                    active: false,
                    active_by: Vec::new(),
                    last_point: None,
                },
            },
            // Topics: the AI's pass (none for a thread off the map, T2 merged away, nor an empty name), a person's
            // moves, a rename onto a name already there (the two are one), another rename, and one with no new name.
            Change::TopicsAssigned {
                assigned: vec![
                    crate::topics::Assigned { thread_id: "T1".into(), topic: "Muse models".into() },
                    crate::topics::Assigned { thread_id: "T3".into(), topic: "Demo day".into() },
                    crate::topics::Assigned { thread_id: "T2".into(), topic: "Gone".into() },
                    crate::topics::Assigned { thread_id: "T8".into(), topic: " ".into() },
                ],
                grouped: Some(3),
            },
            Change::TopicSet { thread_id: "T4".into(), topic: "Demo day".into() },
            Change::TopicSet { thread_id: "T8".into(), topic: "Muse models".into() },
            Change::TopicSet { thread_id: "T99".into(), topic: "Nowhere".into() },
            Change::TopicRenamed { from: "Demo day".into(), to: "Muse models".into() },
            Change::TopicRenamed { from: "Muse models".into(), to: "Muse Spark".into() },
            Change::TopicRenamed { from: "Muse Spark".into(), to: "".into() },
            Change::StayChanged { thread_id: Some("T4".into()) },
            Change::StayChanged { thread_id: None },
            Change::Paused { pause: super::Pause { id: "pause-a-1".into(), thought_id: "a".into(), speaker: "you".into(), thread_id: "T1".into(), revision: 1, excerpt: "Unfinished source".into(), at_ms: 1, resolved: false, later_count: 0, offer_after_ms: 0, hidden: false } },
            Change::ReturnFocused { speaker: "you".into(), pause_id: "pause-a-1".into(), after: 2 },
            Change::PauseChoice { id: "pause-a-1".into(), later_count: 1, offer_after_ms: 300001, hidden: false },
            Change::PauseResolved { id: "pause-a-1".into(), by_thought: "b".into() },
            Change::TextReceived { speaker: "you".into(), id: "received-once".into() },
            Change::CaptionAdded { caption: super::Caption { id: "caption-1".into(), by: "Helper".into(), text: "A completed answer.".into(), at_ms: 200, order: 1, ai: true, to: Some("you".into()) } },
            Change::SpeechRecovered { draft: super::SpeechDraft { id: "speech-once".into(), speaker: "you".into(), text: "Unfinished words".into() } },
            Change::SpeechResolved { id: "speech-once".into() },
        ];
        // Stops compiling when a kind of change is added: add one to the list above too.
        for change in &changes {
            match change {
                Change::CaptionAdded { .. }
                | Change::RecapSaved { .. }
                | Change::AppRegistered { .. }
                | Change::AppEnabled { .. }
                | Change::AppRemoved { .. }
                | Change::AppRan { .. }
                | Change::AppOutput { .. }
                | Change::AppsSeeded
                | Change::ThoughtAdded { .. }
                | Change::TextReceived { .. }
                | Change::Paused { .. } | Change::PauseResolved { .. } | Change::PauseChoice { .. } | Change::ReturnFocused { .. }
                | Change::SpeechRecovered { .. }
                | Change::SpeechResolved { .. }
                | Change::ThreadAdded { .. }
                | Change::ThoughtPlaced { .. }
                | Change::ThreadTouched { .. }
                | Change::LastPoint { .. }
                | Change::ThreadStatus { .. }
                | Change::ActiveChanged { .. }
                | Change::StayChanged { .. }
                | Change::ThreadRenamed { .. }
                | Change::ThreadMerged { .. }
                | Change::ThreadRetitled { .. }
                | Change::TitleChosen { .. }
                | Change::ThreadUnmerged { .. }
                | Change::TidyProposed { .. }
                | Change::SuggestionAdded { .. }
                | Change::ActionProposed { .. }
                | Change::ItemStatus { .. }
                | Change::ItemMoved { .. }
                | Change::ItemRefined { .. }
                | Change::ItemRestored { .. }
                | Change::TagSuggested { .. }
                | Change::TagKept { .. }
                | Change::TagRemoved { .. }
                | Change::ThreadPicture { .. }
                | Change::ThoughtCorrected { .. }
                | Change::ThoughtMoved { .. }
                | Change::ThoughtSplit { .. }
                | Change::ThoughtSkipped { .. }
                | Change::ThoughtDecided { .. }
                | Change::ThoughtNoted { .. }
                | Change::ThoughtRepointed { .. }
                | Change::ThreadRemoved { .. }
                | Change::PutBack { .. }
                | Change::Positioned { .. }
                | Change::Anchored { .. }
                | Change::AiJoined { .. }
                | Change::TopicsAssigned { .. }
                | Change::TopicSet { .. }
                | Change::TopicRenamed { .. }
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
        assert_eq!(kinds.len(), 57, "one of each kind of change");
        for change in &changes {
            let json = serde_json::to_string(change).unwrap();
            let back: Change = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{json} didn't read back: {e}"));
            assert_eq!(json, serde_json::to_string(&back).unwrap(), "a field was lost");
        }
    }

    /// Every kind of change and the map it makes, for the window's own `apply` to replay (scripts/world-mirror-check.mjs
    /// sets E2A2O_FIXTURE_DIR); without it, nothing to write.
    #[test]
    fn every_change_mirror_fixture() {
        let Ok(dir) = std::env::var("E2A2O_FIXTURE_DIR") else { return };
        let changes = every_change();
        // The map after every change, not only the last: a kind whose effect a later change covers is still checked.
        let mut world = World::default();
        let mut worlds = Vec::new();
        for change in &changes {
            world.apply(change);
            worlds.push(serde_json::to_value(&world).unwrap());
        }
        let fixture = serde_json::json!({ "changes": changes, "world": world, "worlds": worlds });
        std::fs::write(std::path::Path::new(&dir).join("every.json"), serde_json::to_string(&fixture).unwrap()).unwrap();
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
        assert_eq!(w.threads.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["T7", "T1", "T3", "T4", "T8"], "a merge undone puts its thread back");
        assert_eq!(w.thread("T7").unwrap().parent_id.as_deref(), Some("T1"), "under the thread its parent went into");
        let topics: std::collections::BTreeMap<&str, &str> = w.topics.iter().map(|(id, name)| (id.as_str(), name.as_str())).collect();
        assert_eq!(topics, [("T1", "Muse Spark"), ("T3", "Muse Spark"), ("T4", "Muse Spark"), ("T7", "Kept through a merge"), ("T8", "Muse Spark")].into(),
            "only threads on the map, renames joined, a topic back with its thread");
        let e = w.thoughts.iter().find(|t| t.id == "e").unwrap();
        assert_eq!((e.text.as_str(), e.unclear.as_str()), ("ask Muse Spark about e", ""), "a yes on the joined point fixes the part that said it");
        let h = w.thoughts.iter().find(|t| t.id == "h").unwrap();
        assert_eq!((h.text.as_str(), h.point.as_str()), ("and", "Ask Muse Spark about g and"), "and the middle part's point");
        assert_eq!((w.proposals.len(), w.proposals[0].into.as_str()), (1, "T1"));
        assert_eq!(w.thread("T3").unwrap().title, "Budget and demo", "a change aimed at a merged thread follows it");
        assert_eq!((w.active_for("Ana").unwrap().as_str(), w.active_for("Sam").unwrap().as_str()), ("T1", "T3"));
        assert_eq!(w.thread("T1").unwrap().dropped_by, "Ana");
        assert!(w.thread("T1").unwrap().tags.is_empty());
        assert_eq!(w.thoughts[0].text, "ask Muse Spark about a", "yes to Did you mean");
        assert_eq!(w.thoughts[1].text, "ask muse bark about b", "no to a sure fix puts the words back");
        assert!(!w.thoughts[0].complete && w.thoughts[1].complete);
        assert_eq!(w.thoughts[0].thread_id.as_deref(), Some("T3"), "a person's move holds on replay");
        assert_eq!(w.moves, [("a".to_string(), "T1".to_string(), "T3".to_string())], "a move undone takes its record back");
        assert!(w.apart("T1", "T3") && w.apart("T2", "T1") && !w.apart("T1", "T4"), "set apart, followed through a merge");
        assert_eq!((w.suggestions[0].thread_id.as_str(), w.actions[0].thread_id.as_str()), ("T3", "T3"));
        assert_eq!((w.actions[0].status, w.actions[0].done_ms), (super::ItemStatus::Done, Some(300)));
        assert!(w.suggestions[0].text == "Ask Sam" && w.restored.contains("sg-1") && w.refined.is_empty(), "an AI correction undone");
        assert_eq!(w.apps.len(), 1);
        assert!(matches!(w.apps[0].publishers[..], [crate::apps::Publisher::Sound {}, crate::apps::Publisher::Card { .. }]) && !w.apps[0].enabled);
        assert!(w.apps[0].purpose.contains("tune"), "the purpose says what it does");
        assert_eq!(w.recaps[0].plans[0].text, "Show the Palace view at the end.");
        // A person's place and an AI participant's stay, through merges into T1 and moves of b; the one taken back to
        // the layout, and those on a thread merged away, a thought set aside and a thread taken off, are gone.
        let mut placed: Vec<(&str, f64, f64, &str, u64)> = w.positions.iter().map(|(id, p)| (id.as_str(), p.x, p.y, p.by.as_str(), p.at_ms)).collect();
        placed.sort_by(|a, b| a.0.cmp(b.0));
        assert_eq!(placed, [("T1", 120.5, -40.0, "Ana", 21), ("b", 300.0, 80.25, "AI", 22)]);
        assert!(w.thread("T4").is_some() && !w.positions.contains_key("T4"), "a merge undone brings the card back in the layout");
        // A note's anchor holds through its thread's merge and the merge's Undo; one for a thread never on the map isn't
        // kept. An AI participant is listed once, in the order it first came.
        assert_eq!(w.anchors.len(), 1);
        assert_eq!(w.anchors["T4"], crate::annotate::Anchor { thought_id: "a".into(), quote: "Muse Spark".into(), context: Some(crate::annotate::AnchorContext { source_text: "Ask Muse Spark about a".into(), source_speaker: "Ana".into(), start: 4, end: 14 }) });
        assert_eq!(w.ai, ["Friend", "Claude"]);
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

/// The parts of a test map that the modules' tests (moves, catalog, find, spoken) share, instead of a copy in each.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::{Thought, Thread, ThreadStatus};

    /// An open top-level thread with nothing else on it.
    pub(crate) fn thread(id: &str, title: &str, touched_ms: u64) -> Thread {
        Thread {
            id: id.into(),
            title: title.into(),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    /// A finished thought of yours placed on `thread`, its point its words, placed a second after it was said.
    pub(crate) fn thought(id: &str, thread: &str, text: &str, at_ms: u64) -> Thought {
        Thought {
            id: id.into(),
            speaker: "you".into(),
            text: text.into(),
            point: text.into(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms,
            place_ms: Some(1_000),
            decided: false,
        }
    }
}
