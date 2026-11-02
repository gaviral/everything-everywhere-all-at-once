//! Presets, and the Messages connector the Full preset turns on.
//!
//! A preset picks which connectors a run has: Demo (the default) is the core alone, the map and its Reminders and
//! Calendar beat; Full is every connector, today Messages. `PRESET=full` in the environment or `.env` switches it.
//!
//! Messages: a whole turn like "ask Mia to confirm what to bring" puts a ready-to-send card up, with the message, who
//! it goes to and a visible countdown (`countdown_ms`). "Stop" (said, typed, or heard as it is being said), Esc or the
//! card's Stop takes it down unsent. Only when the countdown ends does it go, and then only:
//! - to a contact on the allow-list (`MESSAGES_TO`, names and handles; a handle never leaves the core),
//! - from the host's laptop (in a room, a guest's words never send from the host's Messages),
//! - through Messages on the Mac running the core, and only with `MESSAGES_SEND=on`; anything else is a dry run, whose
//!   card says what it would have sent.
//!
//! Tests stand in for Messages (`Sender`), so no test sends anything.

use crate::catalog::{Act, Done};
use crate::protocol::ServerMsg;
use crate::Core;
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Which connectors a run has.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    /// The core alone: nothing reaches outside the app but the Reminders and Calendar beat.
    #[default]
    Demo,
    /// Every connector: Messages too.
    Full,
}

impl Preset {
    /// `PRESET=full` (any case); anything else, or nothing, is Demo, so a run never reaches further than asked.
    pub fn parse(value: Option<&str>) -> Preset {
        if value.is_some_and(|v| v.trim().eq_ignore_ascii_case("full")) { Preset::Full } else { Preset::Demo }
    }
}

/// What a run may do with Messages.
#[derive(Clone, Debug, Default)]
pub struct Settings {
    pub preset: Preset,
    /// The allow-list: each contact's name as said ("Mia") and the handle Messages sends to (a phone number or an
    /// Apple ID email). No one else is ever sent to.
    pub contacts: Vec<(String, String)>,
    /// `MESSAGES_SEND=on`: a countdown that ends really sends. Off, it's a dry run.
    pub live: bool,
}

impl Settings {
    pub fn from_env() -> Settings {
        let var = |name: &str| std::env::var(name).ok();
        Settings {
            preset: Preset::parse(var("PRESET").as_deref()),
            contacts: contacts(var("MESSAGES_TO").as_deref().unwrap_or("")),
            live: var("MESSAGES_SEND").is_some_and(|v| crate::trace::on(&v)),
        }
    }

    /// The contact `words` (said, lowercased) start with, longest name first ("Mia Chen" before "Mia"), with how many
    /// words its name took.
    fn contact(&self, words: &[String]) -> Option<(&str, &str, usize)> {
        self.contacts
            .iter()
            .filter_map(|(name, handle)| {
                let name_words = crate::words(name);
                (!name_words.is_empty() && words.starts_with(&name_words)).then_some((name.as_str(), handle.as_str(), name_words.len()))
            })
            .max_by_key(|(_, _, n)| *n)
    }
}

/// `MESSAGES_TO`: "Mia=+15551234567, Sam=sam@example.com". An entry without both a name and a handle is left out.
pub fn contacts(list: &str) -> Vec<(String, String)> {
    list.split([',', ';'])
        .filter_map(|entry| {
            let (name, handle) = entry.split_once('=')?;
            let (name, handle) = (name.trim(), handle.trim());
            (!crate::words(name).is_empty() && !handle.is_empty()).then(|| (name.to_string(), handle.to_string()))
        })
        .collect()
}

