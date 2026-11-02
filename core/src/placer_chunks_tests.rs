//! The placer's side of chunks.rs: a thought carrying on words cut off by a pause lands with them, linked; an
//! assumption is kept only when it moved the thought; every placement may carry a short why.

use super::{decide, request, settle, Placement, ROOM};
use crate::chunks::Note;
use crate::world::{Change, Thought, Thread, ThreadStatus, World};

fn thread(id: &str, title: &str) -> Thread {
    Thread {
        id: id.into(),
        title: title.into(),
        parent_id: None,
        status: ThreadStatus::Open,
        last_point: String::new(),
        touched_ms: 0,
        tags: Vec::new(),
        picture: None,
        dropped_by: String::new(),
    }
}

fn said(id: &str, text: &str, thread: &str, at_s: u64, complete: bool) -> Thought {
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
        complete,
        at_ms: at_s * 1000,
        place_ms: Some(1),
        decided: false,
    }
}

fn turn(text: &str, at_s: u64) -> Thought {
    Thought { placed: false, thread_id: None, point: String::new(), ..said("now", text, "", at_s, true) }
}

/// The demo's catch: "My biggest problem is that I never finish my" on T1, the bike on T2, "where was I?" back on T1.
fn catch() -> World {
    let mut w = World { threads: vec![thread("T1", "Never finishing things"), thread("T2", "Bike brakes")], ..World::default() };
    w.thoughts = vec![
        said("a", "My biggest problem is that I never finish my", "T1", 37, false),
        said("b", "Oh, and the bike needs new brakes before the weekend.", "T2", 43, true),
    ];
    w.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "you".into() });
    w
}

fn answer(value: serde_json::Value) -> Placement {
    serde_json::from_value(value).unwrap()
}

fn landed(changes: &[Change]) -> Option<&str> {
    changes.iter().find_map(|c| match c {
        Change::ThoughtPlaced { thread_id, .. } => Some(thread_id.as_str()),
        _ => None,
    })
}

fn noted(changes: &[Change]) -> Option<&Note> {
    changes.iter().find_map(|c| match c {
        Change::ThoughtNoted { note, .. } => Some(note),
        _ => None,
    })
}

#[test]
fn the_prompt_quotes_words_left_unfinished_and_asks_for_the_new_fields() {
    let body = request(&catch(), &turn("Sentences. I never finish my sentences.", 60), "m", ROOM, false);
    let prompt = body["messages"][1]["content"].as_str().unwrap();
    assert!(
        prompt.contains("Said just before (placed in T2): \"Oh, and the bike needs new brakes before the weekend.\"\nLeft unfinished (placed in T1): \"My biggest problem is that I never finish my\"\nNEW THOUGHT"),
        "{prompt}"
    );
    let required = body["response_format"]["json_schema"]["schema"]["required"].as_array().unwrap();
    for field in ["joins", "assumed", "why"] {
        assert!(required.iter().any(|r| r == field), "{field}");
    }
    // Nothing left unfinished: no line.
    let mut done = catch();
    done.thoughts[0].complete = true;
    let prompt = request(&done, &turn("Sentences.", 60), "m", ROOM, false)["messages"][1]["content"].as_str().unwrap().to_string();
    assert!(!prompt.contains("Left unfinished"), "{prompt}");
}

/// The model reads "Sentences." as finishing the words left unfinished but calls it a new topic: it lands with them,
/// linked, and no thread is made for half a sentence.
#[test]
fn a_thought_finishing_words_left_unfinished_lands_with_them_linked() {
    let world = catch();
    let said = turn("Sentences. I never finish my sentences.", 60);
    let reply = answer(serde_json::json!({"action": "new", "title": "Sentences", "point": "My biggest problem: I never finish my sentences",
        "joins": "unfinished", "why": "finishes \"I never finish my\""}));
    let changes = decide(&world, &said, reply, 900, false, true);
    assert_eq!(landed(&changes), Some("T1"));
    assert!(!changes.iter().any(|c| matches!(c, Change::ThreadAdded { .. })), "{changes:?}");
    let note = noted(&changes).unwrap();
    assert_eq!((note.continues.as_str(), note.why.as_str()), ("a", "finishes \"I never finish my\""));
    // Applied: T1 is open again with the whole idea as its last point.
    let mut after = World { thoughts: [world.thoughts.clone(), vec![said.clone()]].concat(), ..world.clone() };
    for c in &changes {
        after.apply(c);
    }
    assert_eq!(after.notes["now"].continues, "a");
    assert_eq!(after.thread("T1").unwrap().last_point, "My biggest problem: I never finish my sentences");
}

