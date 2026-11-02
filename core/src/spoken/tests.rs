//! Tests for the spoken command pack (spoken.rs): how each command reads, where "add … to X" files, and what a
//! window is told. The table of every command said alone and after each lead-in, with its look-alikes, is in
//! main.rs (`every_pack_command_acts_alone_and_its_look_alikes_stay_thoughts`). No test calls a model.

use super::*;
use crate::world::{Action, Journal};

struct Fixture {
    core: Arc<Core>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(world: World) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-spoken-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        Self { path, core: Arc::new(Core::test(journal, world)) }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
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

fn map(threads: Vec<Thread>) -> World {
    World { threads, ..World::default() }
}

#[test]
fn add_to_x_cuts_at_the_last_to_and_names_new_words() {
    assert_eq!(filing("Add milk and eggs to the shopping list"), Some(("milk and eggs", "the shopping list")));
    assert_eq!(filing("Okay, add milk to the shopping list, please."), Some(("milk", "the shopping list")));
    assert_eq!(filing("Add a note about the trip to Japan to the travel list"), Some(("a note about the trip to Japan", "the travel list")));
    assert_eq!(filing("Put the receipt in the bills thread"), Some(("the receipt", "the bills thread")));
    assert_eq!(filing("Add to the shopping list: oat milk"), Some(("oat milk", "the shopping list")));
    assert_eq!(filing("Jot down call the landlord on my to-do list"), Some(("call the landlord", "my to-do list")));
    // A thought already on the map is the catalog's to move (plan step 15); a verb that starts errands isn't one.
    for none in ["Put this in perspective", "Add it to the list", "Put that in the shopping list", "Save money on groceries", "I need to add milk to the list", "Add milk"] {
        assert_eq!(filing(none), None, "{none}");
    }
    // Nor is any thought a move points at ("put my last thought in …"): moves.rs's to move, not new words to file.
    for pointing in crate::moves::POINTING {
        let said = format!("Put {pointing} in the pottery thread");
        assert_eq!(filing(&said), None, "{said}");
    }
}

#[test]
fn a_place_is_a_thread_by_its_title_or_a_new_one_only_when_said_as_a_kind_of_place() {
    let world = map(vec![thread("T1", "Groceries", 1), thread("T2", "Car repairs", 2), thread("T3", "Trip to Japan", 3), thread("T4", "Reading list", 4)]);
    let at = |place: &str| destination(&world, place);
    assert_eq!(at("the grocery list"), Destination::Thread("T1".into()));
    assert_eq!(at("groceries"), Destination::Thread("T1".into()));
    assert_eq!(at("the Japan thread"), Destination::Thread("T3".into()));
    assert_eq!(at("my reading list"), Destination::Thread("T4".into()));
    // "The list" alone: the latest thread with "list" in its title.
    assert_eq!(at("the list"), Destination::Thread("T4".into()));
    assert_eq!(at("the packing list"), Destination::New("Packing list".into()));
    // Without a kind of place, only a title with exactly those words: "the car" isn't "Car repairs".
    assert_eq!(at("the car"), Destination::Unsure);
    assert_eq!(at("perspective"), Destination::Unsure);
    // Said as a kind of place, its words in a longer title count; a word shared with one is the placer's to judge.
    assert_eq!(at("the car list"), Destination::Thread("T2".into()));
    assert_eq!(at("the repair shop list"), Destination::Unsure);
    assert_eq!(at("the one"), Destination::Unsure);
}

#[test]
fn filing_lands_at_once_with_what_to_add_as_its_point_and_every_word_kept() {
    let mut world = map(vec![thread("T1", "Shopping list", 1), thread("T2", "Rent", 2)]);
    world.active_by.insert("you".into(), "T2".into());
    world.active = Some("T2".into());
    let f = Fixture::new(world);
    let mut updates = f.core.updates.subscribe();
    assert!(act(&f.core, "you", "Add oat milk to the shopping list.").is_some());
    let world = f.core.snapshot();
    let thought = world.thoughts.last().unwrap();
    assert_eq!((thought.text.as_str(), thought.point.as_str(), thought.placed), ("Add oat milk to the shopping list.", "Oat milk", true));
    assert_eq!(thought.thread_id.as_deref(), Some("T1"));
    assert_eq!(world.thread("T1").unwrap().last_point, "Oat milk");
    assert_eq!(world.active_for("you").map(String::as_str), Some("T1"));
    let mut notices = Vec::new();
    while let Ok(out) = updates.try_recv() {
        if let ServerMsg::Notice { message } = out.message {
            notices.push(message);
        }
    }
    assert_eq!(notices, ["Added to Shopping list"]);
    // A kind of place no thread has yet: a thread of that name.
    assert!(act(&f.core, "you", "Put the tent on the packing list").is_some());
    let world = f.core.snapshot();
    let new = world.threads.iter().find(|t| t.title == "Packing list").unwrap();
    assert_eq!(world.thoughts.last().unwrap().thread_id.as_ref(), Some(&new.id));
    // Not sure where: the rest of `add_turn` keeps it as a thought for the placer.
    assert!(act(&f.core, "you", "Put the kids in the car").is_none());
}

#[test]
fn filing_never_takes_an_id_a_placement_on_its_way_could_make() {
    // The placer counts from the map it asked the model with: here T2, the next "T" number when it asked.
    let f = Fixture::new(map(vec![thread("T1", "Rent", 1)]));
    assert!(act(&f.core, "you", "Add milk to the shopping list").is_some());
    let world = f.core.snapshot();
    let shopping = world.threads.iter().find(|t| t.title == "Shopping list").unwrap();
    assert!(!shopping.id.starts_with('T'), "{}", shopping.id);
    assert_eq!(super::fresh_id(&world), "S3", "the next one skips past the number taken");
    // The placement that was on its way lands as T2 of its own, not in the shopping list.
    f.core.commit(vec![Change::ThreadAdded { thread: thread("T2", "Garden", 9) }]);
    assert_eq!(f.core.snapshot().threads.len(), 3);
}

#[test]
fn a_place_in_another_script_is_read_without_panicking() {
    let world = map(vec![thread("T1", "日本語", 1)]);
    for place in ["日本語", "日本語 list", "the 日本語", "é", "über"] {
        let _ = destination(&world, place);
    }
    assert_eq!(destination(&world, "日本語"), Destination::Thread("T1".into()));
    let f = Fixture::new(world);
    assert!(act(&f.core, "you", "Add milk to 日本語").is_some());
    assert_eq!(f.core.snapshot().thoughts.last().unwrap().thread_id.as_deref(), Some("T1"));
}

#[test]
fn new_thread_about_lands_at_once_with_no_model_call() {
    let mut world = map(vec![thread("T1", "Rent", 1)]);
    world.active_by.insert("you".into(), "T1".into());
    world.active = Some("T1".into());
    let f = Fixture::new(world);
    let mut updates = f.core.updates.subscribe();
    assert!(act(&f.core, "you", "New thread about the garden shed").is_some());
    let world = f.core.snapshot();
    let shed = world.threads.iter().find(|t| t.title == "Garden shed").unwrap();
    let thought = world.thoughts.last().unwrap();
    assert_eq!((thought.text.as_str(), thought.point.as_str(), thought.placed), ("The garden shed", "The garden shed", true));
    assert_eq!(thought.thread_id.as_ref(), Some(&shed.id));
    assert_eq!(world.active_for("you"), Some(&shed.id));
    let notices: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
        .filter_map(|out| if let ServerMsg::Notice { message } = out.message { Some(message) } else { None })
        .collect();
    assert_eq!(notices, ["New thread: “Garden shed”"]);
    assert_eq!(title_for("Why the build is slow and what to do about it."), "Why the build is slow");
    assert_eq!(title_for("Um, the lease"), "Lease");
    assert_eq!(title_for("um"), "Um");
}

#[test]
fn leaving_a_thought_unfinished_for_a_filing_offers_it_back() {
    let mut world = map(vec![thread("T1", "Rent", 1), thread("T2", "Shopping list", 2)]);
    world.active_by.insert("you".into(), "T1".into());
    world.active = Some("T1".into());
    world.thoughts.push(Thought {
        id: "a".into(),
        speaker: "you".into(),
        text: "The rent is due on the".into(),
        point: "Rent is due".into(),
        thread_id: Some("T1".into()),
        placed: true,
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: false,
        at_ms: 1,
        place_ms: Some(0),
    });
    let f = Fixture::new(world);
    assert!(act(&f.core, "you", "Add milk to the shopping list").is_some());
    let world = f.core.snapshot();
    let rent = world.thread("T1").unwrap();
    assert_eq!((rent.status, rent.dropped_by.as_str()), (ThreadStatus::Dropped, "you"));
    // "Finish it" now goes to the window, which knows which card it shows.
    let mut updates = f.core.updates.subscribe();
    assert!(act(&f.core, "you", "Finish it").is_some());
    assert!(std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Finish })));
    // Someone else's is theirs: no card, so "finish it" is talk.
    assert!(act(&f.core, "sam", "Finish it").is_none());
}

