//! Tests for margin notes (annotate.rs): the first note on words starts their tangent under the point's thread, tied
//! to those words, a later one answers in it; every window is sent it, a restart opens it, and the snapshot carries
//! the anchors; nobody moves and no model is asked; refused with the reason, to the asker only, with nothing kept.

use super::*;
use crate::protocol::{ClientMsg, Outgoing, ServerMsg};
use crate::world::fixtures::{thought, thread};
use crate::world::Journal;
use serde_json::{json, Value};

/// T1 (Rent) holds a and b, T2 (Garden) holds c; you're on T2; journaled to a file of its own.
struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
    queue: tokio::sync::mpsc::UnboundedReceiver<crate::placer::Job>,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-annotate-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        // A key, so a thought that went to the placer would be queued there: none may.
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        let core = Arc::new(Core { placer_queue, key: Some("test".into()), ..Core::test(journal, world) });
        core.commit(vec![
            Change::ThreadAdded { thread: thread("T1", "Rent", 1) },
            Change::ThreadAdded { thread: thread("T2", "Garden", 2) },
            Change::ThoughtAdded { thought: thought("a", "T1", "The rent is due Friday and the lease ends in March", 3) },
            Change::ThoughtAdded { thought: thought("b", "T1", "Ask about the deposit", 4) },
            Change::ThoughtAdded { thought: thought("c", "T2", "Plant the beans", 5) },
            Change::ActiveChanged { thread_id: "T2".into(), speaker: "you".into() },
        ]);
        Self { core, path, queue }
    }

    /// The map a restart opens.
    fn replayed(&self) -> World {
        Journal::open(&self.path).unwrap().1
    }

    fn journaled(&self) -> String {
        std::fs::read_to_string(&self.path).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[test]
fn never_split_while_pinned_and_comments_can_attach_immediately() {
    let mut f = Fixture::new();
    assert!(crate::stay::set(&f.core, "you", Some("T1")));
    let text = "Um, keep the wall blue, and rent is due Friday.";
    let mut ids = Vec::new();
    for n in 0..12 {
        let id = f.core.keep(if n % 2 == 0 { "you" } else { "Colleague" }, text);
        // No placer tick or model response between arrival and the bridge's comment.
        if [0, 2, 5, 8, 11].contains(&n) {
            let thread = note(&f.core, "Helper", &id, text, "Which shade of blue?").unwrap();
            assert_eq!(f.core.snapshot().anchors[&thread].thought_id, id);
        }
        ids.push(id);
    }
    let world = f.core.snapshot();
    let kept = world.thoughts.iter().filter(|t| ids.contains(&t.id)).collect::<Vec<_>>();
    assert_eq!(kept.iter().map(|t| &t.id).collect::<Vec<_>>(), ids.iter().collect::<Vec<_>>());
    for thought in kept {
        assert!(thought.placed);
        assert_eq!(thought.thread_id.as_deref(), Some("T1"));
        assert_eq!(thought.text, text);
        assert_eq!(thought.point, text);
    }
    assert_eq!(world.anchors.len(), 5);
    assert!(f.queue.try_recv().is_err(), "neither thoughts nor comments need the model");
    assert!(!f.journaled().contains("\"type\":\"thought_split\""));
}

/// What the windows were sent since `updates` began, as JSON with whom each was for (none: every window).
fn told(updates: &mut tokio::sync::broadcast::Receiver<Outgoing>) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(o) = updates.try_recv() {
        out.push(json!({ "to": o.to, "message": o.message }));
    }
    out
}

/// A note thread's notes, oldest first, as (speaker, words).
fn notes(world: &World, thread_id: &str) -> Vec<(String, String)> {
    world.thoughts.iter().filter(|t| t.thread_id.as_deref() == Some(thread_id)).map(|t| (t.speaker.clone(), t.point.clone())).collect()
}

