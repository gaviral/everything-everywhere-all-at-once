//! Move, rename and delete: the person fixes the map themselves. A misplaced thought moves to
//! another thread ("move that to the pottery thread", or the point's Move button), a thread takes the title they give
//! it ("rename this to Pottery class", or a click on its title), a thought leaves the map ("delete this", "forget the
//! last one", or the point's Delete), and each comes back in one step (Undo, or "scratch that"). Both are the person's, so the AI never overrides them: the refiner never merges the two threads a move set
//! apart (`World::apart`), an undone merge leaves a moved thought where the person put it, and a title they chose
//! stays theirs (tidy.rs). Said or clicked, the same functions act (catalog.rs: one definition each). By rule, with no
//! model call, and only as the whole turn, as every request is: "move it to Friday" stays talk unless a thread's title
//! says Friday.

use crate::catalog::{Act, Done, Undo};
use crate::chunks::Note;
use crate::protocol::ServerMsg;
use crate::spoken::{self, Destination};
use crate::world::{Change, Thread, ThreadStatus, Thought, World};
use crate::{now_ms, Core};
use std::sync::Arc;

/// What a turn asks, from its words alone.
#[derive(Debug, PartialEq)]
enum Ask {
    /// "That" to `place` (see `that`). `sure`: the words can only be about the map ("… the pottery thread",
    /// "… a new thread"), so a place that isn't there is answered, not kept as talk. `last`: the words name the
    /// speaker's latest thought ("my last thought"), not what "this" means.
    Move { place: Place, sure: bool, last: bool },
    /// A thread's new title; each way to read which thread, in the order they're tried (`Target`).
    Rename { targets: Vec<(Target, String)> },
    /// A thought off the map: the speaker's latest (`latest`), or the point "this" means, else their latest.
    Delete { latest: bool },
}

#[derive(Debug, PartialEq)]
enum Place {
    /// A new thread of its own.
    New,
    Named(String),
}

#[derive(Debug, PartialEq)]
enum Target {
    /// What "this" means to the speaker: selected, pointed at, else the thread they're on (catalog.rs `this`).
    This,
    Named(String),
}

/// Where a move goes on this map.
#[derive(Clone, Debug)]
pub enum To {
    Thread(String),
    /// A new thread, with this title, or one from the thought's own point.
    New(Option<String>),
}

/// How a move is taken back: these thoughts go from `to` back to `from` (only those still where the move put them),
/// with the notes the move cleared; `from`, if the move left it empty and it went into `to` (`emptied`), comes back
/// first; `started`, a thread the move made, leaves the map once empty; and the speaker, if the move took them along
/// (`back`), goes back too.
#[derive(Clone, Debug)]
pub struct Unmove {
    pub thoughts: Vec<String>,
    pub from: String,
    pub to: String,
    pub notes: Vec<(String, Note)>,
    pub emptied: bool,
    pub started: Option<String>,
    pub back: Option<String>,
}

/// How a rename is taken back: `thread` gets `was` again, while it still has `title` (nothing renamed it since).
#[derive(Clone, Debug)]
pub struct Retitle {
    pub thread: String,
    pub was: String,
    pub title: String,
}

// --- Reading the words --------------------------------------------------------------------------------------------

const VERBS: [&str; 3] = ["move", "put", "file"];
/// What "that" can be in "move that to …" (see `that`). Filing (spoken.rs) reads none of these as new words to add,
/// since "put my last thought in …" is a move.
pub(crate) const POINTING: [&str; 13] = [
    "that last thought", "my last thought", "the last thought", "the last one", "this thought", "that thought", "this point", "that point",
    "this one", "that one", "this", "that", "it",
];
/// The ones of `POINTING` that name the speaker's latest thought, whatever they point at.
const LAST: [&str; 4] = ["that last thought", "my last thought", "the last thought", "the last one"];
/// "That goes in the pottery thread", "this belongs under bills": said of a thought, never "that's".
const BELONGS: [&str; 3] = ["should go", "goes", "belongs"];
const INTO: [&str; 7] = ["into", "onto", "under", "with", "to", "in", "on"];
/// A thread of its own: "move that to a new thread", "… into its own thread".
const NEW: [&str; 9] = [
    "a new thread", "a new one", "a new topic", "a new card", "its own thread", "its own topic", "its own card", "a thread of its own", "new thread",
];
/// Which thread "rename this …" means; longest first.
const THIS: [&str; 11] = ["this thread", "that thread", "this card", "that card", "this topic", "the thread", "this one", "that one", "this", "that", "it"];
/// "Call this thread …": only with the kind of place, since "call this a win" is talk.
const THIS_KIND: [&str; 5] = ["this thread", "that thread", "this card", "this topic", "this one"];
const TITLE_OF: [&str; 9] = [
    "the title of this thread", "the name of this thread", "the title of this", "the name of this", "the title", "the name", "its title", "its name",
    "this title",
];

