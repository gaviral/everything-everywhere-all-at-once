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
    let changes: Vec<Change> = text.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str(l).ok()).collect();
    if changes.is_empty() {
        return Err(missing());
    }
    let empty = |world: &crate::world::World| world.threads.is_empty() && world.thoughts.is_empty();
    if !empty(&core.snapshot()) {
        return Err(NOT_EMPTY.into());
    }
    copy_pictures(&samples.join("images").join(SAMPLE), images);
    if !core.commit_if(empty, changes) {
        return Err(NOT_EMPTY.into());
    }
    // In a room each person has their own active thread; the sample's is "you"'s alone.
    if let Some(active) = core.snapshot().active.clone() {
        core.commit(vec![Change::ActiveChanged { thread_id: active, speaker: speaker.into() }]);
    }
    Ok(())
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