#[tokio::test]
async fn a_note_starts_a_tangent_tied_to_its_words_for_every_window_and_a_restart() {
    let mut f = Fixture::new();
    let mut updates = f.core.updates.subscribe();
    let id = note(&f.core, "you", "a", "the lease\n ends in March", "  Is it month to month after that?  ").unwrap();
    let world = f.core.snapshot();
    let tangent = world.thread(&id).expect("its thread is on the map");
    assert_eq!(tangent.parent_id.as_deref(), Some("T1"), "under the point's thread");
    assert_eq!(tangent.title, "The lease ends in March");
    assert_eq!(world.anchors[&id], Anchor { thought_id: "a".into(), quote: "the lease ends in March".into(), context: Some(resolve(world.thoughts.iter().find(|t| t.id == "a").unwrap(), "the lease ends in March", None).unwrap()) }, "tied to the words, as one line");
    assert_eq!(notes(&world, &id), [("you".to_string(), "Is it month to month after that?".to_string())]);
    let placed = world.thoughts.iter().find(|t| t.thread_id.as_deref() == Some(id.as_str())).unwrap();
    assert!(placed.placed && placed.complete && placed.place_ms == Some(0), "placed as said, by rule");
    assert_eq!(world.active_for("you").map(String::as_str), Some("T2"), "the note leaves you where you were");
    // Every window is sent each change, in the journal's order.
    let sent: Vec<String> = told(&mut updates).iter().map(|m| {
        assert_eq!(m["to"], Value::Null, "to every window");
        m["message"]["change"]["type"].as_str().unwrap().to_string()
    }).collect();
    assert_eq!(sent, ["thread_added", "anchored", "thought_added", "thought_placed", "thread_touched"]);
    // A restart opens it, and a window's snapshot carries the anchor.
    assert_eq!(serde_json::to_value(&f.replayed().anchors).unwrap(), serde_json::to_value(&world.anchors).unwrap());
    let snapshot = serde_json::to_value(ServerMsg::Snapshot { world: f.core.snapshot() }).unwrap();
    assert_eq!(snapshot["world"]["anchors"][&id], serde_json::to_value(&world.anchors[&id]).unwrap());
    assert!(f.queue.try_recv().is_err(), "no model is asked");
}

#[tokio::test]
async fn a_later_note_on_the_same_words_answers_in_it_and_other_words_start_their_own() {
    let f = Fixture::new();
    let first = note(&f.core, "you", "a", "the lease ends in March", "Month to month after?").unwrap();
    // The Friend, over the bridge, answers on the same words: the same tangent, its name on the reply.
    let reply = note(&f.core, "Friend", "a", "the lease  ends in March", "Yes, at the same rent.").unwrap();
    assert_eq!(reply, first);
    let other = note(&f.core, "Colleague", "a", "due Friday", "Which Friday?").unwrap();
    assert_ne!(other, first, "other words of the same point: a note of their own");
    let world = f.core.snapshot();
    assert_eq!(notes(&world, &first), [("you".into(), "Month to month after?".into()), ("Friend".into(), "Yes, at the same rent.".into())]);
    assert_eq!(world.thread(&first).unwrap().last_point, "Yes, at the same rent.", "the card says the latest");
    assert_eq!(world.threads.iter().filter(|t| t.parent_id.as_deref() == Some("T1")).count(), 2);
    // Ids apart from the placer's and the spoken pack's.
    assert!(first.starts_with('N') && other.starts_with('N'), "{first} {other}");
    // A long quote titles its thread with its first words.
    f.core.commit(vec![Change::ThoughtRepointed { thought_id: "c".into(), point: "Plant the beans before the frost comes in late October".into() }]);
    let long = note(&f.core, "you", "c", "Plant the beans before the frost comes in late October", "Too late?").unwrap();
    assert_eq!(f.core.snapshot().thread(&long).unwrap().title, "Plant the beans before the frost…");
}