#[test]
fn new_thread_about_keeps_every_word_after_it() {
    assert_eq!(new_thread_about("New thread about the garden shed"), Some("The garden shed".into()));
    assert_eq!(new_thread_about("Okay, start a new thread about why the build is slow."), Some("Why the build is slow.".into()));
    assert_eq!(new_thread_about("Create a new one about Dana's party"), Some("Dana's party".into()));
    assert_eq!(new_thread_about("New thread on piano lessons"), Some("Piano lessons".into()));
    assert_eq!(new_thread_about("New thread. I want to learn piano."), Some("I want to learn piano.".into()));
    assert_eq!(new_thread_about("Different topic, but I need to call Mom"), Some("But I need to call Mom".into()));
    assert_eq!(title_for("But I need to call Mom"), "I need to call Mom");
    assert_eq!(new_thread_about("Change of topic: the lease"), Some("The lease".into()));
    // Words that would lead into a request are the thought's own here.
    assert_eq!(new_thread_about("New thread about can you review the contract?"), Some("Can you review the contract?".into()));
    assert_eq!(new_thread_about("New thread. Okay so the tomatoes need stakes."), Some("Okay so the tomatoes need stakes.".into()));
    for none in [
        "New thread",
        "A new thread about the budget came up on Slack",
        "New topic on the agenda is hiring",
        "Create a new one for the kitchen",
        "I want a new thread about this",
        "New thread about",
        "New threads are cheap, I bought six spools",
    ] {
        assert_eq!(new_thread_about(none), None, "{none}");
    }
}

