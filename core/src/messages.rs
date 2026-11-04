//! Presets, and the Messages connector the Full preset turns on.
//!
//! A preset picks which connectors a run has: Demo (the default) is the core alone, the map and its Reminders and
//! Calendar beat; Full is every connector, today Messages, Email, GitHub (github.rs) and Notes (notes.rs). `PRESET=full` in
//! the environment or `.env` switches it.
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
use std::collections::{HashMap, HashSet};
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
    /// Every connector: Messages, Email, GitHub and Notes too.
    Full,
}

impl Preset {
    /// `PRESET=full` (any case); anything else, or nothing, is Demo, so a run never reaches further than asked.
    pub fn parse(value: Option<&str>) -> Preset {
        if value.is_some_and(|v| v.trim().eq_ignore_ascii_case("full")) { Preset::Full } else { Preset::Demo }
    }
}

/// A delivery channel shares one countdown, Stop and reconnect path.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    #[default]
    Messages,
    Email,
}

impl Channel {
    pub fn is_messages(&self) -> bool { *self == Self::Messages }
    fn app(self) -> &'static str { if self == Self::Email { "Mail" } else { "Messages" } }
    fn setting(self) -> &'static str { if self == Self::Email { "EMAIL_SEND" } else { "MESSAGES_SEND" } }
}

/// What a run may do with Messages and email.
#[derive(Clone, Debug, Default)]
pub struct Settings {
    pub preset: Preset,
    /// The allow-list: each contact's name as said ("Mia") and the handle Messages sends to (a phone number or an
    /// Apple ID email). No one else is ever sent to.
    pub contacts: Vec<(String, String)>,
    /// `MESSAGES_SEND=on`: a countdown that ends really sends. Off, it's a dry run.
    pub live: bool,
    pub email_contacts: Vec<(String, String)>,
    pub email_live: bool,
    pub hosted: bool,
}

impl Settings {
    pub fn from_env() -> Settings {
        let var = |name: &str| std::env::var(name).ok();
        Settings {
            preset: Preset::parse(var("PRESET").as_deref()),
            contacts: contacts(var("MESSAGES_TO").as_deref().unwrap_or("")),
            live: var("MESSAGES_SEND").is_some_and(|v| crate::trace::on(&v)),
            email_contacts: contacts(var("EMAIL_TO").as_deref().unwrap_or("")).into_iter()
                .filter(|(name, address)| !name.contains('@') && valid_address(address)).collect(),
            email_live: var("EMAIL_SEND").is_some_and(|v| crate::trace::on(&v)),
            hosted: crate::hosted(),
        }
    }

    /// The contact `words` (said, lowercased) start with, longest name first ("Mia Chen" before "Mia"), with how many
    /// words its name took.
    fn channel_contact(&self, channel: Channel, words: &[String]) -> Option<(&str, &str, usize)> {
        let contacts = if channel == Channel::Email { &self.email_contacts } else { &self.contacts };
        contacts
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

/// Only one mailbox, never a recipient list or an AppleScript expression.
fn valid_address(address: &str) -> bool {
    let Some((local, domain)) = address.split_once('@') else { return false };
    !local.is_empty() && !domain.is_empty() && !domain.contains('@')
        && !address.chars().any(|c| c.is_whitespace() || matches!(c, ',' | ';' | '<' | '>'))
}

/// The shortest countdown: it sends in 5 seconds unless you say something. It is what the demo's message
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

/// Email's subject is a rule: the first eight body words, preserving their spelling. No model call.
fn subject(body: &str) -> String {
    body.split_whitespace().take(8).collect::<Vec<_>>().join(" ").trim_end_matches(['.', '!', '?']).to_string()
}

type EmailSender = Arc<dyn Fn(String, String, String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

const MAIL_SCRIPT: [&str; 9] = [
    "on run argv",
    "tell application \"Mail\"",
    "set outgoing to make new outgoing message with properties {subject:item 2 of argv, content:item 3 of argv, visible:false}",
    "tell outgoing",
    "make new to recipient at end of to recipients with properties {address:item 1 of argv}",
    "end tell",
    "if not (send outgoing) then error \"Mail refused\"",
    "end tell",
    "end run",
];

fn mail_app() -> EmailSender {
    Arc::new(|address, subject, body| Box::pin(async move {
        let mut command = tokio::process::Command::new("osascript");
        for line in MAIL_SCRIPT { command.arg("-e").arg(line); }
        let output = command.arg("--").arg(address).arg(subject).arg(body).output().await.map_err(|e| e.to_string())?;
        if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).trim().to_string()) }
    }))
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
    email_sender: EmailSender,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    next: u64,
    email_off: HashSet<String>,
    speech_ends: HashMap<String, (u64, tokio::time::Instant)>,
    counting: Option<Counting>,
    /// A message Messages has but hasn't answered for yet, and whose: one at a time holds until it does, and a window
    /// of theirs that reconnects meanwhile gets its card, "Sending…", so the answer that follows has a card to end.
    sending: Option<(String, ServerMsg)>,
    /// A speaker whose "stop" was heard while they were still saying it: the turn it ends is that same stop.
    stopped_by_voice: Option<String>,
    /// How many windows each speaker has open (`window`): a count that ends with none of theirs open, so no Stop of
    /// theirs could reach the core, ends unsent.
    windows: HashMap<String, usize>,
    /// Each speaker's last card end (stopped, sent, dry run, failed), for a window that reconnects: one that was
    /// showing that card counting learns how it went, though the end was said while it was away (`card_for`).
    ended: HashMap<String, ServerMsg>,
}

