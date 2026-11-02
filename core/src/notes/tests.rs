//! Tests for the Notes connector (notes.rs). Every one stands in for `osascript`, so no note is ever written or
//! opened: the stand-in only writes down which script it was asked to run, and with what.

use super::*;
use crate::messages::{Preset, Settings};
use crate::protocol::Outgoing;
use crate::world::fixtures::{thought, thread};
use crate::world::Journal;
use tokio::sync::broadcast::Receiver;

type Ran = Arc<Mutex<Vec<(&'static str, Vec<String>)>>>;

struct Fixture {
    core: Arc<Core>,
    ran: Ran,
    out: Receiver<Outgoing>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(preset: Preset, write: bool, world: World) -> Self {
        Self::with(preset, write, world, Ok("x-coredata://note/p7".into()), |core| core)
    }

    fn with(preset: Preset, write: bool, world: World, answer: Result<String, String>, adjust: impl FnOnce(Core) -> Core) -> Self {
        let ran: Ran = Arc::default();
        let log = ran.clone();
        // The stand-in for osascript: it writes down the script (by its job) and arguments, and answers as told.
        let script: Script = Arc::new(move |lines, args| {
            let job = if lines == WRITE { "write" } else if lines == OPEN { "open" } else { "other" };
            log.lock().unwrap().push((job, args));
            let answer = answer.clone();
            Box::pin(async move { answer })
        });
        let path = std::env::temp_dir().join(format!("e2a2o-notes-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let messages = crate::messages::Runtime::with(Settings { preset, ..Settings::default() }, Arc::new(|_, _| Box::pin(async { Err("no".into()) })));
        let core = Arc::new(adjust(Core { messages, notes: Runtime::with(write, script), ..Core::test(journal, world) }));
        let out = core.updates.subscribe();
        Self { core, ran, out, path }
    }

    fn ran(&self) -> Vec<(&'static str, Vec<String>)> {
        self.ran.lock().unwrap().clone()
    }

    /// The cards and notices sent since last asked, as short lines.
    fn told(&mut self) -> Vec<String> {
        std::iter::from_fn(|| self.out.try_recv().ok())
            .filter_map(|o| match o.message {
                ServerMsg::NoteCard { title, sections, state, live, message, .. } => {
                    let points: usize = sections.iter().map(|s| s.points.len()).sum();
                    Some(format!("card {state:?} {title} ({points} points, live {live}): {message}"))
                }
                ServerMsg::Notice { message } if !message.is_empty() => Some(format!("notice {message}")),
                _ => None,
            })
            .collect()
    }

    fn thoughts(&self) -> Vec<String> {
        self.core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

/// A picnic plan: its points in the order said (listed out of order), one decided, one trailing off, one still being
/// placed, and a branch about the weather; a thread on bills apart from it. You're on the picnic.
fn picnic() -> World {
    let now = crate::now_ms();
    let mut decided = thought("b", "T1", "Let's go with Saturday at noon", now - 200_000);
    decided.point = "Saturday at noon".into();
    decided.decided = true;
    let mut trailing = thought("c", "T1", "and we still need someone to bring the", now - 100_000);
    trailing.complete = false;
    let mut pending = thought("p", "T1", "maybe frisbees", now - 10_000);
    pending.placed = false;
    let mut weather = thread("T3", "Weather", 3);
    weather.parent_id = Some("T1".into());
    World {
        threads: vec![thread("T1", "Picnic at the lake", 1), thread("T2", "Bills", 2), weather],
        thoughts: vec![
            decided,
            thought("a", "T1", "picnic at the lake with Mia & Sam", now - 300_000),
            trailing,
            pending,
            thought("d", "T2", "The electric bill is due Friday", now - 250_000),
            thought("e", "T3", "Check the <rain> forecast", now - 150_000),
        ],
        active: Some("T1".into()),
        active_by: HashMap::from([("me".into(), "T1".into())]),
        ..World::default()
    }
}

#[test]
fn a_turn_reads_as_a_note_only_when_it_says_so() {
    let this = |bare| Some(Ask { target: Target::This, bare });
    assert_eq!(read("Save this thread as a note"), this(false));
    assert_eq!(read("Okay, can you save this as a note, please?"), this(false));
    assert_eq!(read("Put this in Notes."), this(true));
    assert_eq!(read("put it in my notes"), this(true));
    assert_eq!(read("Save this to Apple Notes"), this(false));
    assert_eq!(read("Add this thread to the Notes app"), this(false));
    assert_eq!(read("Save as a note"), this(false));
    assert_eq!(read("Save the picnic thread as a note"), Some(Ask { target: Target::Named("the picnic thread".into()), bare: false }));
    assert_eq!(read("add milk to my notes"), Some(Ask { target: Target::Named("milk".into()), bare: true }));
    for not in [
        "I put it in my notes",                         // talk about notes
        "Save money for a new car",                     // an errand
        "Save the receipts for the notes",              // not to Notes
        "Put a note on the fridge",                     // a note, not Notes
        "Save this",                                    // nothing says Notes
        "Note to self: call the landlord",              // a thought
        "Save the long story about the trip we took to the lake last summer as a note", // a sentence
    ] {
        assert_eq!(read(not), None, "{not}");
    }
    // The catalog's reading, without the map: "put this in Notes" and filing words stay the rules' they were.
    for note in ["Save this thread as a note", "Save this to Notes", "Put this in Apple Notes", "Save the picnic thread to Notes"] {
        assert_eq!(kind(note), Some(Act::Note), "{note}");
        assert_eq!(crate::catalog::classify(note), Some(Act::Note), "{note}");
    }
    assert_eq!(kind("Put this in Notes"), None);
    assert_eq!(kind("add milk to my notes"), None);
    assert_eq!(name("the picnic thread"), "picnic");
}

#[test]
fn the_note_is_the_threads_points_in_order_with_decisions_and_unfinished_marked() {
    let note = note(&picnic(), "T1", crate::now_ms()).unwrap();
    let point = |text: &str, decided, unfinished| NotePoint { text: text.into(), who: String::new(), decided, unfinished };
    assert_eq!(
        note,
        Note {
            title: "Picnic at the lake".into(),
            sections: vec![
                NoteSection {
                    title: String::new(),
                    points: vec![
                        point("Picnic at the lake with Mia & Sam", false, false),
                        point("Saturday at noon", true, false),
                        point("And we still need someone to bring the", false, true),
                    ],
                },
                NoteSection { title: "Weather".into(), points: vec![point("Check the <rain> forecast", false, false)] },
            ],
        },
        "placed points only, in the order said; its branch under its own heading; nothing from Bills"
    );
    assert_eq!(
        note.html(),
        "<div><h1>Picnic at the lake</h1></div><ul><li>Picnic at the lake with Mia &amp; Sam</li><li><b>Decided:</b> Saturday at noon</li>\
<li>And we still need someone to bring the <i>(unfinished)</i></li></ul><div><h2>Weather</h2></div><ul><li>Check the &lt;rain&gt; forecast</li></ul>",
        "words said are escaped: they read as text, never as markup"
    );
    // In a room, each point says who said it.
    let mut room = picnic();
    room.thoughts[1].speaker = "Ana".into();
    let note = super::note(&room, "T1", crate::now_ms()).unwrap();
    assert_eq!(note.sections[0].points[0].who, "Ana");
    assert_eq!(note.sections[0].points[1].who, "you");
    assert!(note.html().contains("<li>Ana: Picnic"));
}

#[tokio::test]
async fn in_the_demo_preset_nothing_is_written_and_the_words_stay_a_thought() {
    let mut f = Fixture::new(Preset::Demo, true, picnic());
    f.core.add_thought("me", "Save this thread as a note");
    settle().await;
    assert!(f.ran().is_empty(), "no osascript");
    assert!(f.told().iter().all(|t| !t.starts_with("card")));
    assert!(f.thoughts().contains(&"Save this thread as a note".to_string()), "as before Notes existed");
}

#[tokio::test]
async fn without_notes_write_it_is_a_dry_run_that_shows_the_note_and_writes_nothing() {
    let mut f = Fixture::new(Preset::Full, false, picnic());
    let before = f.thoughts().len();
    f.core.add_thought("me", "Save this thread as a note");
    settle().await;
    assert_eq!(
        f.told(),
        vec!["card DryRun Picnic at the lake (4 points, live false): Dry run: nothing written. With NOTES_WRITE=on this would be a new note in Notes.".to_string()]
    );
    assert!(f.ran().is_empty(), "nothing written, nothing run");
    assert_eq!(f.thoughts().len(), before, "a request, not a thought");
    // Open in Notes has no note to show: nothing runs.
    assert!(!open(&f.core, "me", 1).await);
    assert!(f.ran().is_empty());
}

#[tokio::test]
async fn with_notes_write_on_it_writes_one_new_note_and_open_shows_only_that_one() {
    let mut f = Fixture::new(Preset::Full, true, picnic());
    f.core.add_thought("me", "Put this in Notes");
    settle().await;
    if !crate::apple::reachable() {
        // Not a Mac (or a hosted core): a dry run, never a write.
        assert!(f.ran().is_empty());
        return;
    }
    assert_eq!(
        f.told(),
        vec![
            "card Saving Picnic at the lake (4 points, live true): Saving to Notes…".to_string(),
            "card Saved Picnic at the lake (4 points, live true): Saved to Notes".to_string(),
        ]
    );
    let html = note(&picnic(), "T1", crate::now_ms()).unwrap().html();
    assert_eq!(f.ran(), vec![("write", vec![html])], "one write, the note as the card showed it");
    assert!(open(&f.core, "me", 1).await);
    assert_eq!(f.ran()[1], ("open", vec!["x-coredata://note/p7".to_string()]), "the note it wrote, by its id");
    assert!(!open(&f.core, "me", 99).await, "a card that wrote nothing opens nothing");
    assert_eq!(f.ran().len(), 2);
    assert!(f.ran().iter().all(|(job, _)| matches!(*job, "write" | "open")), "it never runs anything that edits or deletes");
}

#[tokio::test]
async fn a_named_thread_saves_that_thread_and_a_missing_one_is_said() {
    let mut f = Fixture::new(Preset::Full, false, picnic());
    f.core.add_thought("me", "Save the bills thread as a note");
    settle().await;
    let told = f.told();
    assert!(told[0].starts_with("card DryRun Bills (1 points"), "{told:?}");
    f.core.add_thought("me", "Save the garden thread to Notes");
    settle().await;
    assert_eq!(f.told(), vec!["notice Not saved: no thread called “garden” on the map.".to_string()]);
    assert!(f.ran().is_empty());
}

#[tokio::test]
async fn put_this_in_notes_means_a_thread_called_notes_when_there_is_one_and_filing_stays_filing() {
    let mut world = picnic();
    world.threads.push(thread("T4", "Notes", 4));
    let mut f = Fixture::new(Preset::Full, true, world);
    f.core.add_thought("me", "Put this in Notes");
    settle().await;
    assert!(f.told().iter().all(|t| !t.starts_with("card")), "the Notes thread is meant, as before");
    assert!(f.ran().is_empty());
    // "Add milk to my notes" names no thread: words to file, never a note.
    let mut f = Fixture::new(Preset::Full, true, picnic());
    f.core.add_thought("me", "Add milk to my notes");
    settle().await;
    assert!(f.told().iter().all(|t| !t.starts_with("card")));
    assert!(f.ran().is_empty());
}

#[tokio::test]
async fn a_guest_in_a_room_never_writes_into_the_hosts_notes() {
    let mut f = Fixture::with(Preset::Full, true, picnic(), Ok("id".into()), |core| Core { room: Some(crate::Room::from("k7m2x9qp")), ..core });
    f.core.add_thought("guest", "Save this thread as a note");
    settle().await;
    assert!(f.ran().is_empty());
    let told = f.told();
    assert!(told.iter().all(|t| !t.starts_with("card")) && told.iter().any(|t| t.contains("Only the host")), "{told:?}");
    assert!(!open(&f.core, "guest", 1).await);
    assert!(f.ran().is_empty());
}

#[tokio::test]
async fn when_notes_refuses_the_card_says_how_to_fix_it_and_the_next_save_can_go() {
    if !crate::apple::reachable() {
        return;
    }
    let refused = Err("execution error: Not authorized to send Apple events to Notes. (-1743)".to_string());
    let mut f = Fixture::with(Preset::Full, true, picnic(), refused, |core| core);
    f.core.add_thought("me", "Save this thread as a note");
    settle().await;
    let told = f.told();
    assert!(told[1].starts_with("card Failed") && told[1].contains("Automation"), "{told:?}");
    assert!(!open(&f.core, "me", 1).await, "nothing was written, so nothing opens");
    f.core.add_thought("me", "Save this thread as a note");
    settle().await;
    assert!(f.told()[0].starts_with("card Saving"), "one at a time ended with the answer");
}

#[tokio::test]
async fn a_thread_with_no_points_yet_is_said_not_saved() {
    let mut world = picnic();
    world.threads.push(thread("T5", "Empty", 5));
    world.active_by.insert("me".into(), "T5".into());
    let mut f = Fixture::new(Preset::Full, true, world);
    f.core.add_thought("me", "Save this thread as a note");
    settle().await;
    assert_eq!(f.told(), vec!["notice Not saved: “Empty” has no points yet.".to_string()]);
    assert!(f.ran().is_empty());
}

#[test]
fn the_default_runtime_writes_nothing() {
    let r = Runtime::default();
    assert!(!r.write, "a dry run unless NOTES_WRITE is on");
    assert!(!r.live());
}
