//! Tests for presets and the Messages card (messages.rs). Every one stands in for Messages, so nothing is ever sent;
//! the clock is paused, so a countdown is checked to the millisecond without waiting.

use super::*;
use crate::protocol::Outgoing;
use crate::world::{Journal, World};
use tokio::sync::broadcast::Receiver;

type Sent = Arc<Mutex<Vec<(String, String)>>>;

struct Fixture {
    core: Arc<Core>,
    sent: Sent,
    out: Receiver<Outgoing>,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new(settings: Settings) -> Self {
        Self::with(settings, |core| core)
    }

    fn with(settings: Settings, adjust: impl FnOnce(Core) -> Core) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-messages-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let sent: Sent = Arc::default();
        let log = sent.clone();
        // The stand-in for Messages: it only writes down what it was asked to send.
        let sender: Sender = Arc::new(move |handle, text| {
            log.lock().unwrap().push((handle, text));
            Box::pin(async { Ok(()) })
        });
        let core = Arc::new(adjust(Core { messages: Runtime::with(settings, sender), ..Core::test(journal, World::default()) }));
        let out = core.updates.subscribe();
        Self { core, sent, out, path }
    }

    fn sends(&self) -> usize {
        self.sent.lock().unwrap().len()
    }

    /// The cards and notices sent since last asked, as short lines.
    fn told(&mut self) -> Vec<String> {
        std::iter::from_fn(|| self.out.try_recv().ok())
            .filter_map(|o| match o.message {
                ServerMsg::SendCard { to, text, state, in_ms, live, .. } => Some(format!("card {state:?} {to}: {text} ({in_ms} ms, live {live})")),
                ServerMsg::Notice { message } => Some(format!("notice {message}")),
                _ => None,
            })
            .collect()
    }

    fn thoughts(&self) -> Vec<String> {
        self.core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn full(live: bool) -> Settings {
    Settings { preset: Preset::Full, contacts: contacts("Mia=+15550100, Sam Lee=sam@example.com"), live }
}

/// Lets spawned work run after the clock moves.
async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

async fn wait(ms: u64) {
    tokio::time::advance(Duration::from_millis(ms)).await;
    settle().await;
}

const ASK: &str = "Ask Mia to confirm what to bring";
const TEXT: &str = "Hi Mia, could you confirm what to bring?";

#[test]
fn a_preset_is_demo_unless_full_is_asked_for() {
    assert_eq!(Preset::parse(None), Preset::Demo);
    assert_eq!(Preset::parse(Some("demo")), Preset::Demo);
    assert_eq!(Preset::parse(Some("everything")), Preset::Demo);
    assert_eq!(Preset::parse(Some(" Full ")), Preset::Full);
    assert_eq!(Settings::default().preset, Preset::Demo);
    assert!(!Settings::default().live, "a dry run unless MESSAGES_SEND is on");
}

#[test]
fn the_allow_list_reads_names_and_handles_and_skips_half_entries() {
    assert_eq!(
        contacts("Mia=+15550100, Sam Lee = sam@example.com; =+1555; Bob=; Ann"),
        vec![("Mia".to_string(), "+15550100".to_string()), ("Sam Lee".to_string(), "sam@example.com".to_string())]
    );
    assert!(contacts("").is_empty());
}

#[test]
fn a_turn_reads_as_a_message_only_to_someone_on_the_list() {
    let s = full(false);
    let ask = |said: &str| read(said, &s).map(|a| (a.to, a.handle, a.text));
    assert_eq!(ask(ASK), Some(("Mia".into(), "+15550100".into(), TEXT.into())));
    assert_eq!(ask("Okay, can you ask Mia to confirm what to bring, please?").map(|a| a.2), Some(TEXT.into()));
    assert_eq!(ask("Text Sam Lee that I'm running late.").map(|a| (a.0, a.2)), Some(("Sam Lee".into(), "Hi Sam Lee, I'm running late.".into())));
    assert_eq!(ask("tell mia to bring chips").map(|a| a.2), Some("Hi Mia, could you bring chips?".into()));
    for not in [
        "Ask Bob to confirm what to bring", // not on the list
        "Ask Mia what to bring",            // asks nothing it can write as a message
        "Ask Mia to",
        "Mia should confirm what to bring",
        "I need to ask Mia to confirm what to bring", // talk about it, not the request
        "Tell Mia",
    ] {
        assert_eq!(ask(not), None, "{not}");
    }
    // The shape alone, which the catalog reads as the act: someone named, then "to" or "that" and the words.
    assert_eq!(kind(ASK), Some(Act::Message));
    assert_eq!(kind("Ask Bob to confirm what to bring"), Some(Act::Message));
    for talk in ["Tell me about it", "Ask them to wait", "Message received", "Ask Mia", "Text Mia to", "Ask around"] {
        assert_eq!(kind(talk), None, "{talk}");
    }
    assert_eq!(crate::catalog::classify(ASK), Some(Act::Message));
}

#[test]
fn the_countdown_is_five_seconds_for_a_short_message_and_longer_for_a_long_one() {
    assert_eq!(countdown_ms(TEXT), COUNTDOWN_MS);
    assert_eq!(countdown_ms("Hi"), COUNTDOWN_MS);
    let long = "Hi Mia, could you confirm what to bring on Saturday, and whether the park still has the covered tables by the lake?";
    let needed = crate::words(long).len() as u64 * 60_000 / SLOW_WPM + DECIDE_MS + STOP_MS;
    assert!(countdown_ms(long) >= needed && countdown_ms(long) > COUNTDOWN_MS && countdown_ms(long) % 1_000 == 0);
}

#[tokio::test(start_paused = true)]
async fn nothing_is_sent_until_the_countdown_ends_then_it_sends_once() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    let live = crate::apple::reachable();
    assert_eq!(f.told(), vec![format!("card Counting Mia: {TEXT} (5000 ms, live {live})")]);
    assert!(f.thoughts().is_empty(), "a request, not a thought");
    wait(4_999).await;
    assert_eq!(f.sends(), 0, "1 ms before the end: nothing sent");
    assert!(f.told().is_empty());
    wait(1).await;
    if live {
        assert_eq!(*f.sent.lock().unwrap(), vec![("+15550100".to_string(), TEXT.to_string())]);
        assert_eq!(f.told(), vec![format!("card Sent Mia: {TEXT} (0 ms, live true)")]);
    } else {
        // Not a Mac (or a hosted core): a dry run, never a send.
        assert_eq!(f.sends(), 0);
    }
    wait(60_000).await;
    assert!(f.sends() <= 1, "once at most");
}

