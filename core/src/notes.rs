//! The Apple Notes connector the Full preset turns on (messages.rs has the presets).
//!
//! "Save this thread as a note" or "put this in Notes", said or typed as the whole turn, puts a card up with the note
//! it makes: the thread's title, then its points in the order said, a decision marked "Decided", words left
//! unfinished marked "unfinished", and each branch under its own heading. Then it writes that note into Notes, and
//! only:
//! - in the Full preset, on a core that isn't hosted (a hosted core has no Notes of its person's to reach),
//! - from the host's laptop (in a room, a guest's words never write into the host's Notes),
//! - through Notes on the Mac running the core, with `NOTES_WRITE=on`; anything else is a dry run, whose card says
//!   what it would have written.
//!
//! Each save is a new note. The app never changes or deletes a note it wrote: the card offers Open in Notes, and the
//! note is the person's from then on.
//!
//! Tests stand in for `osascript` (`Script`), so no test writes or opens a note.

use crate::catalog::{Act, Done};
use crate::protocol::ServerMsg;
use crate::world::World;
use crate::Core;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

/// Runs one AppleScript with its arguments and gives back what it returned: `osascript` in the app, a stand-in in
/// tests.
pub type Script = Arc<dyn Fn(&'static [&'static str], Vec<String>) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> + Send + Sync>;

/// Writes a new note in the default folder of Notes' default account. Its body arrives as an argument, never inside
/// the script, so no words said can change what the script does. It gives back the note's id, for Open in Notes.
pub const WRITE: &[&str] = &[
    "on run argv",
    "set theBody to item 1 of argv",
    "tell application \"Notes\"",
    "set theNote to make new note at default folder of default account with properties {body:theBody}",
    "return id of theNote",
    "end tell",
    "end run",
];

/// Shows a note the app wrote, by its id, and brings Notes forward. Nothing else: it never edits or deletes.
pub const OPEN: &[&str] = &[
    "on run argv",
    "tell application \"Notes\"",
    "show note id (item 1 of argv)",
    "activate",
    "end tell",
    "end run",
];

/// `osascript` on this Mac. `--` ends its options, so an argument starting with "-" is never read as one.
fn osascript() -> Script {
    Arc::new(|script, args| {
        Box::pin(async move {
            let mut command = tokio::process::Command::new("osascript");
            for line in script {
                command.arg("-e").arg(line);
            }
            let output = command.arg("--").args(args).output().await.map_err(|e| e.to_string())?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        })
    })
}

/// A note on its card, as the window shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteState {
    /// Notes has it and hasn't answered yet.
    Saving,
    /// Notes wrote it: the card offers Open in Notes.
    Saved,
    /// Nothing written: the card shows what would have been.
    DryRun,
    /// Notes refused it, or isn't there.
    Failed,
}

/// One point of the note: the point as its card shows it, who said it in a room, and its marks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NotePoint {
    pub text: String,
    /// Who said it, only when more than one person spoke on the map; else empty.
    pub who: String,
    /// The words say a decision was made (decided.rs), as the map marks it.
    pub decided: bool,
    /// The words trailed off unfinished (`Thought::complete`).
    pub unfinished: bool,
}

/// The thread's own points (`title` empty), or a branch's under its title.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NoteSection {
    pub title: String,
    pub points: Vec<NotePoint>,
}

/// The note a thread makes: what the card shows and what Notes gets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Note {
    pub title: String,
    pub sections: Vec<NoteSection>,
}

impl Note {
    pub fn points(&self) -> usize {
        self.sections.iter().map(|s| s.points.len()).sum()
    }