/// The shortest countdown: User's "auto sends it in 5 seconds unless I say something". It is what the demo's message
/// needs, worked back from the person: "Hi Mia, could you confirm what to bring?" is 8 words, 2.7 s for a slow reader
/// (`SLOW_WPM`), then 1.35 s to decide (`DECIDE_MS`) and 0.9 s for "stop" to reach the core (0.4 s to say it, the
/// speech service's draft words ≈ 0.3 s behind the audio, asr.rs, ≈ 0.2 s there and back): 4.95 s.
pub const COUNTDOWN_MS: u64 = 5_000;
/// The slow end of silent reading, words a minute (ui/src/notice-rules.ts `SLOW_WPM`: Brysbaert 2019).
const SLOW_WPM: u64 = 175;
/// Deciding to act on what you just read (ui/src/notice-rules.ts `DECIDE_MS`: the Keystroke-Level Model).
const DECIDE_MS: u64 = 1_350;
/// Saying "stop" until the core hears it (see `COUNTDOWN_MS`).
const STOP_MS: u64 = 900;
/// How long after the count the card shows ends a stop still counts. The window starts its count when the card
/// reaches it, so its end runs behind the core's by the card's trip, a busy frame before the window reads it, and the
/// stop's trip back; a whole digit more covers those, so a stop while it still says "Sends in 1" is never late. The
/// card says "Sending…" meanwhile.
pub const LATE_STOP_MS: u64 = 1_000;

/// How long the card counts down for `text`: as long as reading it, deciding and saying "stop" take, in whole
/// seconds so the digits count down evenly, and never under `COUNTDOWN_MS`. A longer message gets longer.
pub fn countdown_ms(text: &str) -> u64 {
    let read = crate::words(text).len() as u64 * 60_000 / SLOW_WPM;
    let needed = (read + DECIDE_MS + STOP_MS).div_ceil(1_000) * 1_000;
    needed.max(COUNTDOWN_MS)
}

/// Sends one message: the handle, then the text. Messages through `osascript` in the app; a stand-in in tests.
pub type Sender = Arc<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// The AppleScript that sends: the handle and text arrive as arguments, never inside the script, so no words said
/// can change what it does.
const SCRIPT: [&str; 7] = [
    "on run argv",
    "set theHandle to item 1 of argv",
    "set theText to item 2 of argv",
    "tell application \"Messages\"",
    "send theText to participant theHandle of (1st account whose service type = iMessage)",
    "end tell",
    "end run",
];

/// Messages on this Mac, through `osascript`. `--` ends its options, so a handle or text starting with "-" is an
/// argument, never read as an option.
fn messages_app() -> Sender {
    Arc::new(|handle, text| {
        Box::pin(async move {
            let mut command = tokio::process::Command::new("osascript");
            for line in SCRIPT {
                command.arg("-e").arg(line);
            }
            let output = command.arg("--").arg(handle).arg(text).output().await.map_err(|e| e.to_string())?;
            if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).trim().to_string()) }
        })
    })
}

/// A message on its card, as the window shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SendState {
    /// Up, counting down: it sends when the count ends.
    Counting,
    /// Stopped before the count ended: nothing was sent.
    Stopped,
    /// Messages took it.
    Sent,
    /// A dry run's end: nothing was sent, and the card says what would have been.
    DryRun,
    /// Messages refused it, or isn't there.
    Failed,
}

/// The Messages side of the core: what it may do, and the one message counting down.
pub struct Runtime {
    pub settings: Settings,
    sender: Sender,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    next: u64,
    counting: Option<Counting>,
    /// A message Messages has but hasn't answered for yet: one at a time holds until it does.
    sending: bool,
    /// A speaker whose "stop" was heard while they were still saying it: the turn it ends is that same stop.
    stopped_by_voice: Option<String>,
}

struct Counting {
    id: u64,
    speaker: String,
    to: String,
    handle: String,
    text: String,
    live: bool,
    /// When the card's count ends (a stop still counts for `LATE_STOP_MS` after).
    shown_end: tokio::time::Instant,
}

impl Default for Runtime {
    /// Demo, no contacts: nothing can send. A test core's stand-in refuses, should one ever get that far.
    fn default() -> Self {
        let sender: Sender = if cfg!(test) { Arc::new(|_, _| Box::pin(async { Err("no sending in tests".to_string()) })) } else { messages_app() };
        Runtime::with(Settings::default(), sender)
    }
}

impl Runtime {
    pub fn from_env() -> Self {
        Runtime::with(Settings::from_env(), messages_app())
    }

    pub fn with(settings: Settings, sender: Sender) -> Self {
        Runtime { settings, sender, state: Mutex::default() }
    }

    /// Whether a countdown that ends sends for real: the setting is on, and this is a Mac running the core for its
    /// own person (apple.rs `reachable`).
    fn live(&self) -> bool {
        self.settings.live && crate::apple::reachable()
    }
}

