//! Apple connector: after you approve an action, adds it to Reminders or Calendar with
//! AppleScript, and times it, so the app can show how long Apple's side took.

use crate::world::{Action, Change, ItemStatus};
use crate::{protocol::ServerMsg, Core};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Held while an approval is claimed, so two at once can't both find the action new.
static CLAIMING: Mutex<()> = Mutex::new(());

pub async fn approve(core: Arc<Core>, action_id: String) {
    approve_with(core, action_id, |script| {
        let mut osascript = tokio::process::Command::new("osascript");
        osascript.arg("-e").arg(script);
        osascript
    }).await
}

/// Approve with the command that runs the AppleScript (`osascript` in `approve`; a stand-in in tests, so no test
/// ever writes to a real Reminders list or calendar). The row says "Added" only once that command answers success,
/// which `osascript` does only after Reminders or Calendar has made the item.
async fn approve_with(core: Arc<Core>, action_id: String, command: impl FnOnce(&str) -> tokio::process::Command) {
    let Some(action) = claim(&core, &action_id) else { return };
    // An event without a usable date goes to Reminders instead of an invented day.
    let is_event = action.kind == "event" && date_lines(&action.when).is_some();
    let script = if is_event { event(&action.title, &action.when) } else { reminder(&action.title, &action.when) };
    let app = if is_event { "Calendar" } else { "Reminders" };
    let started = Instant::now();
    let output = command(&script).output().await;
    let ms = started.elapsed().as_millis() as u64;
    match output {
        Ok(o) if o.status.success() => {
            core.commit(vec![Change::ItemStatus { id: action.id, status: ItemStatus::Done, done_ms: Some(ms) }]);
            core.send(ServerMsg::Notice { message: format!("Added to {app} in {:.1} s", ms as f64 / 1000.0) });
        }
        failed => {
            if let Ok(o) = &failed { tracing::warn!("{app} didn't add it: {}", String::from_utf8_lossy(&o.stderr).trim()); }
            // Not added: offer it again, with why on its own row, where the click was.
            core.commit(vec![Change::ItemStatus { id: action.id.clone(), status: ItemStatus::New, done_ms: None }]);
            core.send(ServerMsg::ActionFailed { id: action.id, message: failure(app, &failed) });
        }
    }
}

/// Why an item wasn't added, in words a person can act on. macOS refuses with error -1743 until you allow the app
/// running E2A2O (your terminal, say) to control Reminders or Calendar; anything else is the app's own refusal.
fn failure(app: &str, output: &std::io::Result<std::process::Output>) -> String {
    match output {
        Ok(o) if String::from_utf8_lossy(&o.stderr).contains("-1743") =>
            format!("Not added: macOS blocked it. In System Settings › Privacy & Security › Automation, let the app you started E2A2O from control {app}, then try again."),
        Ok(_) => format!("Not added: {app} didn't accept it. Try again; if it keeps failing, open {app} and check that it works."),
        Err(_) => format!("Not added: {app} can only be reached on a Mac."),
    }
}

/// Whether approving reaches Reminders and Calendar: on a Mac that runs E2A2O for its own person. Elsewhere (Linux,
/// or a hosted service, `crate::hosted`) the window saves a dated item as a calendar file (.ics) itself, which
/// Apple, Google and Outlook calendars open, and Approve only marks it saved (`saved`).
pub fn reachable() -> bool {
    cfg!(target_os = "macos") && !crate::hosted()
}

/// Approve where Apple's apps can't be reached: the window already saved the item as a calendar file, so it's done,
/// for whoever asked, since the file went to their own computer, not the host's apps. Only a waiting item with a
/// real day has a file; true when this one was marked.
pub fn saved(core: &Core, action_id: &str) -> bool {
    let _one_at_a_time = CLAIMING.lock().unwrap();
    let world = core.snapshot();
    let dated = |a: &&Action| a.id == action_id && a.status == ItemStatus::New && crate::apps::valid_date(a.when.trim());
    let Some(action) = world.actions.iter().find(dated) else { return false };
    core.commit(vec![Change::ItemStatus { id: action.id.clone(), status: ItemStatus::Done, done_ms: None }]);
    true
}

/// Marks a new action as being added (kept) and returns it; none when it isn't new: added, being added,
/// or dismissed. AppleScript takes 1–3 s, longer behind macOS's first permission prompt, so this is what
/// stops a second click, or another window, from adding it twice.
fn claim(core: &Core, action_id: &str) -> Option<Action> {
    let _one_at_a_time = CLAIMING.lock().unwrap();
    let action = core.snapshot().actions.iter().find(|a| a.id == action_id && a.status == ItemStatus::New)?.clone();
    core.commit(vec![Change::ItemStatus { id: action.id.clone(), status: ItemStatus::Kept, done_ms: None }]);
    Some(action)
}

