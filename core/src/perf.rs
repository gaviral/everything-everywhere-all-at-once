//! Offline, opt-in measurements of the real change, journal and prompt paths.
//! Run: cargo test --release -- --ignored perf --nocapture

use crate::world::{Action, Change, ItemStatus, Journal, Suggestion, Thought, Thread, ThreadStatus};
use crate::{protocol::ServerMsg, Core};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::hint::black_box;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{broadcast, mpsc};

// Count requested heap bytes on this test's thread, in a separate, untimed sample.
// This is cumulative allocation (including reallocations), not peak/live memory.
thread_local! { static ALLOCATED: Cell<Option<usize>> = const { Cell::new(None) }; }
struct CountingAllocator;
fn allocated(bytes: usize) {
    let _ = ALLOCATED.try_with(|n| {
        if let Some(total) = n.get() {
            n.set(Some(total + bytes));
        }
    });
}
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() {
            allocated(layout.size());
        }
        ptr
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc_zeroed(layout);
        if !ptr.is_null() {
            allocated(layout.size());
        }
        ptr
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let ptr = System.realloc(ptr, layout, size);
        if !ptr.is_null() {
            allocated(size);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

pub(crate) fn measure<T>(label: &str, mut run: impl FnMut() -> T, size: impl Fn(&T) -> usize) {
    measure_with_setup(label, || (), |_| run(), size);
}

pub(crate) fn measure_bytes(label: &str, mut run: impl FnMut() -> Vec<u8>) {
    measure(label, &mut run, Vec::len);
    // Optional exact payloads for comparing the before/after builds without network/model calls.
    if let Some(dir) = std::env::var_os("CORE_PERF_ARTIFACTS") {
        let dir = PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        let name: String = label.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
        std::fs::write(dir.join(format!("{name}.json")), run()).unwrap();
    }
}

fn measure_with_setup<S, T>(label: &str, mut setup: impl FnMut() -> S, mut run: impl FnMut(&S) -> T, size: impl Fn(&T) -> usize) {
    const SAMPLES: usize = 21;
    black_box(run(&setup())); // Warm caches; the journal measurement is explicitly warm-cache.
    let mut times = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let state = setup();
        let start = Instant::now();
        let value = black_box(run(black_box(&state)));
        times.push(start.elapsed());
        black_box(value); // Destruction and setup are outside the timed interval.
    }
    let state = setup();
    ALLOCATED.with(|n| n.set(Some(0)));
    let value = run(&state);
    let heap = ALLOCATED.with(|n| n.replace(None).unwrap());
    let bytes = size(&value);
    times.sort_unstable();
    println!(
        "{label:32} median_ms={:9.3} p95_ms={:9.3} output_B={bytes:8} alloc_B={heap:9}",
        times[SAMPLES / 2].as_secs_f64() * 1000.,
        times[SAMPLES * 95 / 100].as_secs_f64() * 1000.
    );
}

