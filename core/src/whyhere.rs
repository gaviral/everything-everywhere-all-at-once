//! Why here, on request: why a thought is on its thread, for a point or a "While you were away" row that has no
//! reason kept with it. Most need no model: the placer's own reason (chunks.rs `Note::why`), a move the person made,
//! or a thought that started its thread each answer it from the map. Only the rest (the placer's reason named an id,
//! or the thought came from an import or an older journal) asks the fastest model setting, once: the answer is
//! journaled as the thought's note, marked `later`, so every window and a replay show it without asking again.

use crate::chunks::Note;
use crate::protocol::ServerMsg;
use crate::world::{Change, World};
use crate::Core;
use anyhow::bail;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "A spoken thought sits on one thread of the person's live map of their thoughts. Say why it \
belongs on that thread, in at most 10 words, naming the words that show it, such as \"names the lease\" or \"the \
budget part of the trip\". Never an id, never a full sentence of explanation, no period. If it doesn't clearly \
belong, say what it shares with the thread anyway. Plain text, in the language of the notes.";

/// The person asked and is looking at the row; past this the answer has missed its moment and they can ask again.
const PATIENCE: Duration = Duration::from_secs(15);

/// What a hand move says: the person's own choice is the reason.
pub const MOVED: &str = "you moved it here";
/// What the first thought of a thread says: it is why the thread exists.
pub const STARTED: &str = "started this thread";

/// Thoughts whose reason is being asked now, with who waits for it: a second ask while one is out spends nothing,
/// and its speaker gets the same answer (or failure) as the first.
static ASKING: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// Joins the ask for `thought_id`: true for the first speaker, who asks the model; later ones only wait on it.
fn join(thought_id: &str, speaker: &str) -> bool {
    let mut asking = ASKING.lock().unwrap();
    let asking = asking.get_or_insert_with(HashMap::new);
    match asking.get_mut(thought_id) {
        Some(waiting) => {
            if !waiting.iter().any(|s| s == speaker) {
                waiting.push(speaker.into());
            }
            false
        }
        None => {
            asking.insert(thought_id.into(), vec![speaker.into()]);
            true
        }
    }
}

/// Ends the ask for `thought_id`: everyone who waited on it, the asker first.
fn waiters(thought_id: &str) -> Vec<String> {
    ASKING.lock().unwrap().get_or_insert_with(HashMap::new).remove(thought_id).unwrap_or_default()
}

/// Whether a model answer asked about `thought_id` on `thread` may still be kept: it's still there, and the map
/// still can't say why itself (no reason given meanwhile, no move of theirs, even one that came back to `thread`).
fn still_unexplained(w: &World, thought_id: &str, thread: &str) -> bool {
    w.thoughts.iter().any(|t| t.id == thought_id && t.thread_id.as_deref().is_some_and(|id| w.resolve(id) == thread))
        && known(w, thought_id).is_none()
}

/// The reason the map already holds for `thought_id`, if any; `None` when only a model can say.
pub fn known(world: &World, thought_id: &str) -> Option<String> {
    let thought = world.thoughts.iter().find(|t| t.id == thought_id && t.placed)?;
    let on = world.resolve(thought.thread_id.as_deref()?);
    if let Some(why) = world.notes.get(thought_id).map(|n| n.why.trim()).filter(|w| !w.is_empty()) {
        return Some(why.to_string());
    }
    // A move of theirs not taken back (an undone move leaves `moves`), to where it still is.
    if world.moves.iter().rev().find(|(id, _, _)| id == thought_id).is_some_and(|(_, _, to)| world.resolve(to) == on) {
        return Some(MOVED.into());
    }
    let first = world.thoughts.iter().find(|t| t.placed && t.thread_id.as_deref().is_some_and(|id| world.resolve(id) == on));
    if first.is_some_and(|t| t.id == thought_id) {
        let parent = world.thread(&on).and_then(|t| t.parent_id.as_deref()).and_then(|p| world.thread(&world.resolve(p)));
        return Some(match parent {
            Some(p) => format!("started this tangent from {}", p.title),
            None => STARTED.into(),
        });
    }
    None
}