/// A message asked for: who, in the allow-list's spelling, their handle, and the words to send.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub to: String,
    pub handle: String,
    pub text: String,
}

const VERBS: [&str; 4] = ["ask", "tell", "text", "message"];
/// A request to someone ("could you …?") after these; a statement after the others.
const ASKING: [&str; 1] = ["to"];
const SAYING: [&str; 3] = ["that", "saying", "say"];
/// Never a contact's name: "tell me about it", "ask them to wait" is about someone, not to them.
const PRONOUNS: [&str; 12] = ["me", "you", "him", "her", "them", "us", "it", "myself", "yourself", "everyone", "somebody", "someone"];

/// The shape of a message request, without the allow-list: a verb that sends ("ask", "tell", "text", "message"),
/// one to three words naming someone, then "to" or "that" and what to say. What the catalog reads as `Act::Message`.
pub fn kind(text: &str) -> Option<Act> {
    let words = crate::words(crate::spoken::plain(text));
    let verb = words.first()?;
    if !VERBS.contains(&verb.as_str()) || words.get(1).is_none_or(|w| PRONOUNS.contains(&w.as_str())) {
        return None;
    }
    let joined = |i: usize| ASKING.contains(&words[i].as_str()) || SAYING.contains(&words[i].as_str());
    (2..=4).any(|i| i + 1 < words.len() && joined(i)).then_some(Act::Message)
}

/// Reads a whole turn as a message to a contact on the list: "ask Mia to confirm what to bring" → to Mia, "Hi Mia,
/// could you confirm what to bring?". "Tell Sam that I'm running late" → "Hi Sam, I'm running late." None when the
/// turn isn't one, or names no one on the list.
pub fn read(text: &str, settings: &Settings) -> Option<Ask> {
    let said = crate::spoken::plain(text);
    // `said` is part of `text`: where it starts there, so the words sent are cut from the turn as said.
    let at = said.as_ptr() as usize - text.as_ptr() as usize;
    let spans = crate::word_spans(said);
    let words: Vec<String> = spans.iter().map(|(w, _)| w.clone()).collect();
    let verb = words.first()?;
    if !VERBS.contains(&verb.as_str()) {
        return None;
    }
    let (to, handle, n) = settings.contact(&words[1..])?;
    let link = words.get(1 + n)?;
    let asking = ASKING.contains(&link.as_str());
    // "Ask Mia what to bring" asks nothing this can write as a message to her; only "ask Mia to …".
    if !asking && (verb == "ask" || !SAYING.contains(&link.as_str())) {
        return None;
    }
    let rest = payload(&text[at + spans[1 + n].1..]);
    if !rest.chars().any(char::is_alphanumeric) {
        return None;
    }
    let text = if asking { format!("Hi {to}, could you {rest}?") } else { format!("Hi {to}, {rest}.") };
    Some(Ask { to: to.to_string(), handle: handle.to_string(), text })
}

/// The words to send, as said: only the spaces and joining punctuation around them go ("…that, I'm late." → "I'm
/// late"), and a closing "please", said to the app (the message already asks). "For me", "now", a minus sign stay.
fn payload(rest: &str) -> &str {
    let mut t = rest.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, ',' | ':' | ';')).trim_end();
    loop {
        let before = t.len();
        t = t.trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | '…' | ',' | ';' | ':') || c.is_whitespace());
        if let Some(head) = t.len().checked_sub(" please".len()).and_then(|i| Some((t.get(..i)?, t.get(i..)?))) {
            if head.1.eq_ignore_ascii_case(" please") {
                t = head.0;
            }
        }
        if t.len() == before {
            return t;
        }
    }
}