struct Counting {
    channel: Channel,
    subject: String,
    speech_end: Option<(u64, tokio::time::Instant)>,
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
        Runtime { settings, sender, email_sender: if cfg!(test) {
            Arc::new(|_, _, _| Box::pin(async { Err("no email sending in tests".into()) }))
        } else { mail_app() }, state: Mutex::default() }
    }

    /// Whether a countdown that ends sends for real: the setting is on, and this is a Mac running the core for its
    /// own person (apple.rs `reachable`).
    fn live(&self, channel: Channel) -> bool {
        let on = if channel == Channel::Email { self.settings.email_live } else { self.settings.live };
        on && !self.settings.hosted && crate::apple::reachable()
    }
}

/// A message asked for: who, in the allow-list's spelling, their handle, and the words to send.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub channel: Channel,
    pub subject: String,
    pub to: String,
    pub handle: String,
    pub text: String,
}

const VERBS: [&str; 5] = ["ask", "tell", "text", "message", "email"];
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
    if withdrawn(text) {
        return None;
    }
    let said = crate::spoken::plain(text);
    // `said` is part of `text`: where it starts there, so the words sent are cut from the turn as said.
    let at = said.as_ptr() as usize - text.as_ptr() as usize;
    let spans = crate::word_spans(said);
    let words: Vec<String> = spans.iter().map(|(w, _)| w.clone()).collect();
    let verb = words.first()?;
    if !VERBS.contains(&verb.as_str()) {
        return None;
    }
    let channel = if verb == "email" { Channel::Email } else { Channel::Messages };
    let (to, handle, n) = settings.channel_contact(channel, &words[1..])?;
    if channel == Channel::Email && (to.contains('@') || !valid_address(handle)) { return None; }
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
    let subject = if channel == Channel::Email { subject(rest) } else { String::new() };
    Some(Ask { channel, subject, to: to.to_string(), handle: handle.to_string(), text })
}

/// Whether the turn's last clause stops it ("…, no, stop."): the request was taken back as it was said, so those words
/// are never part of a message. A clause ends where speech-to-text punctuates a pause (main.rs `PAUSE`); a closing
/// "please" or "thanks" is said to the app, so the clause before it counts ("…, stop, please"). A stop word inside a
/// clause ("tell Mia the answer is no") is words.
fn withdrawn(text: &str) -> bool {
    let pause = |c: char| crate::PAUSE.contains(&c);
    let mut said = text;
    loop {
        said = said.trim_end_matches(|c: char| c.is_whitespace() || c == '-' || pause(c));
        let last = said.rsplit(pause).next().unwrap_or_default();
        if !COURTESY.contains(&crate::words(last).join(" ").as_str()) {
            return crate::words(last).len() < crate::words(text).len() && is_stop(last);
        }
        said = &said[..said.len() - last.len()];
    }
}