/// "The one on Main Street" right after naming the class: it goes with the class even when the answer names another
/// thread; not when the speaker asked for a new thread.
#[test]
fn a_fragment_pointing_back_goes_with_the_turn_before() {
    let mut world = World { threads: vec![thread("T1", "Mom's birthday"), thread("T2", "Rent")], ..World::default() };
    world.thoughts = vec![said("a", "I need to book that pottery class she mentioned.", "T1", 20, true)];
    world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "you".into() });
    let said = turn("The one on Main Street, I think it's like sixty bucks.", 26);
    let reply = || answer(serde_json::json!({"action": "return", "thread_id": "T2", "point": "Book Mom's pottery class on Main Street, about $60", "joins": "before"}));
    let changes = decide(&world, &said, reply(), 900, false, true);
    assert_eq!((landed(&changes), noted(&changes).map(|n| n.continues.as_str())), (Some("T1"), Some("a")));
    let asked = decide(&world, &said, reply(), 900, true, true);
    assert!(noted(&asked).is_none() && asked.iter().any(|c| matches!(c, Change::ThreadAdded { .. })), "{asked:?}");
    // "none", or a head that isn't there: placed as the answer says, no link.
    let plain = decide(&world, &said, answer(serde_json::json!({"action": "return", "thread_id": "T2", "joins": "none"})), 900, false, true);
    assert_eq!((landed(&plain), noted(&plain)), (Some("T2"), None));
    let alone = decide(&World { thoughts: Vec::new(), ..world.clone() }, &said, reply(), 900, false, true);
    assert_eq!((landed(&alone), noted(&alone)), (Some("T2"), None));
}

/// An assumption shows only when it took the thought away from where the speaker was.
#[test]
fn an_assumption_is_noted_only_when_it_moved_the_thought() {
    let mut world = World { threads: vec![thread("T1", "Mom's birthday"), thread("T2", "Bike brakes")], ..World::default() };
    world.apply(&Change::ActiveChanged { thread_id: "T2".into(), speaker: "you".into() });
    let said = turn("I should book it tonight if it's under eighty.", 90);
    let reply = |thread: &str| answer(serde_json::json!({"action": "return", "thread_id": thread, "assumed": "'it' is the pottery class", "joins": "none"}));
    let moved = decide(&world, &said, reply("T1"), 900, false, true);
    assert_eq!(noted(&moved).map(|n| n.assumed.as_str()), Some("'it' is the pottery class"));
    let stayed = decide(&world, &said, reply("T2"), 900, false, true);
    assert!(noted(&stayed).is_none(), "{stayed:?}");
}

/// A turn cut in two: the rest can't carry on its own first part, and a split's first part keeps its note.
#[test]
fn the_rest_of_a_split_turn_never_joins_its_own_first_part() {
    let said = turn("The dentist moved my cleaning to Thursday and also I should send Sam the slides", 10);
    let world = World { threads: vec![thread("T1", "Dentist")], thoughts: vec![said.clone()], ..World::default() };
    let reply = answer(serde_json::json!({"action": "continue", "thread_id": "T1", "point": "Cleaning moved to Thursday",
        "split": "also I should send Sam the slides", "why": "names the dentist"}));
    let (changes, rest) = settle(&world, &said, reply, 900, false, true);
    assert_eq!(noted(&changes).map(|n| n.why.as_str()), Some("names the dentist"));
    let mut after = world.clone();
    for c in &changes {
        after.apply(c);
    }
    let rest = after.thoughts.iter().find(|t| Some(&t.id) == rest.as_ref()).unwrap().clone();
    let joined = decide(&after, &rest, answer(serde_json::json!({"action": "new", "title": "Slides for Sam", "joins": "before"})), 900, false, true);
    assert!(noted(&joined).is_none() && joined.iter().any(|c| matches!(c, Change::ThreadAdded { .. })), "{joined:?}");
}

#[test]
fn the_trace_line_carries_the_note() {
    let world = catch();
    let said = turn("Sentences.", 60);
    let changes = decide(&world, &said, answer(serde_json::json!({"action": "continue", "thread_id": "T1", "joins": "unfinished"})), 900, false, true);
    let line = super::traced(&world, &said, ("continue".into(), "T1".into(), String::new(), String::new()), false, &changes, None);
    assert_eq!(line["note"]["continues"], "a");
}