/// Acts on a whole turn that asks to message someone, in the Full preset; None leaves it to be talk (the Demo preset,
/// or a name not on the list, which is said once so the words aren't silently a thought).
pub fn act(core: &Arc<Core>, speaker: &str, text: &str) -> Option<Done> {
    let settings = &core.messages.settings;
    if settings.preset != Preset::Full {
        return None;
    }
    let Some(ask) = read(text, settings) else {
        if kind(text).is_some() {
            let words = crate::words(crate::spoken::plain(text));
            let message = match settings.contact(&words[1..]) {
                // On the list, but not said as a message this can write.
                Some((name, _, _)) => format!("Not sent: say it as “ask {name} to …” or “tell {name} that …”. Kept as a thought."),
                None => "Not sent: no one by that name is on your Messages list (MESSAGES_TO). Kept as a thought.".into(),
            };
            core.send_to(speaker, ServerMsg::Notice { message });
        }
        return None;
    };
    // As the Add button: Messages is the host's, on the laptop running the core.
    if !core.is_host(speaker) {
        core.send_to(speaker, ServerMsg::Notice { message: "Only the host can send messages: they go from their Mac.".into() });
        return Some(Done::missed(Act::Message));
    }
    let in_ms = countdown_ms(&ask.text);
    let live = core.messages.live();
    let id = {
        let mut state = core.messages.state.lock().unwrap();
        if state.counting.is_some() || state.sending {
            drop(state);
            core.send_to(speaker, ServerMsg::Notice { message: "One message at a time: say “stop”, or wait for it to send.".into() });
            return Some(Done::missed(Act::Message));
        }
        state.next += 1;
        let id = state.next;
        let shown_end = tokio::time::Instant::now() + Duration::from_millis(in_ms);
        state.counting = Some(Counting { id, speaker: speaker.into(), to: ask.to.clone(), handle: ask.handle, text: ask.text.clone(), live, shown_end });
        id
    };
    core.send_to(speaker, card(id, &ask.to, &ask.text, SendState::Counting, in_ms, live, ""));
    let core = core.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(in_ms + LATE_STOP_MS)).await;
        finish(&core, id).await;
    });
    // "No, I meant …" takes this one down before it redoes the request (catalog.rs `redo`).
    Some(Done::with(Act::Message, Some(crate::catalog::Undo::Unsend { id })))
}

/// The speaker's message still counting down, for a window that just opened (a reload): its card, with the time the
/// count has left.
pub fn counting_card(core: &Core, speaker: &str) -> Option<ServerMsg> {
    let state = core.messages.state.lock().unwrap();
    let c = state.counting.as_ref().filter(|c| c.speaker == speaker)?;
    let left = c.shown_end.saturating_duration_since(tokio::time::Instant::now()).as_millis() as u64;
    Some(card(c.id, &c.to, &c.text, SendState::Counting, left, c.live, ""))
}

/// Whether message `id` is still counting down (an Undo of it can still take it back).
pub fn is_counting(core: &Core, id: u64) -> bool {
    core.messages.state.lock().unwrap().counting.as_ref().is_some_and(|c| c.id == id)
}

fn card(id: u64, to: &str, text: &str, state: SendState, in_ms: u64, live: bool, message: &str) -> ServerMsg {
    ServerMsg::SendCard { id, to: to.into(), text: text.into(), state, in_ms, live, message: message.into() }
}

/// The countdown ended: the message goes, unless it was stopped (then it's no longer counting, and nothing happens).
async fn finish(core: &Arc<Core>, id: u64) {
    let Some(counting) = ({
        let mut state = core.messages.state.lock().unwrap();
        let taken = if state.counting.as_ref().is_some_and(|c| c.id == id) { state.counting.take() } else { None };
        // Live, Messages has it until it answers: one at a time holds till then.
        state.sending = taken.is_some() && core.messages.live();
        taken
    }) else {
        return;
    };
    let Counting { speaker, to, handle, text, .. } = counting;
    if !core.messages.live() {
        core.send_to(&speaker, card(id, &to, &text, SendState::DryRun, 0, false, &dry_run(&to, core.messages.settings.live)));
        return;
    }
    let result = (core.messages.sender)(handle, text.clone()).await;
    core.messages.state.lock().unwrap().sending = false;
    match result {
        Ok(()) => core.send_to(&speaker, card(id, &to, &text, SendState::Sent, 0, true, &format!("Sent to {to}"))),
        Err(error) => {
            // Only the error's number: Messages' own words can carry the handle, which never goes to the log.
            tracing::warn!("Messages didn't send it (error {})", error_number(&error));
            core.send_to(&speaker, card(id, &to, &text, SendState::Failed, 0, true, &failure(&error)));
        }
    }
}

