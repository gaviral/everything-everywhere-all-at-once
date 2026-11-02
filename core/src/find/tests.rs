//! Tests for "take me to …" (find.rs): which words are a search, how points rank, what the model
//! may choose, and what the person sees when nothing matches. No test calls the model.

use super::*;
use crate::world::{Tag, Thread};
use crate::world::{Change, Journal, ThreadStatus};

struct Fixture { core: Arc<Core>, path: std::path::PathBuf }

impl Fixture {
    fn new(world: World) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-find-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        Self { path, core: Arc::new(Core::test(journal, world)) }
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

/// What a turn searches for, if it's a search.
fn asked(text: &str) -> Option<String> {
    command(text).map(|ask| ask.query)
}

#[test]
fn accepts_whole_requests_with_filler_and_polite_words() {
    for ask in [
        "Where did I talk about rent?", "where did we talk about rent", "Take me to the thread about rent.",
        "Didn't I say something about rent?", "Didn’t I say something about rent?", "find the rent thread",
        "Okay, um, could you please find what I said about rent for me?", "So, take me back to the thread about rent, please.",
        "Can you show me what I said about rent?", "Where have I talked about rent?", "Didn't I mention rent?",
        "WHERE DID I WRITE ABOUT RENT?!", "did i say anything about rent", "please find #rent",
        "Didn't I talk about rent?", "Where have I mentioned rent?", "Take me back to rent",
        "Find where I talked about rent", "find where we said something about rent", "Take me to my thoughts on rent",
        // The words that lead into any request (main.rs `lead_in`).
        "Hey, where did I talk about rent?", "Well, all right, where did I talk about rent?", "Cool. Where did I talk about rent?",
        "Let's see, where did I talk about rent?", "Will you take me to the thread about rent?", "I see. Where did I talk about rent?",
    ] {
        assert_eq!(asked(ask).as_deref(), Some(if ask.contains('#') { "#rent" } else if ask.contains("the rent") { "the rent" } else { "rent" }), "{ask}");
    }
    assert_eq!(asked("Find where I said the deposit comes back").as_deref(), Some("the deposit comes back"));
}

#[test]
fn the_question_is_the_first_sentence_and_the_words_after_it_are_kept() {
    let ask = |query: &str, topic: &str, rest: &str, saying: bool| Some(Ask { query: query.into(), topic: topic.into(), rest: rest.into(), saying });
    for (text, expected) in [
        ("Where did I talk about the lease? I think it was due Friday.", ask("the lease", "the lease", "I think it was due Friday.", false)),
        ("Where did I talk about the lease… it's due Friday", ask("the lease", "the lease", "it's due Friday", false)),
        ("Take me to the thread about rent. Also the deposit.", ask("rent", "rent", "Also the deposit.", false)),
        // Only filler or a "please" after it isn't a thought.
        ("Where did I talk about the lease? Um.", ask("the lease", "the lease", "", false)),
        ("Take me to the thread about rent. Please.", ask("rent", "rent", "", false)),
        // A title or an initial doesn't end the question.
        ("Where did I talk about Dr. Patel?", ask("dr patel", "Dr. Patel", "", false)),
        ("Where did I talk about the U.S. visa?", ask("the u s visa", "the U.S. visa", "", false)),
        ("Where did I talk about my Ph.D. applications?", ask("my ph d applications", "my Ph.D. applications", "", false)),
        // A name or a number with a dot in it does, and so does a digit.
        ("Where did I talk about v2.1. It ships Friday.", ask("v2 1", "v2.1", "It ships Friday.", false)),
        ("Where did I talk about step 2. It was hard.", ask("step 2", "step 2", "It was hard.", false)),
        // The topic as it was said, for "I couldn't find …".
        ("Where did I talk about Dana's party?", ask("danas party", "Dana's party", "", false)),
        // "Take me back to …" with nothing pointing at the map may be a saying.
        ("Take me back to Paris.", ask("paris", "Paris", "", true)),
        ("Take me back to Paris. It was lovely.", ask("paris", "Paris", "It was lovely.", true)),
        ("Take me back to the thread about Paris", ask("paris", "Paris", "", false)),
        // A tag points at the map, as a pointer does.
        ("Take me back to #paris", ask("#paris", "#paris", "", false)),
    ] {
        assert_eq!(command(text), expected, "{text}");
    }
    // Initials in brackets don't end it either.
    assert_eq!(first_sentence("Where did I talk about bills (e.g. rent)? It's due."), ("Where did I talk about bills (e.g. rent)?", "It's due."));
}

#[test]
fn find_and_take_me_to_are_errands_unless_they_point_at_the_map() {
    // To-dos as often as asks: they stay thoughts, whatever is on the map.
    for thought in [
        "Find a dentist near the office", "Take me to the airport Friday", "Find time to call Mom",
        "Find out whether the venue has Wi-Fi", "Okay, find a babysitter for Saturday", "Can you find a cheaper flight?",
        "find rent", "Take me to rent.", "Find something about Roman history for the essay", "Find where I left my keys",
    ] {
        assert!(command(thought).is_none(), "{thought}");
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
fn the_one_about_a_topic_searches_after_go_to_take_me_to_or_find() {
    for (ask, query) in [
        ("Go to the one about rent", "rent"),
        ("Take me to the one where I mentioned the lease", "the lease"),
        ("find the one about rent", "rent"),
        ("Go back to the thread about rent", "rent"),
        ("go to the rent thread", "the rent"),
    ] {
        assert_eq!(asked(ask).as_deref(), Some(query), "{ask}");
    }
    // Only mentioned, no topic, a "go to" that doesn't point at the map, or "the one about …" alone, which speech
    // splits off the end of a thought ("…that cookbook. The one about Oaxacan food.").
    for thought in [
        "The one about never finishing things", "the one where I talked about rent", "Okay, the one about rent.",
        "The one about Oaxacan food.",
        "I liked the one about rent", "the one", "the one about", "The one I bought is blue", "go to the one", "Go to the gym",
        "Go to the store on Friday", "go to the last one", "go back to the drawing board",
    ] {
        assert!(command(thought).is_none(), "{thought}");
    }
}

#[test]
fn go_to_the_one_about_a_topic_jumps_as_where_did_i_talk_about_does() {
    let fixture = Fixture::new(World {
        threads: vec![thread("T1", "Habits", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "I never finish what I start", 1)],
        active_by: HashMap::from([("User".into(), "T2".into())]),
        ..World::default()
    });
    fixture.core.add_thought("User", "Go to the one about never finishing things");
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T1"));
    assert_eq!(fixture.core.snapshot().thoughts.len(), 1, "a jump, not a thought");
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
    let source = source(&world, &rank(&world, "rent"));
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
    let source = source(&world, &rank(&world, "unrelated"));
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
    let (User, _) = runtime.next("User", String::new(), String::new());
    let (sam, _) = runtime.next("Sam", String::new(), String::new());
    assert!(runtime.current("User", User));
    let (_, stopped) = runtime.next("User", String::new(), String::new());
    assert_eq!(stopped.request, User);
    assert!(!runtime.current("User", User));
    assert!(runtime.current("Sam", sam));
    // An ended search can't answer twice.
    assert!(runtime.end("Sam", sam).is_some() && runtime.end("Sam", sam).is_none());
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
            // Where a correction of this turn would start from (catalog.rs), to the asker alone.
            ServerMsg::Correctable { .. } => assert_eq!(out.to.as_deref(), Some("User")),
            _ => panic!("unexpected message"),
        }
    }
    assert_eq!(jumps, 1);
    let journal = std::fs::read_to_string(&fixture.path).unwrap();
    assert!(journal.lines().all(|line| serde_json::from_str::<Change>(line).is_ok()), "only existing journal changes");
    fixture.core.add_thought("User", "I need to find the rent receipt");
    assert_eq!(fixture.core.snapshot().thoughts.len(), 2, "ordinary thoughts still reach placement");
}

/// The messages one speaker got, with the thoughts added, in order.
fn told(updates: &mut tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>) -> Vec<String> {
    std::iter::from_fn(|| updates.try_recv().ok()).filter_map(|out| match out.message {
        ServerMsg::Notice { message } => Some(format!("notice: {message}")),
        ServerMsg::Found { message, .. } => Some(format!("found: {message}")),
        ServerMsg::Change { change: Change::ThoughtAdded { thought } } => Some(format!("thought: {}", thought.text)),
        _ => None,
    }).collect()
}

/// A question that can only mean the map finds nothing: a notice that says what was tried, and nothing filed, since
/// asking again would file it twice. Never "it isn't there": the model misses some paraphrases.
#[test]
fn a_question_that_finds_nothing_says_why_and_files_nothing() {
    for (map, said, notice) in [
        (vec![thread("T1", "Rent", 1)], "Where did I talk about the spaceship?", "I couldn't find “the spaceship”. Searching by meaning needs the AI key."),
        (vec![thread("T1", "Rent", 1)], "Where did I talk about rent spaceships?", "I couldn't find “rent spaceships”. Searching by meaning needs the AI key."),
        (vec![thread("T1", "Rent", 1)], "Where did I talk about it?", "I couldn't find “it”. Try a few words you used."),
        (vec![thread("T1", "Rent", 1)], "Take me back to #spaceship", "I couldn't find “#spaceship”. Searching by meaning needs the AI key."),
        (vec![], "Where did I talk about the spaceship?", "Nothing on the map yet: say a thought first"),
    ] {
        let fixture = Fixture::new(World { threads: map, active: Some("T1".into()), ..World::default() });
        let mut updates = fixture.core.updates.subscribe();
        fixture.core.add_thought("Sam", said);
        assert_eq!(told(&mut updates), [format!("notice: {notice}")], "{said}");
        assert!(fixture.core.snapshot().thoughts.is_empty() && fixture.core.snapshot().active_by.is_empty(), "{said}");
    }
}

/// Words said after the question are kept whatever it finds: after the jump, so they go on where it landed. A
/// "take me back to …" that may be a saying is kept whole when nothing is found.
#[test]
fn words_after_the_question_and_a_saying_are_kept() {
    let world = || World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1)],
        active_by: HashMap::from([("User".into(), "T2".into())]),
        ..World::default()
    };
    for (said, expected, on) in [
        (
            "Where did I talk about the rent deposit? The landlord says June.",
            vec!["found: Here: Home — Rent deposit comes back in June", "thought: The landlord says June."],
            "T1",
        ),
        (
            "Where did I talk about the spaceship? It flew over the house.",
            vec!["notice: I couldn't find “the spaceship”. Searching by meaning needs the AI key.", "thought: It flew over the house."],
            "T2",
        ),
        // The dot of a web address ends the question too.
        (
            "Find the thread about example.com. The renewal is due Friday.",
            vec!["notice: I couldn't find “example.com”. Searching by meaning needs the AI key.", "thought: The renewal is due Friday."],
            "T2",
        ),
        ("Take me back to Paris.", vec!["notice: I couldn't find “Paris”, so I kept it as a thought.", "thought: Take me back to Paris."], "T2"),
        (
            "Take me back to Paris. It was lovely.",
            vec!["notice: I couldn't find “Paris”, so I kept it as a thought.", "thought: Take me back to Paris. It was lovely."],
            "T2",
        ),
    ] {
        let fixture = Fixture::new(world());
        let mut updates = fixture.core.updates.subscribe();
        fixture.core.add_thought("User", said);
        assert_eq!(told(&mut updates), expected, "{said}");
        let world = fixture.core.snapshot();
        assert_eq!(world.active_for("User").map(String::as_str), Some(on), "{said}");
        // A kept thought starts out on the thread the speaker is on: after a jump, the answer's.
        assert!(world.thoughts.iter().filter(|t| !t.placed).all(|t| t.thread_id.as_deref() == Some(on)), "{said}");
    }
}

