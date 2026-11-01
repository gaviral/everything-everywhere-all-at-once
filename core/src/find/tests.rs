use super::*;
use crate::world::{Tag, Thread};
use crate::world::{Change, Journal, ThreadStatus};
use tokio::sync::{broadcast, mpsc};

struct Fixture { core: Arc<Core>, path: std::path::PathBuf }

impl Fixture {
    fn new(world: World) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-find-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let (updates, _) = broadcast::channel(128);
        let (placer_queue, _) = mpsc::unbounded_channel();
        Self { path, core: Arc::new(Core {
            find: Runtime::default(), recap: crate::recap::Runtime::default(), apps: crate::apps::Runtime::default(), imports: crate::import::Imports::default(),
            world: Mutex::new(world), journal: Mutex::new(journal), updates, placer_queue, room: None,
            key: None, placer_model: "test".into(), http: reqwest::Client::new(),
            last_activity: std::sync::atomic::AtomicU64::new(0), looked: std::sync::atomic::AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
        }) }
    }
}

impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_file(&self.path); } }

fn thread(id: &str, title: &str, touched_ms: u64) -> Thread {
    Thread {
        id: id.into(), title: title.into(), parent_id: None, status: crate::world::ThreadStatus::Open,
        last_point: String::new(), touched_ms, tags: Vec::new(), picture: None, dropped_by: String::new(),
    }
}

fn point(id: &str, thread: &str, text: &str, at_ms: u64) -> Thought {
    Thought {
        id: id.into(), speaker: "you".into(), text: text.into(), point: text.into(), thread_id: Some(thread.into()),
        placed: true, unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(),
        complete: true, at_ms, place_ms: None,
    }
}

#[test]
fn accepts_whole_requests_with_filler_and_polite_words() {
    for ask in [
        "Where did I talk about rent?", "where did we talk about rent", "Take me to rent.",
        "Didn't I say something about rent?", "Didn’t I say something about rent?", "find rent",
        "Okay, um, could you please find rent for me?", "So, take me back to the thread about rent, please.",
        "Can you show me what I said about rent?", "Where have I talked about rent?", "Didn't I mention rent?",
        "WHERE DID I WRITE ABOUT RENT?!", "did i say anything about rent", "please find #rent",
        "Didn't I talk about rent?", "Where have I mentioned rent?",
    ] {
        assert_eq!(command(ask).as_deref(), Some(if ask.contains('#') { "#rent" } else { "rent" }), "{ask}");
    }
}

#[test]
fn leaves_ordinary_thoughts_alone() {
    for thought in [
        "I need to find the rent receipt", "We should find a cheaper place", "I'm finding rent stressful",
        "I couldn't find anything about rent", "I wonder where I talked about rent", "The find button should be blue",
        "We talked about finding a flat", "Maybe take me to Paris next year", "A search could find rent",
        "Finding rent receipts takes time", "Findings from the study", "finder windows are useful",
        "go back to the drawing board", "where was I?", "go to the next one", "find", "find please", "take me to",
    ] {
        assert!(command(thought).is_none(), "{thought}");
    }
}

#[test]
fn finds_old_points_before_recent_but_weaker_threads() {
    let world = World {
        threads: vec![thread("old", "Home", 1), thread("new", "Rent", 900)],
        thoughts: vec![point("answer", "old", "Rent deposit comes back in June", 1), point("later", "old", "Buy some paint", 2), point("other", "new", "Rent is high", 900)],
        ..World::default()
    };
    let found = deterministic(&world, "rent deposit").unwrap();
    assert_eq!((found.thread_id.as_str(), found.thought_id.as_deref()), ("old", Some("answer")));
    assert!(deterministic(&world, "rent deposit spaceship").is_none(), "weak overlap never jumps");
}

#[test]
fn ranks_titles_tags_stems_and_whole_words() {
    let mut tagged = thread("tagged", "Next steps", 3);
    tagged.tags.push(Tag { name: "#garden".into(), kept: false });
    let world = World {
        threads: vec![thread("title", "Budget plans", 1), tagged, thread("other", "Parenting", 100)],
        thoughts: vec![point("p", "title", "Planning the budgets for summer", 1), point("g", "tagged", "Plant tomatoes", 3)],
        ..World::default()
    };
    assert_eq!(deterministic(&world, "budget plan").unwrap().thought_id.as_deref(), Some("p"));
    assert_eq!(deterministic(&world, "garden").unwrap().thread_id, "tagged");
    assert_eq!(deterministic(&world, "tomato garden").unwrap().thought_id.as_deref(), Some("g"));
    assert!(deterministic(&world, "rent").is_none(), "rent is not inside parenting");
    assert!(deterministic(&world, "astronomy").is_none());
    assert!(deterministic(&world, "the thing").is_none());
    assert_eq!(words("meetings planned budgets"), words("meeting planning budget"));
}