#[test]
fn expand_names_a_thread_this_one_or_all_and_show_needs_a_title() {
    let named = |name: &str, open: bool, sure: bool, title_only: bool| Some(Unfold { target: Target::Named(name.into()), open, sure, title_only });
    assert_eq!(unfold("Expand the garden"), named("the garden", true, false, false));
    assert_eq!(
        unfold("Can we expand all the sub cards inside the app feedback and ideas"),
        named("the app feedback and ideas", true, true, false)
    );
    assert_eq!(unfold("Show me everything under the Japan trip."), named("the Japan trip", true, true, false));
    assert_eq!(unfold("Open all of Rent"), named("Rent", true, true, false));
    assert_eq!(unfold("Show the garden"), named("the garden", true, false, true));
    assert_eq!(unfold("Collapse the garden"), named("the garden", false, false, false));
    assert_eq!(unfold("Expand this"), Some(Unfold { target: Target::This, open: true, sure: true, title_only: false }));
    assert_eq!(unfold("Collapse it"), Some(Unfold { target: Target::This, open: false, sure: true, title_only: false }));
    assert_eq!(unfold("Expand everything"), Some(Unfold { target: Target::All, open: true, sure: true, title_only: false }));
    assert_eq!(unfold("Fold all the cards"), Some(Unfold { target: Target::All, open: false, sure: true, title_only: false }));
    // Said of windows and errands.
    assert_eq!(unfold("Close everything"), None);
    assert_eq!(unfold("Hide it"), None);
    assert_eq!(unfold("Show"), None);
}