/// Said to the app after a stop, not to anyone: "stop, please", "never mind, thanks".
const COURTESY: [&str; 3] = ["please", "thanks", "thank you"];

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
    let email = crate::words(crate::spoken::plain(text)).first().is_some_and(|w| w == "email");
    if email && (settings.hosted || core.messages.state.lock().unwrap().email_off.contains(speaker)) { return None; }
    // "Ask Mia to bring chips, no, stop": taken back in the same breath, so nothing counts down, and it's no thought.
    if kind(text).is_some() && withdrawn(text) {
        core.send_to(speaker, ServerMsg::Notice { message: "Not sent: you said “stop” at the end.".into() });
        return Some(Done::missed(Act::Message));
    }
    let Some(ask) = read(text, settings) else {
        if kind(text).is_some() {
            let words = crate::words(crate::spoken::plain(text));
            let message = match settings.channel_contact(if email { Channel::Email } else { Channel::Messages }, &words[1..]) {
                // On the list, but not said as a message this can write.
                Some((name, _, _)) => format!("Not sent: say it as “ask {name} to …” or “tell {name} that …”. Kept as a thought."),
                None if email => "Not sent: no one by that name is on your email list (EMAIL_TO). Kept as a thought.".into(),
                None => "Not sent: no one by that name is on your Messages list (MESSAGES_TO). Kept as a thought.".into(),
            };
            core.send_to(speaker, ServerMsg::Notice { message });
        }
        return None;
    };
    // As the Add button: Messages is the host's, on the laptop running the core.
    if !core.is_host(speaker) {
        core.send_to(speaker, ServerMsg::Notice { message: if email {
            "Only the host can send email: it goes from their Mac.".into()
        } else { "Only the host can send messages: they go from their Mac.".into() } });
        return Some(Done::missed(Act::Message));
    }
    let in_ms = countdown_ms(&format!("{} {}", ask.subject, ask.text));
    let live = core.messages.live(ask.channel);
    let (id, message) = {
        let mut state = core.messages.state.lock().unwrap();
        if state.counting.is_some() || state.sending.is_some() {
            drop(state);
            core.send_to(speaker, ServerMsg::Notice { message: "One message at a time: say “stop”, or wait for it to send.".into() });
            return Some(Done::missed(Act::Message));
        }
        state.next += 1;
        let id = state.next;
        let shown_end = tokio::time::Instant::now() + Duration::from_millis(in_ms);
        state.counting = Some(Counting { channel: ask.channel, subject: ask.subject.clone(), speech_end: state.speech_ends.remove(speaker), id, speaker: speaker.into(), to: ask.to.clone(), handle: ask.handle, text: ask.text.clone(), live, shown_end });
        let c = state.counting.as_ref().unwrap();
        trace_delivery(core, c, "card");
        (id, card(c, SendState::Counting, in_ms, live, ""))
    };
    core.send_to(speaker, message);
    let core = core.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(in_ms + LATE_STOP_MS)).await;
        finish(&core, id).await;
    });
    // "No, I meant …" takes this one down before it redoes the request (catalog.rs `redo`).
    Some(Done::with(Act::Message, Some(crate::catalog::Undo::Unsend { id })))
}

/// The speaker's card, for a window that just (re)connected: their message still counting down, with the time the count
/// has left; else one Messages still has ("Sending…"), whose end then follows; else how their last one ended, which a
/// window only shows over that same card (ui/src/send-card.ts), so a window that lost its connection mid-count learns
/// whether it went and a fresh one shows nothing old.
pub fn card_for(core: &Core, speaker: &str) -> Option<ServerMsg> {
    let state = core.messages.state.lock().unwrap();
    let Some(c) = state.counting.as_ref().filter(|c| c.speaker == speaker) else {
        let sending = state.sending.as_ref().filter(|(s, _)| s == speaker).map(|(_, card)| card);
        return sending.or_else(|| state.ended.get(speaker)).cloned();
    };
    let left = c.shown_end.saturating_duration_since(tokio::time::Instant::now()).as_millis() as u64;
    Some(card(c, SendState::Counting, left, c.live, ""))
}

/// One of the speaker's windows, open while this lives (main.rs `session`).
pub struct Window {
    core: Arc<Core>,
    speaker: String,
}

/// Counts a window open for `speaker` until the returned guard drops.
pub fn window(core: &Arc<Core>, speaker: &str) -> Window {
    *core.messages.state.lock().unwrap().windows.entry(speaker.to_string()).or_default() += 1;
    Window { core: core.clone(), speaker: speaker.to_string() }
}

impl Drop for Window {
    fn drop(&mut self) {
        let mut state = self.core.messages.state.lock().unwrap();
        if let Some(n) = state.windows.get_mut(&self.speaker) {
            *n -= 1;
            if *n == 0 {
                state.windows.remove(&self.speaker);
            }
        }
    }
}

/// A card's end: to the speaker's windows, and kept for one that reconnects (`card_for`).
fn end(core: &Core, speaker: &str, message: ServerMsg) {
    core.messages.state.lock().unwrap().ended.insert(speaker.to_string(), message.clone());
    core.send_to(speaker, message);
}

/// Whether message `id` is still counting down (an Undo of it can still take it back).
pub fn is_counting(core: &Core, id: u64) -> bool {
    core.messages.state.lock().unwrap().counting.as_ref().is_some_and(|c| c.id == id)
}

fn card(c: &Counting, state: SendState, in_ms: u64, live: bool, message: &str) -> ServerMsg {
    ServerMsg::SendCard { id: c.id, to: c.to.clone(), text: c.text.clone(), channel: c.channel, subject: c.subject.clone(), state, in_ms, live, message: message.into() }
}

