//! Tests for the action catalog (catalog.rs): the table holds to the rules, corrections redo or take back the last
//! turn, "this" resolves in its order, and a spoken yes or no answers only the AI's open question. No test calls a
//! model: the safety net's check of an answer is tested on its own.

use super::*;
use crate::world::{Action, ItemStatus, Journal, Thread, ThreadStatus};

struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(world: World) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-catalog-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        Self { path, core: Arc::new(Core::test(journal, world)) }
    }

    /// What one turn did, as short lines: notices, moves, views, folds, Undo offers, and changes to thoughts.
    async fn say(&self, said: &str) -> Vec<String> {
        let mut updates = self.core.updates.subscribe();
        self.core.add_thought("you", said);
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        drain(&mut updates)
    }

    fn click_undo(&self, id: u64) -> Vec<String> {
        let mut updates = self.core.updates.subscribe();
        undo_click(&self.core, "you", id);
        drain(&mut updates)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn drain(updates: &mut tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(o) = updates.try_recv() {
        out.push(match o.message {
            ServerMsg::Notice { message } if message.is_empty() => continue,
            ServerMsg::Notice { message } => format!("notice {message}"),
            ServerMsg::Undoable { id } => format!("undoable {id}"),
            ServerMsg::Unfold { thread_id, open } => format!("{} {}", if open { "open" } else { "fold" }, thread_id.unwrap_or("all".into())),
            ServerMsg::View { view } => format!("view {view:?}").to_lowercase(),
            ServerMsg::Change { change } => match change {
                Change::ThoughtAdded { thought } => format!("added {}", thought.text),
                Change::ThoughtSkipped { thought_id } => format!("removed {thought_id}"),
                Change::ThoughtCorrected { accept, with, .. } => format!("corrected {accept} {with}").trim_end().to_string(),
                Change::ThreadMerged { from, into } => format!("merged {from} into {into}"),
                Change::ActiveChanged { thread_id, .. } => format!("on {thread_id}"),
                _ => continue,
            },
            _ => continue,
        });
    }
    out
}

fn thread(id: &str, title: &str, touched_ms: u64) -> Thread {
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

fn thought(id: &str, thread: &str, text: &str, at_ms: u64) -> Thought {
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
    }
}

/// Two threads, you on the garden, with one point each said a minute or two ago.
fn garden() -> World {
    let now = now_ms();
    World {
        threads: vec![thread("T1", "Garden", 1), thread("T2", "Bills", 2)],
        thoughts: vec![thought("a", "T1", "Plant the tomatoes", now - 120_000), thought("b", "T2", "The electric bill is due Friday", now - 60_000)],
        active: Some("T1".into()),
        active_by: HashMap::from([("you".into(), "T1".into())]),
        ..World::default()
    }
}

fn undoable(lines: &[String]) -> u64 {
    lines.iter().find_map(|l| l.strip_prefix("undoable ")).and_then(|id| id.parse().ok()).expect("an Undo offer")
}

#[test]
fn every_act_has_one_definition_and_its_phrases_read_as_it() {
    let acts = [
        Act::Back, Act::Next, Act::Previous, Act::Search, Act::NewThread, Act::NewThreadAbout, Act::File, Act::Unfold, Act::Fold,
        Act::Palace, Act::Map, Act::Focus, Act::All, Act::Help, Act::Recap, Act::Compose, Act::Forget, Act::Later, Act::Finish,
        Act::Pause, Act::Approve, Act::KeepApp, Act::DiscardApp, Act::Yes, Act::No, Act::Redo, Act::Undo,
    ];
    assert_eq!(CATALOG.len(), acts.len());
    for act in acts {
        assert_eq!(CATALOG.iter().filter(|d| d.act == act).count(), 1, "{act:?}");
        let d = def(act);
        assert!(!d.phrases.is_empty() && !d.does.is_empty() && !d.answers.is_empty(), "{act:?}");
        for phrase in d.phrases {
            assert_eq!(classify(phrase), Some(act), "{phrase}");
        }
    }
    // Only an outside action is external, and the safety net may never write one, nor an answer or a repair.
    for d in CATALOG {
        assert_eq!(d.external, d.act == Act::Approve, "{:?}", d.act);
        if matches!(d.act, Act::Approve | Act::Yes | Act::No | Act::Redo | Act::Undo) {
            assert!(d.template.is_none(), "{:?}", d.act);
        }
    }
}

/// What the safety net writes, from each template, is read back by the rules as that act; anything else isn't run.
#[test]
fn the_safety_net_runs_only_an_act_it_may_pick_written_as_the_rules_read_it() {
    for d in CATALOG.iter().filter(|d| d.template.is_some()) {
        let said = d.template.unwrap().replace("<thread title>", "Garden").replace("<words>", "the garden shed").replace("<does what>", "pings me about bills");
        assert_eq!(checked(&Verdict { act: name(d.act), say: said.clone() }), Some((d.act, said.clone())), "{said}");
    }
    let no = |act: &str, say: &str| assert_eq!(checked(&Verdict { act: act.into(), say: say.into() }), None, "{act}: {say}");
    no("unfold", "go to the palace");
    no("approve", "add it to Reminders");
    no("yes", "yes");
    no("thought", "");
    no("delete_everything", "expand Garden");
    // The prompt offers only those acts, and the schema only their names and "thought".
    let body = body("m", &prompt("expand the garden", "did this", "no, the bills", &["Garden", "Bills"]));
    let names = body["response_format"]["json_schema"]["schema"]["properties"]["act"]["enum"].as_array().unwrap().clone();
    assert!(names.contains(&json!("unfold")) && names.contains(&json!("thought")));
    assert!(!names.contains(&json!("approve")) && !names.contains(&json!("yes")) && !names.contains(&json!("redo")));
}

#[test]
fn corrections_read_their_lead_and_keep_the_words_after_it() {
    fn redo(rest: &str, strong: bool) -> Option<Correction<'_>> {
        Some(Correction::Redo { rest, strong })
    }
    assert_eq!(correction("No, I meant expand everything."), redo("expand everything.", true));
    assert_eq!(correction("No I was asking you to show them all like the microphone and the UX placement"), redo("show them all like the microphone and the UX placement", true));
    assert_eq!(correction("I meant the palace"), redo("the palace", true));
    assert_eq!(correction("Okay, no, I mean, the map"), redo("the map", true));
    assert_eq!(correction("Sorry, I meant to say go to the palace"), redo("go to the palace", true));
    assert_eq!(correction("No, the bills"), redo("the bills", false));
    assert_eq!(correction("No, that's not what I meant"), redo("", true));
    assert_eq!(correction("Scratch that"), Some(Correction::Scratch));
    assert_eq!(correction("Okay, undo that."), Some(Correction::Scratch));
    for talk in ["No way", "No", "I meant to call Mom", "I mean the weather was nice", "I said I'd call her back", "Scratch that off the list", "Know what I meant?"] {
        assert_eq!(correction(talk), None, "{talk}");
    }
}