/// How many bytes of `l` the longest of `words` takes, with the space after it; or all of `l` when it is one of them
/// and `whole` allows that.
fn lead(l: &str, words: &[&str], whole: bool) -> Option<usize> {
    let mut words = words.to_vec();
    words.sort_by_key(|w| std::cmp::Reverse(w.len()));
    words.iter().find_map(|w| {
        if l.starts_with(&format!("{w} ")) {
            Some(w.len() + 1)
        } else {
            (whole && l == *w).then_some(w.len())
        }
    })
}

fn read(text: &str) -> Option<Ask> {
    let t = spoken::plain(text);
    // ASCII only, so byte offsets in `l` are offsets in `t`, and a title keeps the capitals it was said with.
    let l = t.to_ascii_lowercase();
    read_move(t, &l).or_else(|| read_rename(t, &l)).or_else(|| read_delete(&l))
}

/// "Delete" said of a thought, the whole turn. Bare "delete that" and "remove that" stay "scratch that" (catalog.rs),
/// which takes back what was just said; "forget" never takes "it", "that" or "this one", which set the unfinished
/// card aside (spoken.rs).
const DELETE: [&str; 4] = ["delete", "remove", "erase", "forget"];
/// Always the speaker's latest thought, wherever they point.
const DELETE_LAST: [&str; 9] = [
    "the last one", "my last one", "the last thought", "my last thought", "that last thought", "the last point", "my last point",
    "what i just said", "the last thing i said",
];
/// The point "this" means; "forget" takes only the ones that name a thought.
const THIS_POINT: [&str; 4] = ["this thought", "that thought", "this point", "that point"];
const THIS_ONE: [&str; 3] = ["this one", "that one", "this"];

fn read_delete(l: &str) -> Option<Ask> {
    let n = lead(l, &DELETE, false)?;
    let rest = l[n..].strip_suffix(" from the map").unwrap_or(&l[n..]);
    if DELETE_LAST.contains(&rest) {
        return Some(Ask::Delete { latest: true });
    }
    let forget = l.starts_with("forget");
    (THIS_POINT.contains(&rest) || (!forget && THIS_ONE.contains(&rest))).then_some(Ask::Delete { latest: false })
}

fn read_move(t: &str, l: &str) -> Option<Ask> {
    let mut last = false;
    let mut at = match lead(l, &VERBS, false) {
        Some(n) => {
            last = lead(&l[n..], &LAST, false).is_some();
            n + lead(&l[n..], &POINTING, false)?
        }
        None => {
            let n = lead(l, &["this one", "that one", "this", "that", "it"], false)?;
            n + lead(&l[n..], &BELONGS, false)?
        }
    };
    at += lead(&l[at..], &INTO, false)?;
    let place = t[at..].trim();
    let lower = l[at..].trim();
    if lower.is_empty() {
        return None;
    }
    if NEW.contains(&lower) {
        return Some(Ask::Move { place: Place::New, sure: true, last });
    }
    let kinds = spoken::kinds();
    let sure = crate::find::words(place).last().is_some_and(|w| kinds.contains(w) && w != "one");
    Some(Ask::Move { place: Place::Named(place.into()), sure, last })
}

