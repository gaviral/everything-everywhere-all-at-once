//! The refiner's renames and merges, made so the person stays in charge:
//! - a rename it's sure of (`refiner::sure_title`) lands at once, and the window says so with Undo;
//! - anything else is a proposal on the card: Rename or Merge applies it, × keeps things as they are;
//! - a merge applied can be undone exactly: the thread comes back with what it held (`Unmerge`);
//! - a title the person chose (a rename of theirs, an AI rename they undid, a rename they turned down) is theirs:
//!   the refiner leaves it alone;
//! - a thought the person moved stays where they put it: an undone merge leaves it there (`World::moved`), and the
//!   refiner never merges the two threads the move set apart, nor keeps a card asking to (`follow`).

use crate::protocol::ServerMsg;
use crate::world::{Change, ItemStatus, Thread, World};
use crate::Core;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Rename,
    Merge,
}

/// A tidy-up the refiner wasn't sure of, waiting on the card: rename `thread_id` to `title`, or merge `thread_id` into
/// `into`. New until the person applies it (kept) or says no (dismissed); done when the map moved past it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub kind: Kind,
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub into: String,
    pub status: ItemStatus,
}

/// What a merge moved, to put it back exactly: the thread as it was and where it stood in the list, the ids of its
/// thoughts, branches, ideas and tasks, the proposals still waiting on it (the merge left them behind), and whether
/// the talk (and who) was on it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Unmerge {
    pub thread: Thread,
    pub into: String,
    pub at: usize,
    #[serde(default)]
    pub thoughts: Vec<String>,
    #[serde(default)]
    pub branches: Vec<String>,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub proposals: Vec<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub active_by: Vec<String>,
    /// The point its card shows once back, read when the undo was made (`unmerging`), so applying it reads no clock
    /// and a replay gives the card the person saw. None in a merge's record and in a journal from before it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_point: Option<String>,
}

/// Records what merging `from` into `into` is about to move (called by `World::merge` before it moves anything), and
/// leaves the proposals waiting on `from` behind (done): they were about a thread that is going, so neither moves
/// to `into` (a rename meant for `from` would rename `into`). An undo of the merge brings them back.
pub fn record(world: &mut World, from: &str, into: &str) -> Option<Unmerge> {
    let at = world.threads.iter().position(|t| t.id == from)?;
    let ids = |on: Vec<&String>| on.into_iter().cloned().collect::<Vec<_>>();
    let waiting: Vec<String> = world.proposals.iter().filter(|p| p.thread_id == from && p.status == ItemStatus::New).map(|p| p.id.clone()).collect();
    for p in world.proposals.iter_mut().filter(|p| waiting.contains(&p.id)) {
        p.status = ItemStatus::Done;
    }
    Some(Unmerge {
        thread: world.threads[at].clone(),
        into: into.into(),
        at,
        thoughts: ids(world.thoughts.iter().filter(|t| t.thread_id.as_deref() == Some(from)).map(|t| &t.id).collect()),
        branches: ids(world.threads.iter().filter(|t| t.parent_id.as_deref() == Some(from)).map(|t| &t.id).collect()),
        suggestions: ids(world.suggestions.iter().filter(|s| s.thread_id == from).map(|s| &s.id).collect()),
        actions: ids(world.actions.iter().filter(|a| a.thread_id == from).map(|a| &a.id).collect()),
        proposals: waiting,
        active: world.active.as_deref() == Some(from),
        active_by: world.active_by.iter().filter(|(_, id)| *id == from).map(|(who, _)| who.clone()).collect(),
        last_point: None,
    })
}

/// The change that undoes merge `u` on `world` now: its card's point is read here, once, by the clock (`newest`), and
/// carried in the change, so the journal replays it the same.
pub fn unmerging(world: &World, u: &Unmerge) -> Change {
    let mut back = world.clone();
    unmerge(&mut back, &Unmerge { last_point: None, ..u.clone() });
    let last_point = back.thread(&u.thread.id).map(|t| t.last_point.clone());
    Change::ThreadUnmerged { unmerge: Unmerge { last_point, ..u.clone() } }
}