    /// The note as Notes keeps it, HTML (its `body`): the title as the first line, which Notes makes the note's name,
    /// then a list of points per section. Every word said is escaped, so it reads as text, never as markup.
    pub fn html(&self) -> String {
        let mut out = format!("<div><h1>{}</h1></div>", escape(&self.title));
        for section in &self.sections {
            if section.points.is_empty() {
                continue;
            }
            if !section.title.is_empty() {
                out.push_str(&format!("<div><h2>{}</h2></div>", escape(&section.title)));
            }
            out.push_str("<ul>");
            for p in &section.points {
                let who = if p.who.is_empty() { String::new() } else { format!("{}: ", escape(&p.who)) };
                let decided = if p.decided { "<b>Decided:</b> " } else { "" };
                let unfinished = if p.unfinished { " <i>(unfinished)</i>" } else { "" };
                out.push_str(&format!("<li>{who}{decided}{}{unfinished}</li>", escape(&p.text)));
            }
            out.push_str("</ul>");
        }
        out
    }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The note for thread `id`: its title, its points in the order said, then each branch under it (and theirs) in the
/// map's order. Only placed points: a point still being placed may yet go elsewhere.
pub fn note(world: &World, id: &str, now: u64) -> Option<Note> {
    let id = world.resolve(id);
    let thread = world.thread(&id)?;
    let speakers: std::collections::HashSet<&str> = world.thoughts.iter().map(|t| t.speaker.as_str()).collect();
    let points = |thread: &str| {
        let mut on: Vec<&crate::world::Thought> = world.thoughts.iter().filter(|t| t.placed && t.thread_id.as_deref() == Some(thread)).collect();
        on.sort_by_key(|t| t.said_at(now));
        on.into_iter()
            .map(|t| NotePoint {
                text: crate::spoken::capital(if t.point.trim().is_empty() { &t.text } else { &t.point }),
                who: if speakers.len() > 1 { t.speaker.clone() } else { String::new() },
                decided: t.decided,
                unfinished: !t.complete,
            })
            .collect::<Vec<_>>()
    };
    let mut sections = vec![NoteSection { title: String::new(), points: points(&thread.id) }];
    for branch in crate::spoken::descendants(world, &thread.id) {
        if let Some(b) = world.thread(&branch) {
            sections.push(NoteSection { title: b.title.clone(), points: points(&b.id) });
        }
    }
    sections.retain(|s| s.title.is_empty() || !s.points.is_empty());
    Some(Note { title: thread.title.clone(), sections })
}

/// What a run may do with Notes.
pub struct Runtime {
    /// `NOTES_WRITE=on`: a save really writes. Off, it's a dry run.
    pub write: bool,
    script: Script,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    next: u64,
    /// A note Notes has but hasn't answered for yet: one at a time.
    saving: bool,
    /// Card id → the id Notes gave the note, for Open in Notes: only notes this run wrote.
    written: HashMap<u64, String>,
}

impl Default for Runtime {
    /// Nothing written: a test core's stand-in refuses, should one ever get that far.
    fn default() -> Self {
        let script: Script = if cfg!(test) { Arc::new(|_, _| Box::pin(async { Err("no osascript in tests".to_string()) })) } else { osascript() };
        Runtime::with(false, script)
    }
}

impl Runtime {
    pub fn from_env() -> Self {
        Runtime::with(std::env::var("NOTES_WRITE").is_ok_and(|v| crate::trace::on(&v)), osascript())
    }

    pub fn with(write: bool, script: Script) -> Self {
        Runtime { write, script, state: Mutex::default() }
    }

    /// Whether a save really writes: the setting is on, and this is a Mac running the core for its own person.
    fn live(&self) -> bool {
        self.write && crate::apple::reachable()
    }
}

/// Whether Notes is on at all: the Full preset, on a core that isn't hosted.
pub fn on(core: &Core) -> bool {
    core.messages.settings.preset == crate::messages::Preset::Full && !crate::hosted()
}

/// Which thread a request names.
#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    /// "This": what the speaker selected, points at, else is on (catalog.rs `this`).
    This,
    /// A thread by its title: "the picnic thread".
    Named(String),
}

/// A request to save a thread as a note: which thread, and whether it named Notes only as "notes" ("put this in
/// Notes"), which a thread called Notes could mean too.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub target: Target,
    pub bare: bool,
}

const VERBS: [&str; 5] = ["save", "put", "add", "copy", "send"];
/// Where it goes: "as a note", or into Notes by a name for it.
const PREPS: [&str; 3] = ["to", "in", "into"];
const PLACES: [&str; 6] = ["notes", "my notes", "apple notes", "the notes app", "notes app", "the notes"];
/// The places a thread called "Notes" could also be.
const BARE: [&str; 3] = ["notes", "my notes", "the notes"];
const AS_NOTE: [&str; 4] = ["as a note", "as a new note", "as an apple note", "as a note in notes"];
/// The thread "this" means, said so.
const THIS: [&str; 13] =
    ["", "this", "this one", "this thread", "this card", "this topic", "it", "that", "that one", "that thread", "that card", "the thread", "this whole thread"];
