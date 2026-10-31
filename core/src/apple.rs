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
    let script = if action.kind == "event" { event(&action.title, &action.when) } else { reminder(&action.title, &action.when) };
    let app = if action.kind == "event" { "Calendar" } else { "Reminders" };
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

/// Builds `d` at 9 AM on a YYYY-MM-DD date without relying on locale date formats.
fn date_lines(when: &str) -> Option<String> {
    let mut parts = when.split('-').map(|p| p.parse::<u32>());
    let (Some(Ok(y)), Some(Ok(m)), Some(Ok(d))) = (parts.next(), parts.next(), parts.next()) else { return None };
    Some(format!(
        "set d to current date\nset day of d to 1\nset year of d to {y}\nset month of d to {m}\nset day of d to {d}\nset time of d to 9 * hours"
    ))
}

/// Reminders go to their own "E2A2O" list, so they never mix into your other lists unasked.
fn reminder(title: &str, when: &str) -> String {
    let name = quoted(title);
    let (date, due) = match date_lines(when) {
        Some(date) => (date, ", due date:d"),
        None => (String::new(), ""),
    };
    format!(
        "{date}\ntell application \"Reminders\"\nif not (exists list \"E2A2O\") then make new list with properties {{name:\"E2A2O\"}}\ntell list \"E2A2O\" to make new reminder with properties {{name:{name}{due}}}\nend tell"
    )
}

fn event(title: &str, when: &str) -> String {
    let date = date_lines(when).unwrap_or_else(|| "set d to (current date) + 1 * days\nset time of d to 9 * hours".into());
    format!(
        "{date}\ntell application \"Calendar\"\ntell (first calendar whose writable is true)\nmake new event with properties {{summary:{}, start date:d, end date:d + 30 * minutes}}\nend tell\nend tell",
        quoted(title)
    )
}