fn read_rename(t: &str, l: &str) -> Option<Ask> {
    let title = |from: usize| clean_title(&t[from.min(t.len())..]);
    if let Some(n) = lead(l, &["rename"], true) {
        let rest = &l[n..];
        // "Rename this to Pottery class", "rename it Pottery", "rename" alone (then it asks for the title).
        if rest.is_empty() {
            return Some(Ask::Rename { targets: vec![(Target::This, String::new())] });
        }
        if let Some(m) = lead(rest, &THIS, true) {
            let to = lead(&rest[m..], &["to", "as"], false).unwrap_or(0);
            return Some(Ask::Rename { targets: vec![(Target::This, title(n + m + to))] });
        }
        // "Rename the garden thread to Backyard": the name ends at a " to " or " as "; every place it could end is
        // tried on the map, since a title can hold one too ("Trip to Japan").
        let mut cuts: Vec<usize> = rest.match_indices(" to ").chain(rest.match_indices(" as ")).map(|(i, _)| i).collect();
        cuts.sort();
        let targets: Vec<(Target, String)> = cuts.into_iter()
            .map(|i| (Target::Named(t[n..n + i].trim().into()), title(n + i + 4)))
            .filter(|(target, _)| !matches!(target, Target::Named(name) if name.is_empty()))
            .collect();
        return (!targets.is_empty()).then_some(Ask::Rename { targets });
    }
    if let Some(n) = lead(l, &["call", "name", "title"], false) {
        let m = lead(&l[n..], &THIS_KIND, false)?;
        return Some(Ask::Rename { targets: vec![(Target::This, title(n + m))] });
    }
    let n = lead(l, &["change"], false)?;
    let m = lead(&l[n..], &TITLE_OF, false)?;
    let to = lead(&l[n + m..], &["to"], false)?;
    Some(Ask::Rename { targets: vec![(Target::This, title(n + m + to))] })
}

/// A title as said: without quotes or the marks a pause leaves, first letter in capitals, as the map's titles are.
fn clean_title(said: &str) -> String {
    let marks = |c: char| matches!(c, '"' | '“' | '”' | '\'' | '‘' | '’' | '.' | ',' | ';' | ':' | '!' | '?' | '…') || c.is_whitespace();
    spoken::capital(said.trim_matches(marks))
}

/// The act a whole turn asks for by these rules, without the map (catalog.rs `classify`).
pub fn kind(text: &str) -> Option<Act> {
    read(text).map(|ask| match ask {
        Ask::Move { .. } => Act::Move,
        Ask::Rename { .. } => Act::Rename,
        Ask::Delete { .. } => Act::Delete,
    })
}

/// The thread a spoken name means for a move or rename: by title, as filing reads it (spoken.rs `destination`), else a
/// title holding every word of the name, the same words first, then the most recently touched. Never by what was said
/// on it: "move it to Friday" is talk unless a title says Friday.
fn titled(world: &World, name: &str) -> Option<String> {
    if let Destination::Thread(id) = spoken::destination(world, name) {
        return Some(id);
    }
    let wanted = spoken::name_words(name);
    if wanted.is_empty() {
        return None;
    }
    world.threads.iter()
        .filter(|t| wanted.is_subset(&spoken::name_words(&t.title)))
        .max_by_key(|t| (spoken::name_words(&t.title) == wanted, t.touched_ms))
        .map(|t| t.id.clone())
}

// --- Acting ---------------------------------------------------------------------------------------------------------

/// Acts on `text` when the whole turn is a move or a rename the map allows, and says what it did; None leaves it to be
/// talk ("put it in the fridge"). A move or rename plainly about the map that can't act says why.
pub fn act(core: &Arc<Core>, speaker: &str, text: &str) -> Option<Done> {
    match read(text)? {
        Ask::Move { place, sure, last } => move_that(core, speaker, text, place, sure, last),
        Ask::Rename { targets } => Some(rename_said(core, speaker, targets)),
        Ask::Delete { latest } => Some(delete_said(core, speaker, latest)),
    }
}

/// "Delete this": the point the speaker is on (focused or pointed at), else, as "forget the last one" always does,
/// their latest thought (as "move that" means it), placed or still finding its place.
pub(crate) fn delete_said(core: &Arc<Core>, speaker: &str, latest: bool) -> Done {
    let world = core.snapshot();
    let now = now_ms();
    let pointed = (!latest).then(|| crate::catalog::this_thought(core, &world, speaker)).flatten();
    let target = pointed.or_else(|| world.thoughts.iter().filter(|t| t.speaker == speaker).max_by_key(|t| t.said_at(now)).map(|t| t.id.clone()));
    drop(world);
    let Some(id) = target else {
        notice(core, speaker, "Nothing to delete yet: say a thought first".into());
        return Done::missed(Act::Delete);
    };
    delete(core, speaker, &id)
}

/// The point's Delete (a click, or Delete on a focused point).
pub fn click_delete(core: &Arc<Core>, speaker: &str, thought_id: &str) {
    let done = delete(core, speaker, thought_id);
    crate::catalog::did(core, speaker, "delete this", done);
}

