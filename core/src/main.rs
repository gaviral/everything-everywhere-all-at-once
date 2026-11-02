//! E2A2O core: holds the world in memory, journals every change, listens through
//! Muse Voice Transcribe, places thoughts with Muse Spark, and keeps every UI in sync.
//! With a room code, a second laptop on the same network joins the same map.

mod apple;
mod apps;
mod asr;
mod catalog;
mod chunks;
mod clock;
mod explain;
mod find;
mod import;
mod model;
mod pictures;
mod placer;
mod refiner;
mod trace;
mod recap;
mod protocol;
mod moves;
mod spoken;
mod tidy;
mod world;
#[cfg(test)]
mod perf;

use axum::extract::connect_info::{ConnectInfo, Connected};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, Outgoing, ServerMsg, View};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::{ServeDir, ServeFile};
use world::{Change, Journal, Thought, ThreadStatus, World};

pub struct Core {
    find: find::Runtime,
    /// Each speaker's last turn, what "this" means to them, and the Undo button (catalog.rs).
    catalog: catalog::Runtime,
    recap: recap::Runtime,
    apps: apps::Runtime,
    world: Mutex<Arc<World>>,
    journal: Mutex<Journal>,
    updates: broadcast::Sender<Outgoing>,
    placer_queue: mpsc::UnboundedSender<placer::Job>,
    /// Who said "new thread", and the thought that starts each one.
    new_threads: placer::NewThreads,
    /// The thought being placed, and those waiting to try again.
    pub placing: placer::Placing,
    /// Set when a room is open.
    room: Option<Room>,
    pub key: Option<String>,
    /// Placing and Explain's model (model.rs).
    pub placer_model: model::Setting,
    pub http: reqwest::Client,
    /// When the person last spoke or typed; background work waits for a pause.
    last_activity: std::sync::atomic::AtomicU64,
    /// Set when the person comes back to the window (e.g. opens their eyes).
    looked: std::sync::atomic::AtomicBool,
    /// Wakes the background passes early.
    pub wake: tokio::sync::Notify,
    /// Importing past AI chats.
    pub imports: import::Imports,
    /// Whether the model service refused the key or is busy (model.rs).
    service: model::Service,
    /// Speakers whose windows run on this machine: in a room, only they may add to its Reminders or Calendar.
    hosts: Mutex<std::collections::HashSet<String>>,
    /// Model calls and placements, when `E2A2O_TRACE` is on (trace.rs).
    pub trace: trace::Trace,
}

impl Core {
    pub fn touch(&self) {
        self.last_activity.store(now_ms(), std::sync::atomic::Ordering::Relaxed);
    }

    /// Milliseconds since the person last spoke or typed.
    pub fn quiet_ms(&self) -> u64 {
        now_ms().saturating_sub(self.last_activity.load(std::sync::atomic::Ordering::Relaxed))
    }

    /// True once after the person came back to the window.
    pub fn take_looked(&self) -> bool {
        self.looked.swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> Arc<World> {
        Arc::clone(&self.world.lock().unwrap())
    }

    /// Applies a batch of changes together, journals each one, then tells every UI.
    pub fn commit(&self, changes: Vec<Change>) {
        self.commit_if(|_| true, changes);
    }

    /// Commits `changes` only while `still` holds, checked under the same lock as the commit, so nothing comes
    /// between: a placement whose words were taken back while the model thought (catalog.rs) changes nothing.
    pub fn commit_if(&self, still: impl Fn(&World) -> bool, changes: Vec<Change>) -> bool {
        {
            let mut world = self.world.lock().unwrap();
            if !still(&world) {
                return false;
            }
            let mut journal = self.journal.lock().unwrap();
            for change in &changes {
                Arc::make_mut(&mut world).apply(change);
                if let Err(e) = journal.append(change) {
                    tracing::error!("journal write failed: {e:#}");
                }
            }
        }
        for change in changes {
            self.send(ServerMsg::Change { change });
        }
        true
    }

    /// Journals a change that only the record keeps (an Explain answer, a mark on one): the world and the windows
    /// don't change.
    pub fn record(&self, change: Change) {
        if let Err(e) = self.journal.lock().unwrap().append(&change) {
            tracing::error!("journal write failed: {e:#}");
        }
    }

    /// To every window.
    pub fn send(&self, message: ServerMsg) {
        let _ = self.updates.send(Outgoing { to: None, message });
    }

    /// Only to one speaker's windows.
    pub fn send_to(&self, speaker: &str, message: ServerMsg) {
        let _ = self.updates.send(Outgoing { to: Some(speaker.into()), message });
    }

    /// Takes the speaker to a thread as a new move (a click, a search's answer): a search still looking stops,
    /// and so does a "new thread" asked for before it, since the speaker is somewhere again.
    pub fn focus(self: &Arc<Self>, speaker: &str, thread_id: &str) {
        find::stop(self, speaker);
        self.new_threads.cancel(speaker);
        self.move_to(speaker, thread_id);
    }

    /// Makes a thread the speaker's active one; going back to a dropped thread reopens it. "Where was I?",
    /// "next one" and "last one" move with this alone: saying one already stopped any search said before it
    /// (`add_thought`), and one that waited its turn in the placer's queue must not stop a search said after it.
    fn move_to(&self, speaker: &str, thread_id: &str) {
        let world = self.snapshot();
        let Some(thread) = world.thread(thread_id) else { return };
        self.placing.moved(speaker);
        let mut changes = vec![Change::ActiveChanged { thread_id: thread_id.into(), speaker: speaker.into() }];
        if thread.status == ThreadStatus::Dropped {
            changes.push(Change::ThreadStatus { thread_id: thread_id.into(), status: ThreadStatus::Open, speaker: speaker.into() });
        }
        drop(world);
        self.commit(changes);
    }

    /// "Where was I?": see `way_back`. With nowhere to go back to it still answers, as every request does (the
    /// tour teaches it on an empty map): where the speaker is, shown as Take me there shows a point, or why
    /// there's nothing yet.
    fn go_back(&self, speaker: &str) {
        let world = self.snapshot();
        if let Some(id) = way_back(&world, speaker, now_ms()) {
            let title = world.thread(&id).map(|t| t.title.clone()).unwrap_or_default();
            self.send_to(speaker, ServerMsg::Notice { message: format!("Back to {title}") });
            drop(world);
            self.move_to(speaker, &id);
            return;
        }
        // Nothing else to go back to: every point of theirs is on the thread they're on. Their latest, by when it
        // was said (a split turn's rest, said at the same time, comes later in the list).
        let now = now_ms();
        let latest = world.thoughts.iter().filter(|t| t.placed && t.speaker == speaker).max_by_key(|t| t.said_at(now));
        match latest.and_then(|t| Some((t, world.thread(&world.resolve(t.thread_id.as_deref()?))?))) {
            Some((thought, thread)) => self.send_to(
                speaker,
                ServerMsg::Found {
                    thread_id: thread.id.clone(),
                    thought_id: Some(thought.id.clone()),
                    message: match thought.point.trim() {
                        "" => format!("You're on {}", thread.title),
                        point => format!("You're on {}: “{point}”", thread.title),
                    },
                },
            ),
            None => self.send_to(speaker, ServerMsg::Notice { message: nothing_yet(&world) }),
        }
    }

    /// "Next one": the thread after the speaker's, in the order they were started.
    fn go_next(&self, speaker: &str) {
        let world = self.snapshot();
        let active = world.active_for(speaker);
        let position = active.and_then(|a| world.threads.iter().position(|t| &t.id == a));
        let next = match position {
            Some(i) => world.threads.get(i + 1).or_else(|| world.threads.first()),
            None => world.threads.first(),
        };
        match next {
            Some(thread) if Some(&thread.id) == active => self.only_one(speaker, &thread.title),
            Some(thread) => {
                self.send_to(speaker, ServerMsg::Notice { message: format!("On to {}", thread.title) });
                let id = thread.id.clone();
                drop(world);
                self.move_to(speaker, &id);
            }
            None => self.send_to(speaker, ServerMsg::Notice { message: nothing_yet(&world) }),
        }
    }

    /// "Last one": the thread before the speaker's, in the order "next one" goes, from the first round to the last.
    fn go_previous(&self, speaker: &str) {
        let world = self.snapshot();
        let active = world.active_for(speaker);
        let position = active.and_then(|a| world.threads.iter().position(|t| &t.id == a));
        let previous = match position.and_then(|i| i.checked_sub(1)) {
            Some(i) => world.threads.get(i),
            None => world.threads.last(),
        };
        match previous {
            Some(thread) if Some(&thread.id) == active => self.only_one(speaker, &thread.title),
            Some(thread) => {
                self.send_to(speaker, ServerMsg::Notice { message: format!("Previous: {}", thread.title) });
                let id = thread.id.clone();
                drop(world);
                self.move_to(speaker, &id);
            }
            None => self.send_to(speaker, ServerMsg::Notice { message: nothing_yet(&world) }),
        }
    }

    /// "Next one" or "last one" on the only thread: no move, but an answer.
    fn only_one(&self, speaker: &str, title: &str) {
        self.send_to(speaker, ServerMsg::Notice { message: format!("{title} is the only thread so far") });
    }

    /// "New thread": nothing to place, and the speaker's next thought starts one (placer.rs `NewThreads`).
    fn new_thread(&self, speaker: &str) {
        self.new_threads.ask(speaker);
        self.send_to(speaker, ServerMsg::Notice { message: "New thread: your next thought starts it".into() });
    }

    /// Whether the speaker's window runs on this machine. Alone, only this machine's pages get in.
    fn is_host(&self, speaker: &str) -> bool {
        self.room.is_none() || self.hosts.lock().unwrap().contains(speaker)
    }

    /// A new thought lands in the speaker's active thread at once; the placer moves it if needed. Filler
    /// never becomes a thought, a request is never one, and a spoken command keeps its place among the words:
    /// one the turn opens with goes ahead of the words after it, one it ends with waits behind the words before
    /// it. A search keeps the words said after its question (see `find::request`).
    pub fn add_thought(self: &Arc<Self>, speaker: &str, text: &str) {
        self.add_turn(speaker, text, true);
    }

    /// `add_thought`, where a search the turn asks looks only when `search`: not in the words a stopped search
    /// held, which were said before what stopped it (see `find::stop`).
    fn add_turn(self: &Arc<Self>, speaker: &str, text: &str, search: bool) {
        self.touch();
        // The latest thing said, by when (see `Thought::said_at`).
        let now = now_ms();
        let asked = self.snapshot().thoughts.iter().max_by_key(|t| t.said_at(now)).is_some_and(|t| t.text.trim_end().ends_with('?'));
        // The AI's open question on the speaker's latest words ("Did you mean …?") takes a spoken yes, no or short fix
        // first: "yeah" is filler otherwise.
        if catalog::answer(self, speaker, text) {
            return;
        }
        // "Hmm" while a search is still looking adds nothing, so the search goes on; anything else is newer than it.
        if filler(text, asked) {
            return;
        }
        find::stop(self, speaker);
        catalog::newer(self, speaker);
        if let Some(done) = self.request(speaker, text, search) {
            return catalog::did(self, speaker, text, done);
        }
        // "No, I meant …" and "scratch that": the speaker's previous turn, redone or taken back.
        if catalog::correct(self, speaker, text, search) {
            return;
        }
        let (first, said, then) = turn(text);
        if let Some(job) = first {
            self.run_command(speaker, job);
        }
        if !filler(said, asked) {
            let id = self.keep(speaker, said);
            catalog::kept(self, speaker, said, vec![id]);
        }
        if let Some(job) = then {
            self.run_command(speaker, job);
        }
    }

    /// Acts on `text` when the whole turn is a request (catalog.rs), and says what it did and how to take it back;
    /// None leaves it to be talk. The same path for words said, typed, and the safety net's reading of a correction.
    fn request(self: &Arc<Self>, speaker: &str, text: &str, search: bool) -> Option<catalog::Done> {
        use catalog::{Act, Done, Undo};
        let before = self.snapshot().active_for(speaker).cloned();
        if let Some(period) = recap::command(text) {
            let period = if recap::unqualified(text) { recap::default_period(&self.snapshot(), now_ms()) } else { period };
            recap::request(self.clone(), speaker.into(), period);
            return Some(Done::new(Act::Recap));
        }
        if let Some(request) = apps::command(text) {
            apps::compose(self.clone(), request);
            return Some(Done::new(Act::Compose));
        }
        if let Some(view) = view(text) {
            // "Focus on this" moves you to the card "this" means first, as "collapse this" folds it; Undo moves you
            // back too. Bare "focus" stays on the thread you're on, as its button does.
            let to = if focuses_this(text) { catalog::this(self, &self.snapshot(), speaker) } else { None };
            // No thread to focus on: the window would do nothing, so say why, as "collapse this" does.
            if view == View::Focus && to.is_none() && before.is_none() {
                let empty = self.snapshot().threads.is_empty();
                let message = if empty { "Nothing on the map yet: say a thought first" } else { "Point at a thread, then say “focus on this”" };
                self.send_to(speaker, ServerMsg::Notice { message: message.into() });
                return Some(Done::missed(Act::Focus));
            }
            let moved = to.filter(|to| before.as_ref() != Some(to));
            if let Some(to) = &moved {
                self.focus(speaker, to);
            }
            self.send_to(speaker, ServerMsg::View { view });
            let mut done = Done::view(view);
            if let (Some(_), Some(from)) = (moved, before) {
                done.undo = Some(Undo::Each(done.undo.into_iter().chain([Undo::Move { to: from }]).collect()));
            }
            return Some(done);
        }
        if is_new_thread(text) {
            self.new_thread(speaker);
            return Some(Done::with(Act::NewThread, Some(Undo::NewThread)));
        }
        if let Some(done) = spoken::act(self, speaker, text) {
            return Some(done);
        }
        if let Some(done) = moves::act(self, speaker, text) {
            return Some(done);
        }
        let (first, said, then) = turn(text);
        // "Take me back to where I was" is a command, not a search: only a command that opens the turn comes first.
        if first.is_none() {
            if let Some(ask) = find::command(text) {
                if !search {
                    find::dropped(self, speaker, ask, text);
                } else {
                    find::request(self.clone(), speaker.into(), ask, text.into());
                }
                return Some(Done::moved(Act::Search, before));
            }
        }
        if let (Some(job), "", None) = (first, said, then) {
            self.run_command(speaker, job);
            return Some(Done::moved(catalog::of_job(job), before));
        }
        None
    }

    /// Words to place: a thought in the speaker's active thread, queued for the placer.
    pub fn keep(&self, speaker: &str, text: &str) -> String {
        let thought = Thought {
            id: format!("th-{}", uuid::Uuid::new_v4().simple()),
            speaker: speaker.into(),
            text: text.into(),
            point: String::new(),
            thread_id: self.snapshot().active_for(speaker).cloned(),
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: now_ms(),
            place_ms: None,
        };
        let id = thought.id.clone();
        // Before it's queued, so the placer knows when it's the first after "new thread".
        self.new_threads.said(speaker, &id);
        self.commit(vec![Change::ThoughtAdded { thought }]);
        let _ = self.placer_queue.send(placer::Job::Place(id.clone()));
        id
    }

    /// "Where was I?", "next one" or "last one" acts at once, unless words the speaker said before it are still
    /// waiting for their first try: landing moves them to its thread and would undo it, so then it waits behind
    /// them in the placer's line, and acts as soon as they're placed or their try fails (`placer::serve`). It never
    /// waits for the other person's words, or for a retry: a thought that lands after its speaker moved on
    /// doesn't move them. A "new thread" said before it ends as it's said: the speaker chose a thread to be on.
    fn run_command(&self, speaker: &str, job: Command) {
        self.new_threads.cancel(speaker);
        // Without a working key none lands, so there's nothing to wait for.
        let waiting = self.key().is_ok()
            && self.snapshot().thoughts.iter().any(|t| !t.placed && t.speaker == speaker && !self.placing.failed(&t.id));
        let job = job(speaker.into());
        if waiting {
            let _ = self.placer_queue.send(job);
        } else {
            self.act(job);
        }
    }

    /// A spoken command, now.
    pub(crate) fn act(&self, job: placer::Job) {
        match job {
            placer::Job::Back(speaker) => self.go_back(&speaker),
            placer::Job::Next(speaker) => self.go_next(&speaker),
            placer::Job::Previous(speaker) => self.go_previous(&speaker),
            placer::Job::Place(_) => {}
        }
    }
}

/// Lowercase words, with punctuation as spaces ("Mm-hmm." → "mm hmm").
fn words(text: &str) -> Vec<String> {
    let clean: String =
        text.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' }).collect();
    clean.split_whitespace().map(String::from).collect()
}

/// Sounds and connectors that carry nothing on their own.
const SOUNDS: [&str; 32] = [
    "um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hmm", "hm", "hmmm", "mm", "mmm", "oh", "so", "well", "like",
    "and", "but", "anyway", "anyways", "wait", "actually", "basically", "i mean", "you know", "hold on", "let me think", "let me see",
    "let s see",
];
/// Acknowledgements: filler too, unless they may answer a question just asked. Not "yes": said on its
/// own it's usually meant ("I wonder if I should take it." "Yes."), so the placer judges it in context.
const ACKS: [&str; 15] =
    ["yeah", "yep", "yup", "okay", "ok", "alright", "all right", "right", "sure", "mhm", "mm hmm", "uh huh", "cool", "got it", "i see"];

/// True when a turn holds nothing for the map: only sounds and connectors ("um, so"), or only
/// acknowledgements ("yeah, okay") when the last thing said wasn't a question. "No", a name or a
/// time never is; whatever this lets through, the placer can still set aside in context.
fn filler(text: &str, asked: bool) -> bool {
    let acks: &[&str] = if asked { &[] } else { &ACKS };
    let words = words(text);
    skipped(&words, SOUNDS.iter().chain(acks), |_, _| true) == words.len()
}

/// How many of the first `words` are these phrases, one after another, each where `fits` lets it end (that many
/// words in). Longest first, so "uh huh" isn't read as "uh" and then a stray "huh".
fn skipped<'a>(words: &[impl AsRef<str>], phrases: impl Iterator<Item = &'a &'a str>, fits: impl Fn(&[&str], usize) -> bool) -> usize {
    let mut phrases: Vec<Vec<&str>> = phrases.map(|p| p.split(' ').collect()).collect();
    phrases.sort_by_key(|p| std::cmp::Reverse(p.len()));
    let mut at = 0;
    while let Some(p) = phrases.iter().find(|p| {
        words.len() - at >= p.len() && words[at..].iter().zip(p.iter()).all(|(w, p)| w.as_ref() == *p) && fits(p, at + p.len())
    }) {
        at += p.len();
    }
    at
}

