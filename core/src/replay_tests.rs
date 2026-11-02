//! The journal, the world, replay and Undo held to one another: what Undo puts back, what a restart replays and what a
//! window is sent must be the same map. On the shipped samples, as "Try a sample map" fills a hosted visitor's map. No
//! test calls a model.

use crate::catalog;
use crate::moves;
use crate::protocol::ServerMsg;
use crate::tidy::{Kind, Proposal};
use crate::world::{Change, ItemState, ItemStatus, Journal, World};
use crate::Core;
use std::sync::Arc;

/// A year, to date a sample ahead of the clock (every point counts as said at 0, `Thought::said_at`) or behind it.
const AHEAD: i64 = 365 * 86_400_000;
const BEHIND: i64 = -AHEAD;

/// A core on an empty map, journaling to a file of its own.
fn fresh() -> (Arc<Core>, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("e2a2o-journal-tests-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = Journal::open(&path).unwrap();
    (Arc::new(Core::test(journal, world)), path)
}

/// A shipped sample's changes, its times moved by `shift` ms, so a test reads the same on any day.
fn sample(name: &str, shift: i64) -> Vec<Change> {
    let text = std::fs::read_to_string(format!("{}/../samples/{name}.jsonl", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let at = |ms: &mut u64| *ms = (*ms as i64 + shift) as u64;
    let mut changes: Vec<Change> = text.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect();
    for c in &mut changes {
        match c {
            Change::ThoughtAdded { thought } => at(&mut thought.at_ms),
            Change::ThreadAdded { thread } => at(&mut thread.touched_ms),
            Change::ThreadTouched { at_ms, .. } => at(at_ms),
            _ => {}
        }
    }
    changes
}

/// A core whose map is a sample, committed as "Try a sample map" commits it (sample.rs `load`).
fn sampled(name: &str, shift: i64) -> (Arc<Core>, std::path::PathBuf) {
    let (core, path) = fresh();
    core.commit(sample(name, shift));
    (core, path)
}

/// Everything a person sees of the map, order included: what one Undo must put back.
fn shape(w: &World) -> String {
    let mut active_by: Vec<_> = w.active_by.iter().collect();
    active_by.sort();
    let mut merged: Vec<_> = w.merged.iter().collect();
    merged.sort();
    let mut notes: Vec<_> = w.notes.iter().map(|(id, n)| format!("{id} {n:?}")).collect();
    notes.sort();
    format!(
        "{:#?}",
        (
            w.threads.iter().map(|t| format!("{} {:?} parent={:?} {:?} by={:?} last={:?} touched={} tags={:?} pic={:?}", t.id, t.title, t.parent_id, t.status, t.dropped_by, t.last_point, t.touched_ms, t.tags.iter().map(|g| (&g.name, g.kept)).collect::<Vec<_>>(), t.picture)).collect::<Vec<_>>(),
            w.thoughts.iter().map(|t| format!("{} on={:?} {:?} point={:?} placed={} complete={} decided={}", t.id, t.thread_id, t.text, t.point, t.placed, t.complete, t.decided)).collect::<Vec<_>>(),
            (&w.active, active_by, merged, notes),
            w.suggestions.iter().map(|s| format!("{} {} {:?} {:?}", s.id, s.thread_id, s.text, s.status)).collect::<Vec<_>>(),
            w.actions.iter().map(|a| format!("{} {} {:?} {:?} {:?}", a.id, a.thread_id, a.title, a.when, a.status)).collect::<Vec<_>>(),
            w.proposals.iter().map(|p| format!("{} {} {:?}", p.id, p.thread_id, p.status)).collect::<Vec<_>>(),
        )
    )
}

/// The first lines where two shapes differ.
fn diff(was: &str, now: &str) -> String {
    let (a, b): (Vec<&str>, Vec<&str>) = (was.lines().collect(), now.lines().collect());
    let mut out: Vec<String> = a.iter().zip(&b).filter(|(x, y)| x != y).take(4).map(|(x, y)| format!("    was {}\n    now {}", x.trim(), y.trim())).collect();
    if a.len() != b.len() {
        out.push(format!("    {} lines, now {}", a.len(), b.len()));
    }
    out.join("\n")
}

/// The Undo id the window gets for what `act` does, if it offers one.
fn offered(core: &Core, act: impl FnOnce()) -> Option<u64> {
    let mut updates = core.updates.subscribe();
    act();
    let mut id = None;
    while let Ok(o) = updates.try_recv() {
        if let ServerMsg::Undoable { id: i } = o.message {
            id = Some(i);
        }
    }
    id
}

/// One Undo is one step back: on both shipped samples, dated ahead of the clock (as until Nov 3, 3:46 PM PT) and behind
/// it (as judges see them), deleting any point, moving any point to any other thread or a new one, and renaming any
/// thread, then Undo, gives back the map as it was: titles, last points, unfinished threads, order, who is where.
#[tokio::test]
async fn every_delete_move_and_rename_on_the_samples_undoes_exactly() {
    let mut failures = Vec::new();
    let mut tried = 0;
    for (name, shift) in [("student-week", AHEAD), ("student-week", BEHIND), ("founder-day", AHEAD), ("founder-day", BEHIND)] {
        let (core, path) = sampled(name, shift);
        let base = core.snapshot();
        let _ = std::fs::remove_file(path);
        let thoughts: Vec<String> = base.thoughts.iter().map(|t| t.id.clone()).collect();
        let threads: Vec<String> = base.threads.iter().map(|t| t.id.clone()).collect();
        let before = shape(&base);
        let dated = if shift > 0 { "dated ahead" } else { "dated behind" };
        let mut each = |what: String, act: &dyn Fn(&Arc<Core>)| {
            let (core, path) = sampled(name, shift);
            let Some(id) = offered(&core, || act(&core)) else { return };
            catalog::undo_click(&core, "you", id);
            tried += 1;
            let now = shape(&core.snapshot());
            if now != before {
                failures.push(format!("{name} {dated}: {what}\n{}", diff(&before, &now)));
            }
            let _ = std::fs::remove_file(path);
        };
        for t in &thoughts {
            each(format!("delete {t}, Undo"), &|core| moves::click_delete(core, "you", t));
            each(format!("move {t} to a new thread, Undo"), &|core| moves::click_move(core, "you", t, None));
            for to in &threads {
                each(format!("move {t} to {to}, Undo"), &|core| moves::click_move(core, "you", t, Some(to.clone())));
            }
        }
        for th in &threads {
            each(format!("rename {th}, Undo"), &|core| moves::click_rename(core, "you", th, "Renamed by a test"));
        }
    }
    assert!(tried > 1000, "only {tried} undos tried");
    assert!(failures.is_empty(), "{} of {tried} undos left the map changed:\n{}", failures.len(), failures.iter().take(6).cloned().collect::<Vec<_>>().join("\n"));
}

/// Places thought `id` as the placer would: on `thread` (made first when `title` is given), the speaker moved there.
fn place(core: &Core, id: &str, thread: &str, title: Option<&str>, point: &str) {
    let mut changes = Vec::new();
    if let Some(title) = title {
        changes.push(Change::ThreadAdded { thread: crate::world::fixtures::thread(thread, title, crate::now_ms()) });
    }
    changes.extend([
        Change::ThoughtPlaced { thought_id: id.into(), thread_id: thread.into(), point: point.into(), unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, place_ms: 1, decided: false },
        Change::ThreadTouched { thread_id: thread.into(), last_point: point.into(), at_ms: crate::now_ms() },
        Change::ActiveChanged { thread_id: thread.into(), speaker: "you".into() },
    ]);
    core.commit(changes);
}

/// "Scratch that", then "undo that": words that started their own card come back on it, as they were.
#[tokio::test]
async fn scratch_that_then_undo_puts_words_back_on_their_own_card() {
    let (core, path) = fresh();
    let newest = |core: &Core| core.snapshot().thoughts.last().unwrap().id.clone();
    core.add_thought("you", "Buy milk on the way home");
    place(&core, &newest(&core), "T1", Some("Groceries"), "Buy milk on the way home");
    core.add_thought("you", "Call Mom on Sunday about the trip");
    place(&core, &newest(&core), "T2", Some("Call Mom"), "Call Mom on Sunday");
    let before = shape(&core.snapshot());
    core.add_thought("you", "Scratch that");
    core.add_thought("you", "Undo that");
    let after = shape(&core.snapshot());
    let _ = std::fs::remove_file(path);
    assert!(after == before, "Undo of “scratch that” left the map changed:\n{}", diff(&before, &after));
}

/// Commits from several tasks at once (the placer, the refiner, pictures, each window) reach every window in the
/// journal's order: a window that applies them in another order shows a map the core doesn't have until it reloads.
#[test]
fn concurrent_commits_reach_windows_in_journal_order() {
    // 20 rounds of 8 committers × 100 changes: each round stays under the window queue's 1,024, so nothing lags.
    for round in 0..20 {
        let (core, path) = fresh();
        let mut updates = core.updates.subscribe();
        let threads: Vec<_> = (0..8)
            .map(|n| {
                let core = core.clone();
                std::thread::spawn(move || {
                    for k in 0..100 {
                        core.commit(vec![Change::ActiveChanged { thread_id: format!("T{n}"), speaker: format!("s{n}-{k}") }]);
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let mut told = Vec::new();
        while let Ok(o) = updates.try_recv() {
            if let ServerMsg::Change { change: Change::ActiveChanged { speaker, .. } } = o.message {
                told.push(speaker);
            }
        }
        let kept: Vec<String> = std::fs::read_to_string(&path).unwrap().lines()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap()["speaker"].as_str().unwrap().to_string())
            .collect();
        let _ = std::fs::remove_file(&path);
        assert_eq!(told.len(), kept.len(), "round {round}: every change reaches the window");
        if let Some(i) = told.iter().zip(&kept).position(|(a, b)| a != b) {
            panic!("round {round}: a window's order departs from the journal's at change {i}: {:?} vs {:?}", &told[i..i + 2], &kept[i..i + 2]);
        }
    }
}

/// Every field of the world, the ones a window never gets included (what Undo, the refiner and new ids read).
fn full(w: &World) -> serde_json::Value {
    fn sorted<T: Ord>(mut v: Vec<T>) -> Vec<T> {
        v.sort();
        v
    }
    let unmerge = sorted(w.unmerge.iter().map(|(k, u)| {
        let mut u = u.clone();
        u.active_by.sort();
        (k.clone(), serde_json::to_string(&u).unwrap())
    }).collect());
    serde_json::json!({
        "world": w,
        "removed": w.removed,
        "next_thread_id": w.next_thread_id(),
        "fresh_id": crate::spoken::fresh_id(w),
        "read_ms": sorted(w.read_ms.iter().copied().collect()),
        "read_keys": sorted(w.read_keys.iter().cloned().collect()),
        "retitled": sorted(w.retitled.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
        "titled": sorted(w.titled.iter().cloned().collect()),
        "unmerge": unmerge,
        "moves": w.moves,
        "refined": sorted(w.refined.iter().map(|(k, v)| (k.clone(), serde_json::to_string(v).unwrap())).collect()),
        "restored": sorted(w.restored.iter().cloned().collect()),
    })
}

/// A session on the student's week that takes every road to Undo: a delete, a move, a move to a new thread, a rename,
/// an AI rename and an AI merge undone from their notes, an AI correction put back, words scratched and put back, a
/// filing and a new thread taken back, a link taken apart. Returns every change the windows were sent, in order.
async fn session(core: &Arc<Core>) -> Vec<Change> {
    let mut updates = core.updates.subscribe();
    let say = |text: &str| core.add_thought("you", text);
    core.commit(sample("student-week", BEHIND));
    let undo = |act: &dyn Fn()| {
        if let Some(id) = offered(core, act) {
            catalog::undo_click(core, "you", id);
        }
    };
    let first = core.snapshot().thoughts[0].id.clone();
    let on_t2 = core.snapshot().thoughts.iter().rev().find(|t| t.thread_id.as_deref() == Some("T2")).unwrap().id.clone();
    undo(&|| moves::click_delete(core, "you", &on_t2));
    undo(&|| moves::click_move(core, "you", &first, Some("T3".into())));
    moves::click_move(core, "you", &first, None);
    undo(&|| moves::click_rename(core, "you", "T4", "Kiln days"));
    core.commit(vec![Change::ThreadRetitled { thread_id: "T5".into(), title: "AI title".into(), was: core.snapshot().thread("T5").unwrap().title.clone() }]);
    crate::tidy::undo(core, "you", Kind::Rename, "T5");
    let proposal = Proposal { id: "tp-test".into(), kind: Kind::Merge, thread_id: "T6".into(), title: String::new(), into: "T3".into(), status: ItemStatus::New };
    core.commit(vec![Change::TidyProposed { proposal }]);
    crate::tidy::decide(core, "you", "tp-test", true);
    crate::tidy::undo(core, "you", Kind::Merge, "T6");
    if let Some(a) = core.snapshot().actions.first().cloned() {
        let was = ItemState { status: a.status, text: a.title.clone(), when: a.when.clone() };
        let now = ItemState { status: ItemStatus::Dismissed, ..was.clone() };
        core.commit(vec![Change::ItemRefined { id: a.id.clone(), now, was, why: "cancelled".into() }]);
        crate::refiner::restore(core, &a.id);
    }
    say("Buy more stakes for the beans");
    say("Scratch that");
    say("Undo that");
    undo(&|| say("Add tent pegs to the packing list"));
    undo(&|| say("New thread about the garden shed"));
    let last = core.snapshot().thoughts.iter().rev().find(|t| t.placed).unwrap().id.clone();
    core.commit(vec![Change::ThoughtNoted { thought_id: last.clone(), note: crate::chunks::Note { continues: first.clone(), ..Default::default() } }]);
    crate::chunks::unlink(core, &last);
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    let mut sent = Vec::new();
    while let Ok(o) = updates.try_recv() {
        if let ServerMsg::Change { change } = o.message {
            sent.push(change);
        }
    }
    sent
}

/// A restart (the hosted proxy stops an idle core and starts it again) opens exactly the map that was live, every field
/// included: the ones only Undo, the refiner and new ids read too (`unmerge`, `retitled`, `titled`, `moves`, `refined`,
/// `restored`, `removed`).
#[tokio::test]
async fn a_restart_replays_every_field_of_a_session_with_every_kind_of_undo() {
    let (core, path) = fresh();
    session(&core).await;
    let live = full(&core.snapshot());
    let (_, replayed) = Journal::open(&path).unwrap();
    let _ = std::fs::remove_file(&path);
    let replayed = full(&replayed);
    let (live_s, replayed_s) = (serde_json::to_string_pretty(&live).unwrap(), serde_json::to_string_pretty(&replayed).unwrap());
    assert!(live == replayed, "replay differs from the live map:\n{}", diff(&live_s, &replayed_s));
}

/// What windows are sent is the journal, in its order, so applying it gives the core's map. With E2A2O_FIXTURE_DIR set
/// (scripts/world-mirror-check.mjs), it also writes the session for the window's own `apply` to replay.
#[tokio::test]
async fn session_mirror_fixture() {
    let (core, path) = fresh();
    let sent = session(&core).await;
    let journal: Vec<Change> = std::fs::read_to_string(&path).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let _ = std::fs::remove_file(&path);
    let kept: Vec<String> = journal.iter().filter(|c| !matches!(c, Change::ExplainAnswered { .. } | Change::AnswerMarked { .. })).map(|c| serde_json::to_string(c).unwrap()).collect();
    let told: Vec<String> = sent.iter().map(|c| serde_json::to_string(c).unwrap()).collect();
    assert_eq!(told, kept, "a window's changes differ from the journal's");
    let mut mirrored = World::default();
    for change in &sent {
        mirrored.apply(change);
    }
    assert_eq!(serde_json::to_value(&mirrored).unwrap(), serde_json::to_value(&*core.snapshot()).unwrap());
    if let Ok(dir) = std::env::var("E2A2O_FIXTURE_DIR") {
        let fixture = serde_json::json!({ "changes": sent, "world": &*core.snapshot() });
        std::fs::write(std::path::Path::new(&dir).join("session.json"), serde_json::to_string(&fixture).unwrap()).unwrap();
    }
}

/// After a restart the notes' Undo still works: replay rebuilds what an AI rename, a merge and an AI correction need.
#[tokio::test]
async fn the_notes_undo_works_after_a_restart() {
    let (core, path) = fresh();
    core.commit(sample("student-week", BEHIND));
    let was = core.snapshot().thread("T5").unwrap().title.clone();
    core.commit(vec![Change::ThreadRetitled { thread_id: "T5".into(), title: "AI title".into(), was: was.clone() }]);
    core.commit(vec![Change::ThreadMerged { from: "T6".into(), into: "T3".into() }]);
    let a = core.snapshot().actions[0].clone();
    let state = ItemState { status: a.status, text: a.title.clone(), when: a.when.clone() };
    core.commit(vec![Change::ItemRefined { id: a.id.clone(), now: ItemState { status: ItemStatus::Dismissed, ..state.clone() }, was: state.clone(), why: "cancelled".into() }]);
    let before = shape(&core.snapshot());
    drop(core);
    // The core restarts.
    let (journal, world) = Journal::open(&path).unwrap();
    assert_eq!(shape(&world), before);
    let core = Arc::new(Core::test(journal, world));
    crate::tidy::undo(&core, "you", Kind::Rename, "T5");
    crate::tidy::undo(&core, "you", Kind::Merge, "T6");
    crate::refiner::restore(&core, &a.id);
    let w = core.snapshot();
    let _ = std::fs::remove_file(&path);
    assert_eq!(w.thread("T5").unwrap().title, was);
    assert!(w.thread("T6").is_some() && !w.merged.contains_key("T6"));
    assert_eq!(w.item_state(&a.id), Some(state));
}

/// The map's invariants: every thought and branch on a thread on the map, everyone on a thread on the map, no id both on
/// the map and merged away, no id twice.
fn invariants(w: &World) -> Vec<String> {
    let mut bad = Vec::new();
    let on_map = |id: &str| w.thread(&w.resolve(id)).is_some();
    for t in &w.thoughts {
        if let Some(id) = t.thread_id.as_deref().filter(|id| !on_map(id)) {
            bad.push(format!("thought {} on {id}, not on the map", t.id));
        }
    }
    for th in &w.threads {
        if let Some(p) = th.parent_id.as_deref().filter(|p| !on_map(p) || w.resolve(p) == th.id) {
            bad.push(format!("thread {} under {p}", th.id));
        }
        if w.merged.contains_key(&th.id) {
            bad.push(format!("thread {} is on the map and merged away", th.id));
        }
    }
    for (who, id) in w.active_by.iter().map(|(a, b)| (a.as_str(), b)).chain(w.active.iter().map(|a| ("(talk)", a))) {
        if !on_map(id) {
            bad.push(format!("{who} is on {id}, not on the map"));
        }
    }
    let mut ids: Vec<&str> = w.threads.iter().map(|t| t.id.as_str()).chain(w.thoughts.iter().map(|t| t.id.as_str())).collect();
    let n = ids.len();
    ids.sort();
    ids.dedup();
    if ids.len() != n {
        bad.push("an id twice".into());
    }
    bad
}

/// A seeded walk of the person's fixes, their undos (at once, or later and stale), merges and their undos, on the
/// student's week: after every step the invariants hold, and at the end a restart replays the same map. 30 seeds × 300
/// steps (≈ 5 s; 200 seeds passed); a failure names its seed and step, so it replays.
#[tokio::test]
async fn any_walk_of_fixes_and_undos_keeps_the_map_whole_and_replayable() {
    for seed in 1..=30u64 {
        let (core, path) = sampled("student-week", BEHIND);
        let mut rng = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut next = |n: usize| {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            (rng % n.max(1) as u64) as usize
        };
        let mut offers: Vec<u64> = Vec::new();
        for step in 0..300 {
            let w = core.snapshot();
            let thought = (!w.thoughts.is_empty()).then(|| w.thoughts[next(w.thoughts.len())].id.clone());
            let thread = (!w.threads.is_empty()).then(|| w.threads[next(w.threads.len())].id.clone());
            let other = (!w.threads.is_empty()).then(|| w.threads[next(w.threads.len())].id.clone());
            drop(w);
            let what = next(7);
            let id = match (what, thought, thread, other) {
                (0, Some(t), _, _) => offered(&core, || moves::click_delete(&core, "you", &t)),
                (1, Some(t), Some(to), _) => offered(&core, || moves::click_move(&core, "you", &t, Some(to.clone()))),
                (2, Some(t), _, _) => offered(&core, || moves::click_move(&core, "you", &t, None)),
                (3, _, Some(th), _) => offered(&core, || moves::click_rename(&core, "you", &th, &format!("Title {step}"))),
                (4, _, Some(from), Some(into)) => {
                    // As a card's Merge does: never into itself or its own branch (tidy.rs `decide`).
                    if from != into && !crate::refiner::above(&core.snapshot(), &from, &into) {
                        core.commit(vec![Change::ThreadMerged { from: from.clone(), into }]);
                    }
                    if next(2) == 0 {
                        crate::tidy::undo(&core, "you", Kind::Merge, &from);
                    }
                    None
                }
                (5, _, _, _) => {
                    if let Some(id) = offers.pop() {
                        catalog::undo_click(&core, "you", id);
                    }
                    None
                }
                (_, _, Some(th), _) => {
                    core.focus("you", &th);
                    None
                }
                _ => None,
            };
            // Half the time the person takes it back at once; else it waits, and a later step may try it.
            match id {
                Some(id) if next(2) == 0 => catalog::undo_click(&core, "you", id),
                Some(id) => offers.push(id),
                None => {}
            }
            let bad = invariants(&core.snapshot());
            assert!(bad.is_empty(), "seed {seed}, step {step} (kind {what}): {bad:?}");
        }
        let (_, replayed) = Journal::open(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(full(&replayed), full(&core.snapshot()), "seed {seed}: the restart's map differs");
    }
}

/// A crash can stop the journal between any two lines of a batch (`commit` writes them one at a time): every prefix of
/// a session's journal opens to a whole map.
#[tokio::test]
async fn a_crash_between_any_two_lines_opens_a_whole_map() {
    let (core, path) = fresh();
    session(&core).await;
    let last_on = |id: &str| core.snapshot().thoughts.iter().filter(|t| t.thread_id.as_deref() == Some(id)).map(|t| t.id.clone()).last();
    if let Some(t) = last_on("T2") {
        moves::click_delete(&core, "you", &t);
    }
    if let Some(t) = last_on("T5") {
        moves::click_move(&core, "you", &t, None);
    }
    if let Some(t) = last_on("T3") {
        moves::click_move(&core, "you", &t, Some("T1".into()));
    }
    let text = std::fs::read_to_string(&path).unwrap();
    let _ = std::fs::remove_file(&path);
    let mut world = World::default();
    let mut bad = Vec::new();
    for (n, line) in text.lines().enumerate() {
        world.apply(&serde_json::from_str(line).unwrap());
        let found = invariants(&world);
        if !found.is_empty() {
            bad.push(format!("after line {} ({}): {found:?}", n + 1, &line[..line.len().min(60)]));
        }
    }
    assert!(bad.is_empty(), "{} prefixes open to a broken map:\n{}", bad.len(), bad.iter().take(5).cloned().collect::<Vec<_>>().join("\n"));
}