/// Takes a thought off the map as its point shows it, with the words before a pause it carries on (`with_heads`), and
/// says what went, with Undo. The journal keeps the words (`ThoughtSkipped`); nothing brings them back but Undo: the
/// refiner drops a pass that read them (refiner.rs `drop_deleted`), and an undone merge moves only thoughts on the map.
pub(crate) fn delete(core: &Arc<Core>, speaker: &str, thought_id: &str) -> Done {
    let world = core.snapshot();
    let Some(thought) = world.thoughts.iter().find(|t| t.id == thought_id) else {
        notice(core, speaker, "That thought isn't on the map any more".into());
        return Done::missed(Act::Delete);
    };
    let ids = match thought.thread_id.as_deref().map(|id| world.resolve(id)) {
        Some(on) if thought.placed => with_heads(&world, thought_id, &on),
        _ => vec![thought_id.to_string()],
    };
    let words = if thought.point.is_empty() { thought.text.clone() } else { spoken::capital(&thought.point) };
    drop(world);
    let Some(undo) = crate::catalog::take_off(core, &ids) else {
        notice(core, speaker, "That thought isn't on the map any more".into());
        return Done::missed(Act::Delete);
    };
    notice(core, speaker, format!("Deleted “{}”{}", crate::catalog::short(&words), crate::catalog::with_cards(&undo)));
    Done::with(Act::Delete, Some(undo))
}

fn notice(core: &Core, speaker: &str, message: String) {
    core.send_to(speaker, ServerMsg::Notice { message });
}

/// What "that" is in "move that to …": the speaker's latest thought while it's still finding its place (they just
/// said it, and it's on no card to point at yet); else the newest point on the card "this" means (catalog.rs: the one
/// selected, pointed at or just left by the pointer, else the thread they're on); else their latest. `last` ("my
/// last thought") is always their latest. Of a card, its newest point, whoever said it: the one it shows last. A card
/// with no point of its own (a parent whose points all moved) has nothing to move: Err with its title, never some
/// other thought of theirs.
fn that<'a>(core: &Core, world: &'a World, speaker: &str, last: bool) -> Result<Option<&'a Thought>, String> {
    let now = now_ms();
    let latest = world.thoughts.iter().filter(|t| t.speaker == speaker).max_by_key(|t| t.said_at(now));
    if last || latest.is_some_and(|t| !t.placed) {
        return Ok(latest);
    }
    let card = crate::catalog::pointed_at(core, world, speaker).or_else(|| world.active_for(speaker).map(|id| world.resolve(id)));
    match card {
        Some(card) => match newest(world, now, |t| on(world, t, &card)) {
            Some(t) => Ok(Some(t)),
            None => Err(world.thread(&card).map(|t| t.title.clone()).unwrap_or_default()),
        },
        None => Ok(latest),
    }
}

/// "Move that to …": see `that`. Still finding its place, it moves once it lands, unless the speaker says something
/// else first.
fn move_that(core: &Arc<Core>, speaker: &str, said: &str, place: Place, sure: bool, last: bool) -> Option<Done> {
    let world = core.snapshot();
    let to = match place {
        Place::New => To::New(None),
        Place::Named(name) => match spoken::destination(&world, &name) {
            Destination::New(title) => To::New(Some(title)),
            _ => match titled(&world, &name) {
                Some(id) => To::Thread(id),
                None if sure => {
                    notice(core, speaker, format!("I couldn't find “{name}”. Try words from its title."));
                    return Some(Done::missed(Act::Move));
                }
                None => return None,
            },
        },
    };
    let latest = match that(core, &world, speaker, last) {
        Ok(Some(t)) => t,
        Ok(None) => {
            notice(core, speaker, "Nothing to move yet: say a thought first".into());
            return Some(Done::missed(Act::Move));
        }
        Err(title) => {
            notice(core, speaker, format!("Nothing on {title} to move: point at one of its points"));
            return Some(Done::missed(Act::Move));
        }
    };
    if !latest.placed {
        let id = latest.id.clone();
        drop(world);
        notice(core, speaker, "Moving it once it finds its place…".into());
        tokio::spawn(move_once_placed(core.clone(), speaker.into(), said.into(), id, to, crate::catalog::turn(core, speaker)));
        return Some(Done::new(Act::Move));
    }
    let id = latest.id.clone();
    drop(world);
    Some(shift(core, speaker, &id, to))
}