#[tokio::test]
async fn a_request_filed_as_a_thought_is_redone_and_its_words_come_off_with_undo() {
    let f = Fixture::new(garden());
    // No rule reads this as a request: it's kept, as before.
    let first = f.say("Can we see all the sub notes in the garden one").await;
    assert_eq!(first, ["added Can we see all the sub notes in the garden one"]);
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    let redo = f.say("No, I was asking you to open everything under it").await;
    assert_eq!(redo[..3], ["open T1".to_string(), "notice Opened Garden".into(), format!("removed {id}")]);
    assert_eq!(redo[3], "notice Did “open everything under it” instead. Your earlier words are off the map.");
    assert!(f.core.snapshot().thoughts.iter().all(|t| t.id != id));
    // Undo puts the words back and folds the thread again.
    let undone = f.click_undo(undoable(&redo));
    assert!(undone.contains(&"fold T1".to_string()) && undone.iter().any(|l| l.starts_with("added Can we see")), "{undone:?}");
    assert!(f.core.snapshot().thoughts.iter().any(|t| t.id == id));
    // A stale button does nothing.
    assert_eq!(f.click_undo(undoable(&redo)), ["notice That can't be undone any more: something newer happened"]);
}

#[tokio::test]
async fn a_redo_that_cant_act_keeps_the_earlier_words_and_says_why() {
    let f = Fixture::new(garden());
    f.say("Can we see all the sub notes in the attic one").await;
    let redo = f.say("I meant expand everything in the attic").await;
    assert_eq!(redo, ["notice I couldn't find “the attic”. Try words from its title."]);
    assert!(f.core.snapshot().thoughts.iter().any(|t| t.text.contains("attic one")));
}