struct Fixture {
    core: Arc<Core>,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-perf-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let (updates, _) = broadcast::channel(1024);
        let (placer_queue, _) = mpsc::unbounded_channel();
        Self {
            path,
            core: Arc::new(Core {
                find: crate::find::Runtime::default(),
                recap: crate::recap::Runtime::default(),
                apps: crate::apps::Runtime::default(),
                imports: crate::import::Imports::default(),
                world: Mutex::new(world.into()),
                journal: Mutex::new(journal),
                updates,
                placer_queue,
                room: Some("perf-room".into()),
                key: None,
                placer_model: "perf-model".into(),
                http: reqwest::Client::new(),
                last_activity: std::sync::atomic::AtomicU64::new(0),
                looked: std::sync::atomic::AtomicBool::new(false),
                wake: tokio::sync::Notify::new(),
            }),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn sized(mut text: String, bytes: usize) -> String {
    text.truncate(bytes);
    while text.len() < bytes {
        text.push('x');
    }
    text
}

fn thought(n: usize, at_ms: u64, thread: usize) -> Thought {
    Thought {
        id: format!("th-{n:032x}"),
        speaker: if n % 2 == 0 { "you" } else { "Guest" }.into(),
        text: sized(format!("Thought {n:04}: plan the travel budget for this project and review the next steps together. "), 100),
        point: String::new(),
        thread_id: Some(format!("T{thread}")),
        placed: false,
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: true,
        at_ms,
        place_ms: None,
    }
}

fn populate(core: &Arc<Core>, now: u64) {
    // 200 original threads, then 50 real merges leave the requested 150.
    for n in 1..=200 {
        core.commit(vec![Change::ThreadAdded {
            thread: Thread {
                id: format!("T{n}"),
                title: sized(format!("Project {n:03} travel planning "), 30),
                parent_id: None,
                status: ThreadStatus::Open,
                last_point: String::new(),
                touched_ms: 0,
                tags: Vec::new(),
                picture: None,
                dropped_by: String::new(),
            },
        }]);
    }
    for n in 0..2_000 {
        // Include the review's skew: at least 300 points on one thread.
        let thread = if n < 300 { 1 } else { 2 + (n - 300) % 199 };
        let at_ms = now - (2_000 - n) as u64 * 1_000;
        let thought = thought(n, at_ms, thread);
        let (id, speaker) = (thought.id.clone(), thought.speaker.clone());
        let thread_id = format!("T{thread}");
        let point = sized(format!("Point {n:04}: review project travel budget and dates. "), 50);
        core.commit(vec![Change::ThoughtAdded { thought }]);
        core.commit(vec![
            Change::ThoughtPlaced {
                thought_id: id,
                thread_id: thread_id.clone(),
                point: point.clone(),
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                place_ms: 2_000,
            },
            Change::ThreadTouched { thread_id: thread_id.clone(), last_point: point, at_ms },
            Change::ActiveChanged { thread_id, speaker },
        ]);
    }
    for n in 0..300 {
        core.commit(vec![Change::ActionProposed {
            action: Action {
                id: format!("ac-{n:032x}"),
                thread_id: format!("T{}", 1 + n % 150),
                kind: "reminder".into(),
                title: format!("Review project {n:03} budget and book the next meeting"),
                when: "2026-11-04".into(),
                status: ItemStatus::New,
                done_ms: None,
            },
        }]);
    }
    for n in 0..200 {
        core.commit(vec![Change::SuggestionAdded {
            suggestion: Suggestion {
                id: format!("sg-{n:032x}"),
                thread_id: format!("T{}", 1 + n % 150),
                text: format!("Consider another route for project {n:03} travel plans"),
                status: ItemStatus::New,
            },
        }]);
    }
    for n in 151..=200 {
        core.commit(vec![Change::ThreadMerged { from: format!("T{n}"), into: format!("T{}", n - 149) }]);
    }
    // Ten matching watchers at rest: exercise their real per-thought scans without launching model work.
    for n in 0..10 {
        core.commit(vec![Change::AppRegistered {
            app: crate::apps::MiniApp {
                id: format!("perf-app-{n}"),
                name: format!("Project watcher {n}"),
                purpose: "Review new project points".into(),
                watcher: crate::apps::Watcher::NewThought { min_points: 2 },
                prompt: Some(crate::apps::Prompt {
                    system: "Review the new point.".into(),
                    template: "{topic}\n{points}\n{thought}".into(),
                }),
                publishers: vec![crate::apps::Publisher::Card { text: "{text}".into() }],
                enabled: true,
                request: String::new(),
                cooldown_secs: 86_400,
                created_ms: now,
                last_run_ms: now,
            },
        }]);
    }
}

#[test]
fn held_snapshots_keep_their_contents_and_wire_shape_after_commits() {
    let fixture = Fixture::new();
    let core = &fixture.core;
    core.add_thought("you", "Review the project budget tomorrow.");
    let held = core.snapshot();
    let message = ServerMsg::Snapshot { world: held.clone() };
    let before = serde_json::to_value(&message).unwrap();
    assert_eq!(before, serde_json::json!({ "type": "snapshot", "world": held.as_ref() }));

    core.add_thought("Guest", "Book the next project meeting.");
    core.commit(vec![Change::ThoughtSkipped { thought_id: held.thoughts[0].id.clone() }]);
    assert_eq!(serde_json::to_value(&message).unwrap(), before);
    assert_eq!(held.thoughts[0].text, "Review the project budget tomorrow.");
    let current = core.snapshot();
    assert_eq!(current.thoughts.len(), 1);
    assert_eq!(current.thoughts[0].speaker, "Guest");
    let (_, replayed) = Journal::open(&fixture.path).unwrap();
    assert_eq!(serde_json::to_value(current).unwrap(), serde_json::to_value(replayed).unwrap());
}

#[test]
#[ignore = "offline release performance measurements; run with --ignored perf --nocapture"]
fn perf_big_map() {
    let fixture = Fixture::new();
    let core = &fixture.core;
    // Fixed local noon makes today's slice reproducible across before/after runs on the same day.
    let now = crate::recap::perf_noon();
    populate(core, now);
    if let Some(dir) = std::env::var_os("CORE_PERF_ARTIFACTS") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::copy(&fixture.path, PathBuf::from(dir).join("journal.jsonl")).unwrap();
    }
    let initial = core.snapshot();
    assert_eq!(
        (
            initial.thoughts.len(),
            initial.threads.len(),
            initial.actions.len(),
            initial.suggestions.len(),
            initial.merged.len(),
            initial.active_by.len()
        ),
        (2_000, 150, 300, 200, 50, 2)
    );
    let journal_bytes = std::fs::metadata(&fixture.path).unwrap().len();
    let lines = std::fs::read_to_string(&fixture.path).unwrap().lines().count();
    let world_bytes = serde_json::to_vec(&initial).unwrap().len();
    let (_, replayed) = Journal::open(&fixture.path).unwrap();
    assert_eq!(serde_json::to_value(&initial).unwrap(), serde_json::to_value(&replayed).unwrap());
    drop((initial, replayed));
    println!("\n2,000 thoughts (100 B text / 50 B point), 150 threads (30 B title), 300 actions, 200 suggestions, 50 merges, 2 speakers, 10 apps");
    println!("journal: {lines} lines / {journal_bytes} B; world JSON: {world_bytes} B; 21 warm samples, median / p95; alloc_B = cumulative requested heap bytes in one separate sample");
    measure("journal replay (warm cache)", || Journal::open(&fixture.path).unwrap(), |_| journal_bytes as usize);
    measure("snapshot clone only", || core.snapshot(), |_| world_bytes);
    measure_bytes("connect snapshot + JSON", || serde_json::to_vec(&ServerMsg::Snapshot { world: core.snapshot() }).unwrap());

    let mut tabs: Vec<_> = (0..2).map(|_| core.updates.subscribe()).collect();
    let mut event = 0;
    let mut commit = || {
        event += 1;
        core.commit(vec![
            Change::ThoughtPlaced {
                thought_id: format!("th-{:032x}", 1_999),
                thread_id: "T1".into(),
                point: "new point".into(),
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                place_ms: 2_000,
            },
            Change::ThreadTouched { thread_id: "T1".into(), last_point: "new point".into(), at_ms: now + event },
            Change::ActiveChanged { thread_id: "T1".into(), speaker: "Guest".into() },
        ]);
        tabs.iter_mut()
            .map(|tab| (0..3).map(|_| serde_json::to_vec(&tab.try_recv().unwrap().message).unwrap().len()).sum::<usize>())
            .sum::<usize>()
    };
    measure("commit + JSON for 2 tabs", &mut commit, |bytes| *bytes);
    measure_with_setup(
        "commit with snapshot held",
        || core.snapshot(),
        |held| {
            let before = held.thread("T1").unwrap().touched_ms;
            let bytes = commit();
            assert_eq!(held.thread("T1").unwrap().touched_ms, before);
            assert_ne!(core.world.lock().unwrap().thread("T1").unwrap().touched_ms, before);
            bytes
        },
        |bytes| *bytes,
    );
    drop(commit);
    drop(tabs);

    // The placer sees one real new, pending thought on top of the 2,000 placed ones.
    core.add_thought("Guest", "We should review the project budget together tomorrow.");
    {
        let world = core.snapshot();
        let newest = world.thoughts.last().unwrap();
        crate::placer::perf(&world, newest);
        core.commit(vec![Change::ThoughtSkipped { thought_id: newest.id.clone() }]);
    }
    let world = core.snapshot();
    crate::refiner::perf(&world, now - 500);
    crate::find::perf(&world);
    crate::recap::perf(&world, now);
    crate::pictures::perf(&world, now);
    crate::apps::perf(core, &world.thoughts[1_999].id);
    drop(world);
    // Actual incoming-thought handling, including filler/command checks and journal/broadcast.
    // Remove the previous sample outside the timed interval to hold map size constant.
    measure_with_setup(
        "incoming add_thought",
        || {
            let previous = core.world.lock().unwrap().thoughts.last().filter(|t| !t.placed).map(|t| t.id.clone());
            if let Some(thought_id) = previous {
                core.commit(vec![Change::ThoughtSkipped { thought_id }]);
            }
        },
        |_| core.add_thought("Guest", "We should review the project budget together tomorrow."),
        |_| 0,
    );
    let pending = core.world.lock().unwrap().thoughts.last().unwrap().id.clone();
    core.commit(vec![Change::ThoughtSkipped { thought_id: pending }]);
    measure_with_setup(
        "skip incoming thought",
        || {
            core.add_thought("Guest", "We should review the project budget together tomorrow.");
            core.world.lock().unwrap().thoughts.last().unwrap().id.clone()
        },
        |id| core.commit(vec![Change::ThoughtSkipped { thought_id: id.clone() }]),
        |_| 0,
    );
    let first = core.world.lock().unwrap().thoughts[0].id.clone();
    let mut rest = thought(2_001, now, 1);
    rest.id = "perf-split-rest".into();
    measure_with_setup(
        "split thought near start",
        || {
            core.commit(vec![Change::ThoughtSkipped { thought_id: rest.id.clone() }]);
        },
        |_| core.commit(vec![Change::ThoughtSplit { thought_id: first.clone(), text: "First part".into(), rest: rest.clone() }]),
        |_| 0,
    );
}
