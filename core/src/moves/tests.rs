//! Tests for move and rename (moves.rs): said and clicked, each undone in one step, after a merge too, replayed from
//! the journal, and respected by the refiner. No test calls a model.

use super::*;
use crate::catalog::{self, Act};
use crate::world::{Journal, ThreadStatus};
use std::collections::HashMap;

struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(world: World) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-moves-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        Self { path, core: Arc::new(Core::test(journal, world)) }
    }

    /// What one turn did, as short lines: notices, Undo offers, moves and titles.
    async fn say(&self, said: &str) -> Vec<String> {
        let mut updates = self.core.updates.subscribe();
        self.core.add_thought("you", said);
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        drain(&mut updates)
    }

    fn watch(&self, act: impl FnOnce(&Arc<Core>)) -> Vec<String> {
        let mut updates = self.core.updates.subscribe();
        act(&self.core);
        drain(&mut updates)
    }

    fn on(&self, thought: &str) -> String {
        self.core.snapshot().thoughts.iter().find(|t| t.id == thought).and_then(|t| t.thread_id.clone()).unwrap_or_default()
    }

    fn title(&self, thread: &str) -> String {
        self.core.snapshot().thread(thread).map(|t| t.title.clone()).unwrap_or_default()
    }

    /// The map as the journal replays it over `base` (the fixture's map isn't in it), to hold it to the live one.
    fn replayed(&self, mut base: World) -> World {
        for line in std::fs::read_to_string(&self.path).unwrap().lines() {
            base.apply(&serde_json::from_str(line).unwrap());
        }
        base
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
            ServerMsg::Change { change } => match change {
                Change::ThoughtMoved { thought_id, thread_id, undo, .. } => format!("{} {thought_id} to {thread_id}", if undo { "unmoved" } else { "moved" }),
                Change::TitleChosen { thread_id, title } => format!("titled {thread_id} {title}"),
                Change::ThreadAdded { thread } => format!("thread {} {}", thread.id, thread.title),
                Change::ThreadRemoved { thread_id } => format!("removed {thread_id}"),
                Change::ThoughtAdded { thought } => format!("added {}", thought.text),
                Change::ActiveChanged { thread_id, .. } => format!("on {thread_id}"),
                _ => continue,
            },
            _ => continue,
        });
    }
    out
}