#[tokio::test]
async fn a_redo_the_rules_read_but_the_map_cant_take_is_never_a_dead_turn() {
    // "Show only that one" reads as "show <a title>", and no thread has that title: without a key the words are a
    // thought, as before; the safety net would read them with one.
    let f = Fixture::new(garden());
    f.say("Can you show me just the bills thing").await;
    assert_eq!(f.say("I was asking you to show only that one").await, ["added I was asking you to show only that one"]);
}

#[tokio::test]
async fn words_taken_back_take_the_thread_they_started_with_them() {
    // The placer gave "Make the next thing I say its own topic" a thread of its own (T5); "I meant start a new
    // thread" takes the words back, and the empty thread goes into the bills, where you last spoke before them.
    let mut world = garden();
    world.threads.push(thread("T5", "Next thought instruction", 5));
    let f = Fixture::new(world);
    f.say("Make the next thing I say its own topic").await;
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    f.core.commit(vec![
        Change::ThoughtPlaced { thought_id: id.clone(), thread_id: "T5".into(), point: "Own topic".into(), unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 1 },
        Change::ActiveChanged { thread_id: "T5".into(), speaker: "you".into() },
    ]);
    let redo = f.say("I meant start a new thread").await;
    assert!(redo.contains(&format!("removed {id}")) && redo.contains(&"merged T5 into T2".to_string()), "{redo:?}");
    assert!(f.core.snapshot().thread("T5").is_none());
    // Undo brings the words back, where the thread's id leads now.
    let undone = f.click_undo(undoable(&redo));
    assert!(undone.iter().any(|l| l == "added Make the next thing I say its own topic"), "{undone:?}");
    assert_eq!(f.core.snapshot().thoughts.iter().find(|t| t.id == id).unwrap().thread_id.as_deref(), Some("T2"));
}

#[tokio::test]
async fn a_relative_move_is_redone_from_where_you_were() {
    let mut world = garden();
    world.threads.push(thread("T3", "Trip", 3));
    let f = Fixture::new(world);
    assert_eq!(f.say("Next one").await, ["notice On to Bills", "on T2"]);
    // Back on the garden first, then the one before it: the trip, wrapping around.
    assert_eq!(f.say("No, I meant last one").await, ["on T1", "notice Previous: Trip", "on T3"]);
}

#[tokio::test]
async fn a_request_is_redone_by_a_bare_no_and_the_first_one_undone() {
    let f = Fixture::new(garden());
    assert_eq!(f.say("Expand the garden").await[..2], ["open T1".to_string(), "notice Opened Garden".into()]);
    let redo = f.say("No, expand the bills").await;
    assert_eq!(redo[..3], ["fold T1".to_string(), "open T2".into(), "notice Opened Bills".into()]);
    // After a thought a bare "No, …" is talk.
    let f = Fixture::new(garden());
    f.say("The meeting is on Monday").await;
    assert_eq!(f.say("No, the meeting is on Tuesday").await, ["added No, the meeting is on Tuesday"]);
    // With nothing said just before, a correction is talk too.
    let f = Fixture::new(garden());
    assert_eq!(f.say("I meant the palace").await, ["added I meant the palace"]);
    // Without a key, a correction no rule reads is kept, as before the safety net.
    let f = Fixture::new(garden());
    f.say("Expand the garden").await;
    assert_eq!(f.say("No, I was asking about the other one").await, ["added No, I was asking about the other one"]);
}

#[tokio::test]
async fn a_view_and_a_move_are_redone_and_scratched() {
    let f = Fixture::new(garden());
    assert_eq!(f.say("Palace").await, ["view palace"]);
    // The new view replaces the old one: it isn't undone first.
    assert_eq!(f.say("No, I meant the map").await, ["view map"]);
    assert_eq!(f.say("Scratch that").await, ["view palace", "notice Undone: switch to the map"]);
    let f = Fixture::new(garden());
    assert_eq!(f.say("Next one").await, ["notice On to Bills", "on T2"]);
    assert_eq!(f.say("Scratch that").await, ["on T1", "notice Undone: go to the next thread"]);
    // Nothing to take back.
    let f = Fixture::new(garden());
    assert_eq!(f.say("Scratch that").await, ["notice Nothing to undo: nothing said just before"]);
    f.say("Help").await;
    assert_eq!(f.say("Undo").await, ["notice Can't undo that here: your next turn, Esc or a click closes it"]);
}