/// The marks the transcriber writes at a pause.
const PAUSE: [char; 9] = [',', '.', ';', ':', '?', '!', '…', '—', '–'];

/// Words that ask the app for something ("Can you recap?"). They lead into a request only when it's the whole turn:
/// partway through one they ask someone ("I loved Japan. Would you go back?").
const ASKING: [&str; 4] = ["can you", "could you", "would you", "will you"];

/// Filler that makes a sentence of the words right after it ("I see the palace", "I mean the map", "You know the
/// palace?"), so it leads into a request only across a pause: "I see. Go to the palace.", "I mean, the map", "Like, help".
const TALK: [&str; 4] = ["i see", "i mean", "you know", "like"];

/// `text` after the words that lead into a request, so every request takes the same ones: whatever `filler` sets
/// aside ("Okay, so, um", "Well, all right", "Cool"; `TALK` only before a pause mark), "now", "hey", "please", and
/// the words that ask (`ASKING`). Never at the end of an unpunctuated turn (`is_lost_place`), where the word before
/// the request ends a sentence ("The demo went well where was I").
pub fn lead_in(text: &str) -> &str {
    lead(text, true)
}

/// `lead_in`, with or without the words that ask.
fn lead(text: &str, asking: bool) -> &str {
    // Each word as `words` splits them (a run of letters and digits), and where it ends.
    let mut spans: Vec<(String, usize)> = Vec::new();
    let mut start = None;
    for (i, c) in text.char_indices().chain([(text.len(), ' ')]) {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                spans.push((text[s..i].to_lowercase(), i));
                start = None;
            }
            _ => {}
        }
    }
    let said: Vec<&str> = spans.iter().map(|(w, _)| w.as_str()).collect();
    let extra: &[&str] = if asking { &ASKING } else { &[] };
    let paused = |end: usize| text[spans[end - 1].1..].trim_start().starts_with(PAUSE);
    let leads = SOUNDS.iter().chain(&ACKS).chain(&["now", "hey", "please"]).chain(extra);
    match skipped(&said, leads, |p, end| !TALK.contains(&p.join(" ").as_str()) || paused(end)) {
        0 => text,
        n => &text[spans[n - 1].1..],
    }
}

/// True when words that ask lead into `text`: partway through a turn, that's a question to someone.
fn asks_someone(text: &str) -> bool {
    lead(text, true).len() < lead(text, false).len()
}

/// A spoken "where was I?", "next one" or "last one", as the placer job it makes for a speaker.
type Command = fn(String) -> placer::Job;

/// A spoken "where was I?", "next one" or "last one": the whole turn, or its end after a pause in it ("…it
/// starts at two, okay, where was I?"), with the words said before it, which are still a thought.
fn command(text: &str) -> Option<(&str, Command)> {
    let job = |t: &str| -> Option<Command> {
        if is_go_back(t) {
            Some(placer::Job::Back)
        } else if is_go_next(t) {
            Some(placer::Job::Next)
        } else if is_go_previous(t) {
            Some(placer::Job::Previous)
        } else {
            None
        }
    };
    if let Some(job) = job(text) {
        return Some(("", job));
    }
    let before = |i: usize| text[..i].trim_end().trim_end_matches([',', ';', ':', '—', '–']).trim_end();
    let after = |i: usize| if asks_someone(&text[i..]) { None } else { job(&text[i..]) };
    starts(text).into_iter().find_map(|i| after(i).map(|job| (before(i), job))).or_else(|| {
        // The transcriber sometimes writes a whole turn without punctuation ("…at three where was I").
        let back: Command = placer::Job::Back;
        word_starts(text).find(|&i| is_lost_place(&text[i..])).map(|i| (before(i), back))
    })
}

/// Where each word after the first begins.
fn word_starts(text: &str) -> impl Iterator<Item = usize> + '_ {
    text.char_indices().filter(|&(i, c)| i > 0 && !c.is_whitespace() && text[..i].ends_with(char::is_whitespace)).map(|(i, _)| i)
}

/// "Where was I?" and its kin, which no sentence has partway through ("where I was" is how one would),
/// so they end a turn as a command even with no pause marked before them. Nothing leads into one here: the
/// word before it ends the sentence ("We turned right where was I").
fn is_lost_place(text: &str) -> bool {
    is_ask(text, &["where was i", "where were we", "what was i saying", "what was i talking about"], &["going with this", "going with that", "again"])
}

/// What a turn asks for, in the order said: a command it opens with (see `opening`), the words to place,
/// and a command it ends with (see `command`); a turn that is only a command opens with it. Commands said
/// back to back count once, the last: "where was I, where was I… oh right" goes back once.
fn turn(text: &str) -> (Option<Command>, &str, Option<Command>) {
    let (mut first, mut rest) = (None, text);
    while let Some((job, after)) = opening(rest) {
        (first, rest) = (Some(job), after);
    }
    match command(rest) {
        Some(("", job)) => (Some(job), "", None),
        Some((before, job)) => (first, before, Some(job)),
        None => (first, rest, None),
    }
}

/// A command a turn opens with, and the words after it: "Where was I? Oh right, the rent is due Friday."
/// The words before a pause mark or a turning word must be exactly a command, with the same strict asks
/// and tails as a whole-turn one. Anything less stays as it was: "Go back to the beginning of the song,
/// it's the best part" (more words before the pause) and "Next one up is the dentist" (no pause) are
/// thoughts. So are a bare "next" or "previous" and a "last one", which at the start list things ("Next,
/// I'll call Mom"; "Last one, the dentist"), a command ending in "there", "to that" or "to it", which
/// points at the words after the pause ("Go back there, it was lovely"; "Take me back to that, the budget
/// thing" is still a search), and one asked of someone ("Would you go back? I loved it there").
fn opening(text: &str) -> Option<(Command, &str)> {
    starts(text).into_iter().find_map(|i| {
        let (head, rest) = text.split_at(i);
        if asks_someone(head) {
            return None;
        }
        let said = format!(" {}", words(head).join(" "));
        let points_on = [" there", " to that", " to it"].iter().any(|end| said.ends_with(end));
        let job: Command = if is_go_back(head) && !points_on {
            placer::Job::Back
        } else if is_go_next(head) && !is_command(head, &["next"], &[]) {
            placer::Job::Next
        } else if is_go_previous(head) && !is_command(head, &["previous", "last one", "last thread", "last topic"], &[]) {
            placer::Job::Previous
        } else {
            return None;
        };
        Some((job, rest.trim_start_matches([',', ';', ':', '—', '–']).trim_start()))
    })
}

/// Where a command may begin partway through a turn, or the words after one: a word after a punctuation
/// mark, or a word that turns the talk ("okay", "anyway"). So "fly there and go back" and "that song would
/// take me back" stay thoughts.
fn starts(text: &str) -> Vec<usize> {
    const TURN: [&str; 11] = ["okay", "ok", "alright", "anyway", "anyways", "so", "wait", "hmm", "um", "uh", "oh"];
    let mut out = Vec::new();
    let mut in_word = false;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            in_word = false;
        } else if !in_word {
            in_word = true;
            let word = words(text[i..].split_whitespace().next().unwrap_or(""));
            let turns = word.first().is_some_and(|w| TURN.contains(&w.as_str()));
            if i > 0 && (text[..i].trim_end().ends_with(PAUSE) || turns) {
                out.push(i);
            }
        }
    }
    out
}

/// Where "where was I?" takes a speaker: where their last line trailed off, even the thread they're on (that's
/// where they left off; moving them away would also keep it from being marked unfinished when they move on);
/// else the thread they most recently dropped; else the last other one they spoke on. Never the other
/// person's: in a room each has their own way back.
fn way_back(world: &World, speaker: &str, now: u64) -> Option<String> {
    let current = world.active_by.get(speaker);
    // Newest first by when it was said (see `Thought::said_at`). Reversed first, so the stable sort keeps
    // a split turn's rest (same time) ahead of its first part.
    let mut theirs: Vec<&Thought> = world.thoughts.iter().rev().filter(|t| t.placed && t.speaker == speaker).collect();
    theirs.sort_by_key(|t| std::cmp::Reverse(t.said_at(now)));
    let trailed_off = theirs.first().filter(|t| !t.complete).and_then(|t| t.thread_id.clone());
    let dropped = || {
        world
            .threads
            .iter()
            .filter(|t| t.status == ThreadStatus::Dropped && t.dropped_by == speaker)
            .max_by_key(|t| t.touched_ms)
            .map(|t| t.id.clone())
    };
    trailed_off.or_else(dropped).or_else(|| theirs.iter().filter_map(|t| t.thread_id.clone()).find(|id| Some(id) != current))
}

/// Why "where was I?", "next one" or "last one" has nowhere to go: an empty map, or nothing of the speaker's on it
/// yet (a guest in a room who hasn't spoken).
fn nothing_yet(world: &World) -> String {
    if world.threads.is_empty() { "Nothing on the map yet: say a thought first" } else { "Nothing to go back to yet: say a thought first" }.into()
}