/// The most words a thread's name may take here: titles are asked for in 5 words (protocol.rs `TITLE_MAX`), plus
/// "the" and "thread". More is a sentence about notes, not a request.
const NAME_WORDS: usize = 7;

/// Reads a whole turn as a request to save a thread as a note: a verb ("save", "put", "add", "copy", "send"), the
/// thread ("this", "the picnic thread", or nothing), then "as a note" or "to Notes" ("in Apple Notes", "to the Notes
/// app"). None when it isn't one: "save money for a note" or "I put it in my notes" are thoughts.
pub fn read(text: &str) -> Option<Ask> {
    let words = crate::words(crate::spoken::plain(text));
    let verb = words.first()?;
    if !VERBS.contains(&verb.as_str()) {
        return None;
    }
    let said = words[1..].join(" ");
    let ends = PREPS
        .iter()
        .flat_map(|p| PLACES.iter().map(move |place| (format!("{p} {place}"), BARE.contains(place))))
        .chain(AS_NOTE.iter().map(|a| (a.to_string(), false)));
    // The longest ending that fits: "as a note in notes" before "in notes".
    let (end, bare) = ends
        .filter(|(end, _)| said == *end || said.ends_with(&format!(" {end}")))
        .max_by_key(|(end, _)| end.len())?;
    let middle = said[..said.len() - end.len()].trim();
    if THIS.contains(&middle) {
        return Some(Ask { target: Target::This, bare });
    }
    let n = middle.split(' ').count();
    if n > NAME_WORDS || ["me", "you", "them", "us", "everything", "all"].contains(&middle) {
        return None;
    }
    Some(Ask { target: Target::Named(middle.to_string()), bare })
}

/// A named target as a thread's name: "the picnic thread" → "picnic".
fn name(said: &str) -> &str {
    let mut name = said;
    for lead in ["the ", "my ", "our "] {
        name = name.strip_prefix(lead).unwrap_or(name);
    }
    for tail in [" thread", " topic", " card"] {
        name = name.strip_suffix(tail).unwrap_or(name);
    }
    name.trim()
}

/// Whether a named target says it's a thread ("the picnic thread"), so "to Notes" can't be filing words into a
/// thread called Notes ("add milk to my notes").
fn says_thread(target: &Target) -> bool {
    match target {
        Target::This => true,
        Target::Named(n) => [" thread", " topic", " card"].iter().any(|t| n.ends_with(t)),
    }
}

/// The shape of the request, without the map, as the catalog reads it (`Act::Note`). "Put this in Notes" and "add
/// milk to my notes" are left to the rules that read them in the Demo preset (a move, filing): only `act`, with the
/// map and the preset, takes them as a note.
pub fn kind(text: &str) -> Option<Act> {
    let ask = read(text)?;
    let words = crate::words(crate::spoken::plain(text));
    let moves = words.first().is_some_and(|v| v == "put" || v == "add");
    (!ask.bare || (!moves && says_thread(&ask.target))).then_some(Act::Note)
}