/// A decision cut in two by a pause is one: the part carrying it on is marked even though its own words name no
/// decision ("Priya on Wednesday night"), so the map shows the joined point as decided and Recap gets it once. A cut
/// "Okay, decided:" is never set aside as filler, or the rest would have nothing to carry on.
#[test]
fn a_decision_cut_by_a_pause_is_marked_on_the_part_that_carries_it_on() {
    let mut world = World { threads: vec![thread("T1", "Stats midterm"), thread("T2", "Bike brakes")], ..World::default() };
    world.thoughts = vec![Thought { decided: true, ..said("a", "Decided: I'll study with", "T1", 20, false) }];
    world.apply(&Change::ActiveChanged { thread_id: "T1".into(), speaker: "you".into() });
    let rest = turn("Priya on Wednesday night.", 23);
    let joined = decide(&world, &rest, answer(serde_json::json!({"action": "new", "title": "Study with Priya", "point": "Study with Priya on Wednesday night", "joins": "before"})), 900, false, true);
    let decided = |changes: &[Change]| changes.iter().find_map(|c| match c { Change::ThoughtPlaced { decided, .. } => Some(*decided), _ => None });
    assert_eq!((landed(&joined), decided(&joined)), (Some("T1"), Some(true)), "{joined:?}");
    // Not joined, its own words decide nothing.
    let alone = decide(&world, &rest, answer(serde_json::json!({"action": "return", "thread_id": "T2", "joins": "none"})), 900, false, true);
    assert_eq!(decided(&alone), Some(false));
    // Joined, a question isn't a decision: "We decided" … "or did we?".
    world.thoughts[0].text = "We decided".into();
    let asked = decide(&world, &turn("or did we?", 23), answer(serde_json::json!({"action": "return", "thread_id": "T1", "joins": "before"})), 900, false, true);
    assert_eq!(decided(&asked), Some(false));
    // The marker alone, cut off, is placed, not skipped.
    let skip = || answer(serde_json::json!({"action": "skip"}));
    let marker = decide(&world, &turn("Okay, decided:", 30), skip(), 900, false, true);
    assert!(marker.iter().any(|c| matches!(c, Change::ThoughtPlaced { decided: true, .. })), "{marker:?}");
    let filler = decide(&world, &turn("Okay, yeah.", 30), skip(), 900, false, true);
    assert!(matches!(filler[..], [Change::ThoughtSkipped { .. }]), "{filler:?}");
}

/// A correction changes the words the mark was read from: "We divided on Thursday" fixed to "decided" is a decision,
/// and its undo isn't; a join taken apart reads the carrier's own words again.
#[test]
fn a_correction_or_an_unlink_reads_the_mark_again() {
    let mut world = World { threads: vec![thread("T1", "Stats midterm")], ..World::default() };
    world.thoughts = vec![Thought { unclear: "divided".into(), guess: "decided".into(), ..said("a", "We divided on Thursday for the study session.", "T1", 20, true) }];
    let fixed = crate::decided::remarked(&world, vec![Change::ThoughtCorrected { thought_id: "a".into(), accept: true, with: String::new() }]);
    assert!(matches!(&fixed[..], [_, Change::ThoughtDecided { thought_id, decided: true }] if thought_id == "a"), "{fixed:?}");
    for change in &fixed {
        world.apply(change);
    }
    assert!(world.thoughts[0].decided);
    // A fix made without asking, said no to: the words go back as heard, and so does the mark.
    world.thoughts[0].heard = "divided".into();
    world.thoughts[0].fixed = "decided".into();
    let undone = crate::decided::remarked(&world, vec![Change::ThoughtCorrected { thought_id: "a".into(), accept: false, with: String::new() }]);
    assert!(matches!(&undone[..], [_, Change::ThoughtDecided { decided: false, .. }]), "{undone:?}");
    for change in &undone {
        world.apply(change);
    }
    // A correction that leaves the mark as it was adds nothing.
    let same = crate::decided::remarked(&world, vec![Change::ThoughtCorrected { thought_id: "a".into(), accept: false, with: String::new() }]);
    assert_eq!(same.len(), 1, "{same:?}");
    // A correction on a head reads its carrier again; taking the join apart reads the carrier alone.
    let mut world = World { threads: vec![thread("T1", "Stats midterm")], ..World::default() };
    world.thoughts = vec![
        Thought { unclear: "Divided".into(), guess: "Decided".into(), ..said("h", "Divided: I'll study with", "T1", 20, false) },
        said("c", "Priya on Wednesday night.", "T1", 23, true),
    ];
    world.apply(&Change::ThoughtNoted { thought_id: "c".into(), note: Note { continues: "h".into(), ..Note::default() } });
    let fixed = crate::decided::remarked(&world, vec![Change::ThoughtCorrected { thought_id: "h".into(), accept: true, with: String::new() }]);
    let marked: Vec<&str> = fixed.iter().filter_map(|c| match c { Change::ThoughtDecided { thought_id, decided: true } => Some(thought_id.as_str()), _ => None }).collect();
    assert_eq!(marked, ["h", "c"], "{fixed:?}");
    for change in &fixed {
        world.apply(change);
    }
    let apart = crate::decided::remarked(&world, vec![Change::ThoughtNoted { thought_id: "c".into(), note: Note::default() }]);
    assert!(matches!(&apart[..], [_, Change::ThoughtDecided { thought_id, decided: false }] if thought_id == "c"), "{apart:?}");
}
