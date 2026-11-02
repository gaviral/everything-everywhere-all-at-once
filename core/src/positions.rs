//! Places on the canvas: a person's window or an AI participant puts a thread's card or a thought's point anywhere
//! (`ClientMsg::Position`), and every window shows it there (`Change::Positioned`, `World::positions`). Both sides
//! alike, by rule, with no model call: a place is someone's choice, never read into. A drag sends a step every frame;
//! each step reaches every window at once, while the journal keeps at most one line per item per `JOURNAL_EVERY`, the
//! latest, so a restart opens where the drag ended and a long drag adds a few lines, not hundreds.

use crate::protocol::{ServerMsg, POSITION_MAX};
use crate::world::{Change, Journal, World};
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::time::{Duration, Instant};

/// At most one journal line per item this often: a drag's steps come every frame (17 ms at 60 Hz), so a 3-second drag
/// keeps about 13 lines instead of 180, and a crash right after a drop loses at most this much of its end.
pub const JOURNAL_EVERY: Duration = Duration::from_millis(250);

/// What the window that asked hears when a place is refused.
pub const GONE: &str = "That isn't on the map any more.";
pub const OFF_CANVAS: &str = "Can't put it there: x and y must both be numbers within ±1,000,000, or both null.";

/// A place, as `World::positions` holds it: absolute canvas coordinates of the item's top-left, who put it there (a
/// speaker: a person, or an AI participant's name) and when.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub by: String,
    pub at_ms: u64,
}

/// Lines waiting for the journal (`Core::positions`).
#[derive(Default)]
pub struct Runtime {
    held: Mutex<Held>,
}

#[derive(Default)]
struct Held {
    /// When each item's latest line was written, while that's under `JOURNAL_EVERY` ago.
    written: HashMap<String, Instant>,
    /// Each item's newest step not written yet; a write is set for each.
    waiting: HashMap<String, Change>,
}

/// Where a step's journal line goes (`Held::offer`).
#[derive(Debug)]
enum Line {
    /// Into the journal now.
    Now(Change),
    /// Held until then, when the item's newest step is written (`flush_at`).
    Until(Instant),
    /// Held in place of a step already waiting, whose write is set.
    Replaced,
}

impl Held {
    /// The line of a step on `id` at `now`: written at once when the item's last line is `JOURNAL_EVERY` old or
    /// more; else held, in place of any step already held, until `JOURNAL_EVERY` after that line.
    fn offer(&mut self, id: &str, step: Change, now: Instant) -> Line {
        self.written.retain(|_, at| now.saturating_duration_since(*at) < JOURNAL_EVERY);
        if let Some(waiting) = self.waiting.get_mut(id) {
            *waiting = step;
            return Line::Replaced;
        }
        if let Some(at) = self.written.get(id) {
            self.waiting.insert(id.into(), step);
            return Line::Until(*at + JOURNAL_EVERY);
        }
        self.written.insert(id.into(), now);
        Line::Now(step)
    }

    /// The step held for `id`, written at `now`: the item's next line waits `JOURNAL_EVERY` after it.
    fn due(&mut self, id: &str, now: Instant) -> Option<Change> {
        let step = self.waiting.remove(id)?;
        self.written.insert(id.into(), now);
        Some(step)
    }

    /// Drops the steps held for items no longer on the map: the change that took one off (deleted, set aside, merged
    /// away) took its place with it, live and on replay alike, while a held line written after that change would put
    /// the place back on replay if an Undo brought the item back meanwhile.
    fn settle(&mut self, world: &World) {
        if !self.waiting.is_empty() {
            self.waiting.retain(|id, _| world.placeable(id));
        }
    }
}

/// A place asked for by `by`'s window (`ClientMsg::Position`): both numbers put the item there, both none take it back
/// to the automatic layout. Refused, with what to tell the window, when only one is given, either is past
/// `POSITION_MAX` or not a number, or `id` is neither a thread on the map nor a thought. Applied and sent to every
/// window at once, as a commit is; its journal line may wait (`JOURNAL_EVERY`). Arrangement, as opening a card or
/// pointing at one is, not a turn: the speaker's last turn and its Undo stay as they were (catalog.rs), so a drag
/// after a delete leaves the delete's Undo working.
pub fn set(core: &Arc<Core>, by: &str, id: &str, x: Option<f64>, y: Option<f64>) -> Result<(), &'static str> {
    let fits = |v: f64| v.is_finite() && v.abs() <= POSITION_MAX;
    match (x, y) {
        (Some(x), Some(y)) if fits(x) && fits(y) => {}
        (None, None) => {}
        _ => return Err(OFF_CANVAS),
    }
    let mut world = core.world.lock().unwrap();
    if !world.placeable(id) {
        return Err(GONE);
    }
    // Back to the layout it's already in: nothing to show or keep.
    if x.is_none() && !world.positions.contains_key(id) {
        return Ok(());
    }
    let step = Change::Positioned { id: id.into(), x, y, by: by.into(), at_ms: crate::now_ms() };
    Arc::make_mut(&mut world).apply(&step);
    // The locks in a commit's order (world, journal, then these lines), so nothing comes between.
    let mut journal = core.journal.lock().unwrap();
    match core.positions.held.lock().unwrap().offer(id, step.clone(), Instant::now()) {
        Line::Now(line) => write(&mut journal, &line),
        Line::Until(due) => flush_at(core, id, due),
        Line::Replaced => {}
    }
    // Under the world's lock, as a commit sends, so every window gets steps and changes in the order applied.
    core.send(ServerMsg::Change { change: step });
    Ok(())
}

/// After each change a commit applies (`Core::commit_if`): see `Held::settle`.
pub(crate) fn settle(core: &Core, world: &World) {
    core.positions.held.lock().unwrap().settle(world);
}

/// Writes the step held for `id` once it's due, unless its item left the map meanwhile.
fn flush_at(core: &Arc<Core>, id: &str, due: Instant) {
    let (core, id) = (core.clone(), id.to_string());
    tokio::spawn(async move {
        tokio::time::sleep_until(due).await;
        let _world = core.world.lock().unwrap();
        let mut journal = core.journal.lock().unwrap();
        let step = core.positions.held.lock().unwrap().due(&id, Instant::now());
        if let Some(step) = step {
            write(&mut journal, &step);
        }
    });
}

fn write(journal: &mut Journal, step: &Change) {
    if let Err(e) = journal.append(step) {
        tracing::error!("journal write failed: {e:#}");
    }
}

/// Every held line, written now: a test's restart reads the journal at once, where a running core waits for them.
#[cfg(test)]
pub(crate) fn flush_all(core: &Core) {
    let _world = core.world.lock().unwrap();
    let mut journal = core.journal.lock().unwrap();
    let mut held = core.positions.held.lock().unwrap();
    let ids: Vec<String> = held.waiting.keys().cloned().collect();
    for id in ids {
        if let Some(step) = held.due(&id, Instant::now()) {
            write(&mut journal, &step);
        }
    }
}

#[cfg(test)]
mod tests;