/// "Looking through your threads…" stays up until the answer, so newer words that stop the search take it down;
/// the words the search held go in first, in the order they were said.
#[tokio::test]
async fn newer_words_stop_a_search_and_take_down_its_notice() {
    let pending = Thought { speaker: "User".into(), placed: false, ..point("pending", "T2", "Paint the kitchen", crate::now_ms()) };
    let mut fixture = Fixture::new(World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1), pending],
        active_by: HashMap::from([("User".into(), "T2".into())]),
        ..World::default()
    });
    // A working key, so the search waits for the thought still placing and says it's looking.
    Arc::get_mut(&mut fixture.core).unwrap().key = Some("test".into());
    let mut updates = fixture.core.updates.subscribe();
    fixture.core.add_thought("User", "Where did I talk about the rent deposit? The landlord says June.");
    fixture.core.add_thought("User", "Hmm.");
    assert_eq!(told(&mut updates), ["notice: Looking through your threads…"], "\"hmm\" adds nothing, so the search goes on");
    fixture.core.add_thought("User", "The kitchen needs paint.");
    assert_eq!(told(&mut updates), ["notice: ", "thought: The landlord says June.", "thought: The kitchen needs paint."]);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T2"), "the stopped search never jumps");
    assert!(told(&mut updates).is_empty());
}

