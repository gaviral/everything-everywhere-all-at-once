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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<AnchorContext>,
}

/// Immutable source revision and a half-open Unicode code-point range, never byte offsets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnchorContext {
    pub source_text: String,
    pub source_speaker: String,
    pub start: usize,
    pub end: usize,
}

pub const AMBIGUOUS: &str = "Those words occur more than once. Select the exact occurrence to reply.";
pub const UNRESOLVED: &str = "The selected source revision is unavailable. Select the words again.";

/// Resolve legacy requests only when unique; freeze the source before any later edits.
pub fn resolve(thought: &Thought, quote: &str, context: Option<&AnchorContext>) -> Result<AnchorContext, &'static str> {
    if let Some(c) = context {
        if c.source_speaker != thought.speaker || (c.source_text != thought.point && c.source_text != thought.text)
            || c.start >= c.end || c.end > c.source_text.chars().count()
            || c.source_text.chars().skip(c.start).take(c.end - c.start).collect::<String>() != quote {
            return Err(UNRESOLVED);
        }
        return Ok(c.clone());
    }
    let source = if thought.point.is_empty() { &thought.text } else { &thought.point };
    let hits: Vec<_> = source.char_indices().filter(|(i, _)| source[*i..].starts_with(quote)).map(|(i, _)| i).collect();
    match hits.as_slice() {
        [at] => {
            let start = source[..*at].chars().count();
            Ok(AnchorContext { source_text: source.clone(), source_speaker: thought.speaker.clone(), start, end: start + quote.chars().count() })
        }
        [] => Err(UNRESOLVED),
        _ => Err(AMBIGUOUS),
    }
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
    note_with_context(core, speaker, thought_id, quote, text, speak, None)
}