/// The newest point on thread `id` (by `Thought::said_at`: a time ahead of the clock counts as the earliest).
fn newest(world: &World, id: &str, now: u64) -> Option<String> {
    world.thoughts.iter().filter(|t| t.placed && t.thread_id.as_deref() == Some(id)).max_by_key(|t| t.said_at(now)).map(|t| t.point.clone())
}

/// Puts a merged thread back (`Change::ThreadUnmerged`): what it held comes back from wherever the merge sent it, if
/// it's still there (a thought moved since stays where it was moved); what was said on the merged thread since stays.
pub fn unmerge(world: &mut World, u: &Unmerge) {
    let from = u.thread.id.clone();
    if world.thread(&from).is_some() || !world.merged.contains_key(&from) {
        return;
    }
    let into = world.resolve(&u.into);
    world.merged.remove(&from);
    world.unmerge.remove(&from);
    // A branch whose parent merged away since goes under the thread that parent went into; one off the map, to the top.
    // It joins each merge's record on the way there, so undoing that merge too takes it back under its own parent.
    let mut thread = u.thread.clone();
    let parent = thread.parent_id.take();
    thread.parent_id = parent.as_ref().map(|p| world.resolve(p)).filter(|p| *p != from && world.thread(p).is_some());
    if let (Some(mut id), Some(to)) = (parent, thread.parent_id.as_ref()) {
        for _ in 0..world.merged.len() {
            if id == *to {
                break;
            }
            if let Some(record) = world.unmerge.get_mut(&id).filter(|r| !r.branches.contains(&from)) {
                record.branches.push(from.clone());
            }
            match world.merged.get(&id) {
                Some(next) => id = next.clone(),
                None => break,
            }
        }
    }
    world.threads.insert(u.at.min(world.threads.len()), thread);
    let back = |ids: &[String], id: &str, on: &mut String| {
        if ids.iter().any(|x| x == id) && *on == into {
            *on = from.clone();
        }
    };
    for t in world.thoughts.iter_mut() {
        if let Some(on) = t.thread_id.as_mut() {
            back(&u.thoughts, &t.id, on);
        }
    }
    for t in world.threads.iter_mut() {
        if let Some(on) = t.parent_id.as_mut() {
            back(&u.branches, &t.id, on);
        }
    }
    world.suggestions.iter_mut().for_each(|s| back(&u.suggestions, &s.id, &mut s.thread_id));
    world.actions.iter_mut().for_each(|a| back(&u.actions, &a.id, &mut a.thread_id));
    for p in world.proposals.iter_mut().filter(|p| u.proposals.contains(&p.id) && p.thread_id == from && p.status == ItemStatus::Done) {
        p.status = ItemStatus::New;
    }
    // Its card shows its newest point now there: one deleted since the merge isn't on it. Read when the undo was
    // made (`unmerging`); a journal from before that carries none, and it's read here as it always was.
    let newest = u.last_point.clone().or_else(|| newest(world, &from, crate::now_ms()));
    if let (Some(point), Some(thread)) = (newest, world.threads.iter_mut().find(|t| t.id == from)) {
        thread.last_point = point;
    }
    if u.active && world.active.as_deref() == Some(into.as_str()) {
        world.active = Some(from.clone());
    }
    for who in &u.active_by {
        if let Some(on) = world.active_by.get_mut(who).filter(|on| **on == into) {
            *on = from.clone();
        }
    }
}