/// Acts on a whole turn that asks to save a thread as a note, while Notes is on (`on`); None leaves it to the other
/// rules (the Demo preset, a hosted core, or "to Notes" that may mean a thread called Notes).
pub fn act(core: &Arc<Core>, speaker: &str, text: &str) -> Option<Done> {
    if !on(core) {
        return None;
    }
    let ask = read(text)?;
    let world = core.snapshot();
    // "Put this in Notes" with a thread called Notes on the map: that thread is meant, as it was before Notes was on.
    if ask.bare && world.threads.iter().any(|t| matches!(crate::words(&t.title).join(" ").as_str(), "notes" | "my notes")) {
        return None;
    }
    // As the Add button: Notes is the host's, on the laptop running the core.
    if !core.is_host(speaker) {
        core.send_to(speaker, ServerMsg::Notice { message: "Only the host can save to Notes: it's the Notes on their Mac.".into() });
        return Some(Done::missed(Act::Note));
    }
    let id = match &ask.target {
        Target::This => crate::catalog::this(core, &world, speaker),
        Target::Named(said) => crate::spoken::named_thread(&world, name(said), false),
    };
    let Some(id) = id else {
        // "Add milk to my notes" names no thread: filing's, as before. A thread asked for plainly gets an answer.
        if ask.bare && !says_thread(&ask.target) {
            return None;
        }
        let message = match &ask.target {
            Target::This => "Not saved: there's no thread yet. Say something first, then “save this thread as a note”.".to_string(),
            Target::Named(said) => format!("Not saved: no thread called “{}” on the map.", name(said)),
        };
        core.send_to(speaker, ServerMsg::Notice { message });
        return Some(Done::missed(Act::Note));
    };
    let note = note(&world, &id, crate::now_ms())?;
    if note.points() == 0 {
        core.send_to(speaker, ServerMsg::Notice { message: format!("Not saved: “{}” has no points yet.", note.title) });
        return Some(Done::missed(Act::Note));
    }
    let live = core.notes.live();
    let card_id = {
        let mut state = core.notes.state.lock().unwrap();
        if state.saving {
            drop(state);
            core.send_to(speaker, ServerMsg::Notice { message: "One note at a time: Notes is still saving the last one.".into() });
            return Some(Done::missed(Act::Note));
        }
        state.next += 1;
        state.saving = live;
        state.next
    };
    if !live {
        core.send_to(speaker, card(card_id, &note, NoteState::DryRun, false, &dry_run(core.notes.write)));
        return Some(Done::new(Act::Note));
    }
    core.send_to(speaker, card(card_id, &note, NoteState::Saving, true, "Saving to Notes…"));
    let core = core.clone();
    let speaker = speaker.to_string();
    tokio::spawn(async move {
        let result = (core.notes.script)(WRITE, vec![note.html()]).await;
        let mut state = core.notes.state.lock().unwrap();
        state.saving = false;
        match result {
            Ok(note_id) => {
                if !note_id.is_empty() {
                    state.written.insert(card_id, note_id);
                }
                drop(state);
                core.send_to(&speaker, card(card_id, &note, NoteState::Saved, true, "Saved to Notes"));
            }
            Err(error) => {
                drop(state);
                // Only the error's number: Notes' own words can carry the note's text, which never goes to the log.
                tracing::warn!("Notes didn't save it (error {})", crate::messages::error_number(&error));
                core.send_to(&speaker, card(card_id, &note, NoteState::Failed, true, &failure(&error)));
            }
        }
    });
    Some(Done::new(Act::Note))
}

fn card(id: u64, note: &Note, state: NoteState, live: bool, message: &str) -> ServerMsg {
    ServerMsg::NoteCard { id, title: note.title.clone(), sections: note.sections.clone(), state, live, message: message.into() }
}

/// A dry run's answer, saying what would have made it write: the setting, or, with it on, a Mac running the core
/// for its own person.
fn dry_run(setting_on: bool) -> String {
    if setting_on {
        "Dry run: nothing written. Notes saves only from a Mac running E2A2O for its own person; this would be a new note.".into()
    } else {
        "Dry run: nothing written. With NOTES_WRITE=on this would be a new note in Notes.".into()
    }
}

/// Why a note didn't save, in words a person can act on (as messages.rs says it).
fn failure(error: &str) -> String {
    if error.contains("-1743") {
        "Not saved: macOS blocked it. In System Settings › Privacy & Security › Automation, let the app you started E2A2O from control Notes, then ask again.".into()
    } else {
        "Not saved: Notes didn't accept it. Open Notes once to check it's set up, then ask again.".into()
    }
}

/// The card's Open in Notes: shows the note card `id` saved, in Notes on the host's Mac. Only a note this run wrote,
/// and only for the host; it never changes the note. True when it asked Notes to show it.
pub async fn open(core: &Arc<Core>, speaker: &str, id: u64) -> bool {
    if !core.is_host(speaker) {
        core.send_to(speaker, ServerMsg::Notice { message: "Only the host can open Notes: it's on their Mac.".into() });
        return false;
    }
    let Some(note_id) = core.notes.state.lock().unwrap().written.get(&id).cloned() else { return false };
    if let Err(error) = (core.notes.script)(OPEN, vec![note_id]).await {
        tracing::warn!("Notes didn't open it (error {})", crate::messages::error_number(&error));
        core.send_to(speaker, ServerMsg::Notice { message: "Couldn't open it: find it in Notes by its title.".into() });
        return false;
    }
    true
}

#[cfg(test)]
mod tests;