pub fn note_with_context(core: &Arc<Core>, speaker: &str, thought_id: &str, quote: &str, text: &str, speak: bool, context: Option<&AnchorContext>) -> Result<String, &'static str> {
    let quote = if context.is_some() { quote.to_owned() } else { one_line(quote) };
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
        let source = world.thoughts.iter().find(|t| t.id == thought_id).ok_or(GONE)?;
        let context = resolve(source, &quote, context)?;
        let anchor = Anchor { thought_id: thought_id.into(), quote: quote.clone(), context: Some(context.clone()) };
        let found = tangent(&world, &anchor);
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
                changes.push(Change::Anchored { thread_id: id.clone(), thought_id: thought_id.into(), quote: quote.clone(), context: Some(context.clone()) });
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
                && w.thoughts.iter().find(|t| t.id == thought_id).is_some_and(|t| resolve(t, &quote, Some(&context)).is_ok())
                && tangent(w, &anchor) == found
                && match &found {
                    Some(id) => w.thread(id).is_some(),
                    None => w.thread(&thread_id).is_none() && !w.merged.contains_key(&thread_id),
                }
        };
        if core.commit_speaking(still, changes, speak).map_err(|_| "Couldn't save this note. Keep your words and try again.")? {
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
fn tangent(world: &World, anchor: &Anchor) -> Option<String> {
    world
        .threads
        .iter()
        .find(|t| world.anchors.get(&t.id).is_some_and(|a| a == anchor))
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


/// A connection's opt-in; never inferred from a command or another window of the same speaker.
#[derive(Default)]
pub struct PointReview {
    pub on: bool,
    pub epoch: u64,
    pub busy: bool,
}

impl PointReview {
    pub fn switch(&mut self, on: bool) { self.on = on; self.epoch += 1; self.busy = false; }
}

pub fn review_target(window: u64) -> String { format!("\0point-review:{window}") }

pub fn edit_point(core: &Core, gate: &PointReview, actor: &str, request_id: &str, thought_id: &str, observed: &str, replacement: &str, undo_of: Option<&str>) -> Result<(), &'static str> {
    if !gate.on { return Err("Review text edits is off."); }
    if !review_id(request_id) || observed.chars().count() > 6000 || !(if undo_of.is_some() { !replacement.trim().is_empty() && replacement.chars().count() <= 6000 } else { replacement_valid(replacement) }) {
        return Err("A replacement needs 1–1,200 characters and a valid request.");
    }
    let receipt = crate::world::PointEdit { request_id: request_id.into(), thought_id: thought_id.into(), old_point: observed.into(), new_point: replacement.into(), actor: actor.into(), undo_of: undo_of.map(String::from) };
    let already = || core.snapshot().point_edits.iter().find(|e| e.actor == actor && e.request_id == request_id)
        .map(|r| if r == &receipt { Ok(()) } else { Err("This request identity was already used. Keep the proposal for manual copy.") });
    if let Some(result) = already() { return result; }
    if let Some(id) = undo_of {
        if !core.snapshot().point_edits.iter().any(|e| e.request_id == id && e.actor == actor && e.thought_id == thought_id && e.new_point == observed && e.old_point == replacement && e.undo_of.is_none()) {
            return Err("That accepted edit is unavailable. Keep the proposal for manual copy.");
        }
    }
    let change = Change::PointEdited { request_id: request_id.into(), thought_id: thought_id.into(), old_point: observed.into(), new_point: replacement.into(), actor: actor.into(), undo_of: undo_of.map(String::from) };
    match core.try_commit_if(|w| !w.point_edits.iter().any(|e| e.actor == actor && e.request_id == request_id) && w.thoughts.iter().any(|t| t.id == thought_id && t.placed && t.point == observed && home(w, thought_id).is_some()), vec![change]) {
        Ok(true) => Ok(()),
        Ok(false) => already().unwrap_or(Err("That point changed or left the map. Keep the proposal for manual copy.")),
        Err(_) => Err("Couldn't save. Your proposal is still editable; retry explicitly."),
    }
}

pub fn review_id(id: &str) -> bool { !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') }
fn replacement_valid(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= 1200 && !text.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
}

pub fn shorter_source(core: &Core, thought_id: &str, observed: &str) -> Result<String, &'static str> {
    let world = core.snapshot();
    let t = world.thoughts.iter().find(|t| t.id == thought_id && t.placed && t.point == observed && home(&world, thought_id).is_some())
        .ok_or("That point changed or left the map. Keep your proposal for manual copy.")?;
    if t.point.chars().count() + t.text.chars().count() > 6000 { return Err("Point and original text exceed 6,000 characters. Type a proposal instead."); }
    Ok(t.text.clone())
}

#[cfg(test)]
mod c10_suggest_tests {
    use super::*;
    #[test]
    fn c10_suggest_journal_stale_retry_undo_and_identity() {
        let path = std::env::temp_dir().join(format!("c10-suggest-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = crate::Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        let seed = serde_json::json!({"threads":[{"id":"T1","title":"Synthetic topic","parent_id":null,"status":"open","last_point":"A longer point","touched_ms":20}],
            "thoughts":[{"id":"older","speaker":"speaker","text":"Synthetic original words","point":"A longer point","thread_id":"T1","placed":true,"unclear":"","at_ms":10,"place_ms":0},
            {"id":"newer","speaker":"speaker","text":"Other synthetic words","point":"A longer point","thread_id":"T1","placed":true,"unclear":"","at_ms":20,"place_ms":0}]});
        let seeded: World = serde_json::from_value(seed).unwrap();
        core.commit(seeded.threads.into_iter().map(|thread| Change::ThreadAdded {thread}).chain(seeded.thoughts.into_iter().map(|thought| Change::ThoughtAdded {thought})).collect());
        let before = core.snapshot();
        let mut gate = PointReview::default();
        assert!(edit_point(&core,&gate,"actor","one","older","A longer point","Short point",None).is_err());
        gate.switch(true);
        assert!(shorter_source(&core,"older","changed").is_err());
        assert!(edit_point(&core,&gate,"actor","one","older","A longer point","Short point",None).is_ok());
        let lines = std::fs::read_to_string(&path).unwrap().lines().count();
        assert!(edit_point(&core,&gate,"actor","one","older","A longer point","Short point",None).is_ok());
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), lines);
        assert!(edit_point(&core,&gate,"actor","one","older","A longer point","Different",None).is_err());
        let after = core.snapshot();
        assert_eq!(after.thoughts[0].id, before.thoughts[0].id);
        assert_eq!(after.thoughts[0].text, before.thoughts[0].text);
        assert_eq!(after.thoughts[0].speaker, before.thoughts[0].speaker);
        assert_eq!(after.thoughts[0].at_ms, before.thoughts[0].at_ms);
        assert_eq!(after.threads[0].last_point,"A longer point", "an older equal point is not the latest source");
        assert_eq!(after.threads[0].touched_ms,20);
        assert!(edit_point(&core,&gate,"actor","stale","older","A longer point","Must not win",None).is_err());
        assert!(edit_point(&core,&gate,"actor","undo","older","Short point","A longer point",Some("one")).is_ok());
        assert!(edit_point(&core,&gate,"actor","latest","newer","A longer point","Latest edit",None).is_ok());
        assert_eq!(core.snapshot().threads[0].last_point,"Latest edit");
        assert_eq!(core.snapshot().threads[0].touched_ms,20);
        assert!(edit_point(&core,&gate,"actor","late-undo","newer","A longer point","Wrong undo",None).is_err());
        let (_, replay) = crate::Journal::open(&path).unwrap();
        assert_eq!(replay.thoughts[1].point,"Latest edit");
        assert!(replay.point_edits.iter().any(|e| e.actor == "actor" && e.request_id == "latest"));
        gate.switch(false);
        assert!(edit_point(&core,&gate,"actor","off","newer","Latest edit","Off edit",None).is_err());
    }

    #[test]
    fn c10_suggest_bounds_and_default_off() {
        assert!(!PointReview::default().on);
        assert!(replacement_valid("A shorter point"));
        assert!(!replacement_valid(&"x".repeat(1201)));
        assert!(!replacement_valid("  "));
        assert!(!review_id("../request"));
    }
}