/// Waits for thought `id` to be placed, then moves it, if it wasn't taken back and the speaker said nothing newer
/// (`turn`): then "that" may mean something else.
async fn move_once_placed(core: Arc<Core>, speaker: String, said: String, id: String, to: To, turn: u64) {
    let mut updates = core.updates.subscribe();
    loop {
        if crate::catalog::turn(&core, &speaker) != turn {
            tracing::info!("move of {id} dropped: the speaker said something newer");
            return;
        }
        match core.snapshot().thoughts.iter().find(|t| t.id == id) {
            None => return,
            Some(t) if t.placed => break,
            Some(_) => {}
        }
        if let Err(tokio::sync::broadcast::error::RecvError::Closed) = updates.recv().await {
            return;
        }
    }
    let done = shift(&core, &speaker, &id, to);
    crate::catalog::did(&core, &speaker, &said, done);
}

/// The Move button: a point to another thread (none: a new thread of its own).
pub fn click_move(core: &Arc<Core>, speaker: &str, thought_id: &str, thread_id: Option<String>) {
    let to = thread_id.map_or(To::New(None), To::Thread);
    let done = shift(core, speaker, thought_id, to);
    crate::catalog::did(core, speaker, "move that", done);
}

/// A title typed on the card.
pub fn click_rename(core: &Arc<Core>, speaker: &str, thread_id: &str, title: &str) {
    let world = core.snapshot();
    let thread = world.resolve(thread_id);
    drop(world);
    let done = rename(core, speaker, &thread, clean_title(title));
    crate::catalog::did(core, speaker, "rename this", done);
}

/// A new thread's title from the point that starts it, as "new thread about …" makes one (at most 5 words), without
/// the small words a cut can leave at its end ("Learn to throw on the" → "Learn to throw"). The refiner may propose a
/// better one later: this one isn't the person's.
fn title_from(point: &str) -> String {
    const SMALL: [&str; 16] = ["the", "a", "an", "on", "to", "of", "in", "into", "and", "or", "for", "with", "at", "by", "my", "our"];
    let title = spoken::title_for(point);
    let mut words: Vec<&str> = title.split_whitespace().collect();
    while words.len() > 1 && SMALL.contains(&words[words.len() - 1].to_ascii_lowercase().as_str()) {
        words.pop();
    }
    words.join(" ")
}

/// The ideas a point shows as one: the thought, and the words before a pause it carries on, on the same thread
/// (chunks.rs), oldest first. They move together, as the card shows them.
fn with_heads(world: &World, id: &str, on: &str) -> Vec<String> {
    let mut ids = vec![id.to_string()];
    let mut at = id.to_string();
    while let Some(head) = world.notes.get(&at).map(|n| n.continues.clone()).filter(|h| !h.is_empty() && !ids.contains(h)) {
        let here = world.thoughts.iter().any(|t| t.id == head && t.thread_id.as_deref().map(|x| world.resolve(x)).as_deref() == Some(on));
        if !here {
            break;
        }
        ids.insert(0, head.clone());
        at = head;
    }
    ids
}