#[tokio::test]
async fn a_note_is_refused_with_its_reason_and_nothing_is_kept() {
    let f = Fixture::new();
    let before = f.journaled();
    assert_eq!(note(&f.core, "you", "a", "  ", "A note"), Err(NO_WORDS));
    assert_eq!(note(&f.core, "you", "a", "the lease", " \n "), Err(NO_WORDS));
    assert_eq!(note(&f.core, "you", "a", "the lease", &"x".repeat(THOUGHT_MAX + 1)), Err(TOO_LONG));
    assert_eq!(note(&f.core, "you", "a", &"y".repeat(THOUGHT_MAX + 1), "Long quote"), Err(TOO_LONG));
    assert_eq!(note(&f.core, "you", "nope", "the lease", "Gone?"), Err(GONE));
    assert_eq!(f.journaled(), before, "nothing journaled for a refusal");
    // A thought still finding its place has no point to note on yet.
    f.core.commit(vec![Change::ThoughtAdded { thought: Thought { placed: false, ..thought("d", "T1", "Call the landlord", 6) } }]);
    let before_d = f.journaled();
    assert_eq!(note(&f.core, "you", "d", "the landlord", "Today?"), Err(GONE));
    assert_eq!(f.journaled(), before_d, "nothing journaled for a refusal");
    assert!(f.core.snapshot().anchors.is_empty());
    // At the caps, it goes.
    assert!(note(&f.core, "you", "a", "the lease", &"z".repeat(THOUGHT_MAX)).is_ok());
}

#[tokio::test]
async fn a_note_follows_its_point_through_a_merge_and_its_anchor_comes_back_with_its_thread() {
    let f = Fixture::new();
    // The point's thread merged away: the note goes under the thread it went into.
    f.core.commit(vec![Change::ThreadMerged { from: "T1".into(), into: "T2".into() }]);
    let id = note(&f.core, "you", "a", "the lease", "Still March?").unwrap();
    assert_eq!(f.core.snapshot().thread(&id).unwrap().parent_id.as_deref(), Some("T2"));
    // The note's own thread merged away and back: its anchor is still there, so it's a note again.
    f.core.commit(vec![Change::ThreadMerged { from: id.clone(), into: "T2".into() }]);
    assert!(f.core.snapshot().thread(&id).is_none());
    let again = note(&f.core, "you", "a", "the lease", "A new note").unwrap();
    assert_ne!(again, id, "a note on the map takes the words while the first is merged away");
    assert_eq!(f.core.snapshot().anchors[&id].quote, "the lease", "kept for an Undo");
}

/// The window's message, as the protocol reads it.
#[test]
fn the_window_sends_it_as_annotate() {
    let msg: ClientMsg = serde_json::from_value(json!({ "type": "annotate", "thought_id": "a", "quote": "the lease", "text": "Month to month?" })).unwrap();
    assert!(matches!(msg, ClientMsg::Annotate { thought_id, quote, text, speak: false, context: None } if thought_id == "a" && quote == "the lease" && text == "Month to month?"));
}

#[test]
fn only_the_live_comment_carries_speech_and_the_journal_never_does() {
    let f = Fixture::new();
    note(&f.core, "Helper", "a", "the lease", "An older comment.").unwrap();
    let mut updates = f.core.updates.subscribe();
    let thread = note_speaking(&f.core, "Helper", "a", "the lease", "The new reply.", true).unwrap();
    let mut spoken = Vec::new();
    while let Ok(out) = updates.try_recv() {
        if out.speak {
            if let ServerMsg::Change { change: Change::ThoughtAdded { thought } } = out.message {
                spoken.push(thought.text);
            }
        }
    }
    assert_eq!(spoken, ["The new reply."]);
    assert_eq!(notes(&f.replayed(), &thread).len(), 2);
    assert!(!f.journaled().contains("\"speak\""), "speech is live delivery, never saved for replay");
    let msg: ClientMsg = serde_json::from_value(json!({ "type": "annotate", "thought_id": "a", "quote": "the lease", "text": "The new reply.", "speak": true })).unwrap();
    assert!(matches!(msg, ClientMsg::Annotate { speak: true, .. }));
}