/// Answers a window's "Why here?": from the map when it can, else from the model, journaled as the thought's note.
pub async fn run(core: Arc<Core>, speaker: String, thought_id: String) {
    let world = core.snapshot();
    let reply = |text: String, failed: bool| ServerMsg::WhyHere { thought_id: thought_id.clone(), text, failed };
    if let Some(why) = known(&world, &thought_id) {
        core.send_to(&speaker, reply(why, false));
        return;
    }
    let Some((notes, thread)) = prompt(&world, &thought_id) else {
        core.send_to(&speaker, reply("It isn't on a thread yet.".into(), true));
        return;
    };
    drop(world);
    if !join(&thought_id, &speaker) {
        return;
    }
    let answer = ask(&core, &notes).await.and_then(|text| {
        let why = clean(&text);
        if why.is_empty() { bail!("no usable reason in {text:?}") } else { Ok(why) }
    });
    let msg = match answer {
        Ok(why) => {
            // Only while it's still where it was asked about and the map still can't say why: a move or a new
            // reason since makes this one stale.
            let note = core.snapshot().notes.get(&thought_id).cloned().unwrap_or_default();
            let change = Change::ThoughtNoted { thought_id: thought_id.clone(), note: Note { why: why.clone(), later: true, ..note } };
            if core.commit_if(|w| still_unexplained(w, &thought_id, &thread), vec![change]) {
                reply(why, false)
            } else {
                // Moved, or given a reason, while the model thought: say what the map says now.
                let now = known(&core.snapshot(), &thought_id);
                let failed = now.is_none();
                reply(now.unwrap_or_else(|| "It moved while asking. Ask again.".into()), failed)
            }
        }
        Err(e) => {
            tracing::warn!("why here failed: {e:#}");
            let text = if core.key.is_none() {
                "Saying why needs the AI key.".into()
            } else if core.key_refused() {
                crate::model::REFUSED.into()
            } else if let Some(capped) = core.capped_message() {
                capped
            } else {
                "Couldn't say why just now.".into()
            };
            reply(text, true)
        }
    };
    for waiting in waiters(&thought_id) {
        core.send_to(&waiting, msg.clone());
    }
}

/// What the model reads: the thread (and the one it branched from) with its other points, the other threads'
/// titles to tell it apart from, and the thought's own words. With the resolved thread id, to check the answer
/// still applies. No ids go in, so none come out.
fn prompt(world: &World, thought_id: &str) -> Option<(String, String)> {
    let thought = world.thoughts.iter().find(|t| t.id == thought_id && t.placed)?;
    let on = world.resolve(thought.thread_id.as_deref()?);
    let thread = world.thread(&on)?;
    let mut notes = String::new();
    let others: Vec<&str> = world.threads.iter().rev().filter(|t| t.id != on).take(30).map(|t| t.title.as_str()).collect();
    if !others.is_empty() {
        notes += &format!("Other threads: {}\n", others.join("; "));
    }
    notes += &format!("Thread: {}\n", thread.title);
    if let Some(parent) = thread.parent_id.as_deref().and_then(|p| world.thread(&world.resolve(p))) {
        notes += &format!("A tangent from: {}\n", parent.title);
    }
    let points: Vec<&str> = world
        .thoughts
        .iter()
        .filter(|t| t.placed && t.id != thought_id && t.thread_id.as_deref().is_some_and(|id| world.resolve(id) == on))
        .map(|t| t.point.as_str())
        .collect();
    for point in &points[points.len().saturating_sub(12)..] {
        notes += &format!("- {point}\n");
    }
    let words: String = thought.text.chars().take(600).collect();
    notes += &format!("The thought: \"{}\" (said: \"{words}\")", thought.point);
    Some((notes, on))
}

/// The answer as a glance: one line, at most `chunks::WHY_WORDS` words, no closing period; nothing when it names an id
/// (the same rule as the placer's reason, chunks.rs `why_here`) or says nothing.
fn clean(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default();
    let line = line.trim_matches(|c: char| c == '"' || c == '“' || c == '”').trim().trim_end_matches('.');
    let line = line.strip_prefix("Why here:").map(str::trim).unwrap_or(line);
    let why = crate::chunks::note(None, "", line, false).why;
    let id = why.split(|c: char| !c.is_alphanumeric()).any(|w| {
        let mut chars = w.chars();
        matches!(chars.next(), Some('T' | 'S' | 'I')) && w.len() > 1 && chars.all(|c| c.is_ascii_digit())
    });
    if id { String::new() } else { why }
}