#[tokio::test]
async fn scratch_that_takes_a_thought_off_and_again_puts_it_back() {
    let f = Fixture::new(garden());
    f.say("Buy more stakes for the beans").await;
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    let off = f.say("Scratch that").await;
    assert_eq!(off[..2], [format!("removed {id}"), "notice Removed “Buy more stakes for the beans”".into()]);
    assert!(off[2].starts_with("undoable "));
    assert_eq!(f.say("Undo that").await, ["added Buy more stakes for the beans", "notice Put back"]);
}

#[tokio::test]
async fn scratching_a_filing_takes_its_words_and_the_thread_it_started_away() {
    let f = Fixture::new(garden());
    let filed = f.say("Add tent pegs to the packing list").await;
    assert!(filed.contains(&"notice Added to a new thread: Packing list".to_string()), "{filed:?}");
    let started = f.core.snapshot().threads.iter().find(|t| t.title == "Packing list").unwrap().id.clone();
    let undone = f.click_undo(undoable(&filed));
    assert!(undone.iter().any(|l| l.starts_with("removed th-")), "{undone:?}");
    assert!(undone.contains(&format!("merged {started} into T1")), "{undone:?}");
    assert!(undone.contains(&"on T1".to_string()), "{undone:?}");
    let world = f.core.snapshot();
    assert!(world.thread(&started).is_none() && world.thoughts.iter().all(|t| !t.text.contains("tent pegs")));
    // Into a thread that has other words: only the filed words go.
    let f = Fixture::new(garden());
    f.say("Add the water bill to the bills").await;
    let undone = f.say("Scratch that").await;
    assert!(undone.iter().any(|l| l.starts_with("removed th-")) && !undone.iter().any(|l| l.starts_with("merged")), "{undone:?}");
    assert!(f.core.snapshot().thread("T2").is_some());
}

#[test]
fn this_is_the_selection_then_the_pointer_then_the_one_it_just_left_then_where_you_are() {
    let mut world = garden();
    world.threads.push(thread("T3", "Trip", 3));
    world.merged.insert("T9".into(), "T3".into());
    let now = 1_000_000;
    let at = |selected: Option<&str>, pointed: Option<&str>, left: Option<(&str, u64)>| {
        let a = Attention { selected: selected.map(String::from), pointed: pointed.map(String::from), left: left.map(|(id, at)| (id.to_string(), at)) };
        resolve_this(&world, "you", &a, now)
    };
    assert_eq!(at(Some("T2"), Some("T3"), None).as_deref(), Some("T2"));
    assert_eq!(at(None, Some("T3"), None).as_deref(), Some("T3"));
    assert_eq!(at(None, None, Some(("T2", now - POINTER_MS))).as_deref(), Some("T2"));
    assert_eq!(at(None, None, Some(("T2", now - POINTER_MS - 1))).as_deref(), Some("T1"));
    assert_eq!(at(None, None, None).as_deref(), Some("T1"));
    // A card that's gone doesn't count; a merged one is its successor.
    assert_eq!(at(Some("T7"), None, None).as_deref(), Some("T1"));
    assert_eq!(at(Some("T9"), None, None).as_deref(), Some("T3"));
}

#[tokio::test]
async fn expand_this_opens_the_card_under_the_pointer() {
    let f = Fixture::new(garden());
    attend(&f.core, "you", None, Some("T2".into()));
    assert_eq!(f.say("Expand this").await[..2], ["open T2".to_string(), "notice Opened Bills".into()]);
    // The pointer moved off just now: still that card.
    attend(&f.core, "you", None, None);
    assert_eq!(f.say("Collapse this").await[..2], ["fold T2".to_string(), "notice Folded Bills".into()]);
    // Selected beats pointed.
    attend(&f.core, "you", Some("T1".into()), Some("T2".into()));
    assert_eq!(f.say("Expand this").await[0], "open T1");
}

/// The latest thought asks "Did you mean “Muse Spark”?".
fn asked() -> World {
    let mut world = garden();
    let mut t = thought("q", "T1", "ask muse bark about it", now_ms() - 5_000);
    t.unclear = "muse bark".into();
    t.guess = "Muse Spark".into();
    world.thoughts.push(t);
    world
}