#[test]
fn recency_only_breaks_equal_matches() {
    let world = World {
        threads: vec![thread("old", "Home", 1), thread("new", "Home", 20)],
        thoughts: vec![point("a", "old", "Rent is due", 1), point("b", "new", "Rent is due", 10), point("c", "new", "Rent is due", 20)],
        ..World::default()
    };
    assert_eq!(deterministic(&world, "rent").unwrap().thought_id.as_deref(), Some("c"));
}

#[test]
fn pending_points_and_scattered_words_are_not_answers() {
    let mut pending = point("pending", "T1", "spaceship", 10);
    pending.placed = false;
    let world = World {
        threads: vec![thread("T1", "Notes", 10)],
        thoughts: vec![point("rent", "T1", "rent", 1), point("bikes", "T1", "bikes", 2), pending],
        ..World::default()
    };
    assert!(deterministic(&world, "spaceship").is_none());
    assert!(deterministic(&world, "rent bikes").is_none());
    assert!(deterministic(&World::default(), "rent").is_none());
}

#[test]
fn model_choices_need_supplied_ids_and_real_evidence() {
    let world = World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("rent", "T1", "Pay the landlord on Friday", 1), point("work", "T2", "Ship on Monday", 2)],
        ..World::default()
    };
    let source = source(&world, "rent");
    let choose = |thread: &str, thought: &str, evidence: &str| checked(&world, &source, Choice {
        thread_id: thread.into(), thought_id: thought.into(), evidence: evidence.into(),
    });
    assert_eq!(choose("T1", "rent", "landlord").unwrap().point, "Pay the landlord on Friday");
    for (thread, thought, evidence) in [
        ("T9", "rent", "landlord"), ("T2", "rent", "landlord"), ("T1", "fake", "landlord"),
        ("T1", "rent", "Pay rent tomorrow"), ("T1", "rent", ""), ("", "", ""),
    ] { assert!(choose(thread, thought, evidence).is_none()); }
}

#[test]
fn fallback_is_bounded_and_only_offers_latest_points() {
    let world = World {
        threads: (0..60).map(|i| thread(&format!("T{i}"), "Notes", i)).collect(),
        thoughts: (0..10).map(|i| point(&format!("p{i}"), "T59", &"word ".repeat(100), i)).collect(),
        ..World::default()
    };
    let source = source(&world, "unrelated");
    assert_eq!(source.len(), 48);
    assert_eq!(source[0].thread_id, "T59");
    assert_eq!(source[0].last_points.len(), 3);
    assert_eq!(source[0].last_points[0].thought_id, "p9");
    assert!(source[0].last_points.iter().all(|p| p.point.chars().count() <= 320));
    assert!(checked(&world, &source, Choice { thread_id: "T59".into(), thought_id: "p0".into(), evidence: "word".into() }).is_none());
}

#[test]
fn a_new_request_only_cancels_that_speakers_old_request() {
    let runtime = Runtime::default();
    let User = runtime.cancel("User");
    let sam = runtime.cancel("Sam");
    assert!(runtime.current("User", User));
    runtime.cancel("User");
    assert!(!runtime.current("User", User));
    assert!(runtime.current("Sam", sam));
}