async fn ask(core: &Core, notes: &str) -> anyhow::Result<String> {
    let body = |model: &str| {
        json!({
            "model": model,
            "reasoning_effort": "minimal",
            // Reasoning counts toward the cap (explain.rs): a tight one leaves no answer.
            "max_tokens": 800,
            "prompt_cache_key": "e2a2o-whyhere",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": notes},
            ],
        })
    };
    let value = core.ask_model(&core.placer_model, URL, PATIENCE, body, serde_json::Value::Null).await?;
    let text = value["choices"][0]["message"]["content"].as_str().unwrap_or_default().trim();
    if text.is_empty() {
        bail!("no answer ({})", value["choices"][0]["finish_reason"].as_str().unwrap_or("no reason given"));
    }
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::{clean, join, known, prompt, still_unexplained, waiters, MOVED, STARTED};
    use crate::chunks::Note;
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

    fn thread(id: &str, title: &str, parent: Option<&str>) -> Change {
        Change::ThreadAdded {
            thread: Thread {
                id: id.into(),
                title: title.into(),
                parent_id: parent.map(Into::into),
                status: ThreadStatus::Open,
                last_point: String::new(),
                touched_ms: 0,
                tags: vec![],
                picture: None,
                dropped_by: String::new(),
            },
        }
    }

    fn said(id: &str, thread: &str, point: &str) -> Change {
        Change::ThoughtAdded {
            thought: Thought {
                id: id.into(),
                speaker: "you".into(),
                text: format!("words of {point}"),
                point: point.into(),
                thread_id: Some(thread.into()),
                placed: true,
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                at_ms: 0,
                place_ms: None,
                decided: false,
            },
        }
    }

    fn map() -> World {
        let mut w = World::default();
        for c in [
            thread("T1", "Apartment lease", None),
            thread("T2", "Trip to Lisbon", None),
            thread("T3", "Trip budget", Some("T2")),
            said("a", "T1", "Lease ends in March"),
            said("b", "T1", "Ask the landlord about the deposit"),
            said("c", "T2", "Fly out on the 12th"),
            said("d", "T3", "Hotels run about 900 euros"),
            said("e", "T2", "Book the walking tour"),
        ] {
            w.apply(&c);
        }
        w
    }

    /// Each kind the map can answer without a model, and none it can't.
    #[test]
    fn the_map_answers_most_without_a_model() {
        let mut w = map();
        assert_eq!(known(&w, "a").as_deref(), Some(STARTED), "the first thought started its thread");
        assert_eq!(known(&w, "d").as_deref(), Some("started this tangent from Trip to Lisbon"));
        assert_eq!(known(&w, "b"), None, "a later thought with no reason needs the model");
        w.apply(&Change::ThoughtNoted { thought_id: "b".into(), note: Note { why: "names the deposit".into(), ..Note::default() } });
        assert_eq!(known(&w, "b").as_deref(), Some("names the deposit"), "the placer's reason wins");
        // Moved by hand: their choice is the reason; taken back, it's the model's question again.
        w.apply(&Change::ThoughtMoved { thought_id: "e".into(), thread_id: "T1".into(), from: "T2".into(), undo: false });
        assert_eq!(known(&w, "e").as_deref(), Some(MOVED));
        w.apply(&Change::ThoughtMoved { thought_id: "e".into(), thread_id: "T2".into(), from: "T1".into(), undo: true });
        assert_eq!(known(&w, "e"), None);
        assert_eq!(known(&w, "nope"), None);
    }

    /// A merge follows: the thread a thought now sits on is the one asked about, and its first thought stays first.
    #[test]
    fn merges_are_followed() {
        let mut w = map();
        w.apply(&Change::ThreadMerged { from: "T3".into(), into: "T2".into() });
        assert_eq!(known(&w, "c").as_deref(), Some(STARTED));
        assert_eq!(known(&w, "d"), None, "no longer the first on the thread it's on");
        let (notes, on) = prompt(&w, "d").unwrap();
        assert_eq!(on, "T2");
        assert!(notes.contains("Thread: Trip to Lisbon") && notes.contains("- Fly out on the 12th"), "{notes}");
    }

    /// What the model reads names threads and points, never an id, and leaves the thought itself out of the list.
    #[test]
    fn the_prompt_carries_no_ids() {
        let (notes, on) = prompt(&map(), "e").unwrap();
        assert_eq!(on, "T2");
        assert!(!notes.contains("T1") && !notes.contains("T2") && !notes.contains("T3"), "{notes}");
        assert!(notes.contains("Other threads: Trip budget; Apartment lease"), "{notes}");
        assert!(notes.ends_with("The thought: \"Book the walking tour\" (said: \"words of Book the walking tour\")"), "{notes}");
        assert_eq!(notes.matches("Book the walking tour").count(), 2, "only as the thought, not as a point too");
    }

    /// An answer is a glance: one line, cut to the placer's 10 words, and none that names an id.
    #[test]
    fn answers_are_cleaned_like_the_placers() {
        assert_eq!(clean("\"names the walking tour.\""), "names the walking tour");
        assert_eq!(clean("Why here: plans for the trip itself\nmore text"), "plans for the trip itself");
        assert_eq!(clean("one two three four five six seven eight nine ten eleven"), "one two three four five six seven eight nine ten");
        assert_eq!(clean("matches T2 travel"), "");
        assert_eq!(clean("none"), "");
        assert_eq!(clean("   "), "");
    }

    /// The asked reason is kept on the thought as a note marked `later`, so a replay shows it with no new call,
    /// and an older journal's note (no `later`) still reads.
    #[test]
    fn an_asked_reason_is_journaled_and_replays() {
        let note = Note { why: "names the walking tour".into(), later: true, ..Note::default() };
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json, serde_json::json!({"why": "names the walking tour", "later": true}));
        let old: Note = serde_json::from_value(serde_json::json!({"why": "names the lease"})).unwrap();
        assert!(!old.later);
        let path = std::env::temp_dir().join(format!("e2a2o-whyhere-{}.jsonl", uuid::Uuid::new_v4()));
        {
            let (journal, _) = crate::world::Journal::open(&path).unwrap();
            let core = crate::Core::test(journal, World::default());
            let mut changes = vec![thread("T1", "Apartment lease", None)];
            changes.extend([said("a", "T1", "Lease ends in March"), said("b", "T1", "Ask about the deposit")]);
            changes.push(Change::ThoughtNoted { thought_id: "b".into(), note: note.clone() });
            core.commit(changes);
        }
        let (_, replayed) = crate::world::Journal::open(&path).unwrap();
        assert_eq!(replayed.notes["b"], note);
        assert_eq!(known(&replayed, "b").as_deref(), Some("names the walking tour"));
    }

    /// An answer that comes back after a move there and back again is dropped: "you moved it here" is the reason,
    /// and a kept model answer would win over it in every window and replay.
    #[test]
    fn a_late_answer_never_overwrites_a_move() {
        let mut w = map();
        assert!(still_unexplained(&w, "e", "T2"), "nothing said why: keep the answer");
        w.apply(&Change::ThoughtMoved { thought_id: "e".into(), thread_id: "T1".into(), from: "T2".into(), undo: false });
        assert!(!still_unexplained(&w, "e", "T2"), "moved away");
        w.apply(&Change::ThoughtMoved { thought_id: "e".into(), thread_id: "T2".into(), from: "T1".into(), undo: false });
        assert_eq!(known(&w, "e").as_deref(), Some(MOVED));
        assert!(!still_unexplained(&w, "e", "T2"), "moved back by hand: the move is the reason");
        w.apply(&Change::ThoughtNoted { thought_id: "b".into(), note: Note { why: "names the deposit".into(), ..Note::default() } });
        assert!(!still_unexplained(&w, "b", "T1"), "given a reason meanwhile");
    }

    /// A second speaker asking while one ask is out waits on it and gets its answer, failure included.
    #[test]
    fn every_waiter_hears_back() {
        let id = format!("waiters-{}", uuid::Uuid::new_v4());
        assert!(join(&id, "Ana"), "the first asks");
        assert!(!join(&id, "Ben"), "the second waits");
        assert!(!join(&id, "Ana"), "asking again waits too");
        assert_eq!(waiters(&id), ["Ana", "Ben"]);
        assert!(join(&id, "Ben"), "once answered, a new ask asks again");
        assert_eq!(waiters(&id), ["Ben"]);
    }
}