#[test]
fn exact_occurrence_and_source_revision_survive_restart() {
    let mut f = Fixture::new();
    let source = "At the paper bridge, turn left; near the wooden gate, turn left.";
    let mut original = thought("repeat", "T1", source, 10);
    original.speaker = "speaker-b".into();
    f.core.commit(vec![Change::ThoughtAdded { thought: original }]);
    assert_eq!(note(&f.core, "speaker-a", "repeat", "turn left", "Use the wider path."), Err(AMBIGUOUS));
    let context = AnchorContext { source_text: source.into(), source_speaker: "speaker-b".into(), start: 54, end: 63 };
    let request: ClientMsg = serde_json::from_value(json!({"type":"annotate", "thought_id":"repeat", "quote":"turn left", "text":"Use the wider path.", "context": context})).unwrap();
    let ClientMsg::Annotate { context: Some(request_context), .. } = request else { panic!("context missing") };
    let id = note_with_context(&f.core, "speaker-a", "repeat", "turn left", "Use the wider path.", false, Some(&request_context)).unwrap();
    assert_eq!(f.replayed().anchors[&id].context, Some(context.clone()));
    assert_eq!(notes(&f.replayed(), &id), [("speaker-a".into(), "Use the wider path.".into())]);
    assert_eq!(f.replayed().thoughts.iter().find(|t| t.id == "repeat").unwrap().speaker, "speaker-b");
    // A different occurrence starts a separate thread.
    let first = AnchorContext { start: 21, end: 30, ..context.clone() };
    assert_ne!(note_with_context(&f.core, "speaker-a", "repeat", "turn left", "First.", false, Some(&first)).unwrap(), id);
    f.core.commit(vec![Change::ThoughtRepointed { thought_id: "repeat".into(), point: "At the paper bridge, turn left.".into() }]);
    assert_eq!(f.replayed().anchors[&id].context, Some(context));
    assert!(f.queue.try_recv().is_err());
}

#[test]
fn unicode_offsets_are_code_points_and_invalid_ranges_are_refused() {
    let f = Fixture::new();
    let source = "🧭 café turn left; 路 turn left.";
    let original = thought("unicode", "T1", source, 10);
    let speaker = original.speaker.clone();
    f.core.commit(vec![Change::ThoughtAdded { thought: original }]);
    let start = source.chars().collect::<String>().rfind("turn left").map(|byte| source[..byte].chars().count()).unwrap();
    let c = AnchorContext { source_text: source.into(), source_speaker: speaker, start, end: start + 9 };
    assert!(note_with_context(&f.core, "speaker-a", "unicode", "turn left", "Here.", false, Some(&c)).is_ok());
    let wrong = AnchorContext { start: start + 1, ..c.clone() };
    assert_eq!(note_with_context(&f.core, "speaker-a", "unicode", "turn left", "No.", false, Some(&wrong)), Err(UNRESOLVED));
    let wrong = AnchorContext { source_text: "changed".into(), ..c };
    assert_eq!(note_with_context(&f.core, "speaker-a", "unicode", "turn left", "No.", false, Some(&wrong)), Err(UNRESOLVED));
}

#[test]
fn legacy_journal_defaults_do_not_invent_an_ambiguous_occurrence() {
    let f = Fixture::new();
    let mut w = f.replayed();
    w.apply(&Change::ThoughtAdded { thought: thought("legacy", "T1", "turn left then turn left", 20) });
    let old: Change = serde_json::from_value(json!({"type":"anchored", "thread_id":"T2", "thought_id":"legacy", "quote":"turn left"})).unwrap();
    w.apply(&old);
    assert!(w.anchors["T2"].context.is_none());
    w.apply(&Change::ThoughtRepointed { thought_id: "legacy".into(), point: "turn left".into() });
    w.apply(&old);
    assert!(w.anchors["T2"].context.is_none());
    let mut unique = f.replayed();
    unique.apply(&serde_json::from_value(json!({"type":"anchored", "thread_id":"T2", "thought_id":"a", "quote":"the lease"})).unwrap());
    assert!(unique.anchors["T2"].context.is_some());
}
