//! Apple connector: after you approve an action, adds it to Reminders or Calendar with
//! AppleScript, and times it, so the app can show how long Apple's side took.

use crate::world::{Action, Change, ItemStatus};
use crate::{protocol::ServerMsg, Core};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Held while an approval is claimed, so two at once can't both find the action new.
static CLAIMING: Mutex<()> = Mutex::new(());

pub async fn approve(core: Arc<Core>, action_id: String) {
    let Some(action) = claim(&core, &action_id) else { return };
    // An event without a usable date goes to Reminders instead of an invented day.
    let is_event = action.kind == "event" && date_lines(&action.when).is_some();
    let script = if is_event { event(&action.title, &action.when) } else { reminder(&action.title, &action.when) };
    let app = if is_event { "Calendar" } else { "Reminders" };
    let started = Instant::now();
    let output = tokio::process::Command::new("osascript").arg("-e").arg(&script).output().await;
    let ms = started.elapsed().as_millis() as u64;
    match output {
        Ok(o) if o.status.success() => {
            core.commit(vec![Change::ItemStatus { id: action.id, status: ItemStatus::Done, done_ms: Some(ms) }]);
            core.send(ServerMsg::Notice { message: format!("Added to {app} in {:.1} s", ms as f64 / 1000.0) });
        }
        failed => {
            // Not added: offer it again.
            core.commit(vec![Change::ItemStatus { id: action.id, status: ItemStatus::New, done_ms: None }]);
            let message = match failed {
                Ok(_) => format!("Couldn't add to {app}. Check permission to control {app} in macOS settings, then try again."),
                Err(_) => format!("Couldn't reach {app}. Check that it is available on this Mac, then try again."),
            };
            core.send(ServerMsg::Error { message });
        }
    }
}

/// Marks a new action as being added (kept) and returns it; none when it isn't new: added, being added,
/// or dismissed. AppleScript takes 1–3 s, longer behind macOS's first permission prompt, so this is what
/// stops a second click, or another window, from adding it twice.
fn claim(core: &Core, action_id: &str) -> Option<Action> {
    let _one_at_a_time = CLAIMING.lock().unwrap();
    let action = core.snapshot().actions.into_iter().find(|a| a.id == action_id && a.status == ItemStatus::New)?;
    core.commit(vec![Change::ItemStatus { id: action.id.clone(), status: ItemStatus::Kept, done_ms: None }]);
    Some(action)
}

/// On start: an approval still being added when the core stopped (say, behind the permission prompt)
/// never finished, so it's offered again rather than stuck without its buttons.
pub fn recover(core: &Core) {
    let unfinished = core.snapshot().actions.into_iter().filter(|a| a.status == ItemStatus::Kept);
    core.commit(unfinished.map(|a| Change::ItemStatus { id: a.id, status: ItemStatus::New, done_ms: None }).collect());
}

/// AppleScript text literal with quotes and backslashes escaped.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Builds `d` at the start of a YYYY-MM-DD day without relying on locale date formats.
/// The talk only ever gives a date, so items are all-day rather than at an invented hour.
fn date_lines(when: &str) -> Option<String> {
    // A real day only: AppleScript would quietly roll "2026-11-31" over to December 1.
    if !crate::apps::valid_date(when.trim()) {
        return None;
    }
    let mut parts = when.trim().split('-').map(|p| p.parse::<u32>());
    let (Some(Ok(y)), Some(Ok(m)), Some(Ok(d))) = (parts.next(), parts.next(), parts.next()) else { return None };
    Some(format!(
        "set d to current date\nset day of d to 1\nset year of d to {y}\nset month of d to {m}\nset day of d to {d}\nset time of d to 0"
    ))
}

/// Reminders go to their own "E2A2O" list, so they never mix into your other lists unasked.
fn reminder(title: &str, when: &str) -> String {
    let name = quoted(title);
    let (date, due) = match date_lines(when) {
        Some(date) => (date, ", allday due date:d"),
        None => (String::new(), ""),
    };
    format!(
        "{date}\ntell application \"Reminders\"\nif not (exists list \"E2A2O\") then make new list with properties {{name:\"E2A2O\"}}\ntell list \"E2A2O\" to make new reminder with properties {{name:{name}{due}}}\nend tell"
    )
}