/// Spoken or typed "where was I?" style requests, kept strict so ordinary thoughts
/// like "go back to the drawing board" stay thoughts.
fn is_go_back(text: &str) -> bool {
    is_command(
        text,
        &["where was i", "what was i saying", "what was i talking about", "where were we", "take me back", "go back"],
        &["to where i was", "to that", "to it", "there", "again", "going with this", "going with that"],
    )
}

/// "Go to the next one" style requests.
fn is_go_next(text: &str) -> bool {
    is_command(text, &["go to the next", "next one", "next thread", "go next", "next"], &["one", "thread", "topic"])
}

/// "Go to the last one" style requests, the other way from "next one". "Go back" alone stays "where was I?",
/// and "the last one" is left out: said alone it's more often an answer ("Which slide? The last one").
fn is_go_previous(text: &str) -> bool {
    is_command(
        text,
        &[
            "go to the last", "go to the previous", "go back to the last", "go back to the previous", "go back one", "back one", "last one",
            "last thread", "last topic", "previous",
        ],
        &["one", "thread", "topic"],
    )
}

/// "New thread" style requests. Only the whole turn: "create a new one for the kitchen" is a thought, and
/// so is a bare "new", which is far more often an answer.
fn is_new_thread(text: &str) -> bool {
    is_command(
        text,
        &[
            "new thread", "new topic", "a new thread", "a new topic", "start a new one", "start a new thread", "start a new topic",
            "create a new one", "create a new thread", "make a new one", "make a new thread", "open a new thread", "let s start a new one",
            "let s start a new thread", "let s start a new topic", "change of topic", "different topic",
        ],
        &[],
    )
}

/// A view asked for by voice, as its button sets it: "palace", "show the map", "let's focus", "show all"; or the
/// "?" list of what you can say ("What can I say?", "help"). Only the whole turn, so "let's go to the palace of
/// Versailles", "I can't focus today" and "help me move the couch on Saturday" are thoughts.
fn view(text: &str) -> Option<View> {
    // As Dragon's "What can I say?" and Voice Control's "Show commands". Not "what can I do?", which people ask
    // themselves.
    let help = [
        "help", "help me", "what can i say", "what can you do", "what are the commands", "what are my commands", "show commands",
        "show the commands", "show me the commands", "show me what i can say",
    ];
    let palace = [
        "palace", "the palace", "go to the palace", "go back to the palace", "back to the palace", "show the palace", "show me the palace",
        "open the palace", "switch to the palace", "take me to the palace", "let s go to the palace", "let s see the palace",
    ];
    let map = [
        "map", "the map", "go to the map", "go back to the map", "back to the map", "show the map", "show me the map", "open the map",
        "switch to the map", "take me back to the map", "let s go back to the map", "let s see the map",
    ];
    let focus: Vec<String> = ["focus", "let s focus", "turn on focus"].map(String::from).into_iter().chain(focus_this_asks()).collect();
    let focus: Vec<&str> = focus.iter().map(String::as_str).collect();
    let all =
        ["show all", "show everything", "show me everything", "unfocus", "stop focusing", "turn off focus", "exit focus", "leave focus"];
    if is_command(text, &help, &["here", "now"]) {
        Some(View::Help)
    } else if is_command(text, &palace, &["view"]) {
        Some(View::Palace)
    } else if is_command(text, &map, &["view"]) {
        Some(View::Map)
    } else if is_command(text, &focus, &["mode"]) {
        Some(View::Focus)
    } else if is_command(text, &all, &["mode", "threads", "the threads"]) {
        Some(View::All)
    } else {
        None
    }
}

/// What "focus on …" points at as "this" (catalog.rs `this`: selected, else pointed, else the card the pointer just
/// left, else the thread you're on). ui/src/attention-core.ts mirrors it for the "this" mark (attention-check reads it).
const FOCUS_ON: [&str; 8] = ["this", "this one", "this thread", "this card", "that", "that one", "that thread", "that card"];

/// "Focus on this" and its kin, with "let's" too: a whole-turn focus on the card "this" means. "Focus on the budget"
/// stays a thought: only a pointing word focuses.
fn focus_this_asks() -> Vec<String> {
    ["focus on", "let s focus on"].iter().flat_map(|verb| FOCUS_ON.map(|on| format!("{verb} {on}"))).collect()
}

/// Whether the whole turn focuses "this" rather than the thread you're on ("Focus", "let's focus").
fn focuses_this(text: &str) -> bool {
    let asks = focus_this_asks();
    is_command(text, &asks.iter().map(String::as_str).collect::<Vec<_>>(), &["mode"])
}

/// True when the whole utterance is one of the asks, after words that lead into it (`lead_in`: "Okay, where was
/// I?", "Can you recap?") and before a short allowed tail; a "please" may end either ("go to the last thread, please").
fn is_command(text: &str, asks: &[&str], tails: &[&str]) -> bool {
    is_ask(lead_in(text), asks, tails)
}

/// `is_command` with nothing before the ask.
fn is_ask(text: &str, asks: &[&str], tails: &[&str]) -> bool {
    let rest = words(text).join(" ");
    asks.iter().any(|ask| {
        rest.strip_prefix(ask)
            .map(|tail| {
                let tail = tail.trim();
                let tail = tail.strip_suffix("please").unwrap_or(tail).trim_end();
                tail.is_empty() || tails.contains(&tail)
            })
            .unwrap_or(false)
    })
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
    let room = room_code()?;
    let data = std::env::var("E2A2O_DATA").unwrap_or_else(|_| "../data".into());
    let (journal, world) = Journal::open(&Path::new(&data).join("journal.jsonl"))?;
    let pending: Vec<String> = world.thoughts.iter().filter(|t| !t.placed).map(|t| t.id.clone()).collect();

    let (updates, _) = broadcast::channel(1024);
    let (placer_queue, queue) = mpsc::unbounded_channel();
    let core = Arc::new(Core {
        find: find::Runtime::default(),
        catalog: catalog::Runtime::default(),
        recap: recap::Runtime::default(),
        apps: apps::Runtime::default(),
        world: Mutex::new(world.into()),
        journal: Mutex::new(journal),
        updates,
        placer_queue,
        new_threads: placer::NewThreads::default(),
        hosts: Default::default(),
        placing: placer::Placing::default(),
        room: room.as_deref().map(Room::from),
        key,
        // A key that can't use Contributor mode gets muse-spark-1.2 instead, unless PLACER_MODEL is set (model.rs).
        placer_model: model::Setting::from_env("PLACER_MODEL", "muse-spark-1.2-contributor"),
        // Without a limit, one hung model call stalls its block for good; two minutes is far past any real answer.
        http: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()?,
        last_activity: std::sync::atomic::AtomicU64::new(0),
        looked: std::sync::atomic::AtomicBool::new(false),
        wake: tokio::sync::Notify::new(),
        imports: import::Imports::default(),
        service: model::Service::from_env(),
        trace: trace::Trace::from_env(Path::new(&data)),
    });
    apps::seed(&core, Path::new(&data).file_name().is_some_and(|name| name == "demo"));
    apple::recover(&core);
    tokio::spawn(apps::run(core.clone()));
    tokio::spawn(placer::run(core.clone(), queue));
    tokio::spawn(refiner::run(core.clone()));
    let images = Path::new(&data).join("images");
    tokio::spawn(pictures::run(core.clone(), images.clone()));
    for id in pending {
        let _ = core.placer_queue.send(placer::Job::Place(id));
    }

    let ui = std::env::var("E2A2O_UI").unwrap_or_else(|_| "../ui/dist".into());
    let app = Router::new()
        .route("/ws", get(connect))
        .route("/room", get(room_info))
        .route("/import", post(import::prepare).layer(DefaultBodyLimit::max(import::MAX_BYTES)))
        .nest_service("/images", ServeDir::new(images))
        .fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(format!("{ui}/index.html"))))
        .layer(middleware::from_fn_with_state(core.clone(), gate))
        .with_state(core);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4321);
    // Alone, only this machine can reach the core; a room opens it to the local network, behind the code.
    let address = if room.is_some() { "0.0.0.0" } else { "127.0.0.1" };
    let listener = tokio::net::TcpListener::bind((address, port)).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            anyhow::anyhow!("port {port} is already in use: stop the other app, or start with PORT=4322 ./run.sh")
        } else {
            anyhow::anyhow!("couldn't open port {port}: {e}")
        }
    })?;
    tracing::info!("E2A2O core on http://localhost:{port}");
    if let Some(code) = &room {
        let host = lan_ip().map_or_else(|| "<this laptop's address>".into(), |ip| ip.to_string());
        tracing::info!("Room open. On the other laptop, open http://{host}:{port}/?room={code}");
    }
    axum::serve(listener, app.into_make_service_with_connect_info::<Link>()).await?;
    Ok(())
}

/// ROOM_CODE opens a room. Codes compare as lowercase letters and digits, so "K7M2-X9QP" and
/// "k7m2x9qp" are the same code and none needs escaping in a link or a cookie.
fn room_code() -> anyhow::Result<Option<String>> {
    let Some(raw) = std::env::var("ROOM_CODE").ok().filter(|c| !c.trim().is_empty()) else { return Ok(None) };
    let code = normal_code(&raw);
    if code.is_empty() {
        anyhow::bail!("ROOM_CODE needs letters or digits");
    }
    if code.len() < 8 {
        tracing::warn!("ROOM_CODE is short: anyone on the network could guess it (./run.sh room makes a longer one)");
    }
    Ok(Some(code))
}

fn normal_code(code: &str) -> String {
    code.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect()
}

/// Compares in constant time, so response times don't hint at how much of a guess was right.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// This laptop's address on the local network, for the link to share: the one it would use to reach
/// the internet, else a private network. Connecting a UDP socket sends nothing; it only picks a route.
fn lan_ip() -> Option<std::net::IpAddr> {
    ["8.8.8.8:80", "192.168.0.1:80", "10.0.0.1:80"].into_iter().find_map(|target| {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect(target).ok()?;
        Some(socket.local_addr().ok()?.ip()).filter(|ip| !ip.is_unspecified() && !ip.is_loopback())
    })
}

/// Both ends of a connection: where it came from, and which of this machine's addresses it reached.
#[derive(Clone, Copy, Debug)]
struct Link {
    from: SocketAddr,
    to: SocketAddr,
}

impl Link {
    /// The request comes from this machine itself.
    fn here(&self) -> bool {
        self.from.ip().is_loopback()
    }
}

impl Connected<axum::serve::IncomingStream<'_, tokio::net::TcpListener>> for Link {
    fn connect_info(stream: axum::serve::IncomingStream<'_, tokio::net::TcpListener>) -> Self {
        // Unknown only if the socket already closed; an unspecified address matches no Host.
        let to = stream.io().local_addr().unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
        Link { from: *stream.remote_addr(), to }
    }
}

/// What a request may reach.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Access {
    /// Nothing: another site, or a name that isn't this machine's.
    None,
    /// Only the app's own files, so another laptop can open the page and type the code.
    Page,
    /// The map too: the WebSocket and pictures.
    Map,
}

/// Who may use the core. Alone, only pages served from this machine: a browser always sends Origin
/// with a WebSocket handshake, so a site you happen to have open can't read your map or approve
/// actions; checking Host too stops DNS rebinding (a site whose name resolves to 127.0.0.1).
/// In a room the core is on the network: a page may also come from the address the connection
/// reached (the laptop's IP, never a name a site could point at it), and the map needs the code
/// unless the request comes from this machine.
async fn gate(State(core): State<Arc<Core>>, mut request: Request, next: Next) -> Response {
    let link = request.extensions().get::<ConnectInfo<Link>>().map(|c| c.0);
    let access = {
        let value = |name| request.headers().get(name).and_then(|v| v.to_str().ok());
        let has_code = core.room.as_ref().is_some_and(|room| codes(&request).iter().any(|c| same(&normal_code(c), &room.code)));
        link.map_or(Access::None, |link| access(core.room.is_some(), link, value(header::HOST), value(header::ORIGIN), has_code))
    };
    if access == Access::None || (access == Access::Page && !public(request.uri().path())) {
        tracing::warn!(
            "refused {} from {} (origin {:?})",
            request.uri().path(),
            link.map_or_else(|| "an unknown address".into(), |l| l.from.ip().to_string()),
            request.headers().get(header::ORIGIN)
        );
        return StatusCode::FORBIDDEN.into_response();
    }
    request.extensions_mut().insert(access);
    // Built files and pictures never change under their names (content hash, uuid); everything else, the
    // page above all, is checked every time, so after an update the browser never shows the old app.
    let fixed = ["/assets/", "/images/"].iter().any(|dir| request.uri().path().starts_with(dir));
    let mut response = next.run(request).await;
    // Pages elsewhere can't even embed our files (an <img> sends no Origin).
    response.headers_mut().insert("cross-origin-resource-policy", header::HeaderValue::from_static("same-origin"));
    // A missing file comes back as the page (the app's own routes), and that must not stick.
    let page = response.headers().get(header::CONTENT_TYPE).is_some_and(|t| t.as_bytes().starts_with(b"text/html"));
    let cache = if fixed && response.status().is_success() && !page { "public, max-age=31536000, immutable" } else { "no-cache" };
    response.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static(cache));
    response
}

fn access(room: bool, link: Link, host: Option<&str>, origin: Option<&str>, has_code: bool) -> Access {
    // "localhost" means this machine only when the request comes from it.
    let ours = |value: &str| (link.here() && local(value)) || (room && reached(value, link.to));
    let Some(host) = host.filter(|h| ours(h)) else { return Access::None };
    // Our pages are plain http, so their Origin is "http://" and the Host they were loaded from.
    let ours_too = |origin: &str| (link.here() && local(origin)) || (room && origin.strip_prefix("http://") == Some(host));
    if !origin.is_none_or(ours_too) {
        return Access::None;
    }
    if !room || link.here() || has_code {
        Access::Map
    } else {
        Access::Page
    }
}