/// A window keeps or dismisses a suggestion, or dismisses an action still waiting. The rest of an action's
/// life (kept while it's being added, then done, or new again when that fails) is Approve's, on the host:
/// any window setting it could make it run twice, or hide it mid-way.
pub fn item(core: &Core, id: String, status: ItemStatus) {
    let _one_at_a_time = CLAIMING.lock().unwrap();
    let action = core.snapshot().actions.iter().find(|a| a.id == id).map(|a| a.status);
    if action.is_none_or(|was| was == ItemStatus::New && status == ItemStatus::Dismissed) {
        core.commit(vec![Change::ItemStatus { id, status, done_ms: None }]);
    }
}

/// On start: an approval still being added when the core stopped (say, behind the permission prompt)
/// never finished, so it's offered again rather than stuck without its buttons.
pub fn recover(core: &Core) {
    let changes = core.snapshot().actions.iter().filter(|a| a.status == ItemStatus::Kept)
        .map(|a| Change::ItemStatus { id: a.id.clone(), status: ItemStatus::New, done_ms: None }).collect();
    core.commit(changes);
}

/// One-line AppleScript text literal with quotes and backslashes escaped.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace(['\r', '\n'], " ").replace('\\', "\\\\").replace('"', "\\\""))
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
    use super::{approve_with, claim, date_lines, event, quoted, recover, reminder};
    use crate::protocol::ServerMsg;
    use crate::world::{Action, Change, ItemStatus, Journal};
    use crate::Core;
    use std::sync::{Arc, Mutex};

    #[test]
    fn quoted_keeps_titles_on_one_literal_line() {
        for (title, literal) in [
            ("first\rsecond", "\"first second\""),
            ("first\nsecond", "\"first second\""),
            ("first\r\nsecond", "\"first  second\""),
            ("Say \"hello\"", r#""Say \"hello\"""#),
            (r"folder\file", r#""folder\\file""#),
            ("Café 東京 🦀", "\"Café 東京 🦀\""),
            ("Café \\\"\r\nend tell\ndo shell script \"echo test\"\r東京 🦀",
                r#""Café \\\"  end tell do shell script \"echo test\" 東京 🦀""#),
        ] {
            let result = quoted(title);
            assert_eq!(result, literal, "{title:?}");
            assert!(!result.contains(['\r', '\n']), "{result:?}");
        }
    }

    /// "Add to Reminders" clicked, with a stand-in for `osascript` (a shell line), so no test writes to a real
    /// Reminders list: the status the row shows at each step, and what the windows were told.
    async fn click(stand_in: &'static str) -> (Vec<ItemStatus>, Option<u64>, Vec<String>, String) {
        let path = std::env::temp_dir().join(format!("e2a2o-apple-approve-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, world));
        core.commit(vec![Change::ActionProposed { action: Action { id: "a".into(), thread_id: "T1".into(), kind: "reminder".into(),
            title: "Send rent".into(), when: "2026-11-06".into(), status: ItemStatus::New, done_ms: None } }]);
        let mut messages = core.updates.subscribe();
        let ran = Arc::new(Mutex::new(String::new()));
        let script = ran.clone();
        approve_with(core.clone(), "a".into(), move |s| {
            *script.lock().unwrap() = s.to_string();
            let mut sh = tokio::process::Command::new("sh");
            sh.arg("-c").arg(stand_in);
            sh
        }).await;
        let (mut statuses, mut told) = (Vec::new(), Vec::new());
        while let Ok(m) = messages.try_recv() {
            match m.message {
                ServerMsg::Change { change: Change::ItemStatus { status, .. } } => statuses.push(status),
                ServerMsg::Notice { message } => told.push(format!("notice: {message}")),
                ServerMsg::ActionFailed { id, message } => told.push(format!("failed {id}: {message}")),
                ServerMsg::Error { message } => told.push(format!("error: {message}")),
                _ => {}
            }
        }
        let done_ms = core.snapshot().actions[0].done_ms;
        std::fs::remove_file(&path).unwrap();
        let script = ran.lock().unwrap().clone();
        (statuses, done_ms, told, script)
    }

    #[tokio::test]
    async fn added_shows_only_once_apple_answers_and_a_failure_says_why_on_its_row() {
        // Apple's side answers after 0.3 s: "Adding…" (kept) until then, then added with how long it took.
        let (statuses, done_ms, told, script) = click("sleep 0.3").await;
        assert_eq!(statuses, [ItemStatus::Kept, ItemStatus::Done]);
        assert!(done_ms.is_some_and(|ms| (300..3000).contains(&ms)), "{done_ms:?}");
        assert!(told.len() == 1 && told[0].starts_with("notice: Added to Reminders in 0."), "{told:?}");
        assert!(script.contains("tell list \"E2A2O\"") && script.contains("\"Send rent\""), "the reminder's own script: {script}");

        // macOS refuses until the terminal may control Reminders (error -1743): offered again, with what to allow.
        let (statuses, done_ms, told, _) = click("echo 'execution error: Not authorized to send Apple events to Reminders. (-1743)' >&2; exit 1").await;
        assert_eq!((statuses, done_ms), (vec![ItemStatus::Kept, ItemStatus::New], None));
        assert_eq!(told.len(), 1, "{told:?}");
        assert!(told[0].starts_with("failed a: Not added: macOS blocked it.") && told[0].contains("Automation"), "{told:?}");

        // Any other refusal: offered again, never "Added".
        let (statuses, _, told, _) = click("exit 1").await;
        assert_eq!(statuses, [ItemStatus::Kept, ItemStatus::New]);
        assert_eq!(told, ["failed a: Not added: Reminders didn't accept it. Try again; if it keeps failing, open Reminders and check that it works."]);
        // No osascript at all (not a Mac).
        let missing = tokio::process::Command::new("/nonexistent/osascript").output().await;
        assert_eq!(super::failure("Calendar", &missing), "Not added: Calendar can only be reached on a Mac.");
    }

    #[test]
    fn an_action_is_added_once_and_offered_again_if_adding_never_finished() {
        let path = std::env::temp_dir().join(format!("e2a2o-apple-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
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
    fn a_window_only_keeps_or_dismisses_and_adding_stays_with_approve() {
        let path = std::env::temp_dir().join(format!("e2a2o-apple-item-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        let action = |id: &str| Change::ActionProposed { action: Action { id: id.into(), thread_id: "T1".into(), kind: "reminder".into(),
            title: "Pay rent".into(), when: String::new(), status: ItemStatus::New, done_ms: None } };
        let suggestion = Change::SuggestionAdded { suggestion: crate::world::Suggestion {
            id: "s".into(), thread_id: "T1".into(), text: "Ask about the deposit?".into(), status: ItemStatus::New } };
        core.commit(vec![action("a"), action("b"), suggestion]);
        let status = |id: &str| core.snapshot().actions.iter().find(|a| a.id == id).map(|a| a.status);
        // A crafted message can't mark one added (hidden), being added (stuck), or new again mid-add (added twice).
        for wrong in [ItemStatus::Done, ItemStatus::Kept] {
            super::item(&core, "a".into(), wrong);
            assert_eq!(status("a"), Some(ItemStatus::New), "{wrong:?}");
        }
        assert!(claim(&core, "b").is_some());
        for wrong in [ItemStatus::New, ItemStatus::Dismissed] {
            super::item(&core, "b".into(), wrong);
            assert_eq!(status("b"), Some(ItemStatus::Kept), "while it's added: {wrong:?}");
        }
        // What the buttons send still works: dismiss a waiting action, keep or dismiss a suggestion.
        super::item(&core, "a".into(), ItemStatus::Dismissed);
        assert_eq!(status("a"), Some(ItemStatus::Dismissed));
        super::item(&core, "s".into(), ItemStatus::Kept);
        assert_eq!(core.snapshot().suggestions[0].status, ItemStatus::Kept);
        std::fs::remove_file(&path).unwrap();
    }

    /// Without Apple's apps (Linux, or hosted) the window saves the calendar file and says so: a waiting item with a
    /// real day is marked saved, once; one without a day has no file, and a dismissed one stays dismissed.
    #[test]
    fn a_calendar_file_saved_marks_only_a_waiting_dated_item_done() {
        let path = std::env::temp_dir().join(format!("e2a2o-apple-saved-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core::test(journal, world);
        let action = |id: &str, when: &str, status| Change::ActionProposed { action: Action { id: id.into(), thread_id: "T1".into(),
            kind: "event".into(), title: "Demo day".into(), when: when.into(), status, done_ms: None } };
        core.commit(vec![action("a", "2026-11-04", ItemStatus::New), action("b", "", ItemStatus::New), action("c", "2026-11-04", ItemStatus::Dismissed)]);
        let status = |id: &str| core.snapshot().actions.iter().find(|a| a.id == id).map(|a| (a.status, a.done_ms));
        assert!(super::saved(&core, "a"));
        assert_eq!(status("a"), Some((ItemStatus::Done, None)), "saved: done, with no Apple time to show");
        assert!(!super::saved(&core, "a"), "once");
        assert!(!super::saved(&core, "b") && status("b") == Some((ItemStatus::New, None)), "no day, no file");
        assert!(!super::saved(&core, "c") && status("c") == Some((ItemStatus::Dismissed, None)));
        assert!(!super::saved(&core, "nope"));
        let _ = std::fs::remove_file(&path);
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