fn trace_delivery(core: &Core, c: &Counting, event: &str) {
    core.trace.write(|| serde_json::json!({"kind": "delivery", "channel": c.channel, "id": c.id,
        "event": event, "speech_end_ms": c.speech_end.map(|s| s.0),
        "speech_end_to_event_ms": c.speech_end.map(|s| s.1.elapsed().as_millis() as u64)}));
}

/// ASR's speechEnd arrival, kept only for this speaker's next completed turn; no words or address in the trace.
pub fn speech_end(core: &Core, speaker: &str, ended: bool) {
    let mut state = core.messages.state.lock().unwrap();
    state.speech_ends.remove(speaker);
    if ended { state.speech_ends.insert(speaker.into(), (crate::now_ms(), tokio::time::Instant::now())); }
}

/// Features can disable email immediately, including a pending countdown.
pub fn email_switch(core: &Core, speaker: &str, on: bool) {
    let mut state = core.messages.state.lock().unwrap();
    if on { state.email_off.remove(speaker); } else { state.email_off.insert(speaker.into()); }
    let taken = if !on && state.counting.as_ref().is_some_and(|c| c.channel == Channel::Email && c.speaker == speaker) {
        state.counting.take()
    } else { None };
    drop(state);
    if let Some(c) = taken { stopped(core, c); }
}

/// The countdown ended: the message goes, unless it was stopped (then it's no longer counting, and nothing happens),
/// or none of the speaker's windows is open: a Stop pressed while theirs was offline never reached the core, so it ends
/// unsent rather than going out unseen.
async fn finish(core: &Arc<Core>, id: u64) {
    let counting = {
        let mut state = core.messages.state.lock().unwrap();
        // A stopped message's timer still ends here: it leaves `sending` alone, which may be another message's.
        let Some(counting) = state.counting.take_if(|c| c.id == id) else { return };
        if !state.windows.contains_key(&counting.speaker) {
            drop(state);
            end(core, &counting.speaker, card(&counting, SendState::Stopped, 0, counting.live, OFFLINE));
            return;
        }
        // Live, Messages has it until it answers: one at a time holds till then.
        let c = &counting;
        state.sending = core.messages.live(c.channel).then(|| (c.speaker.clone(), card(c, SendState::Counting, 0, true, "")));
        counting
    };
    let c = &counting;
    if !core.messages.live(c.channel) {
        trace_delivery(core, c, "dry_run");
        let setting_on = if c.channel == Channel::Email { core.messages.settings.email_live } else { core.messages.settings.live };
        end(core, &c.speaker, card(c, SendState::DryRun, 0, false, &dry_run(&c.to, setting_on, c.channel)));
        return;
    }
    let result = if c.channel == Channel::Email {
        (core.messages.email_sender)(c.handle.clone(), c.subject.clone(), c.text.clone()).await
    } else { (core.messages.sender)(c.handle.clone(), c.text.clone()).await };
    core.messages.state.lock().unwrap().sending = None;
    match result {
        Ok(()) => {
            trace_delivery(core, c, "sent");
            end(core, &c.speaker, card(c, SendState::Sent, 0, true, &format!("Sent to {}", c.to)));
        }
        Err(error) => {
            tracing::warn!("{} didn't send it (error {})", c.channel.app(), error_number(&error));
            let message = if c.channel == Channel::Email { failure(&error).replace("Messages", "Mail").replace("signed in to iMessage", "set up to send email") } else { failure(&error) };
            end(core, &c.speaker, card(c, SendState::Failed, 0, true, &message));
        }
    }
}

/// A count that ended with none of the speaker's windows open.
const OFFLINE: &str = "Not sent: your window was offline, so you couldn't stop it.";

/// A dry run's end, saying what would have made it send: the setting, or, with it on, a Mac running the core for its
/// own person (not Linux, not a hosted core).
fn dry_run(to: &str, setting_on: bool, channel: Channel) -> String {
    if setting_on {
        format!("Dry run: nothing sent. {} sends only from a Mac running E2A2O for its own person; it would have gone to {to}.", channel.app())
    } else {
        format!("Dry run: nothing sent. With {}=on it would have gone to {to}.", channel.setting())
    }
}

/// The AppleScript error number in `osascript`'s words ("… (-1743)"), or "unknown": nothing else of them is logged.
pub(crate) fn error_number(error: &str) -> String {
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
    end(core, &c.speaker, card(&c, SendState::Stopped, 0, c.live, "Stopped: not sent"));
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
const STOP_TAILS: [&str; 12] = ["it", "that", "this", "the message", "the text", "the email", "email", "sending", "sending it", "now", "wait", "stop"];

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
