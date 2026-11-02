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

impl Fixture {
    /// With the placer's queue to watch.
    fn queued(world: World) -> (Self, tokio::sync::mpsc::UnboundedReceiver<crate::placer::Job>) {
        let path = std::env::temp_dir().join(format!("e2a2o-catalog-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let (placer_queue, queue) = tokio::sync::mpsc::unbounded_channel();
        (Self { path, core: Arc::new(Core { placer_queue, ..Core::test(journal, world) }) }, queue)
    }

    /// Places thought `id` in `thread` with `point`, as the placer would, and moves the speaker there.
    fn place(&self, id: &str, thread: &str, point: &str) {
        self.core.commit(vec![
            Change::ThoughtPlaced { thought_id: id.into(), thread_id: thread.into(), point: point.into(), unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 1, decided: false },
            Change::ThreadTouched { thread_id: thread.into(), last_point: point.into(), at_ms: now_ms() },
            Change::ActiveChanged { thread_id: thread.into(), speaker: "you".into() },
        ]);
    }

    fn last_point(&self, thread: &str) -> String {
        self.core.snapshot().thread(thread).unwrap().last_point.clone()
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
            ServerMsg::Revert => "revert".into(),
            ServerMsg::Change { change } => match change {
                Change::ThoughtAdded { thought } => format!("added {}", thought.text),
                Change::ThoughtSkipped { thought_id } => format!("removed {thought_id}"),
                Change::ThoughtCorrected { accept, with, .. } => format!("corrected {accept} {with}").trim_end().to_string(),
                Change::ThreadMerged { from, into } => format!("merged {from} into {into}"),
                Change::ThreadRemoved { thread_id } => format!("gone {thread_id}"),
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
        decided: false,
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
        Act::Pause, Act::Approve, Act::KeepApp, Act::DiscardApp, Act::Yes, Act::No, Act::Redo, Act::Undo, Act::Move, Act::Rename, Act::Export,
        Act::Delete,
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
    assert!(undone.contains(&"revert".to_string()) && undone.iter().any(|l| l.starts_with("added Can we see")), "{undone:?}");
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
        Change::ThoughtPlaced { thought_id: id.clone(), thread_id: "T5".into(), point: "Own topic".into(), unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 1, decided: false },
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
    assert_eq!(redo[..3], ["revert".to_string(), "open T2".into(), "notice Opened Bills".into()]);
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

/// "Export my map" asks only the speaker's window for the file (it holds the map): the words aren't kept as a thought,
/// nothing on the map changes, and there's nothing to take back.
#[tokio::test]
async fn export_my_map_asks_the_window_for_the_file_and_changes_nothing() {
    let f = Fixture::new(garden());
    let before = serde_json::to_string(&f.core.snapshot()).unwrap();
    assert_eq!(f.say("Export my map").await, ["view export"]);
    assert_eq!(serde_json::to_string(&f.core.snapshot()).unwrap(), before);
    assert_eq!(f.say("Export the photos to Dana").await, ["added Export the photos to Dana"]);
}

#[tokio::test]
async fn a_view_and_a_move_are_redone_and_scratched() {
    let f = Fixture::new(garden());
    assert_eq!(f.say("Palace").await, ["view palace"]);
    // The new view replaces the old one: it isn't undone first.
    assert_eq!(f.say("No, I meant the map").await, ["view map"]);
    // The window puts back what it showed before the map: it alone knows (Map said on Map stays Map).
    assert_eq!(f.say("Scratch that").await, ["revert", "notice Undone: switch to the map"]);
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
        let a = Attention { selected: selected.map(String::from), pointed: pointed.map(String::from), left: left.map(|(id, at)| (id.to_string(), at)), ..Attention::default() };
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

/// "Focus on this" focuses the card "this" means, as "collapse this" folds it; bare "Focus" stays on yours, as its
/// button does. Scratching it puts back both the view and the thread you were on.
#[tokio::test]
async fn focus_on_this_focuses_the_card_this_means() {
    let f = Fixture::new(garden());
    attend(&f.core, "you", None, Some("T2".into()));
    assert_eq!(f.say("Focus").await, ["view focus"]);
    assert_eq!(f.say("Focus on this").await, ["on T2", "view focus"]);
    assert_eq!(f.say("Scratch that").await, ["revert", "on T1", "notice Undone: show only one thread"]);
    // The card the pointer left just now still counts, and "let's" leads in as it does for "let's focus".
    attend(&f.core, "you", None, None);
    assert_eq!(f.say("Let's focus on that one").await, ["on T2", "view focus"]);
    // Already there: only the view, and its undo is the view's alone.
    let done = f.core.request("you", "Focus on this thread", true).unwrap();
    assert!(matches!(done.undo, Some(Undo::View)), "{:?}", done.undo);
    // A correction redoes it the same way ("Palace", then "No, I meant focus on this"; the new view replaces Palace).
    let f = Fixture::new(garden());
    attend(&f.core, "you", None, Some("T2".into()));
    f.say("Palace").await;
    assert_eq!(f.say("No, I meant focus on this").await, ["on T2", "view focus"]);
    // Nothing pointed or selected: the thread you're on, so nothing moves.
    let f = Fixture::new(garden());
    assert_eq!(f.say("Focus on this").await, ["view focus"]);
    // Nothing to focus on: said, not a silent view the window can't show (review); bare "Focus" too.
    let f = Fixture::new(World::default());
    for said in ["Let's focus on that one", "Focus"] {
        assert_eq!(f.say(said).await, ["notice Nothing on the map yet: say a thought first"], "{said}");
    }
    let f = Fixture::new(World { active: None, active_by: HashMap::new(), ..garden() });
    assert_eq!(f.say("Focus").await, ["notice Point at a thread, then say “focus on this”"]);
    // Pointed at, it moves you there even from nowhere.
    attend(&f.core, "you", None, Some("T2".into()));
    assert_eq!(f.say("Focus on this").await, ["on T2", "view focus"]);
}

/// What the window is told about correcting the last turn, after `act` (`ServerMsg::Correctable`).
async fn correctable(f: &Fixture, act: impl FnOnce()) -> Vec<(u64, Option<String>)> {
    let mut updates = f.core.updates.subscribe();
    act();
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    let mut out = Vec::new();
    while let Ok(o) = updates.try_recv() {
        if let ServerMsg::Correctable { for_ms, back_to } = o.message {
            out.push((for_ms, back_to));
        }
    }
    out
}

#[tokio::test]
async fn the_window_learns_where_a_correction_starts_from() {
    // "Next one" took you to Bills; "No, I meant collapse this" undoes the move first, so "this" is Garden, and the
    // window's mark must say so (review: it marked Bills).
    let f = Fixture::new(garden());
    let next = correctable(&f, || f.core.add_thought("you", "Next one")).await;
    assert_eq!(next, [(JUST_BEFORE_MS, Some("T1".into()))]);
    assert_eq!(f.say("No, I meant collapse this").await, ["on T1", "fold T1", "notice Folded Garden"]);
    // A thought kept, or a view: undoing it moves nobody.
    let f = Fixture::new(garden());
    assert_eq!(correctable(&f, || f.core.add_thought("you", "Buy more seeds")).await, [(JUST_BEFORE_MS, None)]);
    assert_eq!(correctable(&f, || f.core.add_thought("you", "Palace")).await, [(JUST_BEFORE_MS, None)]);
    // "Focus on this" moved you: the view's undo, then the move back.
    attend(&f.core, "you", None, Some("T2".into()));
    assert_eq!(correctable(&f, || f.core.add_thought("you", "Focus on this")).await, [(JUST_BEFORE_MS, Some("T1".into()))]);
    // Undo pressed: nothing left to correct.
    let f = Fixture::new(garden());
    let id = undoable(&f.say("Collapse the garden").await);
    assert_eq!(correctable(&f, || { f.click_undo(id); }).await, [(0, None)]);
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
        ("Export my map", Act::Export),
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

#[tokio::test]
async fn words_put_back_before_they_were_placed_go_back_in_line() {
    let (f, mut queue) = Fixture::queued(garden());
    f.say("Buy more stakes for the beans").await;
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    while queue.try_recv().is_ok() {}
    // Taken off before the placer reached it (it then lets go of the job), and put back: queued again.
    f.say("Scratch that").await;
    assert_eq!(f.say("Undo that").await, ["added Buy more stakes for the beans", "notice Put back"]);
    assert!(matches!(queue.try_recv(), Ok(crate::placer::Job::Place(queued)) if queued == id));
    assert!(!f.core.snapshot().thoughts.iter().find(|t| t.id == id).unwrap().placed);
}

#[tokio::test]
async fn a_late_safety_net_answer_never_undoes_a_newer_turn() {
    let f = Fixture::new(garden());
    f.say("Expand the garden").await;
    let previous = last(&f.core, "you").unwrap();
    let asked = turn(&f.core, "you");
    // While the model reads "No, the other one", the speaker folds the bills: the late answer goes.
    f.say("Collapse the bills").await;
    let mut updates = f.core.updates.subscribe();
    act_on(&f.core, "you", "No, the other one", previous.clone(), asked, Ok(Some((Act::Unfold, "expand Bills".into()))));
    assert_eq!(drain(&mut updates), Vec::<String>::new());
    assert!(matches!(last(&f.core, "you").unwrap().was, Was::Request { act: Act::Fold, .. }));
    // Taken back with Undo meanwhile: it goes too.
    let f = Fixture::new(garden());
    let opened = f.say("Expand the garden").await;
    let previous = last(&f.core, "you").unwrap();
    let asked = turn(&f.core, "you");
    f.click_undo(undoable(&opened));
    let mut updates = f.core.updates.subscribe();
    act_on(&f.core, "you", "No, the other one", previous, asked, Ok(Some((Act::Unfold, "expand Bills".into()))));
    assert_eq!(drain(&mut updates), Vec::<String>::new());
    // Nothing newer: it acts.
    let f = Fixture::new(garden());
    f.say("Expand the garden").await;
    let (previous, asked) = (last(&f.core, "you").unwrap(), turn(&f.core, "you"));
    let mut updates = f.core.updates.subscribe();
    act_on(&f.core, "you", "No, the other one", previous, asked, Ok(Some((Act::Unfold, "expand Bills".into()))));
    assert_eq!(drain(&mut updates)[..3], ["revert".to_string(), "open T2".into(), "notice Opened Bills".into()]);
}

#[tokio::test]
async fn a_correction_redone_as_a_search_takes_the_words_off_only_once_it_jumps() {
    // Not found, and no key to search by meaning: the words stay, and the miss is the answer.
    let f = Fixture::new(garden());
    f.say("That thing about the attic insulation").await;
    let missed = f.say("No, I meant go to the one about the attic insulation").await;
    assert_eq!(missed.len(), 1, "{missed:?}");
    assert!(missed[0].starts_with("notice I couldn't find “the attic insulation”"), "{missed:?}");
    assert!(f.core.snapshot().thoughts.iter().any(|t| t.text.contains("attic insulation")));
    // Found by its words: it jumps, then the words come off, with Undo.
    let f = Fixture::new(garden());
    f.say("That thing about the electric bill").await;
    let found = f.say("No, I meant go to the one about the electric bill").await;
    assert!(found.contains(&"on T2".to_string()), "{found:?}");
    assert!(found.iter().any(|l| l.starts_with("notice Did “go to the one about the electric bill” instead")), "{found:?}");
    assert!(f.core.snapshot().thoughts.iter().all(|t| !t.text.starts_with("That thing about")));
    let undone = f.click_undo(undoable(&found));
    assert!(undone.contains(&"on T1".to_string()) && undone.iter().any(|l| l == "added That thing about the electric bill"), "{undone:?}");
}

#[tokio::test]
async fn a_correction_to_add_a_reminder_with_none_waiting_keeps_the_words() {
    let f = Fixture::new(garden());
    f.say("Can you put that on my list of reminders").await;
    assert_eq!(f.say("No, I meant add it to Reminders").await, ["notice Nothing is waiting to be added yet."]);
    assert!(f.core.snapshot().thoughts.iter().any(|t| t.text.starts_with("Can you put that")));
}

#[tokio::test]
async fn words_taken_off_take_their_point_off_the_card_and_put_back_bring_it_back() {
    // A filing taken back: the thread's last point is its newest remaining one again.
    let f = Fixture::new(garden());
    f.place("b", "T2", "The electric bill is due Friday");
    f.say("Add the water bill to the bills").await;
    assert!(f.last_point("T2").to_lowercase().contains("water bill"), "{}", f.last_point("T2"));
    f.say("Scratch that").await;
    assert_eq!(f.last_point("T2"), "The electric bill is due Friday");
    // A thought taken back and put back.
    let f = Fixture::new(garden());
    f.say("Buy more stakes for the beans").await;
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    f.place("a", "T1", "Plant the tomatoes");
    f.place(&id, "T1", "Buy stakes");
    f.say("Scratch that").await;
    assert_eq!(f.last_point("T1"), "Plant the tomatoes");
    f.say("Undo that").await;
    assert_eq!(f.last_point("T1"), "Buy stakes");
}

#[tokio::test]
async fn the_first_thread_taken_back_leaves_the_map_empty() {
    // "New thread about …" on an empty map, then Undo: no card is left, and nobody is on it.
    let f = Fixture::new(World::default());
    let made = f.say("New thread about camping gear").await;
    let id = f.core.snapshot().threads[0].id.clone();
    let undone = f.click_undo(undoable(&made));
    assert!(undone.contains(&format!("gone {id}")), "{undone:?}");
    let world = f.core.snapshot();
    assert!(world.threads.is_empty() && world.thoughts.is_empty() && world.active_for("you").is_none());
    // A first thought the placer gave a thread, taken back and put back: the thread goes and comes back with it.
    let f = Fixture::new(World::default());
    f.say("Pack the tent for the weekend").await;
    let id = f.core.snapshot().thoughts[0].id.clone();
    f.core.commit(vec![Change::ThreadAdded { thread: thread("T5", "Weekend", 5) }]);
    f.place(&id, "T5", "Pack the tent");
    assert!(f.say("Scratch that").await.contains(&"gone T5".to_string()));
    assert!(f.core.snapshot().threads.is_empty());
    f.say("Undo that").await;
    let world = f.core.snapshot();
    assert_eq!(world.thoughts.iter().find(|t| t.id == id).unwrap().thread_id.as_deref(), Some("T5"));
    assert!(world.thread("T5").is_some());
}

/// ⌘Z (the window's `undo_last`) is "undo that" without words: the same last turn comes back, after the notice and its
/// Undo button are gone, and a typed thought comes off as it would by voice (persona run 2026-11-01, friction 4).
#[tokio::test]
async fn the_undo_key_takes_back_the_last_turn_as_undo_that_does() {
    let message: crate::protocol::ClientMsg = serde_json::from_str(r#"{"type":"undo_last"}"#).unwrap();
    assert!(matches!(message, crate::protocol::ClientMsg::UndoLast));
    let key = |f: &Fixture| {
        let mut updates = f.core.updates.subscribe();
        undo_last(&f.core, "you");
        drain(&mut updates)
    };
    let f = Fixture::new(garden());
    assert_eq!(f.say("Next one").await, ["notice On to Bills", "on T2"]);
    assert_eq!(key(&f), ["on T1", "notice Undone: go to the next thread"]);
    let f = Fixture::new(garden());
    f.say("Buy more stakes for the beans").await;
    let id = f.core.snapshot().thoughts.last().unwrap().id.clone();
    let off = key(&f);
    assert_eq!(off[..2], [format!("removed {id}"), "notice Removed “Buy more stakes for the beans”".into()]);
    // Pressed again, it puts them back, as "undo that" said twice does.
    assert_eq!(key(&f), ["added Buy more stakes for the beans", "notice Put back"]);
    // Nothing said yet: it says so, rather than doing nothing.
    let f = Fixture::new(garden());
    assert_eq!(key(&f), ["notice Nothing to undo: nothing said just before"]);
}