/// Moves a placed thought (with the words it carries on) to `to`, as the person asked: its "why here" goes (the
/// person's reason is theirs), both threads' last points stay true, and if it's the speaker's newest on the thread
/// they're on, they go with it, so what they say next follows it there.
pub(crate) fn shift(core: &Arc<Core>, speaker: &str, thought_id: &str, to: To) -> Done {
    let world = core.snapshot();
    let Some(thought) = world.thoughts.iter().find(|t| t.id == thought_id && t.placed) else {
        notice(core, speaker, "That thought isn't on the map any more".into());
        return Done::missed(Act::Move);
    };
    let Some(from) = thought.thread_id.as_deref().map(|id| world.resolve(id)).filter(|id| world.thread(id).is_some()) else {
        notice(core, speaker, "That thought isn't on the map any more".into());
        return Done::missed(Act::Move);
    };
    let now = now_ms();
    let mut changes = Vec::new();
    let (target, title, started) = match to {
        To::Thread(id) => {
            let id = world.resolve(&id);
            let Some(thread) = world.thread(&id) else {
                notice(core, speaker, "That thread isn't on the map any more".into());
                return Done::missed(Act::Move);
            };
            if id == from {
                notice(core, speaker, format!("It's already in {}", thread.title));
                return Done::missed(Act::Move);
            }
            (id, thread.title.clone(), None)
        }
        To::New(title) => {
            let id = spoken::fresh_id(&world);
            let title = title.unwrap_or_else(|| title_from(if thought.point.is_empty() { &thought.text } else { &thought.point }));
            changes.push(Change::ThreadAdded {
                thread: Thread {
                    id: id.clone(),
                    title: title.clone(),
                    parent_id: None,
                    status: ThreadStatus::Open,
                    last_point: String::new(),
                    touched_ms: now,
                    tags: Vec::new(),
                    picture: None,
                    dropped_by: String::new(),
                },
            });
            (id.clone(), title, Some(id))
        }
    };
    let ids = with_heads(&world, thought_id, &from);
    for id in &ids {
        changes.push(Change::ThoughtMoved { thought_id: id.clone(), thread_id: target.clone(), from: from.clone(), undo: false });
    }
    let mut notes = Vec::new();
    for id in &ids {
        if let Some(note) = world.notes.get(id).filter(|n| !n.why.is_empty() || !n.assumed.is_empty()) {
            notes.push((id.clone(), note.clone()));
            changes.push(Change::ThoughtNoted { thought_id: id.clone(), note: Note { continues: note.continues.clone(), ..Note::default() } });
        }
    }
    // The thread it leaves empty goes into where it went, as words taken back take the thread they alone started
    // (catalog.rs `unkeep`): most often the AI started a thread for a thought that belonged to another, and that
    // thread was the mistake. A merge, so anything late aimed at it lands where its words went, and an undo puts it
    // back where it stood in the list.
    let emptied = !world.thoughts.iter().any(|t| t.placed && on(&world, t, &from) && !ids.contains(&t.id))
        && !world.threads.iter().any(|t| t.parent_id.as_deref() == Some(from.as_str()));
    changes.extend(last_points(&world, &ids, &from, &target, started.is_some(), now).into_iter().filter(|c| !emptied || !matches!(c, Change::ThreadTouched { thread_id, .. } if *thread_id == from)));
    // Their newest words on the thread they're on: "that" there, said last of what they said on it.
    let latest = newest(&world, now, |t| t.speaker == speaker && on(&world, t, &from)).is_some_and(|t| ids.contains(&t.id));
    let back = (latest && world.active_for(speaker).map(|id| world.resolve(id)).as_deref() == Some(from.as_str())).then(|| from.clone());
    if back.is_some() {
        changes.push(Change::ActiveChanged { thread_id: target.clone(), speaker: speaker.into() });
        // Taken along, the speaker is somewhere again: a "new thread" asked for before ends, as on any move (`focus`).
        core.new_threads.cancel(speaker);
    }
    // The cards made from these words alone go with them (an emptied thread's go with its merge): "pottery class
    // Thursday" moved off Garden takes its reminder, rather than leaving it on a card that no longer says it.
    let carried = if emptied { Vec::new() } else { carry(&world, &ids, &from, &target) };
    let cards = cards(carried.len());
    changes.extend(carried);
    if emptied {
        changes.push(Change::ThreadMerged { from: from.clone(), into: target.clone() });
    }
    // It names what moved: "that" may be a card's point, not the words just said (`that`).
    let what = crate::catalog::short(if thought.point.is_empty() { &thought.text } else { &thought.point });
    drop(world);
    core.commit(changes);
    notice(core, speaker, if started.is_some() { format!("Moved “{what}”{cards} to a new thread: {title}") } else { format!("Moved “{what}”{cards} to {title}") });
    Done::with(Act::Move, Some(Undo::Unmove(Unmove { thoughts: ids, from, to: target, notes, emptied, started, back })))
}

/// The waiting cards on `from` made from thoughts `ids` alone (catalog.rs `made_from`), moved to `to` with them.
fn carry(world: &World, ids: &[String], from: &str, to: &str) -> Vec<Change> {
    let moving: Vec<Thought> = world.thoughts.iter().filter(|t| ids.contains(&t.id)).cloned().collect();
    crate::catalog::made_from(world, from, &moving).into_iter().map(|id| Change::ItemMoved { id, thread_id: to.into() }).collect()
}

/// How a move's notice names the cards that went along: "", " and the card made from it", " and its 2 cards".
fn cards(n: usize) -> String {
    match n {
        0 => String::new(),
        1 => " and the card made from it".into(),
        n => format!(" and the {n} cards made from it"),
    }
}

/// Whether thought `t` is on thread `id`, following merges.
fn on(world: &World, t: &Thought, id: &str) -> bool {
    t.thread_id.as_deref().map(|x| world.resolve(x)).as_deref() == Some(id)
}

