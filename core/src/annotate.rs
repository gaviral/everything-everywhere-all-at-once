//! Margin notes: words picked in a point and answered beside them (`ClientMsg::Annotate`), by a person's window or an
//! AI participant, for every window on the map. One mechanism with tangents: a note is a tangent anchored to words, a
//! thread under the point's thread whose thoughts are the note and its replies, and `World::anchors` keeps the words
//! each is tied to (`Change::Anchored`). By rule, with no model call; journaled as any thought is, so a restart and a
//! window that opens later have it, and it reaches every window as a change.

use crate::protocol::THOUGHT_MAX;
use crate::world::{Change, Thought, Thread, ThreadStatus, World};
use crate::Core;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// The words a note is tied to: a point's thought, and the words picked in it as they read then.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Anchor {
    pub thought_id: String,
    pub quote: String,
}

/// What the window that asked hears when a note is refused.
pub const GONE: &str = "That point isn't on the map any more.";
pub const NO_WORDS: &str = "A comment needs words, and the words it's about.";
pub const TOO_LONG: &str = "Too long for one comment: 6,000 characters at most.";

/// How many words of the quote a new note's thread is titled with, as a tangent's title is short (the placer asks for 5).
const TITLE_WORDS: usize = 6;

/// A note by `speaker` on `quote`, words in thought `thought_id`: the first note on those words starts their tangent
/// under the point's thread, a later one answers in it. The speaker stays where they are, as a drag leaves them (a
/// note is beside the talk, not a move in it). Returns the note's thread, or why not.
pub fn note(core: &Arc<Core>, speaker: &str, thought_id: &str, quote: &str, text: &str) -> Result<String, &'static str> {
    note_speaking(core, speaker, thought_id, quote, text, false)
}

pub fn note_speaking(core: &Arc<Core>, speaker: &str, thought_id: &str, quote: &str, text: &str, speak: bool) -> Result<String, &'static str> {
    let quote = one_line(quote);
    let text = text.trim();
    if quote.is_empty() || text.is_empty() {
        return Err(NO_WORDS);
    }
    if quote.chars().count() > THOUGHT_MAX || text.chars().count() > THOUGHT_MAX {
        return Err(TOO_LONG);
    }
    // Made from a snapshot and committed only while it still holds: another note on the same words meanwhile makes this
    // one a reply to it, and a delete meanwhile refuses it. A few tries: each is a commit that came between.
    for _ in 0..4 {
        let world = core.snapshot();
        let Some(parent) = home(&world, thought_id) else { return Err(GONE) };
        let found = tangent(&world, thought_id, &quote);
        let now = crate::now_ms();
        let mut changes = Vec::new();
        let thread_id = match &found {
            Some(id) => id.clone(),
            None => {
                let id = fresh_id(&world);
                changes.push(Change::ThreadAdded {
                    thread: Thread {
                        id: id.clone(),
                        title: title_of(&quote),
                        parent_id: Some(parent),
                        status: ThreadStatus::Open,
                        last_point: String::new(),
                        touched_ms: now,
                        tags: Vec::new(),
                        picture: None,
                        dropped_by: String::new(),
                    },
                });
                changes.push(Change::Anchored { thread_id: id.clone(), thought_id: thought_id.into(), quote: quote.clone() });
                id
            }
        };
        let thought = Thought {
            id: format!("th-{}", uuid::Uuid::new_v4().simple()),
            speaker: speaker.into(),
            text: text.into(),
            point: String::new(),
            thread_id: Some(thread_id.clone()),
            placed: false,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: now,
            place_ms: None,
            decided: false,
        };
        let id = thought.id.clone();
        changes.push(Change::ThoughtAdded { thought });
        // Placed as said: the words are the note's own, so no model reads them into a point.
        changes.push(Change::ThoughtPlaced {
            thought_id: id,
            thread_id: thread_id.clone(),
            point: text.into(),
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            place_ms: 0,
            decided: crate::decided::said(text),
        });
        changes.push(Change::ThreadTouched { thread_id: thread_id.clone(), last_point: text.into(), at_ms: now });
        drop(world);
        let still = |w: &World| {
            home(w, thought_id).is_some()
                && tangent(w, thought_id, &quote) == found
                && match &found {
                    Some(id) => w.thread(id).is_some(),
                    None => w.thread(&thread_id).is_none() && !w.merged.contains_key(&thread_id),
                }
        };
        if core.commit_speaking(still, changes, speak) {
            return Ok(thread_id);
        }
    }
    Err(GONE)
}

/// The thread a note on thought `thought_id` goes under: the thread its point is on, while it's placed and on the map.
fn home(world: &World, thought_id: &str) -> Option<String> {
    let thought = world.thoughts.iter().find(|t| t.id == thought_id && t.placed)?;
    let thread = world.resolve(thought.thread_id.as_deref()?);
    world.thread(&thread).map(|t| t.id.clone())
}

/// The note already on these words, if one is on the map: the first, in the map's order.
fn tangent(world: &World, thought_id: &str, quote: &str) -> Option<String> {
    world
        .threads
        .iter()
        .find(|t| world.anchors.get(&t.id).is_some_and(|a| a.thought_id == thought_id && a.quote == quote))
        .map(|t| t.id.clone())
}

/// An id for a note's thread, apart from the placer's "T…" and the spoken pack's "S…" (spoken.rs `fresh_id`): a
/// placement still waiting on the model counts from the map it was asked with.
fn fresh_id(world: &World) -> String {
    let mut n = world.threads_made() + 1;
    loop {
        let id = format!("N{n}");
        if world.thread(&id).is_none() && !world.merged.contains_key(&id) {
            return id;
        }
        n += 1;
    }
}

/// A note's thread is titled with the words it's about: their first few, a "…" when there are more.
fn title_of(quote: &str) -> String {
    let words: Vec<&str> = quote.split_whitespace().collect();
    let title = words.iter().take(TITLE_WORDS).copied().collect::<Vec<_>>().join(" ");
    let title = crate::spoken::capital(title.trim_matches(|c: char| !c.is_alphanumeric() && c != '…'));
    let title = if title.is_empty() { crate::spoken::capital(quote) } else { title };
    let clipped: String = title.chars().take(crate::protocol::TITLE_MAX - 1).collect();
    if words.len() > TITLE_WORDS || clipped.len() < title.len() { format!("{clipped}…") } else { clipped }
}

/// One line, as a quote shows: runs of spaces and line breaks as one space.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests;