fn undoable(lines: &[String]) -> u64 {
    lines.iter().find_map(|l| l.strip_prefix("undoable ")).and_then(|id| id.parse().ok()).expect("an Undo offer")
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

/// The demo's slip: "Learn to throw on the wheel" landed on Garden, the speaker with it; Pottery class is elsewhere.
fn slipped() -> World {
    let now = now_ms();
    let mut world = World {
        threads: vec![thread("T1", "Garden", 1), thread("T2", "Pottery class", 2), thread("T3", "Bills", 3)],
        thoughts: vec![
            thought("a", "T1", "Plant the tomatoes", now - 180_000),
            thought("b", "T2", "Pottery class is on Thursdays", now - 120_000),
            thought("c", "T3", "The electric bill is due Friday", now - 90_000),
            thought("w", "T1", "Learn to throw on the wheel", now - 10_000),
        ],
        active: Some("T1".into()),
        active_by: HashMap::from([("you".into(), "T1".into())]),
        ..World::default()
    };
    world.threads[0].last_point = "Learn to throw on the wheel".into();
    world.threads[1].last_point = "Pottery class is on Thursdays".into();
    world.notes.insert("w".into(), Note { why: "“wheel” sounds like gardening".into(), ..Note::default() });
    world
}

#[test]
fn the_words_read_as_a_move_or_a_rename_only_as_the_whole_turn() {
    let moved = |place: &str, sure: bool| Some(Ask::Move { place: Place::Named(place.into()), sure, last: false });
    assert_eq!(read("Move that to the pottery thread."), moved("the pottery thread", true));
    assert_eq!(read("Okay, move that to pottery please"), moved("pottery", false));
    assert_eq!(read("Put that in the bills thread"), moved("the bills thread", true));
    assert_eq!(read("That goes in Pottery class"), moved("Pottery class", false));
    assert_eq!(read("File that under bills"), moved("bills", false));
    assert_eq!(read("Move my last thought to the garden"), Some(Ask::Move { place: Place::Named("the garden".into()), sure: false, last: true }));
    assert_eq!(read("Move that to a new thread"), Some(Ask::Move { place: Place::New, sure: true, last: false }));
    assert_eq!(read("Move it into its own thread"), Some(Ask::Move { place: Place::New, sure: true, last: false }));
    let renamed = |target: Target, title: &str| Some(Ask::Rename { targets: vec![(target, title.into())] });
    assert_eq!(read("Rename this to pottery class."), renamed(Target::This, "Pottery class"));
    assert_eq!(read("Rename it “Pottery”"), renamed(Target::This, "Pottery"));
    assert_eq!(read("Call this thread Pottery class"), renamed(Target::This, "Pottery class"));
    assert_eq!(read("Change the title to Kiln days"), renamed(Target::This, "Kiln days"));
    assert_eq!(read("Rename"), renamed(Target::This, ""));
    assert_eq!(
        read("Rename trip to Japan to Travel"),
        Some(Ask::Rename { targets: vec![(Target::Named("trip".into()), "Japan to Travel".into()), (Target::Named("trip to Japan".into()), "Travel".into())] }),
        "each place the name could end is tried on the map"
    );
    // Talk: the same words inside a sentence, a move that names no thought, or a call that isn't a title.
    for talk in ["I want to move that to Friday because of the rain", "Move the meeting to Friday", "Call this a win", "Put the kids in the car", "That's in the car"] {
        assert_eq!(kind(talk), None, "{talk}");
    }
}

#[tokio::test]
async fn move_that_takes_the_latest_thought_and_the_speaker_there_and_undo_puts_both_back() {
    let base = slipped();
    let f = Fixture::new(base.clone());
    let lines = f.say("Move that to the pottery thread").await;
    assert_eq!(&lines[..3], ["moved w to T2", "on T2", "notice Moved “Learn to throw on the wheel” to Pottery class"], "{lines:?}");
    let world = f.core.snapshot();
    assert_eq!((f.on("w").as_str(), world.thread("T2").unwrap().last_point.as_str()), ("T2", "Learn to throw on the wheel"));
    assert_eq!(world.thread("T1").unwrap().last_point, "Plant the tomatoes", "the card it left shows its own latest point");
    assert!(!world.notes.contains_key("w"), "the AI's “why here” goes: the person's reason is theirs");
    assert!(world.apart("T1", "T2"));
    drop(world);
    // The command is never a thought.
    assert!(f.core.snapshot().thoughts.iter().all(|t| !t.text.starts_with("Move")));
    let undone = f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    assert!(undone.contains(&"unmoved w to T1".to_string()) && undone.contains(&"on T1".to_string()), "{undone:?}");
    let world = f.core.snapshot();
    assert_eq!(f.on("w"), "T1");
    assert_eq!(world.thread("T1").unwrap().last_point, "Learn to throw on the wheel");
    assert_eq!(world.thread("T2").unwrap().last_point, "Pottery class is on Thursdays");
    assert!(world.notes.contains_key("w") && !world.apart("T1", "T2"), "its note is back, and nothing keeps the two apart");
    // As the journal replays it.
    let replayed = f.replayed(base);
    assert_eq!(serde_json::to_value(&*world).unwrap(), serde_json::to_value(&replayed).unwrap());
    assert!(replayed.moves.is_empty());
}

#[tokio::test]
async fn a_move_to_a_place_not_on_the_map_is_answered_or_stays_talk() {
    let f = Fixture::new(slipped());
    // Plainly a thread, but none by that name, and too near Garden to start one ("the packing list" starts one).
    assert_eq!(f.say("Move that to the garden shed thread").await, ["notice I couldn't find “the garden shed thread”. Try words from its title."]);
    assert_eq!(f.on("w"), "T1");
    let talk = f.say("Move it to Friday").await;
    assert_eq!(talk, ["added Move it to Friday"], "talk about a date, kept as a thought");
}

#[tokio::test]
async fn a_move_to_a_new_thread_starts_it_and_undo_takes_it_away() {
    let f = Fixture::new(slipped());
    let lines = f.say("Move that to a new thread").await;
    let new = f.on("w");
    // Its title from the point, at most the refiner's 5 words, never ending on a small word ("… on the").
    assert!(lines.contains(&format!("thread {new} Learn to throw")), "{lines:?}");
    assert!(lines.contains(&"notice Moved “Learn to throw on the wheel” to a new thread: Learn to throw".to_string()));
    let undone = f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    assert!(undone.contains(&format!("removed {new}")), "{undone:?}");
    assert!(f.core.snapshot().thread(&new).is_none() && f.on("w") == "T1");
    // A named list not on the map starts it, as filing does.
    f.say("Move that to the packing list").await;
    assert_eq!(f.title(&f.on("w")), "Packing list");
}

#[tokio::test]
async fn rename_this_is_the_persons_title_and_undo_puts_the_old_one_back() {
    let f = Fixture::new(slipped());
    let lines = f.say("Rename this to backyard").await;
    assert_eq!(&lines[..2], ["titled T1 Backyard", "notice Renamed to “Backyard”"]);
    assert!(f.core.snapshot().titled.contains("T1"), "the refiner leaves it alone");
    f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    assert_eq!(f.title("T1"), "Garden");
    // Named, and "scratch that" undoes it too.
    f.say("Rename the bills thread to Money").await;
    assert_eq!(f.title("T3"), "Money");
    f.say("Scratch that").await;
    assert_eq!(f.title("T3"), "Bills");
    assert_eq!(f.say("Rename this").await, ["notice Say the new title: “rename this to …”"]);
    let replayed = f.replayed(slipped());
    assert_eq!((replayed.thread("T1").unwrap().title.as_str(), replayed.thread("T3").unwrap().title.as_str()), ("Garden", "Bills"));
    assert!(replayed.titled.contains("T3"), "a title put back is the person's too");
}

#[tokio::test]
async fn clicks_go_through_the_same_definition_and_scratch_that_undoes_them() {
    let f = Fixture::new(slipped());
    // An older point, moved by its button: the speaker stays where they are.
    let lines = f.watch(|core| click_move(core, "you", "a", Some("T3".into())));
    assert_eq!(lines, ["moved a to T3", "notice Moved “Plant the tomatoes” to Bills", "undoable 1"], "{lines:?}");
    f.say("Scratch that").await;
    assert_eq!(f.on("a"), "T1");
    let lines = f.watch(|core| click_rename(core, "you", "T2", "  Kiln days. "));
    assert_eq!(&lines[..2], ["titled T2 Kiln days", "notice Renamed to “Kiln days”"]);
    assert_eq!(f.watch(|core| click_move(core, "you", "b", Some("T2".into()))), ["notice It's already in Kiln days"]);
}

#[tokio::test]
async fn a_move_undone_after_a_merge_goes_back_and_a_rename_merged_away_says_why() {
    let f = Fixture::new(slipped());
    let moved = f.say("Move that to pottery").await;
    // The person merges Pottery class into Bills (a card's Merge), then undoes the move.
    f.core.commit(vec![Change::ThreadMerged { from: "T2".into(), into: "T3".into() }]);
    assert_eq!(f.on("w"), "T3");
    f.watch(|core| catalog::undo_click(core, "you", undoable(&moved)));
    assert_eq!(f.on("w"), "T1", "back where it was, from wherever the merge took it");
    // A thought moved back to a thread merged away since comes back with it when that merge is undone.
    let f = Fixture::new(slipped());
    let moved = f.say("Move that to pottery").await;
    f.core.commit(vec![Change::ThreadMerged { from: "T1".into(), into: "T3".into() }]);
    f.watch(|core| catalog::undo_click(core, "you", undoable(&moved)));
    assert_eq!(f.on("w"), "T3");
    let unmerge = f.core.snapshot().unmerge.get("T1").cloned().unwrap();
    f.core.commit(vec![Change::ThreadUnmerged { unmerge }]);
    assert_eq!(f.on("w"), "T1");
    // A rename whose thread merged away can't be undone: its title would land on the other thread.
    let renamed = f.say("Rename the garden thread to Backyard").await;
    assert_eq!(f.title("T1"), "Backyard");
    f.core.commit(vec![Change::ThreadMerged { from: "T1".into(), into: "T3".into() }]);
    assert_eq!(f.watch(|core| catalog::undo_click(core, "you", undoable(&renamed))), ["notice That can't be undone any more: something newer happened"]);
    assert_eq!(f.title("T3"), "Bills");
}

#[tokio::test]
async fn an_undone_merge_leaves_a_moved_thought_where_the_person_put_it() {
    let f = Fixture::new(slipped());
    // Garden merged into Pottery class, then the person moves the wheel thought to Bills, then the merge is undone.
    f.core.commit(vec![Change::ThreadMerged { from: "T1".into(), into: "T2".into() }]);
    click_move(&f.core, "you", "w", Some("T3".into()));
    let unmerge = f.core.snapshot().unmerge.get("T1").cloned().unwrap();
    assert!(!unmerge.thoughts.contains(&"w".to_string()));
    f.core.commit(vec![Change::ThreadUnmerged { unmerge }]);
    assert_eq!((f.on("w").as_str(), f.on("a").as_str()), ("T3", "T1"));
    // Even moved back onto the merged thread: it's the person's, not the merge's.
    let f = Fixture::new(slipped());
    f.core.commit(vec![Change::ThreadMerged { from: "T1".into(), into: "T2".into() }]);
    click_move(&f.core, "you", "w", Some("T3".into()));
    click_move(&f.core, "you", "w", Some("T2".into()));
    let unmerge = f.core.snapshot().unmerge.get("T1").cloned().unwrap();
    f.core.commit(vec![Change::ThreadUnmerged { unmerge }]);
    assert_eq!(f.on("w"), "T2");
}

#[tokio::test]
async fn a_move_settles_a_merge_card_between_the_two_threads() {
    let mut world = slipped();
    world.proposals.push(crate::tidy::Proposal {
        id: "tp".into(),
        kind: crate::tidy::Kind::Merge,
        thread_id: "T2".into(),
        title: String::new(),
        into: "T1".into(),
        status: crate::world::ItemStatus::New,
    });
    let f = Fixture::new(world);
    f.say("Move that to pottery").await;
    assert_eq!(f.core.snapshot().proposals[0].status, crate::world::ItemStatus::Done);
}

#[tokio::test]
async fn a_point_moves_with_the_words_it_carries_on() {
    let mut world = slipped();
    let now = now_ms();
    world.thoughts.push(thought("w2", "T1", "on Saturdays", now - 5_000));
    world.notes.insert("w2".into(), Note { continues: "w".into(), ..Note::default() });
    let f = Fixture::new(world);
    let lines = f.say("Move that to pottery").await;
    assert_eq!(&lines[..2], ["moved w to T2", "moved w2 to T2"]);
    assert_eq!(f.core.snapshot().notes["w2"].continues, "w", "still one idea");
}

#[tokio::test]
async fn a_thought_still_finding_its_place_moves_once_it_lands() {
    let mut world = slipped();
    let mut pending = thought("p", "T1", "Glaze the bowls", now_ms());
    (pending.placed, pending.point) = (false, String::new());
    world.thoughts.push(pending);
    let f = Fixture::new(world);
    let lines = f.say("Move that to pottery").await;
    assert_eq!(lines, ["notice Moving it once it finds its place…"]);
    let mut updates = f.core.updates.subscribe();
    f.core.commit(vec![Change::ThoughtPlaced {
        thought_id: "p".into(), thread_id: "T1".into(), point: "Glaze the bowls".into(), unclear: String::new(), guess: String::new(),
        heard: String::new(), fixed: String::new(), complete: true, place_ms: 1,
        decided: false,
    }]);
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    assert_eq!(f.on("p"), "T2");
    assert!(drain(&mut updates).iter().any(|l| l.starts_with("undoable")));
    // Something said meanwhile: "that" may mean it now, so the waiting move goes.
    let mut world = slipped();
    let mut pending = thought("p", "T1", "Glaze the bowls", now_ms());
    pending.placed = false;
    world.thoughts.push(pending);
    let f = Fixture::new(world);
    f.say("Move that to pottery").await;
    f.say("Next one").await;
    f.core.commit(vec![Change::ThoughtPlaced {
        thought_id: "p".into(), thread_id: "T1".into(), point: "Glaze the bowls".into(), unclear: String::new(), guess: String::new(),
        heard: String::new(), fixed: String::new(), complete: true, place_ms: 1,
        decided: false,
    }]);
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    assert_eq!(f.on("p"), "T1");
}

#[tokio::test]
async fn no_that_goes_in_another_thread_moves_the_words_and_keeps_them() {
    let f = Fixture::new(slipped());
    let lines = f.say("Learn to center the clay").await;
    let id = f.core.snapshot().thoughts.iter().find(|t| t.text == "Learn to center the clay").unwrap().id.clone();
    assert!(lines.contains(&"added Learn to center the clay".to_string()));
    f.core.commit(vec![Change::ThoughtPlaced {
        thought_id: id.clone(), thread_id: "T1".into(), point: "Learn to center the clay".into(), unclear: String::new(), guess: String::new(),
        heard: String::new(), fixed: String::new(), complete: true, place_ms: 1,
        decided: false,
    }]);
    let lines = f.say("No, that goes in the pottery thread").await;
    assert!(lines.contains(&format!("moved {id} to T2")), "{lines:?}");
    assert_eq!(f.on(&id), "T2");
    // Scratch that undoes the move, not the words.
    f.say("Scratch that").await;
    assert_eq!(f.on(&id), "T1");
}

#[tokio::test]
async fn each_undoes_as_its_definition_says() {
    for (said, act) in [("Move that to pottery", Act::Move), ("Rename this to Backyard", Act::Rename)] {
        let f = Fixture::new(slipped());
        let done = act_for(&f, said);
        assert_eq!(done.act, act);
        assert_eq!(done.undo.as_ref().map(crate::catalog::Undo::by), Some(crate::catalog::def(act).undo), "{said}");
    }
}

fn act_for(f: &Fixture, said: &str) -> Done {
    super::act(&f.core, "you", said).unwrap()
}

#[tokio::test]
async fn a_thread_the_move_leaves_empty_goes_into_where_its_words_went_and_undo_puts_it_back_in_place() {
    // The AI started "Wheel throwing" (T4) for a thought that belonged to Pottery class.
    let mut world = slipped();
    world.thoughts.retain(|t| t.id != "w");
    world.threads.insert(1, thread("T4", "Wheel throwing", 4));
    world.thoughts.push(thought("w", "T4", "Learn to throw on the wheel", now_ms() - 10_000));
    world.active_by.insert("you".into(), "T4".into());
    let f = Fixture::new(world);
    let lines = f.say("Move that to pottery").await;
    let world = f.core.snapshot();
    assert!(world.thread("T4").is_none() && world.merged.get("T4").map(String::as_str) == Some("T2"), "{lines:?}");
    assert_eq!(world.active_for("you").map(String::as_str), Some("T2"));
    drop(world);
    f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    let world = f.core.snapshot();
    assert_eq!(world.threads.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["T1", "T4", "T2", "T3"], "back where it stood");
    assert_eq!((f.on("w").as_str(), world.active_for("you").map(String::as_str)), ("T4", Some("T4")));
    // To a new thread from a thread it empties: the new one goes on undo, the old one comes back.
    drop(world);
    let lines = f.say("Move that to a new thread").await;
    let new = f.on("w");
    assert!(f.core.snapshot().thread("T4").is_none());
    f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    let world = f.core.snapshot();
    assert!(world.thread(&new).is_none() && world.thread("T4").is_some() && f.on("w") == "T4");
}

#[tokio::test]
async fn put_my_last_thought_in_a_thread_moves_it_and_files_no_new_words() {
    for said in ["Put my last thought in the pottery thread", "Put that last thought in pottery", "Put this point in the pottery thread"] {
        let f = Fixture::new(slipped());
        let before = f.core.snapshot().thoughts.len();
        let lines = f.say(said).await;
        assert!(lines.contains(&"moved w to T2".to_string()), "{said}: {lines:?}");
        assert_eq!((f.on("w").as_str(), f.core.snapshot().thoughts.len()), ("T2", before), "{said}: {lines:?}");
    }
}

#[tokio::test]
async fn following_a_move_ends_a_new_thread_asked_for_before_it() {
    let f = Fixture::new(slipped());
    f.say("New thread").await;
    let lines = f.say("Move that to pottery").await;
    assert!(lines.contains(&"on T2".to_string()), "taken along: {lines:?}");
    // The next thought follows Pottery: it starts no thread.
    f.core.new_threads.said("you", "next");
    assert!(!f.core.new_threads.starts("next"));
    // Not taken along (on another thread), a "new thread" still stands.
    let f = Fixture::new(slipped());
    f.core.focus("you", "T3");
    f.say("New thread").await;
    f.say("Move my last thought to pottery").await;
    assert_eq!(f.on("w"), "T2");
    f.core.new_threads.said("you", "next");
    assert!(f.core.new_threads.starts("next"));
}

/// Undoing a move to a new thread removes that thread; a topic started in between must keep its own id, and the next
/// new topic must get a fresh one rather than land on it.
#[tokio::test]
async fn a_removed_thread_does_not_hand_out_an_id_already_in_use() {
    let f = Fixture::new(slipped());
    let lines = f.say("Move that to a new thread").await;
    let moved_to = f.on("w");
    // Meanwhile the placer starts a new topic.
    let made = f.core.snapshot().next_thread_id();
    f.core.commit(vec![Change::ThreadAdded { thread: thread(&made, "Meanwhile", now_ms()) }]);
    f.watch(|core| catalog::undo_click(core, "you", undoable(&lines)));
    let w = f.core.snapshot();
    assert!(w.thread(&moved_to).is_none(), "the undone move's thread is gone");
    let next = w.next_thread_id();
    assert!(w.thread(&next).is_none() && !w.merged.contains_key(&next), "next_thread_id {next} is already in use");
    assert!(w.thread(&crate::spoken::fresh_id(&w)).is_none());
}

/// "That" means what "this" means (catalog.rs `this`): a card you selected or point at (or just left), else the thread
/// you're on, and of that card its newest point; only the thought you just said, still finding its place, comes
/// first, and "my last thought" is always your latest. The skeptic persona run of 2026-11-01 (synthetic): on the Cat
/// card, "move that to Health" moved "Book Lisbon flights", the latest part of an earlier ramble, and said only
/// "Moved to Health".
#[tokio::test]
async fn that_is_the_newest_point_of_the_card_this_means() {
    // A ramble's last part (Lisbon) was said last but landed first; the placer left you on Garden.
    let rambled = || {
        let mut world = slipped();
        world.threads.push(thread("T4", "Lisbon trip", 4));
        world.thoughts.push(thought("l", "T4", "Book Lisbon flights", now_ms() - 5_000));
        world
    };
    let f = Fixture::new(rambled());
    let lines = f.say("Move that to pottery").await;
    assert_eq!(&lines[..3], ["moved w to T2", "on T2", "notice Moved “Learn to throw on the wheel” to Pottery class"], "{lines:?}");
    assert_eq!(f.on("l"), "T4", "the ramble's other part stays");
    // Selected, or under the pointer, or just left by it: that card's newest point, and you stay where you are.
    for (selected, pointed, leave) in [(Some("T3"), None, false), (None, Some("T3"), false), (None, Some("T3"), true)] {
        let f = Fixture::new(rambled());
        catalog::attend(&f.core, "you", selected.map(String::from), pointed.map(String::from));
        if leave {
            catalog::attend(&f.core, "you", None, None);
        }
        let lines = f.say("Move that to pottery").await;
        assert_eq!(lines, ["moved c to T2", "notice Moved “The electric bill is due Friday” to Pottery class", "undoable 1"], "{selected:?} {pointed:?} {leave}");
        assert_eq!((f.on("w").as_str(), f.on("l").as_str()), ("T1", "T4"));
    }
    // "My last thought" is your latest, wherever you point.
    let f = Fixture::new(rambled());
    catalog::attend(&f.core, "you", None, Some("T3".into()));
    assert!(f.say("Move my last thought to pottery").await.contains(&"moved l to T2".to_string()));
    // The thought you just said, not on the map yet, is "that" even with the pointer on a card.
    let mut world = rambled();
    let mut pending = thought("p", "T1", "Glaze the bowls", now_ms());
    pending.placed = false;
    world.thoughts.push(pending);
    let f = Fixture::new(world);
    catalog::attend(&f.core, "you", None, Some("T3".into()));
    assert_eq!(f.say("Move that to pottery").await, ["notice Moving it once it finds its place…"]);
    // Replayed from the journal, the map is the live one.
    let base = rambled();
    let f = Fixture::new(base.clone());
    catalog::attend(&f.core, "you", Some("T3".into()), None);
    f.say("Move that to pottery").await;
    assert_eq!(serde_json::to_value(&*f.core.snapshot()).unwrap(), serde_json::to_value(&f.replayed(base)).unwrap());
}

/// A card can be left with no point of its own (a parent whose only point moved keeps its children). Pointed at,
/// "move that" has nothing to take from it, and says so: it never reaches for the speaker's latest thought elsewhere.
#[tokio::test]
async fn that_on_a_card_with_no_point_moves_nothing() {
    let mut world = slipped();
    let mut child = thread("T4", "Electric bill", 4);
    child.parent_id = Some("T5".into());
    world.threads.push(child);
    world.threads.push(thread("T5", "Money", 5));
    let f = Fixture::new(world);
    catalog::attend(&f.core, "you", None, Some("T5".into()));
    assert_eq!(f.say("Move that to pottery").await, ["notice Nothing on Money to move: point at one of its points"]);
    assert_eq!(f.on("w"), "T1", "the latest thought, on Garden, stays");
}