/// True when a Host names the address the connection reached, e.g. "192.168.1.20:4321".
fn reached(host: &str, to: SocketAddr) -> bool {
    !to.ip().is_unspecified() && (host == to.to_string() || (to.port() == 80 && host == to.ip().to_string()))
}

/// The app's own files, which hold nothing of the map. Everything else needs the code in a room.
fn public(path: &str) -> bool {
    matches!(path, "/" | "/index.html" | "/room" | "/pcm-worklet.js") || path.starts_with("/assets/")
}

/// The room codes a request carries: `?room=` on the WebSocket, or the `room` cookie the page sets
/// for pictures (an <img> can't add a query).
fn codes(request: &Request) -> Vec<String> {
    let query = Query::<HashMap<String, String>>::try_from_uri(request.uri()).ok().and_then(|Query(q)| q.get("room").cloned());
    let cookies = request
        .headers()
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix("room=").map(str::to_string));
    query.into_iter().chain(cookies).collect()
}

/// Whether a room is open and whether this page may join it, so the page knows to ask for a name
/// and, on another laptop, the code. Asked with a name, also whether it's taken (see `Names`).
async fn room_info(
    State(core): State<Arc<Core>>,
    ConnectInfo(link): ConnectInfo<Link>,
    Query(join): Query<Join>,
    request: Request,
) -> Json<serde_json::Value> {
    let member = request.extensions().get::<Access>() == Some(&Access::Map);
    let taken = member
        && !join.name.trim().is_empty()
        && core.room.as_ref().is_some_and(|room| room.names.lock().unwrap().taken(&speaker_name(&join.name, link.here()), link));
    Json(serde_json::json!({ "room": core.room.is_some(), "member": member, "taken": taken }))
}

/// An open room: the code another laptop needs (see `gate`), and who holds each name in it.
pub struct Room {
    code: String,
    names: Mutex<Names>,
}

impl From<&str> for Room {
    fn from(code: &str) -> Self {
        Room { code: code.into(), names: Mutex::default() }
    }
}

/// A name in a room is the host's or one connected guest's, since what's private goes to every window with
/// that name: live words, the mic going on and off, notices, an import. This machine keeps a name it joined
/// with until the core stops, so it stays the host's while their window reconnects; another laptop holds one
/// while connected.
#[derive(Default)]
struct Names {
    host: HashSet<String>,
    /// The address and number of windows holding each guest name.
    guests: HashMap<String, (IpAddr, usize)>,
}

impl Names {
    /// Guest windows at one address share a name; the host and other addresses can't take it.
    /// Case doesn't tell people apart.
    fn taken(&self, name: &str, link: Link) -> bool {
        let name = name.to_lowercase();
        self.guests.get(&name).is_some_and(|(address, _)| link.here() || *address != link.from.ip())
            || (!link.here() && self.host.contains(&name))
    }
}

/// A window's hold on its name; another laptop's lets go when its connection ends, or never starts.
struct Seat {
    core: Arc<Core>,
    guest: Option<String>,
}

impl Seat {
    /// Takes the name for a window, or None when it is taken.
    fn take(core: &Arc<Core>, name: &str, link: Link) -> Option<Seat> {
        let mut seat = Seat { core: core.clone(), guest: None };
        let Some(room) = &core.room else { return Some(seat) };
        let mut names = room.names.lock().unwrap();
        if names.taken(name, link) {
            return None;
        }
        let name = name.to_lowercase();
        if link.here() {
            names.host.insert(name);
        } else {
            names.guests.entry(name.clone()).or_insert((link.from.ip(), 0)).1 += 1;
            seat.guest = Some(name);
        }
        drop(names);
        Some(seat)
    }
}

impl Drop for Seat {
    fn drop(&mut self) {
        let (Some(room), Some(name)) = (&self.core.room, &self.guest) else { return };
        let mut names = room.names.lock().unwrap();
        if let Some((_, windows)) = names.guests.get_mut(name) {
            *windows -= 1;
            if *windows == 0 {
                names.guests.remove(name);
            }
        }
    }
}

/// True for localhost, 127.0.0.1 and [::1], with or without a scheme and a port.
fn local(value: &str) -> bool {
    let host = value.rsplit("://").next().unwrap_or(value);
    let host = match host.rsplit_once(':') {
        Some((name, port)) if port.bytes().all(|b| b.is_ascii_digit()) => name,
        _ => host,
    };
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

#[derive(serde::Deserialize)]
struct Join {
    /// The name this window joined a room with; none alone.
    #[serde(default)]
    name: String,
}

async fn connect(
    upgrade: WebSocketUpgrade,
    Query(join): Query<Join>,
    ConnectInfo(link): ConnectInfo<Link>,
    State(core): State<Arc<Core>>,
) -> Response {
    let speaker = speaker_name(&join.name, link.here());
    let renamed = speaker != speaker_name(&join.name, true);
    // The page asks /room for another name when this happens.
    let Some(seat) = Seat::take(&core, &speaker, link) else {
        return (StatusCode::CONFLICT, "That name is taken in this room.").into_response();
    };
    upgrade.on_upgrade(move |socket| session(socket, core, speaker, link.here(), renamed, seat))
}

/// What another laptop is called when it asks for this machine's name, or for none.
const GUEST: &str = "Guest";

/// What a window's thoughts are labeled with: its name in the room, on one line and at most 24
/// characters; alone, "you". "you" is this machine's own name (alone, and on everything from before
/// rooms), so another laptop that asks for it, or for no name, is "Guest": else it would get the host's
/// live words, mic and notices.
fn speaker_name(name: &str, here: bool) -> String {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).take(24).collect();
    match name.trim() {
        name if !here && (name.is_empty() || name.eq_ignore_ascii_case("you")) => GUEST.into(),
        "" => "you".into(),
        name => name.into(),
    }
}

/// Journals a window's "off" mark on an Explain or a Recap. Anything else, or an id no answer could have, is
/// ignored: a mark is a label for later, never an instruction.
fn mark(core: &Core, speaker: &str, kind: String, id: String, off: bool) {
    let fits = !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if matches!(kind.as_str(), "explain" | "recap") && fits {
        core.record(Change::AnswerMarked { kind, id, off, speaker: speaker.into(), at_ms: now_ms() });
    }
}

/// What a window needs to be current: the world, an app still being built, and this speaker's import in progress.
fn catch_up(core: &Core, speaker: &str) -> Vec<ServerMsg> {
    let mut messages = vec![ServerMsg::Snapshot { world: core.snapshot() }, core.placing.message()];
    messages.extend(apps::unsettled_build(core).map(|build| ServerMsg::AppsBuild { build }));
    messages.extend(core.imports.live_for(speaker).map(|status| ServerMsg::Import { status }));
    if core.key.is_none() {
        messages.push(ServerMsg::Notice { message: "MODEL_API_KEY is not set: listening and placement are off.".into() });
    } else if core.key_refused() {
        messages.push(ServerMsg::Notice { message: model::REFUSED.into() });
    } else if let Some(message) = core.capped_message() {
        messages.push(ServerMsg::Notice { message });
    }
    messages
}