#[tokio::test(start_paused = true)]
async fn the_cards_stop_or_esc_before_the_end_means_it_is_never_sent() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(4_900).await;
    assert!(stop(&f.core, 1), "still counting");
    assert_eq!(f.told(), vec![format!("card Stopped Mia: {TEXT} (0 ms, live false)")]);
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    assert!(!stop(&f.core, 1), "already down");
    assert!(f.told().is_empty());
}

#[tokio::test(start_paused = true)]
async fn saying_stop_takes_it_down_and_the_stop_is_no_thought() {
    for word in ["Stop.", "Cancel it", "Don't send it!", "No", "Wait", "Scratch that"] {
        let mut f = Fixture::new(full(true));
        f.core.add_thought("me", ASK);
        settle().await;
        f.told();
        wait(3_000).await;
        f.core.add_thought("me", word);
        assert_eq!(f.told(), vec![format!("card Stopped Mia: {TEXT} (0 ms, live false)")], "{word}");
        wait(60_000).await;
        assert_eq!(f.sends(), 0, "{word}");
        assert!(f.thoughts().is_empty(), "{word}");
    }
}

#[tokio::test(start_paused = true)]
async fn stop_heard_while_still_being_said_stops_it_and_its_turn_is_only_that() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(2_000).await;
    heard(&f.core, "me", "Confirm what");
    heard(&f.core, "other", "Stop");
    assert!(f.told().is_empty(), "someone else's draft, or other words, stop nothing");
    heard(&f.core, "me", "Stop");
    assert_eq!(f.told(), vec![format!("card Stopped Mia: {TEXT} (0 ms, live false)")]);
    // The turn ends a moment later as "Stop.": already done, so nothing more, and not a thought.
    wait(4_000).await;
    f.core.add_thought("me", "Stop.");
    assert!(f.thoughts().is_empty());
    assert_eq!(f.sends(), 0);
    // A later "stop" with nothing counting is the rest of the app's again.
    assert!(!said(&f.core, "me", "Stop."));
}

#[tokio::test(start_paused = true)]
async fn a_dry_run_counts_down_and_says_what_it_would_have_sent_without_sending() {
    let mut f = Fixture::new(full(false));
    f.core.add_thought("me", ASK);
    settle().await;
    assert_eq!(f.told(), vec![format!("card Counting Mia: {TEXT} (5000 ms, live false)")]);
    wait(5_000).await;
    assert_eq!(f.told(), vec![format!("card DryRun Mia: {TEXT} (0 ms, live false)")]);
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
}

#[tokio::test(start_paused = true)]
async fn the_demo_preset_has_no_messages_the_words_stay_a_thought() {
    let mut f = Fixture::new(Settings { preset: Preset::Demo, ..full(true) });
    f.core.add_thought("me", ASK);
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    assert!(f.told().iter().all(|t| !t.starts_with("card")));
    assert_eq!(f.thoughts(), vec![ASK.to_string()]);
}

#[tokio::test(start_paused = true)]
async fn no_one_off_the_list_is_ever_sent_to_and_the_person_is_told() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", "Ask Bob to confirm what to bring");
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    let told = f.told();
    assert!(told.iter().all(|t| !t.starts_with("card")), "{told:?}");
    assert!(told.iter().any(|t| t.contains("Not sent: no one by that name")), "{told:?}");
    assert_eq!(f.thoughts(), vec!["Ask Bob to confirm what to bring".to_string()]);
}

#[tokio::test(start_paused = true)]
async fn a_guest_in_a_room_never_sends_from_the_hosts_messages() {
    let mut f = Fixture::with(full(true), |core| Core { room: Some(crate::Room::from("k7m2x9qp")), ..core });
    f.core.add_thought("guest", ASK);
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    let told = f.told();
    assert!(told.iter().all(|t| !t.starts_with("card")) && told.iter().any(|t| t.contains("Only the host")), "{told:?}");
}

#[tokio::test(start_paused = true)]
async fn one_at_a_time_a_second_ask_while_counting_is_refused() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(1_000).await;
    f.core.add_thought("me", "Text Sam Lee that I'm running late");
    assert_eq!(f.told(), vec!["notice One message at a time: say “stop”, or wait for it to send.".to_string()]);
    wait(60_000).await;
    let expected = if crate::apple::reachable() { vec![("+15550100".to_string(), TEXT.to_string())] } else { vec![] };
    assert_eq!(*f.sent.lock().unwrap(), expected, "only the first, once");
}
