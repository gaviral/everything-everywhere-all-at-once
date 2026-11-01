//! Apple connector: after you approve an action, adds it to Reminders or Calendar with
//! AppleScript, and times it, so the app can show how long Apple's side took.

use crate::world::{Change, ItemStatus};
use crate::{protocol::ServerMsg, Core};
use std::sync::Arc;
use std::time::Instant;

pub async fn approve(core: Arc<Core>, action_id: String) {
    let world = core.snapshot();
    let Some(action) = world.actions.iter().find(|a| a.id == action_id).cloned() else { return };
    if action.status == ItemStatus::Done {
        return;
    }
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
        Ok(o) => {
            let reason = String::from_utf8_lossy(&o.stderr).trim().to_string();
            core.send(ServerMsg::Error { message: format!("{app} said no: {reason}") });
        }
        Err(e) => core.send(ServerMsg::Error { message: format!("Couldn't run AppleScript: {e}") }),
    }
}

/// AppleScript text literal with quotes and backslashes escaped.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Builds `d` at the start of a YYYY-MM-DD day without relying on locale date formats.
/// The talk only ever gives a date, so items are all-day rather than at an invented hour.
fn date_lines(when: &str) -> Option<String> {
    let mut parts = when.trim().split('-').map(|p| p.parse::<u32>());
    let (Some(Ok(y)), Some(Ok(m)), Some(Ok(d))) = (parts.next(), parts.next(), parts.next()) else { return None };
    if !(2000..=2100).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
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

/// Only called with a usable date (see `approve`).
fn event(title: &str, when: &str) -> String {
    let date = date_lines(when).unwrap_or_default();
    format!(
        "{date}\ntell application \"Calendar\"\ntell (first calendar whose writable is true)\nmake new event with properties {{summary:{}, start date:d, end date:d + 1 * days, allday event:true}}\nend tell\nend tell",
        quoted(title)
    )
}

#[cfg(test)]
mod tests {
    use super::{date_lines, event, reminder};

    #[test]
    fn dates_are_all_day_and_checked() {
        assert!(date_lines("2026-11-03").is_some_and(|d| d.ends_with("set time of d to 0")));
        for bad in ["", "tomorrow", "2026-13-01", "2026-11-00", "1999-01-01", "2026-11"] {
            assert!(date_lines(bad).is_none(), "{bad}");
        }
        assert!(event("Freeze", "2026-11-03").contains("allday event:true"));
        assert!(reminder("Pay rent", "2026-11-03").contains("allday due date:d"));
        assert!(!reminder("Pay rent", "").contains("due date"));
    }

    #[test]
    #[ignore = "writes the scripts for `osacompile` to check; run with --ignored --nocapture"]
    fn print_scripts() {
        println!("{}\n---\n{}\n---\n{}", event("Say \"hi\"", "2026-11-03"), reminder("Pay rent", "2026-11-03"), reminder("x", ""));
    }
}
