//! "Try a sample map": an empty map fills with the student's week from `samples/` (the one `./run.sh sample` opens),
//! pictures included, so a newcomer on a hosted link sees a full map at once instead of a blank page. Below it, three
//! shorter maps show other moments where talking into a live map helps: a team meeting that drifts off its first
//! item, a bug left mid-sentence for a call, and a walk through a house with your hands full.
//! The samples come from `E2A2O_SAMPLES`, else `../samples` beside the core's folder; without them the button
//! doesn't show (`available`).

use crate::protocol::ServerMsg;
use crate::world::Change;
use crate::Core;
use std::path::{Path, PathBuf};

/// The maps the empty map offers, as (file in `samples/`, what the button and its notice call it). The first is what
/// "Try a sample map" opens, the same one `./run.sh sample` does; the window offers the others by name, and only these
/// names load, so a message can never point the core at another file.
pub const SAMPLES: [(&str, &str); 4] = [
    ("student-week", "A student's week"),
    ("team-sync", "A team meeting"),
    ("debug-break", "A bug, then a call"),
    ("house-walk", "A walk through a house"),
];
const SAMPLE: &str = SAMPLES[0].0;

fn dir() -> PathBuf {
    PathBuf::from(std::env::var("E2A2O_SAMPLES").unwrap_or_else(|_| "../samples".into()))
}

/// Whether the button can fill a map: the sample's journal is there to read.
pub fn available() -> bool {
    dir().join(format!("{SAMPLE}.jsonl")).is_file()
}

/// The samples this core can open, for the window's buttons: each one whose journal is there, first the default.
pub fn listed() -> serde_json::Value {
    let there: Vec<_> = SAMPLES.iter().filter(|(file, _)| dir().join(format!("{file}.jsonl")).is_file())
        .map(|(file, label)| serde_json::json!({ "id": file, "label": label })).collect();
    serde_json::Value::Array(there)
}

/// The sample a window asked for: none named is the default; a name not offered is none.
fn pick(name: Option<&str>) -> Option<(&'static str, &'static str)> {
    match name {
        None => Some(SAMPLES[0]),
        Some(name) => SAMPLES.iter().copied().find(|(file, _)| *file == name),
    }
}

/// The button, from a window: fills this core's map, and tells the speaker how it went.
pub fn fill(core: &Core, speaker: &str, name: Option<&str>) {
    let images = Path::new(&crate::data_dir()).join("images");
    let message = match pick(name) {
        None => "That sample map isn't offered here.".to_string(),
        Some((file, label)) => match load(core, speaker, &dir(), &images, file) {
            Ok(()) => format!("Sample map: {}. Look around, or add your own thoughts to it.", lowercase_first(label)),
            Err(why) => why,
        },
    };
    core.send_to(speaker, ServerMsg::Notice { message });
}

fn lowercase_first(label: &str) -> String {
    let mut chars = label.chars();
    chars.next().map(|c| c.to_lowercase().chain(chars).collect()).unwrap_or_default()
}

/// Puts `samples/<file>.jsonl` into an empty map as if it had been said here: its pictures into `images` first
/// (the journal names them), then every change in one commit, so every window sees the whole map at once. Only an
/// empty map takes it, checked under the commit's lock, so a thought said meanwhile, or a second click, never mixes
/// a sample into real thoughts. The speaker lands on the sample's active thread.
fn load(core: &Core, speaker: &str, samples: &Path, images: &Path, file: &str) -> Result<(), String> {
    load_at(core, speaker, samples, images, file, crate::now_ms())
}

