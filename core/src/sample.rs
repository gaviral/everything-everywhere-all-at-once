//! "Try a sample map": an empty map fills with the student's week from `samples/` (the one `./run.sh sample` opens),
//! pictures included, so a newcomer on a hosted link sees a full map at once instead of a blank page.
//! The samples come from `E2A2O_SAMPLES`, else `../samples` beside the core's folder; without them the button
//! doesn't show (`available`).

use crate::protocol::ServerMsg;
use crate::world::Change;
use crate::Core;
use std::path::{Path, PathBuf};

/// The sample the button opens: the same one `./run.sh sample` does.
const SAMPLE: &str = "student-week";

fn dir() -> PathBuf {
    PathBuf::from(std::env::var("E2A2O_SAMPLES").unwrap_or_else(|_| "../samples".into()))
}

/// Whether the button can fill a map: the sample's journal is there to read.
pub fn available() -> bool {
    dir().join(format!("{SAMPLE}.jsonl")).is_file()
}

/// The button, from a window: fills this core's map, and tells the speaker how it went.
pub fn fill(core: &Core, speaker: &str) {
    let images = Path::new(&crate::data_dir()).join("images");
    let message = match load(core, speaker, &dir(), &images) {
        Ok(()) => "Sample map: a student's week. Look around, or add your own thoughts to it.".to_string(),
        Err(why) => why,
    };
    core.send_to(speaker, ServerMsg::Notice { message });
}

/// Puts `samples/<SAMPLE>.jsonl` into an empty map as if it had been said here: its pictures into `images` first
/// (the journal names them), then every change in one commit, so every window sees the whole map at once. Only an
/// empty map takes it, checked under the commit's lock, so a thought said meanwhile, or a second click, never mixes
/// a sample into real thoughts. The speaker lands on the sample's active thread.
fn load(core: &Core, speaker: &str, samples: &Path, images: &Path) -> Result<(), String> {
    let missing = || "The sample map isn't installed here.".to_string();
    let text = std::fs::read_to_string(samples.join(format!("{SAMPLE}.jsonl"))).map_err(|_| missing())?;
    // Unreadable lines are skipped, as when a journal opens (world.rs `Journal::open`).
    let empty = |world: &crate::world::World| world.threads.is_empty() && world.thoughts.is_empty();
    // A map emptied after a merge or delete still holds those ids (T2 leads into T1): the sample's threads take
    // fresh ones, so none of them resolves into another.
    let made = core.snapshot().threads_made();
    let changes: Vec<Change> = text.lines().filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|mut v| { rebase(&mut v, made); serde_json::from_value(v).ok() })
        // The person who opens it owns it: a hosted visitor or a room guest isn't "you", and only their own words and
        // drops give them the unfinished card and "where was I?".
        .map(|change| match change {
            Change::ThoughtAdded { mut thought } => {
                thought.speaker = speaker.into();
                Change::ThoughtAdded { thought }
            }
            Change::ThreadStatus { thread_id, status, .. } => Change::ThreadStatus { thread_id, status, speaker: speaker.into() },
            Change::ActiveChanged { thread_id, .. } => Change::ActiveChanged { thread_id, speaker: speaker.into() },
            change => change,
        })
        .collect();
    if changes.is_empty() {
        return Err(missing());
    }
    if !empty(&core.snapshot()) {
        return Err(NOT_EMPTY.into());
    }
    copy_pictures(&samples.join("images").join(SAMPLE), images);
    if !core.commit_if(empty, changes) {
        return Err(NOT_EMPTY.into());
    }
    // The sample's moves are the speaker's (above), so they land on its active thread with the rest of it.
    Ok(())
}

/// Every thread id in a sample line ("T3"), `by` on ("T7" after 4 made).
fn rebase(v: &mut serde_json::Value, by: usize) {
    match v {
        serde_json::Value::String(s) => {
            if let Some(n) = s.strip_prefix('T').and_then(|n| n.parse::<usize>().ok()) {
                *s = format!("T{}", n + by);
            }
        }
        serde_json::Value::Array(all) => all.iter_mut().for_each(|v| rebase(v, by)),
        serde_json::Value::Object(all) => all.values_mut().for_each(|v| rebase(v, by)),
        _ => {}
    }
}

const NOT_EMPTY: &str = "The sample only fills an empty map, and this one has thoughts.";