#[test]
fn requests_focus_only_the_asker_and_send_a_private_jump_without_adding_a_thought() {
    let mut rent = thread("T1", "Home", 1);
    rent.status = ThreadStatus::Dropped;
    rent.dropped_by = "User".into();
    let fixture = Fixture::new(World {
        threads: vec![rent, thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1)],
        active: Some("T2".into()),
        active_by: HashMap::from([("User".into(), "T2".into()), ("Sam".into(), "T2".into())]),
        ..World::default()
    });
    let mut updates = fixture.core.updates.subscribe();
    fixture.core.add_thought("User", "Where did I talk about the rent deposit?");
    let world = fixture.core.snapshot();
    assert_eq!(world.active_for("User").map(String::as_str), Some("T1"));
    assert_eq!(world.active_for("Sam").map(String::as_str), Some("T2"));
    assert_eq!(world.thread("T1").unwrap().status, ThreadStatus::Open);
    assert_eq!(world.thoughts.len(), 1);
    let mut jumps = 0;
    while let Ok(out) = updates.try_recv() {
        match out.message {
            ServerMsg::Found { thread_id, thought_id, message } => {
                assert_eq!(out.to.as_deref(), Some("User"));
                assert_eq!(thread_id, "T1");
                assert_eq!(thought_id.as_deref(), Some("answer"));
                assert_eq!(message, "Here: Home — Rent deposit comes back in June");
                jumps += 1;
            }
            ServerMsg::Change { change: Change::ActiveChanged { speaker, .. } } => assert_eq!(speaker, "User"),
            ServerMsg::Change { change: Change::ThreadStatus { .. } } => {}
            _ => panic!("unexpected message"),
        }
    }
    assert_eq!(jumps, 1);
    let journal = std::fs::read_to_string(&fixture.path).unwrap();
    assert!(journal.lines().all(|line| serde_json::from_str::<Change>(line).is_ok()), "only existing journal changes");
    fixture.core.add_thought("User", "I need to find the rent receipt");
    assert_eq!(fixture.core.snapshot().thoughts.len(), 2, "ordinary thoughts still reach placement");
}

#[test]
fn missing_and_weak_matches_without_a_key_leave_the_map_alone() {
    let fixture = Fixture::new(World {
        threads: vec![thread("T1", "Rent", 1)], active: Some("T1".into()), ..World::default()
    });
    let mut updates = fixture.core.updates.subscribe();
    for query in ["spaceship", "rent spaceship"] {
        request(fixture.core.clone(), "Sam".into(), query.into());
        let out = updates.try_recv().unwrap();
        assert_eq!(out.to.as_deref(), Some("Sam"));
        assert!(matches!(out.message, ServerMsg::Notice { message } if message == "I couldn't find a matching thread or point."));
        assert!(updates.try_recv().is_err());
        assert!(fixture.core.snapshot().active_by.is_empty());
        assert!(std::fs::read_to_string(&fixture.path).unwrap().is_empty());
    }
}

#[test]
fn a_late_result_follows_a_merge_and_uses_the_current_words() {
    let mut world = World {
        threads: vec![thread("T1", "Rent", 1), thread("T2", "Home", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit returns in May", 1)], ..World::default()
    };
    let found = deterministic(&world, "rent deposit").unwrap();
    world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T2".into() });
    world.thoughts[0].point = "Rent deposit returns in June".into();
    let fixture = Fixture::new(world);
    let mut updates = fixture.core.updates.subscribe();
    show(&fixture.core, "User", found);
    let mut seen = false;
    while let Ok(out) = updates.try_recv() {
        if let ServerMsg::Found { thread_id, message, .. } = out.message {
            assert_eq!(thread_id, "T2");
            assert_eq!(message, "Here: Home — Rent deposit returns in June");
            seen = true;
        }
    }
    assert!(seen);
}

#[tokio::test]
async fn a_jump_waits_for_the_thought_said_just_before_it() {
    // User said something a moment ago; it's still finding its thread when User asks where the rent deposit came up.
    let pending = Thought { speaker: "User".into(), placed: false, ..point("pending", "T2", "Paint the kitchen", crate::now_ms()) };
    let fixture = Fixture::new(World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1), pending],
        active_by: HashMap::from([("User".into(), "T2".into())]),
        ..World::default()
    });
    let mut updates = fixture.core.updates.subscribe();
    fixture.core.add_thought("User", "Where did I talk about the rent deposit?");
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T2"), "nothing moves while it's placed");
    // It lands on Work and makes Work User's thread; only then the jump, which User keeps.
    fixture.core.commit(vec![
        Change::ThoughtPlaced {
            thought_id: "pending".into(), thread_id: "T2".into(), point: "Paint the kitchen".into(), unclear: String::new(),
            guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 900,
        },
        Change::ActiveChanged { thread_id: "T2".into(), speaker: "User".into() },
    ]);
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T1"));
    let mut said = Vec::new();
    while let Ok(out) = updates.try_recv() {
        match out.message {
            ServerMsg::Notice { message } => said.push(message),
            ServerMsg::Found { message, .. } => said.push(message),
            _ => {}
        }
    }
    assert_eq!(said, ["Looking through your threads…", "Here: Home — Rent deposit comes back in June"]);
}
