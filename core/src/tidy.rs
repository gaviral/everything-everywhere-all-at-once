//! The refiner's renames and merges, made so the person stays in charge (decisions/refinersure.md):
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
    })
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
    world.threads.insert(u.at.min(world.threads.len()), u.thread.clone());
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
        Kind::Merge => world.unmerge.get(thread_id).filter(|_| world.merged.contains_key(thread_id)).map(|u| Change::ThreadUnmerged { unmerge: u.clone() }),
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
        for line in std::fs::read_to_string(&path).unwrap().lines() {
            replayed.apply(&serde_json::from_str(line).unwrap());
        }
        assert_eq!(shape(&replayed), shape(&core.snapshot()));
        assert_eq!(replayed.titled, core.snapshot().titled);
        std::fs::remove_file(&path).unwrap();
    }
}