#[test]
fn expand_opens_the_thread_with_its_branches_and_a_miss_said_plainly_is_answered() {
    let mut branch = thread("T2", "Mic feedback", 2);
    branch.parent_id = Some("T1".into());
    let mut deeper = thread("T3", "Button states", 3);
    deeper.parent_id = Some("T2".into());
    let f = Fixture::new(map(vec![thread("T1", "App feedback and ideas", 1), branch, deeper, thread("T4", "Rent", 4)]));
    let said = |text: &str| {
        let mut updates = f.core.updates.subscribe();
        let acted = act(&f.core, "you", text).is_some();
        let mut out = Vec::new();
        while let Ok(message) = updates.try_recv() {
            match message.message {
                ServerMsg::Unfold { thread_id, open } => out.push(format!("{} {}", if open { "open" } else { "fold" }, thread_id.unwrap_or("all".into()))),
                ServerMsg::Notice { message } => out.push(message),
                _ => {}
            }
        }
        (acted, out)
    };
    assert_eq!(said("Expand all the sub cards inside app feedback"), (true, vec!["open T1".into(), "Opened App feedback and ideas and its 2 branches".into()]));
    assert_eq!(said("Show me the mic feedback"), (true, vec!["open T2".into(), "Opened Mic feedback and its branch".into()]));
    assert_eq!(said("Collapse rent"), (true, vec!["fold T4".into(), "Folded Rent".into()]));
    assert_eq!(said("Expand everything"), (true, vec!["open all".into(), "Every thread is open".into()]));
    assert_eq!(said("Expand everything in the garden"), (true, vec!["I couldn't find “the garden”. Try words from its title.".into()]));
    assert_eq!(said("Expand the business into Europe"), (false, vec![]));
    assert_eq!(said("Show Dana the photos"), (false, vec![]));
    // "Show", "open" and "hide" need the whole title: a thread with more words in it isn't named.
    f.core.commit(vec![Change::ThreadAdded { thread: thread("T5", "Dana photos from Japan", 5) }]);
    assert_eq!(said("Show Dana the photos"), (false, vec![]));
    assert_eq!(said("Hide the mic"), (false, vec![]));
    assert_eq!(said("Show Dana photos from Japan"), (true, vec!["open T5".into(), "Opened Dana photos from Japan".into()]));
    assert_eq!(said("Expand Dana photos"), (true, vec!["open T5".into(), "Opened Dana photos from Japan".into()]));
}

#[test]
fn add_it_to_reminders_adds_the_newest_waiting_on_your_thread() {
    let action = |id: &str, thread: &str, status: ItemStatus| Action {
        id: id.into(),
        thread_id: thread.into(),
        kind: "reminder".into(),
        title: format!("Do {id}"),
        when: String::new(),
        status,
        done_ms: None,
    };
    let mut world = map(vec![thread("T1", "Rent", 1), thread("T2", "Garden", 2)]);
    world.actions = vec![action("a", "T1", ItemStatus::New), action("b", "T2", ItemStatus::New), action("c", "T1", ItemStatus::Done)];
    world.active_by.insert("you".into(), "T1".into());
    let f = Fixture::new(World::default());
    assert_eq!(proposed(&f.core, &world, "you").map(|a| a.id.as_str()), Some("a"));
    // Off every thread with one waiting: "it" is that one. With two waiting on other threads (in a room, maybe
    // someone else's), "it" is neither: nothing is added on a guess.
    world.active_by.insert("you".into(), "T9".into());
    assert_eq!(proposed(&f.core, &world, "you").map(|a| a.id.as_str()), None);
    world.actions.retain(|a| a.id != "a");
    assert_eq!(proposed(&f.core, &world, "you").map(|a| a.id.as_str()), Some("b"));
    world.actions.retain(|a| a.status != ItemStatus::New);
    assert!(proposed(&f.core, &world, "you").is_none());
    for said in ["Add it to Reminders", "Okay, add that to my calendar.", "Approve it", "Yes, add it"] {
        assert!(is_approve(said), "{said}");
    }
    for said in ["Add the dentist to my calendar", "I'll add it to reminders later"] {
        assert!(!is_approve(said), "{said}");
    }
}

#[test]
fn stop_listening_is_only_the_whole_turn() {
    for said in ["Stop listening", "Okay, stop listening for a bit.", "Pause listening", "Mic off", "Turn off the mic, please"] {
        assert!(is_stop_listening(said), "{said}");
    }
    for said in ["Stop listening to him", "I should stop listening to podcasts at night", "Stop", "Pause"] {
        assert!(!is_stop_listening(said), "{said}");
    }
}

#[test]
fn stop_listening_ends_a_turn_only_after_a_pause() {
    assert_eq!(stop_tail("Call mom tomorrow about the flight. Stop listening."), Some(("Call mom tomorrow about the flight.", "Stop listening.")));
    assert_eq!(stop_tail("The deposit is due Friday, okay stop listening"), Some(("The deposit is due Friday", "okay stop listening")));
    assert_eq!(stop_tail("Rent is due. Mic off, thanks."), Some(("Rent is due.", "Mic off, thanks.")));
    assert!(is_stop_listening("Stop listening, thank you."));
    for said in [
        "Stop listening",
        "I should stop listening to podcasts at night",
        "We loved the band. Would you stop listening to them?",
        "I loved it. Could you stop listening?",
        "Okay, so I want to stop listening to the news.",
    ] {
        assert_eq!(stop_tail(said), None, "{said}");
    }
    assert!(stops_listening("Rent is due. Stop listening.") && stops_listening("Stop listening") && !stops_listening("Stop listening to him"));
}