/// Events go to their own "E2A2O" calendar, as reminders go to their own list, so none lands in a shared
/// or work calendar unasked. Only called with a usable date (see `approve`).
fn event(title: &str, when: &str) -> String {
    let date = date_lines(when).unwrap_or_default();
    format!(
        "{date}\ntell application \"Calendar\"\nif not (exists calendar \"E2A2O\") then make new calendar with properties {{name:\"E2A2O\"}}\ntell calendar \"E2A2O\"\nmake new event with properties {{summary:{}, start date:d, end date:d + 1 * days, allday event:true}}\nend tell\nend tell",
        quoted(title)
    )
}

#[cfg(test)]
mod tests {
    use super::{claim, date_lines, event, recover, reminder};
    use crate::world::{Action, Change, ItemStatus, Journal};
    use crate::Core;
    use std::sync::Mutex;

    #[test]
    fn an_action_is_added_once_and_offered_again_if_adding_never_finished() {
        let path = std::env::temp_dir().join(format!("e2a2o-apple-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let (updates, _) = tokio::sync::broadcast::channel(16);
        let (placer_queue, _) = tokio::sync::mpsc::unbounded_channel();
        let core = Core {
            find: crate::find::Runtime::default(),
            imports: crate::import::Imports::default(),
            recap: Default::default(), apps: Default::default(), world: Mutex::new(world), journal: Mutex::new(journal),
            updates, placer_queue, room: None, key: None, placer_model: "test".into(), http: reqwest::Client::new(),
            last_activity: Default::default(), looked: Default::default(), wake: Default::default(),
        };
        let status = |core: &Core| core.snapshot().actions[0].status;
        core.commit(vec![Change::ActionProposed { action: Action { id: "a".into(), thread_id: "T1".into(), kind: "reminder".into(),
            title: "Pay rent".into(), when: String::new(), status: ItemStatus::New, done_ms: None } }]);
        // Two clicks at once (or two windows): one of them adds it.
        let claimed = std::thread::scope(|s| {
            [s.spawn(|| claim(&core, "a").is_some()), s.spawn(|| claim(&core, "a").is_some())].map(|click| click.join().unwrap())
        });
        assert_eq!(claimed.iter().filter(|c| **c).count(), 1);
        assert_eq!(status(&core), ItemStatus::Kept, "being added: its buttons go");
        assert!(claim(&core, "a").is_none(), "a later click while Apple's side runs");
        // The core stopped before Apple's side answered: offered again on start.
        recover(&core);
        assert_eq!(status(&core), ItemStatus::New);
        core.commit(vec![Change::ItemStatus { id: "a".into(), status: ItemStatus::Done, done_ms: Some(900) }]);
        assert!(claim(&core, "a").is_none() && claim(&core, "missing").is_none());
        recover(&core);
        assert_eq!(status(&core), ItemStatus::Done, "an added one stays added");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn dates_are_all_day_and_checked() {
        assert!(date_lines("2026-11-03").is_some_and(|d| d.ends_with("set time of d to 0")));
        for bad in ["", "tomorrow", "Saturday", "2026-13-01", "2026-11-00", "2026-11-31", "2026-02-29", "1999-01-01", "2026-11"] {
            assert!(date_lines(bad).is_none(), "{bad}");
        }
        assert!(event("Freeze", "2026-11-03").contains("allday event:true"));
        assert!(event("Freeze", "2026-11-03").contains("tell calendar \"E2A2O\"") && !event("Freeze", "2026-11-03").contains("first calendar"));
        assert!(reminder("Pay rent", "2026-11-03").contains("allday due date:d"));
        assert!(!reminder("Pay rent", "").contains("due date"));
    }

    #[test]
    #[ignore = "writes the scripts for `osacompile` to check; run with --ignored --nocapture"]
    fn print_scripts() {
        println!("{}\n---\n{}\n---\n{}", event("Say \"hi\"", "2026-11-03"), reminder("Pay rent", "2026-11-03"), reminder("x", ""));
    }
}