/// Two questions in one turn answer one after the other. A click while the first waits stops both: the second was
/// asked before the click too, and its answer would undo it. The words after them are kept either way.
#[tokio::test]
async fn a_click_stops_a_search_and_any_search_its_words_ask() {
    let said = "Where did I talk about the lease? Where did I talk about rent? It's due on the first.";
    let world = || World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2), thread("T3", "Bills", 3)],
        thoughts: vec![point("lease", "T1", "The lease ends in June", 1), point("rent", "T3", "Rent is due on the first", 2)],
        active_by: HashMap::from([("you".into(), "T1".into())]),
        ..World::default()
    };
    let fixture = Fixture::new(world());
    let mut updates = fixture.core.updates.subscribe();
    fixture.core.add_thought("you", said);
    let both = ["found: Here: Home — The lease ends in June", "found: Here: Bills — Rent is due on the first", "thought: It's due on the first."];
    assert_eq!(told(&mut updates), both);
    assert_eq!(fixture.core.snapshot().active_for("you").map(String::as_str), Some("T3"));
    // The first waits for a thought still placing (a working key, so it can land), and Work is clicked meanwhile.
    let mut busy = world();
    busy.thoughts.push(Thought { placed: false, ..point("pending", "T1", "Paint the kitchen", crate::now_ms()) });
    let mut fixture = Fixture::new(busy);
    Arc::get_mut(&mut fixture.core).unwrap().key = Some("test".into());
    let mut updates = fixture.core.updates.subscribe();
    fixture.core.add_thought("you", said);
    fixture.core.focus("you", "T2");
    fixture.core.commit(vec![Change::ThoughtPlaced {
        thought_id: "pending".into(), thread_id: "T1".into(), point: "Paint the kitchen".into(), unclear: String::new(),
        guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 900,
    }]);
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(fixture.core.snapshot().active_for("you").map(String::as_str), Some("T2"), "nothing asked before the click moves you after it");
    assert_eq!(told(&mut updates), ["notice: Looking through your threads…", "notice: ", "thought: It's due on the first."]);
}