/// Keeps the proposals in step with the map (`World::apply`): a thread renamed leaves its waiting renames behind
/// (done: the map moved past them; a merge does the same in `record`); a title the person chose, or a rename they
/// turned down, makes the title theirs. A `ThreadRenamed` doesn't: before tidy.rs the refiner renamed with it, so an
/// old journal's are the AI's.
pub fn follow(world: &mut World, change: &Change) {
    match change {
        Change::ThreadRenamed { thread_id, .. } | Change::ThreadRetitled { thread_id, .. } | Change::TitleChosen { thread_id, .. } => {
            if !matches!(change, Change::ThreadRetitled { .. }) {
                // A newer title: the AI rename's Undo would put back a title from before it.
                world.retitled.remove(thread_id);
            }
            if matches!(change, Change::TitleChosen { .. }) {
                world.titled.insert(thread_id.clone());
            }
            for p in world.proposals.iter_mut().filter(|p| p.kind == Kind::Rename && p.thread_id == *thread_id && p.status == ItemStatus::New) {
                p.status = ItemStatus::Done;
            }
        }
        // A thought the person moved between two threads says they're two topics: a merge of the two still waiting
        // on a card is past (done), as a rename is once the person titles the thread.
        Change::ThoughtMoved { thread_id, from, undo: false, .. } => {
            let (a, b) = (world.resolve(from), world.resolve(thread_id));
            let pair = |p: &Proposal| {
                let (x, y) = (world.resolve(&p.thread_id), world.resolve(&p.into));
                (x == a && y == b) || (x == b && y == a)
            };
            let settled: Vec<String> = world.proposals.iter().filter(|p| p.kind == Kind::Merge && p.status == ItemStatus::New && pair(p)).map(|p| p.id.clone()).collect();
            for p in world.proposals.iter_mut().filter(|p| settled.contains(&p.id)) {
                p.status = ItemStatus::Done;
            }
        }
        Change::ItemStatus { id, status: ItemStatus::Dismissed, .. } => {
            if let Some(p) = world.proposals.iter().find(|p| p.id == *id && p.kind == Kind::Rename) {
                world.titled.insert(p.thread_id.clone());
            }
        }
        _ => {}
    }
}

/// The card's Rename or Merge (`apply`), or its × (keeps things as they are).
pub fn decide(core: &Core, speaker: &str, id: &str, apply: bool) {
    let world = core.snapshot();
    let Some(p) = world.proposals.iter().find(|p| p.id == id && p.status == ItemStatus::New).cloned() else { return };
    let mut changes = Vec::new();
    if apply {
        let thread = world.resolve(&p.thread_id);
        match p.kind {
            Kind::Rename if world.thread(&thread).is_some() => {
                changes.push(Change::TitleChosen { thread_id: thread, title: p.title.clone() });
            }
            Kind::Merge => {
                let into = world.resolve(&p.into);
                // Still two threads, and never into its own branch (see `refiner::changes_on`).
                if into != thread && world.thread(&thread).is_some() && world.thread(&into).is_some() && !crate::refiner::above(&world, &thread, &into) {
                    changes.push(Change::ThreadMerged { from: thread, into });
                }
            }
            _ => {}
        }
        if changes.is_empty() {
            core.send_to(speaker, ServerMsg::Notice { message: "That no longer fits the map: it changed since".into() });
        }
    }
    let status = if !apply { ItemStatus::Dismissed } else if changes.is_empty() { ItemStatus::Done } else { ItemStatus::Kept };
    changes.push(Change::ItemStatus { id: p.id, status, done_ms: None });
    core.commit(changes);
}

/// The Undo on the window's note: an AI rename goes back to the title before it (which is then the person's), and a
/// merge comes apart. Only while it's still the latest of its kind on that thread, and the renamed thread is still
/// there (merged away since, its rename would land on the thread it went into).
pub fn undo(core: &Core, speaker: &str, kind: Kind, thread_id: &str) {
    let world = core.snapshot();
    let change = match kind {
        Kind::Rename => world.retitled.get(thread_id).filter(|_| world.thread(thread_id).is_some()).map(|was| Change::TitleChosen { thread_id: thread_id.into(), title: was.clone() }),
        // Nothing of it left on the map (its points deleted since): no empty card comes back, with words long gone.
        Kind::Merge => world.unmerge.get(thread_id).filter(|_| world.merged.contains_key(thread_id))
            .filter(|u| u.thoughts.iter().any(|id| world.thoughts.iter().any(|t| &t.id == id)) || u.branches.iter().any(|id| world.thread(id).is_some()))
            .map(|u| unmerging(&world, u)),
    };
    match change {
        Some(change) => core.commit(vec![change]),
        None => core.send_to(speaker, ServerMsg::Notice { message: "That can't be undone any more: something newer happened".into() }),
    }
}