#[tokio::test]
async fn a_spoken_yes_no_or_short_fix_answers_the_open_question() {
    for (said, did) in [
        ("Yes", vec!["corrected true", "notice Changed to “Muse Spark”"]),
        ("Yeah, that's right.", vec!["corrected true", "notice Changed to “Muse Spark”"]),
        ("No", vec!["corrected false", "notice Kept “muse bark”"]),
        ("Nope.", vec!["corrected false", "notice Kept “muse bark”"]),
        ("No, Muse Spark.", vec!["corrected true", "notice Changed to “Muse Spark”"]),
        ("No, I said Muse Lark", vec!["corrected true Muse Lark", "notice Changed to “Muse Lark”"]),
        ("It's Muse Lark", vec!["corrected true Muse Lark", "notice Changed to “Muse Lark”"]),
    ] {
        let f = Fixture::new(asked());
        assert_eq!(f.say(said).await, did, "{said}");
    }
    let f = Fixture::new(asked());
    f.say("Yes").await;
    assert_eq!(f.core.snapshot().thoughts.iter().find(|t| t.id == "q").unwrap().text, "ask Muse Spark about it");
    // A sentence isn't a fix, and a request isn't either: it's done, and the question stays a button.
    let f = Fixture::new(asked());
    assert_eq!(f.say("No, I want to talk about the budget for next year instead").await, ["added No, I want to talk about the budget for next year instead"]);
    let f = Fixture::new(asked());
    assert_eq!(f.say("Palace").await, ["view palace"]);
    assert_eq!(f.say("Yes").await, ["added Yes"]);
}

#[tokio::test]
async fn with_no_open_question_a_yes_is_what_it_was_and_never_approves_anything_outside() {
    let mut world = garden();
    world.actions.push(Action {
        id: "r".into(),
        thread_id: "T1".into(),
        kind: "reminder".into(),
        title: "Buy stakes".into(),
        when: String::new(),
        status: ItemStatus::New,
        done_ms: None,
    });
    for said in ["Yeah", "Sure", "Okay", "Yep, sure"] {
        let f = Fixture::new(world.clone());
        assert_eq!(f.say(said).await, Vec::<String>::new(), "{said}");
    }
    for said in ["Yes", "Do it", "Yes please", "Go ahead"] {
        let f = Fixture::new(world.clone());
        let did = f.say(said).await;
        assert!(did.iter().all(|l| !l.contains("Adding") && !l.contains("approve")), "{said}: {did:?}");
        assert!(f.core.snapshot().actions.iter().all(|a| a.status == ItemStatus::New), "{said}");
    }
    // With a question open too, a yes answers the question and leaves the reminder waiting.
    let mut both = asked();
    both.actions = world.actions.clone();
    let f = Fixture::new(both);
    assert_eq!(f.say("Yes").await, ["corrected true", "notice Changed to “Muse Spark”"]);
    assert!(f.core.snapshot().actions.iter().all(|a| a.status == ItemStatus::New));
}

/// Each request's undo is the kind its definition says.
#[tokio::test]
async fn each_request_undoes_as_its_definition_says() {
    let mut world = garden();
    world.threads[1].status = ThreadStatus::Dropped;
    world.threads[1].dropped_by = "you".into();
    for (said, act) in [
        ("Where was I?", Act::Back),
        ("Next one", Act::Next),
        ("Last one", Act::Previous),
        ("New thread", Act::NewThread),
        ("New thread about the garden shed", Act::NewThreadAbout),
        ("Add stakes to the garden", Act::File),
        ("Expand the garden", Act::Unfold),
        ("Collapse this", Act::Fold),
        ("Palace", Act::Palace),
        ("Map", Act::Map),
        ("Focus", Act::Focus),
        ("Show all", Act::All),
        ("Help", Act::Help),
        ("Forget it", Act::Forget),
        ("Later", Act::Later),
        ("Finish it", Act::Finish),
        ("Stop listening", Act::Pause),
        ("Add it to Reminders", Act::Approve),
    ] {
        let f = Fixture::new(world.clone());
        let done = f.core.request("you", said, true).unwrap_or_else(|| panic!("{said}"));
        assert_eq!(done.act, act, "{said}");
        match (def(act).undo, done.undo.as_ref().map(Undo::by)) {
            (UndoBy::Not(_), None) => {}
            (by, Some(undo)) => assert_eq!(by, undo, "{said}"),
            (by, None) => panic!("{said}: {by:?} but no undo"),
        }
    }
}