#[test]
fn a_to_do_that_starts_with_find_or_take_me_to_reaches_the_map() {
    let fixture = Fixture::new(World {
        threads: vec![thread("T1", "Dentist", 1), thread("T2", "Airport pickup", 2), thread("T3", "Call Mom", 3)],
        thoughts: vec![point("a", "T1", "Find a dentist near the office", 1), point("b", "T2", "Airport Friday at six", 2), point("c", "T3", "Call Mom this week", 3)],
        active_by: HashMap::from([("User".into(), "T3".into())]),
        ..World::default()
    });
    let mut updates = fixture.core.updates.subscribe();
    for said in ["Find a dentist near the office", "Take me to the airport Friday", "Find time to call Mom"] {
        fixture.core.add_thought("User", said);
        assert_eq!(fixture.core.snapshot().thoughts.last().map(|t| (t.text.as_str(), t.placed)), Some((said, false)), "{said}");
    }
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T3"), "no jump");
    while let Ok(out) = updates.try_recv() {
        assert!(!matches!(out.message, ServerMsg::Found { .. } | ServerMsg::Notice { .. }), "a thought, not a search");
    }
    // Once those are placed (a search waits for them), the unmistakable ways still search.
    let placed = fixture.core.snapshot().thoughts.iter().filter(|t| !t.placed).map(|t| Change::ThoughtPlaced {
        thought_id: t.id.clone(), thread_id: "T1".into(), point: t.text.clone(), unclear: String::new(), guess: String::new(),
        heard: String::new(), fixed: String::new(), complete: true, place_ms: 900,
    }).collect();
    fixture.core.commit(placed);
    fixture.core.commit(vec![Change::ActiveChanged { thread_id: "T3".into(), speaker: "User".into() }]);
    fixture.core.add_thought("User", "Find where I talked about the airport");
    assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T2"));
    assert_eq!(fixture.core.snapshot().thoughts.len(), 6);
}