/// A dry run's end, saying what would have made it send: the setting, or, with it on, a Mac running the core for its
/// own person (not Linux, not a hosted core).
fn dry_run(to: &str, setting_on: bool) -> String {
    if setting_on {
        format!("Dry run: nothing sent. Messages sends only from a Mac running E2A2O for its own person; it would have gone to {to}.")
    } else {
        format!("Dry run: nothing sent. With MESSAGES_SEND=on it would have gone to {to}.")
    }
}

/// The AppleScript error number in `osascript`'s words ("… (-1743)"), or "unknown": nothing else of them is logged.
fn error_number(error: &str) -> String {
    error
        .rsplit_once("(-")
        .and_then(|(_, tail)| tail.split_once(')'))
        .map(|(digits, _)| digits)
        .filter(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()))
        .map_or_else(|| "unknown".into(), |d| format!("-{d}"))
}

/// Why a message didn't go, in words a person can act on (as apple.rs says it for Reminders).
fn failure(error: &str) -> String {
    if error.contains("-1743") {
        "Not sent: macOS blocked it. In System Settings › Privacy & Security › Automation, let the app you started E2A2O from control Messages, then ask again.".into()
    } else {
        "Not sent: Messages didn't accept it. Check that Messages is signed in to iMessage, then ask again.".into()
    }
}

/// Takes the counting message down unsent, when it's `id` (the card's Stop or Esc; any window that shows it).
/// True when it was still counting.
pub fn stop(core: &Core, id: u64) -> bool {
    let taken = {
        let mut state = core.messages.state.lock().unwrap();
        if state.counting.as_ref().is_some_and(|c| c.id == id) { state.counting.take() } else { None }
    };
    taken.map(|c| stopped(core, c)).is_some()
}

fn stopped(core: &Core, c: Counting) {
    core.send_to(&c.speaker, card(c.id, &c.to, &c.text, SendState::Stopped, 0, c.live, "Stopped: not sent"));
}

/// Words that stop a message while it counts down, said or typed as the whole turn. Read as said, then without a
/// lead-in ("okay, stop"): "wait" and "no" lead into other requests, so alone they would read as nothing.
pub fn is_stop(text: &str) -> bool {
    crate::is_ask(text, &STOPS, &STOP_TAILS) || crate::is_command(text, &STOPS, &STOP_TAILS)
}

const STOPS: [&str; 17] = [
    "stop", "cancel", "don t send", "dont send", "do not send", "wait", "hold on", "no", "nope", "no no", "no stop",
    "no don t", "scratch that", "undo that", "undo", "never mind", "abort",
];
const STOP_TAILS: [&str; 10] = ["it", "that", "this", "the message", "the text", "sending", "sending it", "now", "wait", "stop"];

/// The speaker's draft words as they talk: "stop" stops their message now, without waiting for the turn to end.
pub fn heard(core: &Core, speaker: &str, draft: &str) {
    if !is_stop(draft) {
        return;
    }
    let taken = {
        let mut state = core.messages.state.lock().unwrap();
        let theirs = state.counting.as_ref().is_some_and(|c| c.speaker == speaker);
        let taken = if theirs { state.counting.take() } else { None };
        if taken.is_some() {
            state.stopped_by_voice = Some(speaker.into());
        }
        taken
    };
    if let Some(c) = taken {
        stopped(core, c);
    }
}

/// A whole turn, before anything else reads it: true when it was a "stop" for the speaker's counting message (or the
/// end of one their draft words already stopped), which is then all it was.
pub fn said(core: &Core, speaker: &str, text: &str) -> bool {
    let taken = {
        let mut state = core.messages.state.lock().unwrap();
        let voiced = match state.stopped_by_voice.take() {
            Some(s) if s == speaker => true,
            other => {
                state.stopped_by_voice = other;
                false
            }
        };
        if !is_stop(text) {
            return false;
        }
        let theirs = state.counting.as_ref().is_some_and(|c| c.speaker == speaker);
        match (theirs, voiced) {
            (true, _) => state.counting.take(),
            (false, true) => return true,
            (false, false) => return false,
        }
    };
    if let Some(c) = taken {
        stopped(core, c);
    }
    true
}

#[cfg(test)]
mod tests;