/// The newest placed thought on `thread` (by when it was said) among those `on` picks.
fn newest<'a>(world: &'a World, now: u64, on: impl Fn(&Thought) -> bool) -> Option<&'a Thought> {
    world.thoughts.iter().filter(|t| t.placed && on(t)).max_by_key(|t| t.said_at(now))
}

/// Keeps the copies of points on cards true when `ids` go from `from` to `to`: `from` takes its newest remaining point
/// if its last was one of them; `to` takes theirs if they're newer than its own. On the world before the move.
fn last_points(world: &World, ids: &[String], from: &str, to: &str, new: bool, now: u64) -> Vec<Change> {
    let moving = |t: &Thought| ids.contains(&t.id);
    let on = |t: &Thought, id: &str| t.thread_id.as_deref().map(|x| world.resolve(x)).as_deref() == Some(id);
    let mut out = Vec::new();
    if let Some(thread) = world.thread(from) {
        if world.thoughts.iter().any(|t| moving(t) && !t.point.is_empty() && t.point == thread.last_point) {
            let point = newest(world, now, |t| on(t, from) && !moving(t)).map(|t| t.point.clone()).unwrap_or_default();
            out.push(Change::ThreadTouched { thread_id: from.into(), last_point: point, at_ms: thread.touched_ms });
        }
    }
    let theirs = newest(world, now, moving);
    let own = newest(world, now, |t| on(t, to) && !moving(t));
    if let Some(moved) = theirs.filter(|m| own.is_none_or(|o| m.said_at(now) >= o.said_at(now))) {
        let touched = if new { now } else { world.thread(to).map_or(now, |t| t.touched_ms) };
        out.push(Change::ThreadTouched { thread_id: to.into(), last_point: moved.point.clone(), at_ms: touched });
    }
    out
}

/// Whether `u` can still be taken back: its thread to go back to is on the map, apart from where the thoughts are,
/// and one of them is still where the move put it (an undone merge, "scratch that" on it, or another move may have
/// taken it elsewhere).
pub(crate) fn can_unmove(world: &World, u: &Unmove) -> bool {
    let (on, back) = (world.resolve(&u.to), world.resolve(&u.from));
    let returns = comes_back(world, u).is_some() || (back != on && world.thread(&back).is_some());
    returns && still_there(world, u, &on).next().is_some()
}

/// The thread the move emptied and merged away, if it's still merged where the thoughts are: its undo of that merge.
fn comes_back(world: &World, u: &Unmove) -> Option<crate::tidy::Unmerge> {
    let merged_here = world.merged.contains_key(&u.from) && world.resolve(&u.from) == world.resolve(&u.to);
    u.emptied.then_some(()).filter(|_| merged_here).and_then(|_| world.unmerge.get(&u.from).cloned())
}

fn still_there<'a>(world: &'a World, u: &'a Unmove, on: &'a str) -> impl Iterator<Item = &'a Thought> + 'a {
    world.thoughts.iter().filter(move |t| u.thoughts.contains(&t.id) && t.thread_id.as_deref().map(|x| world.resolve(x)).as_deref() == Some(on))
}

/// Takes a move back (`can_unmove` first): the thoughts still where it put them go back, with their notes, a thread
/// the move started leaves the map once empty, and the speaker it took along goes back if they're still there.
pub(crate) fn unmove(core: &Arc<Core>, speaker: &str, u: &Unmove) {
    if !can_unmove(&core.snapshot(), u) {
        return;
    }
    if let Some(unmerge) = comes_back(&core.snapshot(), u) {
        core.commit(vec![Change::ThreadUnmerged { unmerge }]);
    }
    let world = core.snapshot();
    let (on, back) = (world.resolve(&u.to), world.resolve(&u.from));
    let ids: Vec<String> = still_there(&world, u, &on).map(|t| t.id.clone()).collect();
    let mut changes: Vec<Change> = ids.iter()
        .map(|id| Change::ThoughtMoved { thought_id: id.clone(), thread_id: u.from.clone(), from: u.to.clone(), undo: true })
        .collect();
    changes.extend(u.notes.iter().filter(|(id, _)| ids.contains(id)).map(|(id, note)| Change::ThoughtNoted { thought_id: id.clone(), note: note.clone() }));
    let emptied = u.started.as_ref().map(|id| world.resolve(id)).filter(|id| {
        *id == on
            && !world.thoughts.iter().any(|t| t.thread_id.as_deref().map(|x| world.resolve(x)).as_deref() == Some(id.as_str()) && !ids.contains(&t.id))
            && !world.threads.iter().any(|t| t.parent_id.as_deref() == Some(id.as_str()))
    });
    let now = now_ms();
    changes.extend(last_points(&world, &ids, &on, &back, false, now).into_iter().filter(|c| !matches!(c, Change::ThreadTouched { thread_id, .. } if Some(thread_id) == emptied.as_ref())));
    // The cards that went with them come back too, as does any made from them alone where they were put.
    let carried = if world.thread(&back).is_some() { carry(&world, &ids, &on, &back) } else { Vec::new() };
    let going_back = |c: &Change| carried.iter().any(|m| matches!((m, c), (Change::ItemMoved { id, .. }, Change::ItemStatus { id: other, .. }) if id == other));
    changes.extend(carried.iter().cloned());
    if let Some(id) = &emptied {
        changes.extend(crate::catalog::set_aside(&world, id).into_iter().filter(|c| !going_back(c)));
        changes.push(Change::ThreadRemoved { thread_id: id.clone() });
    }
    let follow = u.back.is_some() && (world.active_for(speaker) == Some(&on) || emptied.is_some());
    drop(world);
    core.commit(changes);
    if follow {
        core.focus(speaker, &back);
    }
}