fn load_at(core: &Core, speaker: &str, samples: &Path, images: &Path, file: &str, now: u64) -> Result<(), String> {
    let missing = || "The sample map isn't installed here.".to_string();
    let text = std::fs::read_to_string(samples.join(format!("{file}.jsonl"))).map_err(|_| missing())?;
    // Unreadable lines are skipped, as when a journal opens (world.rs `Journal::open`).
    let empty = |world: &crate::world::World| world.threads.is_empty() && world.thoughts.is_empty();
    // A map emptied after a merge or delete still holds those ids (T2 leads into T1): the sample's threads take
    // fresh ones, so none of them resolves into another.
    let made = core.snapshot().threads_made();
    let mut lines: Vec<serde_json::Value> = text.lines().filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok()).collect();
    // The samples are dated (Nov 3): opened before then, a recap would skip lines still in the future. They move
    // back to end just now, their gaps kept.
    let ahead = lines.iter().filter_map(latest).max().unwrap_or(0).saturating_sub(now);
    if ahead > 0 {
        lines.iter_mut().for_each(|v| shift(v, ahead));
    }
    let changes: Vec<Change> = lines.into_iter()
        .filter_map(|mut v| { rebase(&mut v, made); serde_json::from_value(v).ok() })
        // The person who opens it owns it: a hosted visitor or a room guest isn't "you", and only their own words and
        // drops give them the unfinished card and "where was I?". Only the sample's own "you" lines become theirs:
        // the others in it (Sam and Lena at the team meeting) keep their words.
        .map(|change| match change {
            Change::ThoughtAdded { mut thought } => {
                if thought.speaker == "you" {
                    thought.speaker = speaker.into();
                }
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
    copy_pictures(&samples.join("images").join(file), images);
    if !core.commit_if(empty, changes) {
        return Err(NOT_EMPTY.into());
    }
    // The sample's moves are the speaker's (above), so they land on its active thread with the rest of it.
    Ok(())
}

/// The times a sample line keeps: when a line was said, a thread last touched, an item done.
const TIMES: [&str; 3] = ["at_ms", "touched_ms", "done_ms"];

/// The latest time in a sample line, if it has one.
fn latest(v: &serde_json::Value) -> Option<u64> {
    match v {
        serde_json::Value::Array(all) => all.iter().filter_map(latest).max(),
        serde_json::Value::Object(all) => all.iter()
            .filter_map(|(k, v)| if TIMES.contains(&k.as_str()) { v.as_u64() } else { latest(v) }).max(),
        _ => None,
    }
}

/// Every time in a sample line, `by` earlier.
fn shift(v: &mut serde_json::Value, by: u64) {
    match v {
        serde_json::Value::Array(all) => all.iter_mut().for_each(|v| shift(v, by)),
        serde_json::Value::Object(all) => for (k, v) in all.iter_mut() {
            match v.as_u64() {
                Some(ms) if TIMES.contains(&k.as_str()) => *v = (ms.saturating_sub(by)).into(),
                _ => shift(v, by),
            }
        },
        _ => {}
    }
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
    use super::{load, load_at, pick, NOT_EMPTY, SAMPLE, SAMPLES};
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
        load(&core, "Ana", &samples(), &images, SAMPLE).unwrap();

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
        assert_eq!(load(&core, "Ana", &samples(), &images, SAMPLE), Err(NOT_EMPTY.into()));
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
        load(&core, "Ana", &samples(), &dir.join("images"), SAMPLE).unwrap();
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
        load(&core, "Dana", &samples(), &dir.join("images"), SAMPLE).unwrap();
        let world = core.snapshot();
        let card = world.threads.iter().filter(|t| t.status == ThreadStatus::Dropped && t.dropped_by == "Dana").max_by_key(|t| t.touched_ms).map(|t| t.id.clone());
        let _ = std::fs::remove_dir_all(dir);
        assert!(card.is_some(), "the unfinished card is offered to Dana");
        assert_eq!(crate::way_back(&world, "Dana", crate::now_ms()), card, "“where was I?” goes where the card points");
    }

    /// The meeting sample is a meeting: whoever opens it takes the sample's own "you" lines, and Sam's and Lena's
    /// stay theirs, so their names show on their points and the model still sees who said what.
    #[test]
    fn the_opener_takes_the_samples_own_lines_and_the_others_keep_theirs() {
        for opener in ["you", "Dana"] {
            let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
            let (journal, world) = Journal::open(&dir.join("journal.jsonl")).unwrap();
            let core = Core::test(journal, world);
            load(&core, opener, &samples(), &dir.join("images"), "team-sync").unwrap();
            let world = core.snapshot();
            let _ = std::fs::remove_dir_all(&dir);
            let speakers: std::collections::BTreeSet<&str> = world.thoughts.iter().map(|t| t.speaker.as_str()).collect();
            assert_eq!(speakers, std::collections::BTreeSet::from([opener, "Lena", "Sam"]), "opened by {opener}");
        }
    }

    /// The samples are dated (Nov 3). Opened before that, they end "just now" with their gaps kept, so a recap, a
    /// "today" or anything ordered by time sees them; nothing on the map is in the future.
    #[test]
    fn a_sample_opened_before_its_own_date_ends_just_now() {
        let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
        let open_at = |name: &str, now: u64| {
            let (journal, world) = Journal::open(&dir.join(name)).unwrap();
            let core = Core::test(journal, world);
            load_at(&core, "you", &samples(), &dir.join("images"), SAMPLE, now).unwrap();
            core.snapshot()
        };
        let last = |w: &crate::world::World| w.thoughts.iter().map(|t| t.at_ms).max().unwrap();
        let gaps = |w: &crate::world::World| w.thoughts.iter().map(|t| last(w) - t.at_ms).collect::<Vec<_>>();
        // Opened after its date, it keeps its own times.
        let dated = open_at("dated.jsonl", u64::MAX / 2);
        let now = last(&dated) - 24 * 3600 * 1000;
        let early = open_at("early.jsonl", now);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(last(&early), now, "the sample ends just now");
        assert!(early.thoughts.iter().all(|t| t.at_ms <= now), "every line is in the past, so a recap of today finds it");
        assert!(early.threads.iter().all(|t| t.touched_ms <= now), "no thread touched in the future");
        assert_eq!(gaps(&early), gaps(&dated), "the gaps between lines stay as they were");
    }

    #[test]
    fn without_the_samples_it_says_so_and_changes_nothing() {
        let path = std::env::temp_dir().join(format!("e2a2o-sample-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        let nowhere = std::env::temp_dir().join(format!("e2a2o-no-samples-{}", uuid::Uuid::new_v4()));
        assert_eq!(load(&core, "you", &nowhere, &nowhere.join("images"), SAMPLE), Err("The sample map isn't installed here.".into()));
        assert!(core.snapshot().threads.is_empty());
        assert!(samples().join(format!("{SAMPLE}.jsonl")).is_file(), "the repo ships the sample the button opens");
    }

    /// Each map the empty map offers loads whole into an empty map, and the three short ones keep their shape: 6 to
    /// 10 spoken lines (a moment, read in under a minute), a picture per thread, every one placed, an unfinished card to go back to, a "✓
    /// decided" only where the words say so (decided.rs, the rule a live map uses), and every item on a thread that's
    /// there. Health wording is held off by precheck (scripts/health-words.pl reads samples/).
    #[test]
    fn every_offered_sample_loads_and_the_short_ones_keep_their_shape() {
        use crate::world::ThreadStatus;
        for (file, label) in SAMPLES {
            assert!(!label.is_empty() && label.len() <= 24, "{file}: a label fits a button");
            let dir = std::env::temp_dir().join(format!("e2a2o-sample-{}", uuid::Uuid::new_v4()));
            let (journal, world) = Journal::open(&dir.join("journal.jsonl")).unwrap();
            let core = Core::test(journal, world);
            load(&core, "you", &samples(), &dir.join("images"), file).unwrap_or_else(|e| panic!("{file}: {e}"));
            let world = core.snapshot();
            assert!(world.thoughts.iter().all(|t| t.placed && t.thread_id.as_deref().is_some_and(|id| world.thread(id).is_some())), "{file}");
            assert!(world.threads.iter().any(|t| t.status == ThreadStatus::Dropped), "{file}: an unfinished card");
            assert!(world.active.as_deref().is_some_and(|id| world.thread(id).is_some()), "{file}: opens on a thread");
            for a in &world.actions {
                assert!(world.thread(&a.thread_id).is_some() && (a.kind == "reminder" || a.kind == "event"), "{file}: {}", a.id);
            }
            for s in &world.suggestions {
                assert!(world.thread(&s.thread_id).is_some(), "{file}: {}", s.id);
            }
            for thread in &world.threads {
                let picture = thread.picture.as_deref().unwrap_or_else(|| panic!("{file} {}: a picture, so the Palace isn't blank", thread.id));
                assert!(dir.join("images").join(picture.trim_start_matches("/images/")).is_file(), "{file}: {picture} copied");
            }
            if file != SAMPLE {
                let n = world.thoughts.len();
                assert!((6..=10).contains(&n), "{file}: {n} spoken lines, not 6 to 10");
                for t in &world.thoughts {
                    assert_eq!(t.decided, crate::decided::said(&t.text), "{file} {}: decided as a live map would mark it", t.id);
                }
            }
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    /// Only the offered names load: none named is the button's own sample, and anything else (another file, a path
    /// out of samples/) is refused before any file is read.
    #[test]
    fn only_offered_samples_load_by_name() {
        assert_eq!(pick(None).map(|(f, _)| f), Some(SAMPLE));
        for (file, _) in SAMPLES {
            assert_eq!(pick(Some(file)).map(|(f, _)| f), Some(file));
        }
        for name in ["founder-day", "../data/someone/journal", "/etc/passwd", "", "team-sync.jsonl", "TEAM-SYNC"] {
            assert_eq!(pick(Some(name)), None, "{name}");
        }
    }

    /// A window from before the choice sends a bare {"type":"sample"}: still the default.
    #[test]
    fn the_sample_message_names_one_or_none() {
        use crate::protocol::ClientMsg;
        assert!(matches!(serde_json::from_str(r#"{"type":"sample"}"#), Ok(ClientMsg::Sample { name: None })));
        let named = serde_json::from_str(r#"{"type":"sample","name":"house-walk"}"#);
        assert!(matches!(named, Ok(ClientMsg::Sample { name: Some(ref n) }) if n == "house-walk"));
    }
}