#[test]
fn filler_while_a_search_is_looking_keeps_the_search() {
    let fixture = Fixture::new(World::default());
    let (request, _) = fixture.core.find.next("User", String::new(), String::new());
    fixture.core.add_thought("User", "Hmm.");
    fixture.core.add_thought("User", "um, okay");
    assert!(fixture.core.find.current("User", request), "\"hmm\" while it looks adds nothing");
    fixture.core.add_thought("User", "The deposit comes back in June.");
    assert!(!fixture.core.find.current("User", request), "a new thought is newer than the search");
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
    let (request, _) = fixture.core.find.next("User", String::new(), String::new());
    show(&fixture.core, "User", request, found, "the rent deposit");
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
    let mut fixture = Fixture::new(World {
        threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
        thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1), pending],
        active_by: HashMap::from([("User".into(), "T2".into())]),
        ..World::default()
    });
    // A working key, so the thought can land.
    Arc::get_mut(&mut fixture.core).unwrap().key = Some("test".into());
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

/// Without a working key the thought said just before is never placed, so the jump doesn't wait for it: with no
/// key, with one the service refused, or from the moment the service refuses it.
#[tokio::test(start_paused = true)]
async fn without_a_working_key_a_jump_doesnt_wait_for_a_thought_that_cant_be_placed() {
    for key in ["none", "refused", "refused while the jump waits"] {
        let pending = Thought { speaker: "User".into(), placed: false, ..point("pending", "T2", "Paint the kitchen", crate::now_ms()) };
        let mut fixture = Fixture::new(World {
            threads: vec![thread("T1", "Home", 1), thread("T2", "Work", 2)],
            thoughts: vec![point("answer", "T1", "Rent deposit comes back in June", 1), pending],
            active_by: HashMap::from([("User".into(), "T2".into())]),
            ..World::default()
        });
        if key != "none" {
            Arc::get_mut(&mut fixture.core).unwrap().key = Some("wrong".into());
        }
        if key == "refused" {
            let _ = fixture.core.check(reqwest::StatusCode::UNAUTHORIZED);
        }
        fixture.core.add_thought("User", "Where did I talk about the rent deposit?");
        if key == "refused while the jump waits" {
            let _ = fixture.core.check(reqwest::StatusCode::UNAUTHORIZED);
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        assert_eq!(fixture.core.snapshot().active_for("User").map(String::as_str), Some("T1"), "{key}");
    }
}