#[cfg(test)]
mod tests {
    use super::{Kind, Proposal};
    use crate::world::{Action, Change, ItemStatus, Suggestion, Thought, Thread, ThreadStatus, World};

    fn thread(id: &str, parent: Option<&str>) -> Thread {
        Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: parent.map(Into::into),
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    fn said(id: &str, on: &str) -> Thought {
        Thought {
            id: id.into(),
            speaker: "you".into(),
            text: id.into(),
            point: id.into(),
            thread_id: Some(on.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
            decided: false,
        }
    }

    fn map() -> World {
        let mut world = World {
            threads: vec![thread("T1", None), thread("T2", None), thread("T3", Some("T2")), thread("T4", None)],
            thoughts: vec![said("a", "T1"), said("b", "T2"), said("c", "T2"), said("d", "T3")],
            active: Some("T2".into()),
            ..World::default()
        };
        world.active_by.insert("Sam".into(), "T2".into());
        world.suggestions.push(Suggestion { id: "sg".into(), thread_id: "T2".into(), text: "idea".into(), status: ItemStatus::New });
        world.actions.push(Action { id: "ac".into(), thread_id: "T2".into(), kind: "reminder".into(), title: "task".into(), when: String::new(), status: ItemStatus::New, done_ms: None });
        world
    }

    /// The map's shape, order included, to compare before and after.
    fn shape(world: &World) -> String {
        format!(
            "{:?} {:?} {:?} {:?} {:?} {:?} {:?}",
            world.threads.iter().map(|t| (&t.id, &t.title, &t.parent_id)).collect::<Vec<_>>(),
            world.thoughts.iter().map(|t| (&t.id, &t.thread_id)).collect::<Vec<_>>(),
            world.suggestions.iter().map(|s| &s.thread_id).collect::<Vec<_>>(),
            world.actions.iter().map(|a| &a.thread_id).collect::<Vec<_>>(),
            world.active,
            world.active_by.get("Sam"),
            world.merged,
        )
    }

    #[test]
    fn a_merge_comes_apart_exactly_and_what_was_said_since_stays() {
        let before = map();
        let mut world = before.clone();
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        assert!(world.thread("T2").is_none() && world.thoughts.iter().all(|t| t.thread_id.as_deref() != Some("T2")));
        let undo = Change::ThreadUnmerged { unmerge: world.unmerge["T2"].clone() };
        // Through the journal, as a restart replays it.
        let undo: Change = serde_json::from_str(&serde_json::to_string(&undo).unwrap()).unwrap();
        let mut replayed = world.clone();
        replayed.apply(&undo);
        assert_eq!(shape(&replayed), shape(&before), "every thought, branch, idea, task and who was on it comes back");
        assert!(replayed.unmerge.is_empty());
        // Said on the merged thread after the merge: it stays there.
        world.apply(&Change::ThoughtAdded { thought: said("e", "T2") });
        world.apply(&undo);
        assert_eq!(world.thoughts.iter().find(|t| t.id == "e").unwrap().thread_id.as_deref(), Some("T1"));
        // Applied twice (a journal replayed over itself): nothing more happens.
        let once = shape(&world);
        world.apply(&undo);
        assert_eq!(shape(&world), once);
    }

    #[test]
    fn a_rename_the_person_makes_or_takes_back_is_theirs() {
        let mut world = map();
        world.apply(&Change::ThreadRetitled { thread_id: "T1".into(), title: "Rent".into(), was: "Topic T1".into() });
        assert_eq!((world.thread("T1").unwrap().title.as_str(), world.retitled.get("T1").map(String::as_str)), ("Rent", Some("Topic T1")));
        assert!(!world.titled.contains("T1"), "the AI's own title isn't the person's");
        world.apply(&Change::TitleChosen { thread_id: "T1".into(), title: "Topic T1".into() });
        assert!(world.retitled.is_empty() && world.titled.contains("T1"));
        // A rename turned down: the title stays theirs; a merge turned down doesn't touch titles.
        let proposal = |id: &str, kind, on: &str| Proposal { id: id.into(), kind, thread_id: on.into(), title: "New".into(), into: "T1".into(), status: ItemStatus::New };
        world.apply(&Change::TidyProposed { proposal: proposal("p1", Kind::Rename, "T4") });
        world.apply(&Change::TidyProposed { proposal: proposal("p2", Kind::Merge, "T2") });
        world.apply(&Change::ItemStatus { id: "p2".into(), status: ItemStatus::Dismissed, done_ms: None });
        assert!(!world.titled.contains("T2"));
        world.apply(&Change::ItemStatus { id: "p1".into(), status: ItemStatus::Dismissed, done_ms: None });
        assert!(world.titled.contains("T4"));
        // A waiting rename is left behind once the thread is renamed anyway.
        world.apply(&Change::TidyProposed { proposal: proposal("p3", Kind::Rename, "T3") });
        world.apply(&Change::ThreadRetitled { thread_id: "T3".into(), title: "Other".into(), was: "Topic T3".into() });
        assert_eq!(world.proposals.iter().find(|p| p.id == "p3").unwrap().status, ItemStatus::Done);
    }

    #[test]
    fn a_merge_leaves_the_proposals_of_the_thread_going_behind_and_its_undo_brings_them_back() {
        // Review finding: the window moved a waiting rename onto the thread merged into, so Rename renamed that one.
        let mut world = map();
        let proposal = |id: &str, kind, on: &str, title: &str, into: &str| Change::TidyProposed {
            proposal: Proposal { id: id.into(), kind, thread_id: on.into(), title: title.into(), into: into.into(), status: ItemStatus::New },
        };
        world.apply(&proposal("r", Kind::Rename, "T2", "Rent payment", ""));
        world.apply(&proposal("m", Kind::Merge, "T2", "", "T4"));
        world.apply(&proposal("t1", Kind::Rename, "T1", "Pay rent", ""));
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        let status = |w: &World| w.proposals.iter().map(|p| (p.id.clone(), p.thread_id.clone(), p.status)).collect::<Vec<_>>();
        let owned = |v: [(&str, &str, ItemStatus); 3]| v.map(|(a, b, c)| (a.to_string(), b.to_string(), c)).to_vec();
        assert_eq!(status(&world), owned([("r", "T2", ItemStatus::Done), ("m", "T2", ItemStatus::Done), ("t1", "T1", ItemStatus::New)]));
        world.apply(&Change::ThreadUnmerged { unmerge: world.unmerge["T2"].clone() });
        assert_eq!(status(&world), owned([("r", "T2", ItemStatus::New), ("m", "T2", ItemStatus::New), ("t1", "T1", ItemStatus::New)]));
    }

    #[test]
    fn an_old_journals_renames_are_the_ais_and_a_chosen_title_is_the_persons() {
        // Review finding: before tidy.rs the refiner renamed with `ThreadRenamed`, so replaying it can't make titles the person's.
        let mut world = map();
        world.apply(&Change::ThreadRenamed { thread_id: "T1".into(), title: "Rent".into() });
        assert_eq!(world.thread("T1").unwrap().title, "Rent");
        assert!(world.titled.is_empty());
        world.apply(&Change::TitleChosen { thread_id: "T1".into(), title: "Pay rent".into() });
        assert_eq!(world.thread("T1").unwrap().title, "Pay rent");
        assert!(world.titled.contains("T1"));
    }

    #[test]
    fn a_rename_undo_after_its_thread_merged_away_changes_nothing() {
        // Review finding: the Undo still showing renamed the thread it went into.
        let mut world = map();
        world.apply(&Change::ThreadRetitled { thread_id: "T2".into(), title: "Rent".into(), was: "Topic T2".into() });
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        let (core, path) = core(world);
        super::undo(&core, "you", Kind::Rename, "T2");
        let now = core.snapshot();
        assert_eq!(now.thread("T1").unwrap().title, "Topic T1");
        assert!(now.titled.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "", "nothing was written");
        // Put back, its Undo works again.
        let unmerge = now.unmerge["T2"].clone();
        core.commit(vec![Change::ThreadUnmerged { unmerge }]);
        super::undo(&core, "you", Kind::Rename, "T2");
        assert_eq!(core.snapshot().thread("T2").unwrap().title, "Topic T2");
        std::fs::remove_file(&path).unwrap();
    }

    /// A keyless core on `world`, and the journal it writes.
    fn core(world: World) -> (std::sync::Arc<crate::Core>, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("e2a2o-tidy-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::Journal::open(&path).unwrap();
        (std::sync::Arc::new(crate::Core::test(journal, world)), path)
    }

    /// An AI merge whose points were deleted since: its Undo brings back no empty card with deleted words, and with
    /// one point left, the card shows that point.
    #[test]
    fn undoing_a_merge_after_its_points_were_deleted_brings_back_no_deleted_words() {
        let start = || {
            let mut world = World { threads: vec![thread("T1", None), thread("T2", None)], thoughts: vec![said("a", "T1"), said("b", "T2"), said("c", "T2")], ..World::default() };
            world.threads[1].last_point = "c".into();
            world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
            world
        };
        let mut world = start();
        world.apply(&Change::ThoughtSkipped { thought_id: "b".into() });
        world.apply(&Change::ThoughtSkipped { thought_id: "c".into() });
        let (live, path) = core(world);
        super::undo(&live, "you", Kind::Merge, "T2");
        assert!(live.snapshot().thread("T2").is_none(), "no empty card");
        std::fs::remove_file(&path).unwrap();
        let mut world = start();
        world.apply(&Change::ThoughtSkipped { thought_id: "c".into() });
        let (live, path) = core(world);
        super::undo(&live, "you", Kind::Merge, "T2");
        assert_eq!(live.snapshot().thread("T2").unwrap().last_point, "b", "the deleted point isn't on its card");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn the_card_applies_or_keeps_and_the_note_undoes_through_the_journal() {
        let mut world = map();
        let proposal = |id: &str, kind, on: &str, title: &str, into: &str| Change::TidyProposed {
            proposal: Proposal { id: id.into(), kind, thread_id: on.into(), title: title.into(), into: into.into(), status: ItemStatus::New },
        };
        world.apply(&proposal("p1", Kind::Rename, "T4", "Groceries", ""));
        world.apply(&proposal("p2", Kind::Merge, "T2", "", "T1"));
        world.apply(&proposal("p3", Kind::Merge, "T1", "", "T2"));
        world.apply(&Change::ThreadRetitled { thread_id: "T1".into(), title: "Rent".into(), was: "Topic T1".into() });
        let (before, start) = (map(), world.clone());
        let (core, path) = core(world);
        super::decide(&core, "you", "p1", true);
        super::decide(&core, "you", "p2", true);
        // Its other half went with the merge: nothing left to apply, and nothing changes.
        super::decide(&core, "you", "p3", true);
        let now = core.snapshot();
        assert_eq!(now.thread("T4").unwrap().title, "Groceries");
        assert!(now.thread("T2").is_none() && now.titled.contains("T4"));
        assert_eq!(now.proposals.iter().map(|p| p.status).collect::<Vec<_>>(), [ItemStatus::Kept, ItemStatus::Kept, ItemStatus::Done]);
        // The notes' Undo: the AI's rename goes back (and the title is then the person's), the merge comes apart.
        super::undo(&core, "you", Kind::Rename, "T1");
        super::undo(&core, "you", Kind::Merge, "T2");
        let now = core.snapshot();
        assert_eq!(now.thread("T1").unwrap().title, "Topic T1");
        assert!(now.titled.contains("T1") && now.retitled.is_empty());
        let shape_without_titles = |w: &World| shape(w).replace("Groceries", "Topic T4");
        assert_eq!(shape_without_titles(&now), shape(&before));
        // Once more: nothing left to undo.
        super::undo(&core, "you", Kind::Merge, "T2");
        assert_eq!(shape_without_titles(&core.snapshot()), shape(&before));
        // Replayed from the journal (as a restart does), the map is the same.
        let mut replayed = start;
        for line in std::fs::read_to_string(&path).unwrap().split_inclusive('\n') {
            for (change, _) in crate::world::journal_record(line.as_bytes(), line.ends_with('\n')).unwrap() {
                replayed.apply(&change);
            }
        }
        assert_eq!(shape(&replayed), shape(&core.snapshot()));
        assert_eq!(replayed.titled, core.snapshot().titled);
        std::fs::remove_file(&path).unwrap();
    }

    /// The card's × through `decide`, as the window sends it; a second click on an answered card.
    #[test]
    fn the_cards_x_keeps_things_as_they_are_and_a_second_click_does_nothing() {
        let mut world = map();
        let proposal = |id: &str, kind, on: &str, title: &str, into: &str| Change::TidyProposed {
            proposal: Proposal { id: id.into(), kind, thread_id: on.into(), title: title.into(), into: into.into(), status: ItemStatus::New },
        };
        world.apply(&proposal("p1", Kind::Rename, "T4", "Groceries", ""));
        world.apply(&proposal("p2", Kind::Merge, "T2", "", "T1"));
        let start = world.clone();
        let (core, path) = core(world);
        super::decide(&core, "you", "p1", false);
        super::decide(&core, "you", "p2", false);
        super::decide(&core, "you", "p2", true);
        let now = core.snapshot();
        assert_eq!(shape(&now), shape(&start), "nothing renamed or merged");
        assert_eq!(now.proposals.iter().map(|p| p.status).collect::<Vec<_>>(), [ItemStatus::Dismissed, ItemStatus::Dismissed]);
        assert!(now.titled.contains("T4") && !now.titled.contains("T2"), "a rename turned down makes the title theirs; a merge doesn't");
        let lines: Vec<String> = std::fs::read_to_string(&path).unwrap().split_inclusive('\n').map(String::from).collect();
        assert_eq!(lines.len(), 2, "one line per answer: {lines:?}");
        let mut replayed = start;
        for line in &lines {
            for (change, _) in crate::world::journal_record(line.as_bytes(), line.ends_with('\n')).unwrap() {
                replayed.apply(&change);
            }
        }
        assert_eq!((shape(&replayed), &replayed.titled), (shape(&now), &now.titled));
        std::fs::remove_file(&path).unwrap();
    }

    /// An AI rename's Undo after the person renamed the thread: says why, writes nothing.
    #[test]
    fn an_ai_rename_undo_after_the_person_renamed_it_says_why_and_changes_nothing() {
        let mut world = map();
        world.apply(&Change::ThreadRetitled { thread_id: "T1".into(), title: "Rent".into(), was: "Topic T1".into() });
        world.apply(&Change::TitleChosen { thread_id: "T1".into(), title: "Pay rent".into() });
        let (core, path) = core(world);
        let mut told = core.updates.subscribe();
        super::undo(&core, "you", Kind::Rename, "T1");
        assert_eq!(core.snapshot().thread("T1").unwrap().title, "Pay rent");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "", "nothing was written");
        let said: Vec<String> = std::iter::from_fn(|| told.try_recv().ok()).map(|o| serde_json::to_string(&o.message).unwrap()).collect();
        assert!(said.iter().any(|m| m.contains("can't be undone any more")), "{said:?}");
        std::fs::remove_file(&path).unwrap();
    }

    /// A merge undone after the thread it went into merged on: its points come back from where they went.
    #[test]
    fn a_merge_undone_after_the_thread_it_went_into_merged_on_comes_back_whole() {
        let before = map();
        let mut chained = before.clone();
        // T2 into T1, then T1 into T4: what T2 held is on T4 now.
        chained.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        chained.apply(&Change::ThreadMerged { from: "T1".into(), into: "T4".into() });
        {
            let (core, path) = core(chained.clone());
            super::undo(&core, "you", Kind::Merge, "T2");
            let now = core.snapshot();
            let on = |id: &str| now.thoughts.iter().find(|t| t.id == id).unwrap().thread_id.clone().unwrap();
            assert_eq!([on("b"), on("c"), on("a")], ["T2", "T2", "T4"], "T2's points back; T1's stay where T1 went");
            assert_eq!(now.thread("T3").unwrap().parent_id.as_deref(), Some("T2"), "its branch");
            assert_eq!((now.suggestions[0].thread_id.as_str(), now.actions[0].thread_id.as_str()), ("T2", "T2"));
            assert_eq!((now.active.as_deref(), now.active_by.get("Sam").map(String::as_str)), (Some("T2"), Some("T2")));
            std::fs::remove_file(&path).unwrap();
        }
        // Newest first, as the window's notes allow: the map is exactly as it was.
        let (core, path) = core(chained);
        super::undo(&core, "you", Kind::Merge, "T1");
        super::undo(&core, "you", Kind::Merge, "T2");
        assert_eq!(shape(&core.snapshot()), shape(&before));
        std::fs::remove_file(&path).unwrap();
    }

    /// A branch whose merge is undone after its parent merged away: it comes back under the thread its parent went
    /// into, not under a parent that isn't on the map (a card no top thread holds).
    #[test]
    fn a_branch_comes_back_under_the_thread_its_parent_went_into() {
        let mut world = map();
        // T3 (a branch of T2) into T4, then T2 into T1.
        world.apply(&Change::ThreadMerged { from: "T3".into(), into: "T4".into() });
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        world.apply(&Change::ThreadUnmerged { unmerge: world.unmerge["T3"].clone() });
        assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T1"));
        assert_eq!(world.thoughts.iter().find(|t| t.id == "d").unwrap().thread_id.as_deref(), Some("T3"));
        // Undoing the parent's merge too: the branch goes back under its own parent, as before both merges.
        world.apply(&Change::ThreadUnmerged { unmerge: world.unmerge["T2"].clone() });
        assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T2"));
    }

    /// The same through a chain (T2 into T1, T1 into T4), each merge undone in either order: the branch ends under
    /// its own parent.
    #[test]
    fn a_branch_comes_back_under_its_parent_through_a_chain_of_merges() {
        for parent_first in [true, false] {
            let mut world = map();
            world.threads.push(thread("T9", None));
            world.apply(&Change::ThreadMerged { from: "T3".into(), into: "T9".into() });
            world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
            world.apply(&Change::ThreadMerged { from: "T1".into(), into: "T4".into() });
            world.apply(&Change::ThreadUnmerged { unmerge: world.unmerge["T3"].clone() });
            assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T4"));
            let order = if parent_first { ["T2", "T1"] } else { ["T1", "T2"] };
            for id in order {
                world.apply(&Change::ThreadUnmerged { unmerge: world.unmerge[id].clone() });
            }
            assert_eq!(world.thread("T3").unwrap().parent_id.as_deref(), Some("T2"), "parent first: {parent_first}");
        }
    }

    /// Replay gives the map the person saw: an undone merge's card shows the point it showed live, whatever the
    /// clock says when the journal is read. A point dated just ahead of the clock (a sample, a wrong clock) counted
    /// as the earliest live and as the newest once the clock passed it.
    #[test]
    fn an_undone_merge_replays_to_the_card_it_showed() {
        let now = crate::now_ms();
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None)], thoughts: vec![said("a", "T1"), said("b", "T2"), said("c", "T2")], ..World::default() };
        world.thoughts[1].at_ms = now - 60_000;
        // Stay ahead regardless of journal setup or scheduler delays.
        world.thoughts[2].at_ms = u64::MAX;
        world.threads[1].last_point = "c".into();
        world.apply(&Change::ThreadMerged { from: "T2".into(), into: "T1".into() });
        let start = world.clone();
        let (core, path) = core(world);
        super::undo(&core, "you", Kind::Merge, "T2");
        let live = core.snapshot().thread("T2").unwrap().last_point.clone();
        assert_eq!(live, "b", "a point dated ahead counts as the earliest");
        let mut replayed = start;
        // Simulate the clock passing c by moving only its synthetic timestamp behind the clock.
        // No real-time wait: without the recorded last_point, replay would now choose c.
        replayed.thoughts[2].at_ms = now - 1;
        for line in std::fs::read_to_string(&path).unwrap().split_inclusive('\n') {
            for (change, _) in crate::world::journal_record(line.as_bytes(), line.ends_with('\n')).unwrap() {
                replayed.apply(&change);
            }
        }
        assert_eq!(super::newest(&replayed, "T2", crate::now_ms()).as_deref(), Some("c"));
        assert_eq!(replayed.thread("T2").unwrap().last_point, live);
        std::fs::remove_file(&path).unwrap();
    }
}
