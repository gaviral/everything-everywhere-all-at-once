//! Explicit status on an existing anchored thread; independent of topic status.
use crate::{
    world::{Change, World},
    Core,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiscussionStatus {
    pub thread_id: String,
    pub status: String,
    pub actor: String,
    pub at_ms: u64,
    pub revision: u64,
    pub request_id: String,
    pub observed_revision: u64,
    pub reply_count: usize,
}

pub fn plan(
    w: &World,
    actor: &str,
    request_id: &str,
    thread_id: &str,
    status: &str,
    observed: u64,
) -> Result<DiscussionStatus, &'static str> {
    if request_id.is_empty() || request_id.len() > 100 || !matches!(status, "open" | "resolved") {
        return Err("Invalid discussion change.");
    }
    if let Some(old) = w
        .discussion_receipts
        .get(&(actor.into(), request_id.into()))
    {
        return if old.thread_id == thread_id
            && old.status == status
            && old.observed_revision == observed
        {
            Ok(old.clone())
        } else {
            Err("Request identity already used. Start a new edit.")
        };
    }
    if !w.anchors.contains_key(thread_id) || !w.threads.iter().any(|t| t.id == thread_id) {
        return Err("This anchored discussion is no longer on the map.");
    }
    let revision = w
        .discussions
        .iter()
        .find(|s| s.thread_id == thread_id)
        .map_or(0, |s| s.revision);
    if observed != revision {
        return Err("Discussion changed. Review its current state before choosing again.");
    }
    Ok(DiscussionStatus {
        thread_id: thread_id.into(),
        status: status.into(),
        actor: actor.into(),
        at_ms: crate::now_ms(),
        revision: revision.checked_add(1).ok_or("Revision limit reached.")?,
        request_id: request_id.into(),
        observed_revision: observed,
        reply_count: w
            .thoughts
            .iter()
            .filter(|t| t.thread_id.as_deref() == Some(thread_id))
            .count(),
    })
}

pub fn set(
    core: &Core,
    enabled: &AtomicBool,
    actor: &str,
    request_id: &str,
    thread_id: &str,
    status: &str,
    observed: u64,
) -> Result<DiscussionStatus, String> {
    if !enabled.load(Ordering::SeqCst) {
        return Err("Discussion status is off.".into());
    }
    let snapshot = core.snapshot();
    let record =
        plan(&snapshot, actor, request_id, thread_id, status, observed).map_err(str::to_owned)?;
    if snapshot
        .discussion_receipts
        .contains_key(&(actor.into(), request_id.into()))
    {
        return Ok(record);
    }
    let valid = |w: &World| {
        enabled.load(Ordering::SeqCst)
            && !w
                .discussion_receipts
                .contains_key(&(actor.into(), request_id.into()))
            && plan(w, actor, request_id, thread_id, status, observed).is_ok_and(|next| {
                next.reply_count == record.reply_count && next.revision == record.revision
            })
    };
    match core.try_commit_if(
        valid,
        vec![Change::DiscussionStatus {
            discussion: record.clone(),
        }],
    ) {
        Ok(true) => Ok(record),
        Ok(false) => {
            Err("Discussion changed. Review its current state before choosing again.".into())
        }
        Err(_) => Err("Save unconfirmed. Retry explicitly; nothing was acknowledged.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{
        fixtures::{thought, thread},
        Journal,
    };
    #[test]
    fn c10_discuss_revision_actor_restart_and_no_implicit_reopen() {
        let path = std::env::temp_dir().join(format!("discussion-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, w) = Journal::open(&path).unwrap();
        let core = Core::test(journal, w);
        core.commit(vec![
            Change::ThreadAdded {
                thread: thread("T1", "Wall", 1),
            },
            Change::ThoughtAdded {
                thought: thought("p1", "T1", "A blue wall", 1),
            },
        ]);
        let core = std::sync::Arc::new(core);
        let id = crate::annotate::note(&core, "you", "p1", "blue wall", "Check daylight").unwrap();
        let gate = AtomicBool::new(false);
        assert!(set(&core, &gate, "Sam", "r1", &id, "resolved", 0).is_err());
        gate.store(true, Ordering::SeqCst);
        let saved = set(&core, &gate, "Sam", "r1", &id, "resolved", 0).unwrap();
        assert_eq!(saved.actor, "Sam");
        assert_eq!(
            set(&core, &gate, "Sam", "r1", &id, "resolved", 0).unwrap(),
            saved
        );
        assert!(set(&core, &gate, "you", "r2", &id, "open", 0).is_err());
        crate::annotate::note(&core, "you", "p1", "blue wall", "New context").unwrap();
        assert_eq!(core.snapshot().discussions[0].status, "resolved");
        drop(core);
        let (journal, w) = Journal::open(&path).unwrap();
        assert_eq!(w.discussions[0], saved);
        assert_eq!(
            w.thoughts.iter().find(|t| t.id == "p1").unwrap().text,
            "A blue wall"
        );
        let core = Core::test(journal, w);
        assert_eq!(
            set(&core, &gate, "you", "r2", &id, "open", 1)
                .unwrap()
                .revision,
            2
        );
        gate.store(false, Ordering::SeqCst);
        assert!(set(&core, &gate, "you", "r3", &id, "resolved", 2).is_err());
        let world = (*core.snapshot()).clone();
        drop(core);
        let journal = Journal::read_only(&path).unwrap();
        let core = Core::test(journal, world);
        gate.store(true, Ordering::SeqCst);
        assert!(set(&core, &gate, "you", "failed-write", &id, "resolved", 2).is_err());
        assert_eq!(core.snapshot().discussions[0].revision, 2);
    }
    #[test]
    fn c10_discuss_old_world_defaults() {
        let mut value = serde_json::to_value(World::default()).unwrap();
        value.as_object_mut().unwrap().remove("discussions");
        let w: World = serde_json::from_value(value).unwrap();
        assert!(w.discussions.is_empty());
    }
}