/// "Rename …" said: the thread "this" means, or the one named (an exact title first, then one holding the name's
/// words), and the title after it.
fn rename_said(core: &Arc<Core>, speaker: &str, targets: Vec<(Target, String)>) -> Done {
    let world = core.snapshot();
    let found = |exact: bool| targets.iter().find_map(|(target, title)| {
        let id = match target {
            Target::This => crate::catalog::this(core, &world, speaker),
            Target::Named(name) => {
                let wanted = spoken::name_words(name);
                let hit = |t: &&Thread| !wanted.is_empty() && if exact { spoken::name_words(&t.title) == wanted } else { wanted.is_subset(&spoken::name_words(&t.title)) };
                world.threads.iter().filter(hit).max_by_key(|t| t.touched_ms).map(|t| t.id.clone())
            }
        }?;
        Some((id, title.clone()))
    });
    let Some((thread, title)) = found(true).or_else(|| found(false)) else {
        let message = match &targets[0].0 {
            Target::Named(name) => format!("I couldn't find “{name}”. Try words from its title."),
            Target::This if world.threads.is_empty() => "Nothing on the map yet: say a thought first".into(),
            Target::This => "Point at a thread, then say “rename this to …”".into(),
        };
        notice(core, speaker, message);
        return Done::missed(Act::Rename);
    };
    drop(world);
    rename(core, speaker, &thread, title)
}

/// Gives `thread` the person's title (`TitleChosen`: the refiner leaves it alone from now on).
fn rename(core: &Arc<Core>, speaker: &str, thread: &str, title: String) -> Done {
    let world = core.snapshot();
    let Some(was) = world.thread(thread).map(|t| t.title.clone()) else {
        notice(core, speaker, "That thread isn't on the map any more".into());
        return Done::missed(Act::Rename);
    };
    if title.is_empty() {
        notice(core, speaker, "Say the new title: “rename this to …”".into());
        return Done::missed(Act::Rename);
    }
    if title.chars().count() > crate::protocol::TITLE_MAX {
        notice(core, speaker, format!("Titles stay short: {} characters at most.", crate::protocol::TITLE_MAX));
        return Done::missed(Act::Rename);
    }
    if title == was {
        notice(core, speaker, format!("It's already called “{title}”"));
        return Done::missed(Act::Rename);
    }
    drop(world);
    core.commit(vec![Change::TitleChosen { thread_id: thread.into(), title: title.clone() }]);
    notice(core, speaker, format!("Renamed to “{title}”"));
    Done::with(Act::Rename, Some(Undo::Retitle(Retitle { thread: thread.into(), was, title })))
}

/// Whether a rename can still be taken back: the thread is on the map (not merged away) and nothing renamed it since.
pub(crate) fn can_unrename(world: &World, r: &Retitle) -> bool {
    world.thread(&r.thread).is_some_and(|t| t.title == r.title)
}

/// Takes a rename back: the title before it, which is the person's choice too.
pub(crate) fn unrename(core: &Core, r: &Retitle) {
    if can_unrename(&core.snapshot(), r) {
        core.commit(vec![Change::TitleChosen { thread_id: r.thread.clone(), title: r.was.clone() }]);
    }
}

#[cfg(test)]
mod tests;