/// Copies the sample's pictures, keeping any file already there (a map's pictures have their own names).
fn copy_pictures(from: &Path, to: &Path) {
    let Ok(entries) = std::fs::read_dir(from) else { return };
    if let Err(e) = std::fs::create_dir_all(to) {
        tracing::warn!("couldn't make the pictures folder: {e}");
        return;
    }
    for entry in entries.flatten() {
        let target = to.join(entry.file_name());
        if !target.exists() {
            if let Err(e) = std::fs::copy(entry.path(), &target) {
                tracing::warn!("couldn't copy a sample picture: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{load, NOT_EMPTY, SAMPLE};
    use crate::world::{Journal, ThreadStatus};
    use crate::Core;
    use std::path::Path;

    fn samples() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples")
    }

    /// The button on an empty map: the whole sample in one go, its pictures where /images serves them, the
    /// speaker on its active thread, and the journal keeps it, so the map opens the same next time.
    #[test]
    fn the_sample_fills_an_empty_map_once_with_its_pictures() {
        let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
        let journal_path = dir.join("journal.jsonl");
        let (journal, world) = Journal::open(&journal_path).unwrap();
        let core = Core::test(journal, world);
        let images = dir.join("images");
        load(&core, "Ana", &samples(), &images).unwrap();

        let world = core.snapshot();
        assert_eq!(world.threads.len(), 8, "a student's week: 8 threads");
        assert!(world.thoughts.len() >= 30 && world.thoughts.iter().all(|t| t.placed));
        assert!(world.threads.iter().any(|t| t.status == ThreadStatus::Dropped), "with its unfinished card");
        assert_eq!(world.active_for("Ana"), world.active.as_ref(), "the speaker lands where the sample is");
        for thread in &world.threads {
            let picture = thread.picture.as_ref().expect("a picture per thread");
            let file = picture.strip_prefix("/images/").expect(picture);
            assert!(images.join(file).is_file(), "{file} copied");
        }
        // Reopened from its journal: the same map.
        let (_, reopened) = Journal::open(&journal_path).unwrap();
        assert_eq!((reopened.threads.len(), reopened.thoughts.len()), (world.threads.len(), world.thoughts.len()));

        // A second click, or a map with thoughts: nothing added.
        assert_eq!(load(&core, "Ana", &samples(), &images), Err(NOT_EMPTY.into()));
        assert_eq!(core.snapshot().thoughts.len(), world.thoughts.len());
    }

    /// A map emptied after a merge (T2 leads into T1): the sample's threads stay its own, none folded into another.
    #[test]
    fn the_sample_on_a_map_emptied_after_a_merge_keeps_every_thread() {
        let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&dir.join("journal.jsonl")).unwrap();
        let mut world = crate::world::World::default();
        // T1 and T2 made, T2 merged into T1, then T1's points deleted: T1 left the map.
        world.merged.insert("T2".into(), "T1".into());
        world.removed = 1;
        let core = Core::test(journal, world);
        load(&core, "Ana", &samples(), &dir.join("images")).unwrap();
        let world = core.snapshot();
        assert_eq!(world.threads.len(), 8);
        for th in &world.threads {
            assert_eq!(world.resolve(&th.id), th.id, "a sample thread leads into another");
        }
        for t in &world.thoughts {
            let on = t.thread_id.as_deref().unwrap();
            assert!(world.thread(on).is_some() && world.resolve(on) == on, "{} sits on {on}, which leads to {}", t.id, world.resolve(on));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A hosted visitor is a guest by the name they typed, never "you" (main.rs `speaker_name`; tunnel.rs): the sample
    /// they open is theirs, so its unfinished card rises for them and "where was I?" goes where it points.
    #[test]
    fn a_visitor_who_opens_the_sample_owns_its_unfinished_card() {
        let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&dir.join("journal.jsonl")).unwrap();
        let core = Core::test(journal, world);
        load(&core, "Dana", &samples(), &dir.join("images")).unwrap();
        let world = core.snapshot();
        let card = world.threads.iter().filter(|t| t.status == ThreadStatus::Dropped && t.dropped_by == "Dana").max_by_key(|t| t.touched_ms).map(|t| t.id.clone());
        let _ = std::fs::remove_dir_all(dir);
        assert!(card.is_some(), "the unfinished card is offered to Dana");
        assert_eq!(crate::way_back(&world, "Dana", crate::now_ms()), card, "“where was I?” goes where the card points");
    }

    #[test]
    fn without_the_samples_it_says_so_and_changes_nothing() {
        let path = std::env::temp_dir().join(format!("e2a2o-sample-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        let nowhere = std::env::temp_dir().join(format!("e2a2o-no-samples-{}", uuid::Uuid::new_v4()));
        assert_eq!(load(&core, "you", &nowhere, &nowhere.join("images")), Err("The sample map isn't installed here.".into()));
        assert!(core.snapshot().threads.is_empty());
        assert!(samples().join(format!("{SAMPLE}.jsonl")).is_file(), "the repo ships the sample the button opens");
    }
}