/// One UI connection: sends the world, then every change and whatever is meant for its speaker;
/// takes typed thoughts and audio as that speaker. `here`: the window is on this machine.
/// `renamed`: it asked for a name it can't have, so the reply says what it's called instead. `_seat`
/// holds its name in a room until it closes.
async fn session(socket: WebSocket, core: Arc<Core>, speaker: String, here: bool, renamed: bool, _seat: Seat) {
    let (mut out, mut incoming) = socket.split();
    if core.room.is_some() {
        tracing::info!("{speaker} joined the room");
    }
    let updates = core.updates.subscribe();
    for message in catch_up(&core, &speaker) {
        if write(&mut out, &message).await.is_err() { return; }
    }
    if renamed {
        let notice = ServerMsg::Notice { message: format!("You joined as {speaker}: \"you\" is the host's name.") };
        if write(&mut out, &notice).await.is_err() { return; }
    }
    let forwarding = tokio::spawn(forward(out, updates, core.clone(), speaker.clone()));
    if here {
        core.hosts.lock().unwrap().insert(speaker.clone());
    }

    let mut audio: Option<mpsc::Sender<Vec<u8>>> = None;
    // This window's listening sessions, counted, so only the latest one says listening stopped: after a
    // quick off and on, the old session's late end mustn't switch the new mic off.
    let listens = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let volume_source = uuid::Uuid::new_v4().to_string();
    while let Some(Ok(message)) = incoming.next().await {
        match message {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(text.as_str()) {
                Ok(ClientMsg::Recap { period }) => recap::request(core.clone(), speaker.clone(), period),
                Ok(ClientMsg::ComposeApp { request }) => apps::compose(core.clone(), request),
                Ok(ClientMsg::DecideApp { build_id, keep }) => apps::decide(&core, &build_id, keep),
                Ok(ClientMsg::ToggleApp { id, enabled }) => apps::toggle(&core, id, enabled),
                Ok(ClientMsg::RemoveApp { id }) => core.commit(vec![Change::AppRemoved { id }]),
                Ok(ClientMsg::AppVolume { level }) => apps::volume(&core, &volume_source, level),
                Ok(ClientMsg::AppOutput { id, sound }) => apps::volume_output(&core, id, sound),
                Ok(ClientMsg::Text { text }) if !text.trim().is_empty() => core.add_thought(&speaker, text.trim()),
                // A listener whose voice service ended has a closed channel; start a fresh one.
                Ok(ClientMsg::Listen { on: true }) if audio.as_ref().is_none_or(|tx| tx.is_closed()) => {
                    audio = Some(start_listening(&core, &speaker, &listens));
                }
                Ok(ClientMsg::Listen { on: false }) => { audio = None; apps::disconnect(&core, &volume_source); }
                Ok(ClientMsg::Focus { thread_id }) => core.focus(&speaker, &thread_id),
                Ok(ClientMsg::Explain { id, text, context, thread_id }) => {
                    tokio::spawn(explain::run(core.clone(), id, text, context, thread_id));
                }
                Ok(ClientMsg::Item { id, status }) => apple::item(&core, id, status),
                // It goes into Reminders or Calendar on the laptop running the core, so it's that person's call.
                Ok(ClientMsg::Approve { id }) if here => {
                    tokio::spawn(apple::approve(core.clone(), id));
                }
                Ok(ClientMsg::Approve { .. }) => {
                    core.send_to(&speaker, ServerMsg::Notice { message: "Only the host can add this: it goes into their apps.".into() });
                }
                Ok(ClientMsg::Visible) => {
                    core.looked.store(true, std::sync::atomic::Ordering::Relaxed);
                    core.wake.notify_waiters();
                }
                Ok(ClientMsg::Tag { thread_id, tag, keep }) => {
                    let change = if keep { Change::TagKept { thread_id, tag } } else { Change::TagRemoved { thread_id, tag } };
                    core.commit(vec![change]);
                }
                Ok(ClientMsg::Mark { kind, id, off }) => mark(&core, &speaker, kind, id, off),
                Ok(ClientMsg::Correct { thought_id, accept }) => catalog::answered(&core, &thought_id, accept, String::new()),
                Ok(ClientMsg::Unlink { thought_id }) => chunks::unlink(&core, &thought_id),
                Ok(ClientMsg::Attention { selected, pointed }) => catalog::attend(&core, &speaker, selected, pointed),
                Ok(ClientMsg::Undo { id }) => catalog::undo_click(&core, &speaker, id),
                Ok(ClientMsg::Tidy { id, apply }) => tidy::decide(&core, &speaker, &id, apply),
                Ok(ClientMsg::Untidy { kind, thread_id }) => tidy::undo(&core, &speaker, kind, &thread_id),
                Ok(ClientMsg::Move { thought_id, thread_id }) => moves::click_move(&core, &speaker, &thought_id, thread_id),
                Ok(ClientMsg::Rename { thread_id, title }) => moves::click_rename(&core, &speaker, &thread_id, &title),
                Ok(ClientMsg::ImportStart { id }) => import::start(core.clone(), id, speaker.clone(), here),
                // Imports run on the host only (their key, their chats), so only the host stops one.
                Ok(ClientMsg::ImportCancel) if here => import::cancel(&core, &speaker),
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
    forwarding.abort();
    apps::disconnect(&core, &volume_source);
    if core.room.is_some() {
        tracing::info!("{speaker} left the room");
    }
}

/// Sends a window every change and whatever is meant for its speaker, until the window is gone.
async fn forward(mut out: SplitSink<WebSocket, Message>, mut updates: broadcast::Receiver<Outgoing>, core: Arc<Core>, speaker: String) {
    loop {
        match updates.recv().await {
            // Someone else's live words, mic and notices.
            Ok(Outgoing { to: Some(to), .. }) if to != speaker => {}
            Ok(Outgoing { message, .. }) => {
                if write(&mut out, &message).await.is_err() {
                    return;
                }
            }
            // Fell too far behind to replay the missed changes: catch up as if just connected.
            Err(broadcast::error::RecvError::Lagged(_)) => {
                for message in catch_up(&core, &speaker) {
                    if write(&mut out, &message).await.is_err() {
                        return;
                    }
                }
            }
            Err(_) => return,
        }
    }
}

/// One message to a window, as JSON; an error means the window is gone.
async fn write(out: &mut SplitSink<WebSocket, Message>, message: &ServerMsg) -> Result<(), axum::Error> {
    out.send(Message::Text(serde_json::to_string(message).unwrap().into())).await
}

/// Relays a window's microphone to Voice Transcribe until the window stops it or the service ends, then says
/// listening stopped, unless the window has started listening again since (`listens` counts its sessions).
/// Returns where the window's audio goes.
fn start_listening(core: &Arc<Core>, speaker: &str, listens: &Arc<std::sync::atomic::AtomicU64>) -> mpsc::Sender<Vec<u8>> {
    let (tx, rx) = mpsc::channel(256);
    let n = listens.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let (core, speaker, listens) = (core.clone(), speaker.to_string(), listens.clone());
    tokio::spawn(async move {
        let ended = asr::run(core.clone(), speaker.clone(), rx).await;
        if let Err(e) = &ended {
            tracing::warn!("listening stopped: {e:#}");
        }
        if listens.load(std::sync::atomic::Ordering::Relaxed) != n {
            return;
        }
        match ended {
            Ok(()) => core.send_to(&speaker, ServerMsg::Status { listening: false, note: "Stopped listening".into() }),
            Err(e) => {
                core.send_to(&speaker, ServerMsg::Error { message: format!("Speech service error: {e}") });
                core.send_to(&speaker, ServerMsg::Status { listening: false, note: "Not listening".into() });
            }
        }
    });
    tx
}

/// A core for tests on `world`, journaling to `journal`: alone (no room), no key, and a placer queue no one reads.
/// A test sets what it needs on top, e.g. `Core { key: Some("good".into()), ..Core::test(journal, world) }`.
#[cfg(test)]
impl Core {
    pub(crate) fn test(journal: Journal, world: World) -> Core {
        Core {
            find: Default::default(),
            catalog: Default::default(),
            recap: Default::default(),
            apps: Default::default(),
            world: Mutex::new(world.into()),
            journal: Mutex::new(journal),
            updates: broadcast::channel(1024).0,
            placer_queue: mpsc::unbounded_channel().0,
            new_threads: Default::default(),
            hosts: Default::default(),
            placing: Default::default(),
            room: None,
            key: None,
            placer_model: "test".into(),
            // One for every test core: making one reads the system's certificates, and a test may make thousands.
            http: {
                static HTTP: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
                HTTP.get_or_init(reqwest::Client::new).clone()
            },
            last_activity: Default::default(),
            looked: Default::default(),
            wake: Default::default(),
            imports: Default::default(),
            service: Default::default(),
            trace: Default::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{access, command, filler, local, normal_code, placer::Job, public, same, speaker_name, turn, way_back, Access, Core, Link, Room, Seat};
    use super::{is_go_back, is_go_next, is_go_previous, is_new_thread, view, ACKS, ASKING, SOUNDS};
    use crate::protocol::{ServerMsg, View};
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};
    use futures_util::{SinkExt, StreamExt};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    /// A core on an empty map with a working key (words said can land, so commands and searches wait for them),
    /// with the placer's queue to watch.
    fn test_core(room: Option<&str>) -> (Arc<Core>, mpsc::UnboundedReceiver<Job>, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("e2a2o-main-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let (placer_queue, queue) = mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, room: room.map(Room::from), key: Some("test".into()), ..Core::test(journal, world) });
        (core, queue, path)
    }

    /// A core on `world` with no key, so nothing calls a model, with the placer's queue to watch.
    fn keyless(world: World) -> (Arc<Core>, mpsc::UnboundedReceiver<Job>, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("e2a2o-main-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::Journal::open(&path).unwrap();
        let (placer_queue, queue) = mpsc::unbounded_channel();
        (Arc::new(Core { placer_queue, ..Core::test(journal, world) }), queue, path)
    }

    #[test]
    fn an_off_mark_is_journaled_for_later_and_changes_nothing_else() {
        let (core, _queue, path) = test_core(None);
        let mut updates = core.updates.subscribe();
        super::mark(&core, "User", "explain".into(), "x1a2b".into(), true);
        super::mark(&core, "User", "recap".into(), "today-1793547629176".into(), true);
        super::mark(&core, "User", "recap".into(), "today-1793547629176".into(), false);
        // Only the two kinds, with an id an answer could have.
        super::mark(&core, "User", "thread".into(), "T1".into(), true);
        super::mark(&core, "User", "explain".into(), "../../etc".into(), true);
        super::mark(&core, "User", "explain".into(), "x".repeat(81), true);
        let lines: Vec<serde_json::Value> =
            std::fs::read_to_string(&path).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let marks: Vec<(&str, &str, bool)> = lines
            .iter()
            .filter(|l| l["type"] == "answer_marked")
            .map(|l| (l["kind"].as_str().unwrap(), l["id"].as_str().unwrap(), l["off"].as_bool().unwrap()))
            .collect();
        assert_eq!(marks, [("explain", "x1a2b", true), ("recap", "today-1793547629176", true), ("recap", "today-1793547629176", false)]);
        assert!(lines.iter().all(|l| l["speaker"] == "User" && l["at_ms"].as_u64().is_some()));
        assert!(updates.try_recv().is_err(), "no window is sent a mark");
        let (_, reopened) = crate::Journal::open(&path).unwrap();
        assert_eq!(serde_json::to_value(&reopened).unwrap(), serde_json::to_value(&*core.snapshot()).unwrap(), "the map is as it was");
        let _ = std::fs::remove_file(&path);
    }

    fn thread(id: &str, touched_ms: u64, dropped_by: &str) -> Thread {
        Thread {
            id: id.into(),
            title: id.into(),
            parent_id: None,
            status: if dropped_by.is_empty() { ThreadStatus::Open } else { ThreadStatus::Dropped },
            last_point: String::new(),
            touched_ms,
            tags: Vec::new(),
            picture: None,
            dropped_by: dropped_by.into(),
        }
    }

    fn said(id: &str, speaker: &str, thread: &str, at_ms: u64) -> Thought {
        Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: String::new(),
            point: String::new(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms,
            place_ms: None,
        }
    }

    #[test]
    fn filler_is_only_sounds_connectors_and_acknowledgements_after_no_question() {
        for text in ["yeah", "so", "hmm okay", "right right right", "Um, so...", "Mm-hmm.", "you know", "let's see", "okay, yeah"] {
            assert!(filler(text, false), "{text}");
        }
        // After a question an acknowledgement may be the answer: the placer decides.
        for text in ["yeah", "hmm, okay", "uh-huh", "yes"] {
            assert!(!filler(text, true), "{text}");
        }
        assert!(filler("um, let me think", true));
        // Never filler: a yes or a no, a maybe, a name, a time, or anything with real words.
        for text in ["yes", "no", "nope", "maybe", "Dad", "Tuesday", "oh wow", "yeah, the demo is Tuesday", "I don't know"] {
            assert!(!filler(text, false), "{text}");
        }
    }

    #[test]
    fn a_command_at_the_end_of_a_turn_still_acts() {
        let said = |text: &str| {
            command(text).map(|(before, job)| (before.to_string(), if matches!(job("you".into()), Job::Back(_)) { "back" } else { "next" }))
        };
        let back = |before: &str| Some((before.to_string(), "back"));
        assert_eq!(said("where was I"), back(""));
        assert_eq!(said("So, um, where was I going with this"), back(""));
        assert_eq!(said("Right, where were we?"), back(""));
        assert_eq!(said("It starts at two in the afternoon, okay, where was I?"), back("It starts at two in the afternoon"));
        assert_eq!(said("the budget, now where was I"), back("the budget"));
        assert_eq!(said("the budget um where was I"), back("the budget"));
        assert_eq!(said("I'll pay it on Thursday. Anyway, next one."), Some(("I'll pay it on Thursday.".into(), "next")));
        // Heard with no punctuation at all: a question only the command asks still ends the turn.
        assert_eq!(said("oh and the dentist moved my cleaning to Thursday at three where was I"), back("oh and the dentist moved my cleaning to Thursday at three"));
        assert_eq!(said("the caterer needs the headcount by Friday what was I saying"), back("the caterer needs the headcount by Friday"));
        // Ordinary speech stays a thought: "go back" or "next" with no pause before them, or more words after a command.
        for text in [
            "go back to the drawing board on this",
            "that song would take me back",
            "I'd fly to Paris and go back",
            "you can't just now go back",
            "Where was I when the power went out?",
            "Tuesday, next week",
            "What's next?",
            "Anyway back to the hackathon. The placement needs to be under three seconds.",
            "she asked where was I supposed to park",
            "I'll take the next one",
        ] {
            assert_eq!(said(text), None, "{text}");
        }
    }

    #[test]
    fn a_command_at_the_start_of_a_turn_goes_ahead_of_the_words_after_it() {
        let name = |job: fn(String) -> Job| if matches!(job("you".into()), Job::Back(_)) { "back" } else { "next" };
        let (back, next) = (Some("back"), Some("next"));
        // (turn, the command it opens with, the words placed, the command it ends with)
        let turns = [
            // At the start: after a pause mark or a turning word, with or without punctuation.
            ("Where was I? Oh right, the rent is due Friday.", back, "Oh right, the rent is due Friday.", None),
            ("Okay, where were we? The demo is on Tuesday.", back, "The demo is on Tuesday.", None),
            ("So, um, what was I saying? The budget is too tight.", back, "The budget is too tight.", None),
            ("Next one. I still need slides for the demo.", next, "I still need slides for the demo.", None),
            ("Take me back to where I was — the landlord wants it by Friday", back, "the landlord wants it by Friday", None),
            ("where was I oh right the rent is due friday", back, "oh right the rent is due friday", None),
            // Back to back, the last one counts: said twice, or changed midway.
            ("Where was I, where was I… oh right, the rent.", back, "oh right, the rent.", None),
            ("Next one, wait, go back. The rent is due Friday.", back, "The rent is due Friday.", None),
            ("Where was I? Next one.", next, "", None),
            // Only filler after it: add_thought keeps none of it.
            ("Where was I? Um.", back, "Um.", None),
            // At the end, as before, and at both ends.
            ("It starts at two in the afternoon, okay, where was I?", None, "It starts at two in the afternoon", back),
            ("I'll pay it on Thursday. Anyway, next one.", None, "I'll pay it on Thursday.", next),
            ("Where was I? The rent, okay, next one.", back, "The rent", next),
            // Any word that leads into a request, except one that asks someone (below).
            ("Hey, where was I? The rent is due Friday.", back, "The rent is due Friday.", None),
            ("The rent is due Friday. Well, where was I?", None, "The rent is due Friday.", back),
            // The whole turn.
            ("Where was I?", back, "", None),
            ("Okay, next one", next, "", None),
            // In the middle, between words: stays a thought.
            ("The rent is due Friday. Where was I? Oh right, the budget.", None, "The rent is due Friday. Where was I? Oh right, the budget.", None),
        ];
        for (text, first, words, then) in turns {
            let (f, w, t) = turn(text);
            assert_eq!((f.map(name), w, t.map(name)), (first, words, then), "{text}");
        }
        // Look-alikes at the start stay as they were: more words before the pause, no pause, a bare "next",
        // or a command pointing past the pause ("that" is the budget thing: a search, as before).
        for text in [
            "Go back to the beginning of the song, it's the best part",
            "Next one up is the dentist",
            "Next, I'll call Mom about the dentist.",
            "Next week, the dentist",
            "Go back there, it was lovely",
            "Take me back to that, the budget thing",
            "Where was I when the power went out? At the store.",
            "that song would take me back, honestly",
            "Anyway back to the hackathon. The placement needs to be under three seconds.",
            // Asked of someone, at the start or the end.
            "Would you go back? I loved it there.",
            "I loved Japan. Would you go back?",
        ] {
            let (f, w, t) = turn(text);
            assert_eq!((f.map(name), w, t.map(name)), (None, text, None), "{text}");
        }
    }

    #[test]
    fn last_one_is_next_one_the_other_way_and_only_the_whole_command() {
        for text in [
            "Go to the last one.", "last one", "Okay, previous one", "go to the previous one", "Previous thread.", "previous",
            "Go back one.", "go back to the last one", "Go to the last thread, please.", "LAST ONE!", "Anyway, go to the previous topic",
        ] {
            assert!(is_go_previous(text), "{text}");
        }
        for text in [
            "go to the last one of the meetings", "That was the last one.", "the last one", "last", "go back",
            "go back to the drawing board", "the previous owner left it", "last one to leave turns off the lights", "go to the next one",
        ] {
            assert!(!is_go_previous(text), "{text}");
        }
        // "Go back" alone is still "where was I?"; "next one" takes "thread" as "last one" does.
        assert!(is_go_back("Go back.") && !is_go_back("Go back one."));
        assert!(is_go_next("go to the next thread") && is_go_next("Go to the next one, please."));
        assert!(!is_go_next("go to the next one of the meetings"));
        // As "next one", at the end of a turn after a pause, or at its start; but a "last one" or a bare "previous"
        // opening a turn lists things, so it stays a thought.
        let name = |job: fn(String) -> Job| match job("you".into()) {
            Job::Back(_) => "back",
            Job::Next(_) => "next",
            Job::Previous(_) => "previous",
            Job::Place(_) => "place",
        };
        let previous = Some("previous");
        for (text, first, words, then) in [
            ("I'll pay it on Thursday. Anyway, last one.", None, "I'll pay it on Thursday.", previous),
            ("Go to the previous one. The kitchen needs paint.", previous, "The kitchen needs paint.", None),
            ("Last one, call the dentist.", None, "Last one, call the dentist.", None),
            ("Previous, I said the rent was late.", None, "Previous, I said the rent was late.", None),
        ] {
            let (f, w, t) = turn(text);
            assert_eq!((f.map(name), w, t.map(name)), (first, words, then), "{text}");
        }
    }

    #[test]
    fn new_thread_is_only_the_whole_turn() {
        for text in [
            "Create a new one.", "new thread", "New topic!", "Okay, start a new thread.", "start a new one", "Make a new thread, please",
            "Let's start a new thread.", "So, change of topic.",
        ] {
            assert!(is_new_thread(text), "{text}");
        }
        for text in [
            "create a new one for the kitchen", "Let's start a new thread about the trip", "new", "New one.",
            "the new thread is about rent", "I want to start a new job", "Make an app that plays a tune at five",
        ] {
            assert!(!is_new_thread(text), "{text}");
        }
    }

    #[test]
    fn a_view_by_voice_is_only_the_whole_turn() {
        for (text, asked) in [
            ("Palace", View::Palace),
            ("go to the palace", View::Palace),
            ("Let's go to the palace!", View::Palace),
            ("Show the palace view.", View::Palace),
            ("Map.", View::Map),
            ("Okay, back to the map", View::Map),
            ("show me the map, please", View::Map),
            ("Let's focus.", View::Focus),
            ("focus mode", View::Focus),
            ("Show all", View::All),
            ("show all the threads", View::All),
            ("unfocus", View::All),
            ("Help.", View::Help),
            ("What can I say?", View::Help),
            ("Okay, so what can you do?", View::Help),
            ("what are the commands, please", View::Help),
            ("What can I say here?", View::Help),
            ("Hey, can you help me?", View::Help),
            ("Cool, palace.", View::Palace),
            ("Can you show me the palace?", View::Palace),
            ("Please focus.", View::Focus),
            ("Let's focus on this.", View::Focus),
            ("Okay, focus on that one", View::Focus),
            ("Focus on this please", View::Focus),
            ("Please focus on this mode please", View::Focus),
            ("Let's focus on that card, please.", View::Focus),
            ("I see. Go to the palace.", View::Palace),
            ("I mean, the map", View::Map),
        ] {
            assert_eq!(view(text), Some(asked), "{text}");
        }
        for text in [
            "Let's go to the palace of Versailles", "The palace was beautiful", "map out the week", "I can't focus today",
            "focus on the budget", "show all the receipts to Dana", "the map is wrong", "help me move the couch on Saturday",
            "I need help with the budget", "what can you do about the rent", "what can I say to Dana", "what can we do about the lease",
            "What can I do?", "Please focus on the budget.", "I see the palace", "You know the map?",
            // Focus takes only "mode" after it: ui/src/attention-core.ts shows no "this" mark for these either.
            "Let's focus on that card now", "Focus on this for me", "Focus on this please mode",
        ] {
            assert_eq!(view(text), None, "{text}");
        }
    }

    /// "Where was I?", "next one" and "last one" always answer, even with nowhere to go: on an empty map (the tour
    /// teaches "where was I?" there), on the only thread, and for a guest who hasn't spoken. Nothing is kept.
    #[test]
    fn with_nowhere_to_go_a_command_still_answers() {
        let now = super::now_ms();
        let tomatoes = Thought { point: "Plant the tomatoes".into(), ..said("a", "you", "Garden", now - 5_000) };
        let one = World {
            threads: vec![thread("Garden", 1, "")],
            thoughts: vec![tomatoes],
            active_by: HashMap::from([("you".into(), "Garden".into())]),
            ..World::default()
        };
        let empty = "Nothing on the map yet: say a thought first";
        for (map, speaker, said, answer) in [
            (World::default(), "you", "Where was I?", empty.to_string()),
            (World::default(), "you", "Next one", empty.into()),
            (World::default(), "you", "Last one", empty.into()),
            // On the only thread, with the last line finished: where they are, shown as Take me there shows it.
            (one.clone(), "you", "Where was I?", "Garden a You're on Garden: “Plant the tomatoes”".into()),
            (one.clone(), "you", "Next one", "Garden is the only thread so far".into()),
            (one.clone(), "you", "Last one", "Garden is the only thread so far".into()),
            (one.clone(), "Sam", "Where was I?", "Nothing to go back to yet: say a thought first".into()),
            // A guest with no thread of their own yet starts at the first.
            (one.clone(), "Sam", "Next one", "On to Garden".into()),
        ] {
            let (core, mut queue, path) = keyless(map);
            let mut updates = core.updates.subscribe();
            core.add_thought(speaker, said);
            let told: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
                .filter_map(|out| match out.message {
                    ServerMsg::Notice { message } => Some((out.to, message)),
                    ServerMsg::Found { thread_id, thought_id, message } => {
                        Some((out.to, format!("{thread_id} {} {message}", thought_id.unwrap_or_default())))
                    }
                    _ => None,
                })
                .map(|(to, message)| {
                    assert_eq!(to.as_deref(), Some(speaker), "{said}");
                    message
                })
                .collect();
            assert_eq!(told, [answer], "{speaker}: {said}");
            assert!(core.snapshot().thoughts.iter().all(|t| t.placed) && queue.try_recv().is_err(), "nothing kept: {said}");
            let _ = std::fs::remove_file(&path);
        }
    }

    /// What one turn did: the requests it answered (see `answered`) and the thoughts it kept, in order.
    async fn did(world: World, said: &str) -> (Vec<String>, Vec<String>) {
        let (core, _queue, path) = keyless(world);
        let mut updates = core.updates.subscribe();
        core.add_thought("you", said);
        // A recap answers from a task of its own.
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        let (mut answers, mut thoughts) = (Vec::new(), Vec::new());
        while let Ok(out) = updates.try_recv() {
            match out.message {
                ServerMsg::Change { change: Change::ThoughtAdded { thought } } => thoughts.push(thought.text),
                message => answers.extend(answered(&message)),
            }
        }
        let _ = std::fs::remove_file(&path);
        // A request may answer more than once (a recap loading then done, an app's build failing without a key).
        answers.dedup();
        (answers, thoughts)
    }

    /// The kind of answer a message is to a request, if it is one.
    fn answered(message: &ServerMsg) -> Option<String> {
        Some(match message {
            ServerMsg::Notice { message } if message.starts_with("Back to ") => "back".into(),
            ServerMsg::Notice { message } if message.starts_with("On to ") => "next".into(),
            ServerMsg::Notice { message } if message.starts_with("Previous: ") => "previous".into(),
            ServerMsg::Notice { message } if message.starts_with("New thread: “") => "new thread with".into(),
            ServerMsg::Notice { message } if message.starts_with("New thread: ") => "new thread".into(),
            ServerMsg::Notice { message } if message.starts_with("Added to ") => "added".into(),
            ServerMsg::Notice { message } if message.starts_with("I couldn't find") => "not found".into(),
            ServerMsg::Notice { message } if message.starts_with("Nothing is waiting to be added") => "approve".into(),
            ServerMsg::Unfold { open, .. } => if *open { "unfold" } else { "fold" }.into(),
            ServerMsg::Found { message, .. } if message.starts_with("Here: ") => "found".into(),
            ServerMsg::View { view } => format!("{view:?}").to_lowercase(),
            ServerMsg::RecapState { period, .. } => format!("recap {period:?}").to_lowercase(),
            ServerMsg::AppsBuild { .. } => "app".into(),
            _ => return None,
        })
    }

    /// Every request the README and the "?" list teach acts through `add_thought`, said alone and after each word
    /// that may lead into it, and none of it is kept as a thought; the look-alikes stay thoughts.
    #[tokio::test]
    async fn every_documented_request_acts_alone_and_after_each_lead_in() {
        let now = super::now_ms();
        // Two threads you spoke on, you on the first; one point to find.
        let world = || World {
            threads: vec![thread("Garden", 1, ""), thread("Bills", 2, "")],
            thoughts: vec![
                Thought { point: "Plant the tomatoes".into(), ..said("a", "you", "Garden", now - 120_000) },
                Thought { point: "The electric bill is due Friday".into(), ..said("b", "you", "Bills", now - 60_000) },
            ],
            active_by: HashMap::from([("you".into(), "Garden".into())]),
            ..World::default()
        };
        // A recap that names no period covers today, or the last session when nothing landed today.
        let bare = format!("recap {:?}", crate::recap::default_period(&world(), now)).to_lowercase();
        let documented = [
            // The "?" list.
            ("What can I say?", "help"),
            ("Help", "help"),
            ("Where was I?", "back"),
            ("Go back", "back"),
            ("Next one", "next"),
            ("Last one", "previous"),
            ("New thread", "new thread"),
            ("Create a new one", "new thread"),
            ("Palace", "palace"),
            ("Map", "map"),
            ("Focus", "focus"),
            ("Show all", "all"),
            ("Where did I talk about the electric bill?", "found"),
            ("Go to the one about the electric bill", "found"),
            ("Recap", &bare),
            ("Recap this session", "recap session"),
            ("Make an app that pings me about bills", "app"),
            // The README.
            ("What can you do?", "help"),
            ("Take me back to where I was", "back"),
            ("Previous one", "previous"),
            ("Go back one", "previous"),
            ("New topic", "new thread"),
            ("Go to the palace", "palace"),
            ("Let's focus", "focus"),
            ("Take me back to the electric bill", "found"),
            ("Find where I said the electric bill", "found"),
            ("What did I decide today?", "recap today"),
            ("What did I decide?", &bare),
            ("What did we decide?", &bare),
            ("Let's recap", &bare),
            ("Make an app that shows a card when I mention the demo.", "app"),
            ("Can you make me an app to remind me about rent?", "app"),
            ("Build an app that plays a tune when we get loud", "app"),
            ("Make a new app that counts my tangents", "app"),
        ];
        let leads: Vec<&str> = [""].iter().chain(&SOUNDS).chain(&ACKS).chain(&["now", "hey", "please"]).chain(&ASKING).copied().collect();
        for (phrase, does) in documented {
            for lead in &leads {
                let said = if lead.is_empty() { phrase.to_string() } else { format!("{lead}, {phrase}") };
                assert_eq!(did(world(), &said).await, (vec![does.to_string()], vec![]), "{said}");
            }
        }
        // Look-alikes: talk about these things, or a request asked of someone, is a thought.
        for said in [
            "Can you go back to the drawing board?",
            "Yeah, recap the book.",
            "Please focus on the budget.",
            "Well, I might make an app that plays a tune",
            "Can you recap the book for me?",
            "Let's make an app that helps students find housing",
            "Let's go to the palace of Versailles",
            "Create a new one for the kitchen",
            "Help me move the couch on Saturday",
            "What can I say to Dana?",
            "What did I decide about the venue?",
            "Find a dentist near the office",
            "Take me to the airport Friday",
            "Go back to the beginning of the song, it's the best part",
            "I loved Japan. Would you go back?",
            "The one about Oaxacan food.",
            // With no pause, these make a sentence of what follows (`TALK`).
            "I see the palace",
            "I mean the map",
            "You know the palace?",
            "Like the map",
        ] {
            assert_eq!(did(world(), said).await, (vec![], vec![said.to_string()]), "{said}");
        }
        // At the end of a turn the words before keep every word of theirs ("well", "right"), then it acts.
        for (said, kept, does) in [
            ("The demo went well where was I", "The demo went well", "back"),
            ("We turned right where was I", "We turned right", "back"),
            ("It starts at two, okay, where was I?", "It starts at two", "back"),
            ("The rent is due Friday, next one", "The rent is due Friday", "next"),
            ("I'll pay it on Thursday. Anyway, last one.", "I'll pay it on Thursday.", "previous"),
        ] {
            assert_eq!(did(world(), said).await, (vec![does.to_string()], vec![kept.to_string()]), "{said}");
        }
    }

    /// The spoken command pack (spoken.rs), as the asks table above: each command the "?" list and the README teach
    /// acts said alone and after each lead-in, and is never kept as a thought, except "add … to X", whose words land
    /// where it said (the thought is the turn as said); the look-alikes stay thoughts.
    #[tokio::test]
    async fn every_pack_command_acts_alone_and_its_look_alikes_stay_thoughts() {
        let now = super::now_ms();
        // Two threads you spoke on, you on the first, and one you left unfinished (the card is up).
        let world = |dropped: bool| World {
            threads: [thread("Garden", 1, ""), thread("Bills", 2, "")].into_iter().chain(dropped.then(|| thread("Trip", 3, "you"))).collect(),
            thoughts: vec![
                Thought { point: "Plant the tomatoes".into(), ..said("a", "you", "Garden", now - 120_000) },
                Thought { point: "The electric bill is due Friday".into(), ..said("b", "you", "Bills", now - 60_000) },
            ],
            active_by: HashMap::from([("you".into(), "Garden".into())]),
            ..World::default()
        };
        let documented = [
            // The "?" list.
            ("Add tomato stakes to the garden", "added"),
            ("Add milk to the shopping list", "added"),
            ("New thread about the garden shed", "new thread with"),
            ("What was I thinking?", "back"),
            ("Let me finish my thought", "back"),
            ("Forget it", "forget"),
            ("Never mind", "forget"),
            ("Expand the garden", "unfold"),
            ("Expand everything", "unfold"),
            ("Collapse this", "fold"),
            ("Stop listening", "pause"),
            ("Add it to Reminders", "approve"),
            ("Finish it", "finish"),
            ("Later", "later"),
            // The README.
            ("Put the receipt in the bills thread", "added"),
            ("Add to the shopping list: oat milk", "added"),
            ("Start a new thread about why the build is slow", "new thread with"),
            ("New thread. I want to learn piano.", "new thread with"),
            ("What was I going to say?", "back"),
            ("It's okay, I forgot", "forget"),
            ("Not now", "later"),
            ("Expand all the sub cards inside the bills", "unfold"),
            ("Show me everything under the garden", "unfold"),
            ("Show me the bills", "unfold"),
            ("Fold the garden", "fold"),
            ("Expand everything in the attic", "not found"),
            ("Pause listening", "pause"),
            ("Turn off the mic", "pause"),
            ("Add that to my calendar", "approve"),
        ];
        let leads: Vec<&str> = [""].iter().chain(&SOUNDS).chain(&ACKS).chain(&["now", "hey", "please"]).chain(&ASKING).copied().collect();
        for (phrase, does) in documented {
            for lead in &leads {
                let said = if lead.is_empty() { phrase.to_string() } else { format!("{lead}, {phrase}") };
                let kept: Vec<String> = match does {
                    "added" => vec![said.clone()],
                    "new thread with" => vec![super::spoken::tests_first(phrase)],
                    _ => vec![],
                };
                assert_eq!(did(world(true), &said).await, (vec![does.to_string()], kept), "{said}");
            }
            // By rule: nothing goes to the placer, so nothing waits on the model, and without a key each still acts
            // ("new thread about …" queued a placement before the review of 88ace4d).
            let (core, mut queue, path) = keyless(world(true));
            core.add_thought("you", phrase);
            let _ = std::fs::remove_file(&path);
            assert!(queue.try_recv().is_err(), "{phrase} asked the placer");
        }
        // Look-alikes: talk about these things, or a command only partway through a turn, is a thought.
        for said in [
            "Put this in perspective",
            "Put the kids in the car",
            "Add salt to taste",
            "Add a deck to the house",
            "Add it to the list",
            "Save money on groceries",
            "I need to add milk to the shopping list",
            "A new thread about the budget came up on Slack",
            "New topic on the agenda is hiring",
            "I bought a boat. What was I thinking?",
            "Forget it, I'll just buy a new one",
            "Never mind the weather, the trip is on",
            "Expand the business into Europe",
            "Show Dana the photos",
            "Hide the presents",
            "Fold the laundry",
            "Close everything before you leave",
            "Open the window",
            "Stop listening to him",
            "I should stop listening to podcasts at night",
            "I'll add it to reminders later",
            // With no card up, and no app waiting, these are answers or talk.
            "Later",
            "Not now",
            "Finish it",
            "Keep it",
        ] {
            assert_eq!(did(world(false), said).await, (vec![], vec![said.to_string()]), "{said}");
        }
        // "Let me think" is a pause to think: filler, neither a move nor a thought.
        assert_eq!(did(world(true), "Let me think").await, (vec![], vec![]));
    }

    // A search said while a thought is still placing waits on a task, so this runs inside a runtime like the app.
    #[tokio::test]
    async fn filler_never_becomes_a_thought_and_commands_keep_their_place_among_the_words() {
        let (core, mut queue, path) = test_core(None);
        let mut jobs = || {
            let mut out = Vec::new();
            while let Ok(job) = queue.try_recv() {
                out.push(match job {
                    Job::Place(_) => "place",
                    Job::Back(_) => "back",
                    Job::Next(_) => "next",
                    Job::Previous(_) => "previous",
                });
            }
            out
        };
        let texts = |core: &Core| core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect::<Vec<_>>();

        core.add_thought("you", "um, so");
        core.add_thought("you", "right right right");
        assert!(texts(&core).is_empty() && jobs().is_empty());
        core.add_thought("you", "It starts at two in the afternoon, okay, where was I?");
        assert_eq!(texts(&core), ["It starts at two in the afternoon"]);
        assert_eq!(jobs(), ["place", "back"]);
        core.add_thought("you", "Okay, where was I?");
        assert_eq!(jobs(), ["back"]);
        // "yeah" after a question goes to the placer, which can tell an answer from filler.
        core.add_thought("you", "Should I take the Google offer?");
        core.add_thought("you", "yeah");
        assert_eq!(texts(&core)[1..], ["Should I take the Google offer?", "yeah"]);
        assert_eq!(jobs(), ["place", "place"]);
        // A command the turn opens with goes ahead of the words after it, and isn't a search either.
        core.add_thought("you", "Where was I? Oh right, the rent is due Friday.");
        assert_eq!(jobs(), ["back", "place"]);
        core.add_thought("you", "Take me back to where I was. The landlord wants it by Friday.");
        assert_eq!(jobs(), ["back", "place"]);
        core.add_thought("you", "Where was I? The rent, okay, next one.");
        assert_eq!(jobs(), ["back", "place", "next"]);
        core.add_thought("you", "Where was I? Um.");
        assert_eq!(jobs(), ["back"]);
        core.add_thought("you", "Go back to the beginning of the song, it's the best part");
        assert_eq!(jobs(), ["place"]);
        core.add_thought("you", "Take me back to that, the budget thing");
        assert!(jobs().is_empty(), "a search, as before (it waits for the thoughts still placing)");
        assert_eq!(
            texts(&core)[3..],
            ["Oh right, the rent is due Friday.", "The landlord wants it by Friday.", "The rent", "Go back to the beginning of the song, it's the best part"]
        );
        let _ = std::fs::remove_file(&path);
    }

    /// The next message a window gets, as JSON.
    async fn received(window: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> serde_json::Value {
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), window.next()).await.expect("a message within 5 s");
            if let tokio_tungstenite::tungstenite::Message::Text(text) = frame.unwrap().unwrap() {
                return serde_json::from_str(text.as_str()).unwrap();
            }
        }
    }

    /// One window over a real WebSocket, as the page connects: the world first, then what's meant for it and
    /// never another speaker's own; a typed thought lands; a mic that can't start says why, then that it stopped.
    #[tokio::test]
    async fn a_window_gets_the_world_then_its_own_messages_and_can_type_and_listen() {
        use tokio_tungstenite::tungstenite::Message;
        let path = std::env::temp_dir().join(format!("e2a2o-main-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        // No key, so nothing here reaches the model or the speech service.
        let core = Arc::new(Core::test(journal, world));
        let routes = axum::Router::new()
            .route("/ws", axum::routing::get(super::connect))
            .layer(axum::middleware::from_fn_with_state(core.clone(), super::gate))
            .with_state(core.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, routes.into_make_service_with_connect_info::<Link>()).await });
        let (mut window, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws")).await.unwrap();
        assert_eq!(received(&mut window).await["type"], "snapshot");
        // Where unplaced thoughts stand, so a window that reconnects shows its pills as they are: nothing yet.
        assert_eq!(received(&mut window).await, serde_json::json!({"type": "placing", "now": null, "retries": []}));
        assert_eq!(received(&mut window).await["message"], "MODEL_API_KEY is not set: listening and placement are off.");
        // Alone, this window is "you".
        core.send_to("Sam", ServerMsg::Notice { message: "for Sam".into() });
        core.send(ServerMsg::Notice { message: "for everyone".into() });
        core.send_to("you", ServerMsg::Notice { message: "for you".into() });
        assert_eq!(received(&mut window).await["message"], "for everyone");
        assert_eq!(received(&mut window).await["message"], "for you");
        window.send(Message::Text(r#"{"type":"text","text":"the rent is due Friday"}"#.into())).await.unwrap();
        let change = received(&mut window).await;
        assert_eq!((change["type"].as_str(), change["change"]["type"].as_str()), (Some("change"), Some("thought_added")));
        assert_eq!(core.snapshot().thoughts[0].text, "the rent is due Friday");
        // How long that turn can be corrected, and that undoing it moves nobody (catalog.rs `Correctable`).
        assert_eq!(received(&mut window).await, serde_json::json!({"type": "correctable", "for_ms": 120_000, "back_to": null}));
        window.send(Message::Text(r#"{"type":"listen","on":true}"#.into())).await.unwrap();
        assert_eq!(received(&mut window).await["message"], "Speech service error: MODEL_API_KEY is not set");
        let status = received(&mut window).await;
        assert_eq!((status["listening"].as_bool(), status["note"].as_str()), (Some(false), Some("Not listening")));
        window.close(None).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn only_this_machine_counts_as_local() {
        for ok in ["localhost:4321", "127.0.0.1:4321", "[::1]:4321", "http://localhost:5173", "http://127.0.0.1:4321", "localhost"] {
            assert!(local(ok), "{ok}");
        }
        for bad in ["evil.com:4321", "http://localhost.evil.com:4321", "http://127.0.0.1.nip.io", "null", "http://evil.com", "[::1"] {
            assert!(!local(bad), "{bad}");
        }
    }

    fn link(from: &str, to: &str) -> Link {
        Link { from: from.parse().unwrap(), to: to.parse().unwrap() }
    }

    #[test]
    fn alone_only_this_machines_pages_get_in() {
        let here = link("127.0.0.1:50000", "127.0.0.1:4321");
        assert_eq!(access(false, here, Some("localhost:4321"), Some("http://localhost:4321"), false), Access::Map);
        assert_eq!(access(false, here, Some("127.0.0.1:4321"), None, false), Access::Map);
        assert_eq!(access(false, here, Some("localhost:4321"), Some("https://example.com"), false), Access::None);
        assert_eq!(access(false, here, Some("example.com:4321"), None, false), Access::None, "DNS rebinding");
        assert_eq!(access(false, here, None, None, false), Access::None);
    }

    #[test]
    fn a_room_lets_the_other_laptop_in_with_the_code() {
        let guest = link("192.168.1.9:51000", "192.168.1.5:4321");
        let (host, page) = (Some("192.168.1.5:4321"), Some("http://192.168.1.5:4321"));
        assert_eq!(access(true, guest, host, page, true), Access::Map);
        assert_eq!(access(true, guest, host, None, true), Access::Map);
        // Without the code: the page, to type it in, but not the map.
        assert_eq!(access(true, guest, host, page, false), Access::Page);
        assert!(public("/") && public("/assets/index-abc.js") && public("/room") && public("/pcm-worklet.js"));
        assert!(!public("/ws") && !public("/images/T1-x.webp") && !public("/anything-else"));
        // Other sites stay out, code or not: their own Origin, or a name pointed at this laptop.
        assert_eq!(access(true, guest, host, Some("https://example.com"), true), Access::None);
        assert_eq!(access(true, guest, host, Some("http://192.168.1.5:3000"), true), Access::None);
        assert_eq!(access(true, guest, Some("example.com:4321"), Some("http://example.com:4321"), true), Access::None);
        // From another laptop, "localhost" means that laptop.
        assert_eq!(access(true, guest, Some("localhost:4321"), None, true), Access::None);
        assert_eq!(access(true, guest, host, Some("http://localhost:4321"), true), Access::None);
        // The host's own window needs no code.
        let here = link("127.0.0.1:50000", "127.0.0.1:4321");
        assert_eq!(access(true, here, Some("localhost:4321"), Some("http://localhost:4321"), false), Access::Map);
    }

    #[test]
    fn codes_ignore_case_and_dashes() {
        assert_eq!(normal_code(" K7M2-x9qp "), "k7m2x9qp");
        assert!(same("k7m2x9qp", "k7m2x9qp"));
        assert!(!same("k7m2x9qp", "k7m2x9qq") && !same("k7m2", "k7m2x9qp"));
    }

    #[test]
    fn names_label_thoughts() {
        assert_eq!(speaker_name("  Sam \n Lee ", false), "Sam Lee");
        assert_eq!(speaker_name("", true), "you");
        assert_eq!(speaker_name(&"x".repeat(40), false).len(), 24);
    }

    #[test]
    fn another_laptop_cant_take_this_machines_name() {
        // "you" is this machine's, and private messages go to every window with the same name.
        assert_eq!(speaker_name("you", true), "you");
        for name in ["", "you", " YOU ", "You\n", "yo\u{0}u"] {
            assert_eq!(speaker_name(name, false), "Guest", "{name:?}");
        }
        assert_eq!(speaker_name("Youssef", false), "Youssef");
    }

    #[test]
    fn where_was_i_is_each_speakers_own() {
        let said = |id: &str, speaker: &str, thread: &str| said(id, speaker, thread, 0);
        let now = 1;
        let mut world = World {
            threads: vec![thread("T1", 1, "User"), thread("T2", 2, "Sam"), thread("T3", 3, ""), thread("T4", 4, "")],
            thoughts: vec![said("a", "Lee", "T3"), said("b", "Sam", "T4"), said("c", "Lee", "T4")],
            ..World::default()
        };
        world.active_by.insert("Lee".into(), "T4".into());
        // Sam dropped T2 more recently, but User's way back is User's own.
        assert_eq!(way_back(&world, "User", now).as_deref(), Some("T1"));
        assert_eq!(way_back(&world, "Sam", now).as_deref(), Some("T2"));
        // Nothing dropped: the last other thread Lee spoke on.
        assert_eq!(way_back(&world, "Lee", now).as_deref(), Some("T3"));
        // Right after a line of theirs trailed off, it's where they said it, even the thread they're on and
        // even with an older loose end; someone else's unfinished line doesn't count.
        world.threads.push(thread("T5", 5, "Lee"));
        world.thoughts.push(Thought { complete: false, ..said("d", "Sam", "T4") });
        assert_eq!(way_back(&world, "Lee", now).as_deref(), Some("T5"));
        world.thoughts.push(Thought { complete: false, ..said("e", "Lee", "T4") });
        assert_eq!(way_back(&world, "Lee", now).as_deref(), Some("T4"));
        assert_eq!(way_back(&world, "Sam", now).as_deref(), Some("T4"), "Sam's last line trailed off too, on T4");
    }

    #[test]
    fn where_was_i_goes_by_when_things_were_said_not_by_imports_landing_last() {
        let now = 1_800_000_000_000;
        let mut world = World {
            threads: vec![thread("Rent", 1, ""), thread("Demo", 2, ""), thread("Kitchen renovation", 3, "")],
            // Rent a minute ago, then Demo; then an import landed a point from a chat a year back.
            thoughts: vec![said("a", "you", "Rent", now - 60_000), said("b", "you", "Demo", now - 30_000), said("c", "you", "Kitchen renovation", now - 365 * 86_400_000)],
            ..World::default()
        };
        world.active_by.insert("you".into(), "Demo".into());
        assert_eq!(way_back(&world, "you", now).as_deref(), Some("Rent"));
        // A line that trailed off before the import is still where they left off.
        world.thoughts[1].complete = false;
        assert_eq!(way_back(&world, "you", now).as_deref(), Some("Demo"));
        // A sample map dated for its demo day, ahead of the clock, comes before anything said live.
        world.thoughts[1].complete = true;
        world.thoughts.insert(0, said("sample", "you", "Kitchen renovation", now + 3 * 86_400_000));
        assert_eq!(way_back(&world, "you", now).as_deref(), Some("Rent"));
    }

    #[test]
    fn a_command_acts_at_once_unless_words_said_before_it_are_still_placing() {
        let (core, mut queue, path) = test_core(None);
        let mut jobs = || std::iter::from_fn(|| queue.try_recv().ok()).map(|job| match job {
            Job::Place(_) => "place",
            Job::Back(_) => "back",
            Job::Next(_) => "next",
            Job::Previous(_) => "previous",
        }).collect::<Vec<_>>();
        let unplaced = |id: &str, speaker: &str, at_ms| Thought { placed: false, thread_id: None, ..said(id, speaker, "", at_ms) };
        let now = super::now_ms();
        core.commit(vec![
            Change::ThreadAdded { thread: thread("T1", 1, "User") },
            Change::ThreadAdded { thread: thread("T2", 2, "") },
            Change::ActiveChanged { thread_id: "T2".into(), speaker: "User".into() },
            // Sam's words are being placed, and one of User's failed and waits for a retry.
            Change::ThoughtAdded { thought: unplaced("sam", "Sam", now) },
            Change::ThoughtAdded { thought: unplaced("old", "User", now - 61_000) },
        ]);
        core.placing.retry(&core, "old", "User", std::time::Duration::from_secs(15));
        // Neither holds User up: no wait behind the other person's placements or a retry.
        core.add_thought("User", "Where was I?");
        assert!(jobs().is_empty());
        assert_eq!(core.snapshot().active_for("User").map(String::as_str), Some("T1"));
        core.add_thought("User", "Okay, next one");
        assert_eq!(core.snapshot().active_for("User").map(String::as_str), Some("T2"));
        // User's own words still placing: landing would undo the command, so it waits behind them.
        core.add_thought("User", "The caterer needs the head count by Friday, okay, where was I?");
        assert_eq!(jobs(), ["place", "back"]);
        core.add_thought("User", "Where was I? The menu is final.");
        assert_eq!(jobs(), ["back", "place"]);
        assert_eq!(core.snapshot().active_for("User").map(String::as_str), Some("T2"), "not yet");
        let _ = std::fs::remove_file(&path);
    }

    /// With no key, or one the service refused, nothing said lands: a command never waits behind it.
    #[test]
    fn without_a_working_key_a_command_acts_at_once() {
        for refused in [false, true] {
            let (mut core, mut queue, path) = test_core(None);
            if refused {
                let _ = core.check(reqwest::StatusCode::UNAUTHORIZED);
            } else {
                Arc::get_mut(&mut core).unwrap().key = None;
            }
            core.commit(vec![
                Change::ThreadAdded { thread: thread("Garden", 1, "") },
                Change::ThreadAdded { thread: thread("Party", 2, "") },
                Change::ThoughtAdded { thought: said("a", "you", "Garden", 1) },
                Change::ActiveChanged { thread_id: "Party".into(), speaker: "you".into() },
            ]);
            core.add_thought("you", "The caterer needs the head count by Friday, okay, where was I?");
            let waiting = std::iter::from_fn(|| queue.try_recv().ok()).filter(|job| !matches!(job, Job::Place(_))).count();
            assert_eq!(waiting, 0, "refused: {refused}");
            assert_eq!(core.snapshot().active_for("you").map(String::as_str), Some("Garden"), "refused: {refused}");
            let _ = std::fs::remove_file(&path);
        }
    }

    /// "Last one" goes to the thread before yours, from the first round to the last, and waits behind your words
    /// still being placed, as "next one" does. With more words it's a thought.
    #[test]
    fn last_one_goes_to_the_thread_before_yours() {
        let (core, mut queue, path) = test_core(None);
        let mut updates = core.updates.subscribe();
        core.commit(vec![
            Change::ThreadAdded { thread: thread("Garden", 1, "") },
            Change::ThreadAdded { thread: thread("Party", 2, "") },
            Change::ThreadAdded { thread: thread("Rent", 3, "") },
            Change::ActiveChanged { thread_id: "Party".into(), speaker: "you".into() },
        ]);
        let active = |core: &Core| core.snapshot().active_for("you").cloned();
        core.add_thought("you", "Go to the last one.");
        assert_eq!(active(&core).as_deref(), Some("Garden"));
        core.add_thought("you", "previous one");
        assert_eq!(active(&core).as_deref(), Some("Rent"), "from the first, round to the last");
        core.add_thought("you", "Okay, next one");
        assert_eq!(active(&core).as_deref(), Some("Garden"), "and back the other way");
        let told: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                ServerMsg::Notice { message } => Some(message),
                _ => None,
            })
            .collect();
        assert_eq!(told, ["Previous: Garden", "Previous: Rent", "On to Garden"]);
        assert!(queue.try_recv().is_err(), "nothing to place");
        core.add_thought("you", "The caterer needs the head count by Friday, okay, last one.");
        core.add_thought("you", "Go to the last one of the meetings");
        let jobs: Vec<&str> = std::iter::from_fn(|| queue.try_recv().ok())
            .map(|job| match job {
                Job::Place(_) => "place",
                Job::Previous(_) => "previous",
                _ => "other",
            })
            .collect();
        assert_eq!(jobs, ["place", "previous", "place"]);
        assert_eq!(core.snapshot().thoughts[1].text, "Go to the last one of the meetings");
        let _ = std::fs::remove_file(&path);
    }

    /// "New thread" places nothing and tells only the speaker; the next thought they say starts one (placer.rs
    /// `decide`), unless they move to a thread before saying it. With more words it's a thought.
    #[test]
    fn new_thread_places_nothing_and_the_next_thought_starts_one() {
        let (core, mut queue, path) = test_core(None);
        let mut updates = core.updates.subscribe();
        core.commit(vec![
            Change::ThreadAdded { thread: thread("Rent", 1, "") },
            Change::ThreadAdded { thread: thread("Party", 2, "") },
            Change::ActiveChanged { thread_id: "Rent".into(), speaker: "User".into() },
        ]);
        core.add_thought("User", "Create a new one.");
        assert!(core.snapshot().thoughts.is_empty() && queue.try_recv().is_err(), "nothing to place");
        let told: Vec<(Option<String>, String)> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                ServerMsg::Notice { message } => Some((out.to, message)),
                _ => None,
            })
            .collect();
        assert_eq!(told, [(Some("User".into()), "New thread: your next thought starts it".into())]);
        // Sam's thought is Sam's; User's next one starts the thread, and only that one.
        core.add_thought("Sam", "The DJ wants a deposit");
        core.add_thought("User", "The kitchen needs paint");
        core.add_thought("User", "Blue, I think");
        let starts = |core: &Core| core.snapshot().thoughts.iter().map(|t| core.new_threads.starts(&t.id)).collect::<Vec<_>>();
        assert_eq!(starts(&core), [false, true, false]);
        // Moving to a thread first, by voice or by a click, ends it: the next thought goes where User went.
        core.add_thought("User", "New topic");
        core.add_thought("User", "Where was I?");
        core.add_thought("User", "The landlord called");
        core.add_thought("User", "New thread");
        core.focus("User", "Party");
        core.add_thought("User", "The cake is ordered");
        core.add_thought("User", "create a new one for the kitchen");
        assert_eq!(starts(&core), [false, true, false, false, false, false]);
        assert_eq!(core.snapshot().thoughts[5].text, "create a new one for the kitchen");
        let _ = std::fs::remove_file(&path);
    }

    /// A view said aloud goes only to the speaker's windows and places nothing; with more words it's a thought. Focus
    /// on an empty map says why nothing changes.
    #[test]
    fn a_view_said_aloud_goes_only_to_the_speakers_windows() {
        let (core, _queue, path) = test_core(None);
        let mut updates = core.updates.subscribe();
        core.add_thought("Sam", "Let's go to the palace!");
        core.add_thought("Sam", "Okay, focus.");
        let views: Vec<(Option<String>, String)> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                ServerMsg::View { view } => Some((out.to, format!("{view:?}"))),
                ServerMsg::Notice { message } => Some((out.to, message)),
                ServerMsg::Correctable { .. } => None,
                _ => panic!("only views and answers"),
            })
            .collect();
        let sam = |said: &str| (Some("Sam".to_string()), said.to_string());
        assert_eq!(views, [sam("Palace"), sam("Nothing on the map yet: say a thought first")]);
        assert!(core.snapshot().thoughts.is_empty());
        core.add_thought("Sam", "Let's go to the palace of Versailles");
        assert_eq!(core.snapshot().thoughts.len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    /// "Where was I?" after words still being placed waits its turn in the placer's queue; a search said after it
    /// waits for those words too, and still happens when the command has acted.
    #[tokio::test(start_paused = true)]
    async fn a_command_that_waited_its_turn_doesnt_stop_a_search_said_after_it() {
        let (core, mut queue, path) = test_core(None);
        let mut updates = core.updates.subscribe();
        let now = super::now_ms();
        let readme = Thought { point: "The README needs a quick start".into(), ..said("a", "you", "Docs", now - 120_000) };
        core.commit(vec![
            Change::ThreadAdded { thread: thread("Docs", 1, "") },
            Change::ThreadAdded { thread: thread("Garden", 2, "") },
            Change::ThreadAdded { thread: thread("Party", 3, "") },
            Change::ThoughtAdded { thought: readme },
            Change::ThoughtAdded { thought: said("b", "you", "Garden", now - 60_000) },
            Change::ActiveChanged { thread_id: "Party".into(), speaker: "you".into() },
        ]);
        core.add_thought("you", "The caterer needs the head count by Friday, okay, where was I?");
        core.add_thought("you", "Where did I talk about the README?");
        // The placer's turn: the words land on Party, then "where was I?" goes back to Garden.
        while let Ok(job) = queue.try_recv() {
            match job {
                Job::Place(thought_id) => core.commit(vec![Change::ThoughtPlaced {
                    thought_id,
                    thread_id: "Party".into(),
                    point: "Caterer needs the head count by Friday".into(),
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    place_ms: 900,
                }]),
                Job::Back(speaker) => core.go_back(&speaker),
                Job::Next(speaker) => core.go_next(&speaker),
                Job::Previous(speaker) => core.go_previous(&speaker),
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert_eq!(core.snapshot().active_for("you").map(String::as_str), Some("Docs"));
        let told: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                crate::protocol::ServerMsg::Notice { message } | crate::protocol::ServerMsg::Found { message, .. } => Some(message),
                _ => None,
            })
            .collect();
        assert_eq!(told, ["Looking through your threads…", "Back to Garden", "Here: Docs — The README needs a quick start"]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn in_a_room_a_name_belongs_to_one_laptop() {
        let (core, _queue, path) = test_core(Some("k7m2x9qp"));
        let link = |from: &str| Link { from: from.parse().unwrap(), to: "192.168.1.5:4321".parse().unwrap() };
        let host = link("127.0.0.1:51000");
        let guest = link("192.168.1.20:51001");
        let other_window = link("192.168.1.20:51002");
        let other_guest = link("192.168.1.21:51001");
        let taken = |name: &str, link| core.room.as_ref().unwrap().names.lock().unwrap().taken(name, link);
        // The host joined as User: another laptop can't be User, in any case, even while the host's window reconnects.
        drop(Seat::take(&core, "User", host).unwrap());
        assert!(Seat::take(&core, "User", guest).is_none() && taken("User", guest));
        assert!(Seat::take(&core, "User", host).is_some(), "the host's other windows share it");
        // A second tab or overlapping reload shares Sam's name only from the same laptop's IP.
        let sam = Seat::take(&core, "Sam", guest).unwrap();
        let another_tab = Seat::take(&core, "sAM", other_window).unwrap();
        assert!(!taken("SAM", other_window));
        assert!(Seat::take(&core, "sam", other_guest).is_none() && taken("SAM", other_guest));
        assert!(Seat::take(&core, "sam", host).is_none() && taken("SAM", host));
        drop(sam);
        assert!(taken("Sam", host) && taken("Sam", other_guest), "one window is still open");
        assert!(Seat::take(&core, "sam", other_guest).is_none());
        drop(another_tab);
        assert!(!taken("Sam", host) && !taken("Sam", other_guest));
        assert!(Seat::take(&core, "sAM", other_guest).is_some(), "the last window frees the name for another address");
        assert!(Seat::take(&core, "Sam", host).is_some(), "the host can take the freed name too");
        // Alone, every window is this machine's.
        let (alone, _queue, alone_path) = test_core(None);
        assert!(Seat::take(&alone, "you", host).is_some());
        for path in [path, alone_path] {
            let _ = std::fs::remove_file(path);
        }
    }

    /// The sample is a judge's first map, and its tour says to type "where was I?": that goes where the unfinished
    /// card points, before and after the sample's own date. (Its last line once trailed off on another thread, so
    /// the card said "Rent is due" and "where was I?" went to "Electric bill autopay".)
    #[test]
    fn in_each_sample_where_was_i_goes_where_the_unfinished_card_points() {
        for sample in ["student-week", "founder-day"] {
            let text = std::fs::read_to_string(format!("{}/../samples/{sample}.jsonl", env!("CARGO_MANIFEST_DIR"))).unwrap();
            let mut world = World::default();
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                world.apply(&serde_json::from_str(line).unwrap());
            }
            let card = world.threads.iter().filter(|t| t.status == ThreadStatus::Dropped && t.dropped_by == "you")
                .max_by_key(|t| t.touched_ms).map(|t| t.id.clone());
            assert!(card.is_some(), "{sample}: the sample shows an unfinished card");
            for now in [1, u64::MAX / 2] {
                assert_eq!(way_back(&world, "you", now), card, "{sample} at {now}");
            }
        }
    }
}
