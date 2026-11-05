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
    /// The asker's window, open unless a test closes it (`finish` sends nothing with none of theirs open).
    window: Option<Window>,
}

impl Fixture {
    fn new(settings: Settings) -> Self {
        Self::with(settings, |core| core)
    }

    fn with(settings: Settings, adjust: impl FnOnce(Core) -> Core) -> Self {
        let sent: Sent = Arc::default();
        let log = sent.clone();
        // The stand-in for Messages: it only writes down what it was asked to send.
        let sender: Sender = Arc::new(move |handle, text| {
            log.lock().unwrap().push((handle, text));
            Box::pin(async { Ok(()) })
        });
        Self::sending(settings, sender, sent, adjust)
    }

    fn sending(settings: Settings, sender: Sender, sent: Sent, adjust: impl FnOnce(Core) -> Core) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-messages-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(adjust(Core { messages: Runtime::with(settings, sender), ..Core::test(journal, World::default()) }));
        let out = core.updates.subscribe();
        let window = Some(window(&core, "me"));
        Self { core, sent, out, path, window }
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
    Settings { preset: Preset::Full, contacts: contacts("Recipient=+15550100, Colleague Reviewer=colleague@example.com"), live, ..Settings::default() }
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

const ASK: &str = "Ask Recipient to confirm what to bring";
const TEXT: &str = "Hi Recipient, could you confirm what to bring?";

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
        contacts("Recipient=+15550100, Colleague Reviewer = colleague@example.com; =+1555; Stranger=; Reader"),
        vec![("Recipient".to_string(), "+15550100".to_string()), ("Colleague Reviewer".to_string(), "colleague@example.com".to_string())]
    );
    assert!(contacts("").is_empty());
}

#[test]
fn a_turn_reads_as_a_message_only_to_someone_on_the_list() {
    let s = full(false);
    let ask = |said: &str| read(said, &s).map(|a| (a.to, a.handle, a.text));
    assert_eq!(ask(ASK), Some(("Recipient".into(), "+15550100".into(), TEXT.into())));
    assert_eq!(ask("Okay, can you ask Recipient to confirm what to bring, please?").map(|a| a.2), Some(TEXT.into()));
    assert_eq!(ask("Text Colleague Reviewer that I'm running late.").map(|a| (a.0, a.2)), Some(("Colleague Reviewer".into(), "Hi Colleague Reviewer, I'm running late.".into())));
    assert_eq!(ask("tell recipient to bring chips").map(|a| a.2), Some("Hi Recipient, could you bring chips?".into()));
    for not in [
        "Ask Stranger to confirm what to bring", // not on the list
        "Ask Recipient what to bring",            // asks nothing it can write as a message
        "Ask Recipient to",
        "Recipient should confirm what to bring",
        "I need to ask Recipient to confirm what to bring", // talk about it, not the request
        "Tell Recipient",
    ] {
        assert_eq!(ask(not), None, "{not}");
    }
    // The shape alone, which the catalog reads as the act: someone named, then "to" or "that" and the words.
    assert_eq!(kind(ASK), Some(Act::Message));
    assert_eq!(kind("Ask Stranger to confirm what to bring"), Some(Act::Message));
    for talk in ["Tell me about it", "Ask them to wait", "Message received", "Ask Recipient", "Text Recipient to", "Ask around"] {
        assert_eq!(kind(talk), None, "{talk}");
    }
    assert_eq!(crate::catalog::classify(ASK), Some(Act::Message));
}

#[test]
fn the_countdown_is_five_seconds_for_a_short_message_and_longer_for_a_long_one() {
    assert_eq!(countdown_ms(TEXT), COUNTDOWN_MS);
    assert_eq!(countdown_ms("Hi"), COUNTDOWN_MS);
    let long = "Hi Recipient, could you confirm what to bring on Saturday, and whether the park still has the covered tables by the lake?";
    let needed = crate::words(long).len() as u64 * 60_000 / SLOW_WPM + DECIDE_MS + STOP_MS;
    assert!(countdown_ms(long) >= needed && countdown_ms(long) > COUNTDOWN_MS && countdown_ms(long) % 1_000 == 0);
}

#[tokio::test(start_paused = true)]
async fn nothing_is_sent_until_the_countdown_ends_then_it_sends_once() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    let live = crate::apple::reachable();
    assert_eq!(f.told(), vec![format!("card Counting Recipient: {TEXT} (5000 ms, live {live})")]);
    assert!(f.thoughts().is_empty(), "a request, not a thought");
    // The card's count ends at 5 s; a stop still counts for LATE_STOP_MS after, so the window's end is never late.
    wait(4_999 + LATE_STOP_MS).await;
    assert_eq!(f.sends(), 0, "1 ms before the end: nothing sent");
    assert!(f.told().is_empty());
    wait(1).await;
    if live {
        assert_eq!(*f.sent.lock().unwrap(), vec![("+15550100".to_string(), TEXT.to_string())]);
        assert_eq!(f.told(), vec![format!("card Sent Recipient: {TEXT} (0 ms, live true)")]);
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
    let live = crate::apple::reachable();
    assert_eq!(f.told(), vec![format!("card Stopped Recipient: {TEXT} (0 ms, live {live})")], "a live card stays live once stopped");
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
        assert_eq!(f.told(), vec![format!("card Stopped Recipient: {TEXT} (0 ms, live {})", crate::apple::reachable())], "{word}");
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
    assert_eq!(f.told(), vec![format!("card Stopped Recipient: {TEXT} (0 ms, live {})", crate::apple::reachable())]);
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
    assert_eq!(f.told(), vec![format!("card Counting Recipient: {TEXT} (5000 ms, live false)")]);
    wait(5_000 + LATE_STOP_MS).await;
    assert_eq!(f.told(), vec![format!("card DryRun Recipient: {TEXT} (0 ms, live false)")]);
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
    f.core.add_thought("me", "Ask Stranger to confirm what to bring");
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    let told = f.told();
    assert!(told.iter().all(|t| !t.starts_with("card")), "{told:?}");
    assert!(told.iter().any(|t| t.contains("Not sent: no one by that name")), "{told:?}");
    assert_eq!(f.thoughts(), vec!["Ask Stranger to confirm what to bring".to_string()]);
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
    f.core.add_thought("me", "Text Colleague Reviewer that I'm running late");
    assert_eq!(f.told(), vec!["notice One message at a time: say “stop”, or wait for it to send.".to_string()]);
    wait(60_000).await;
    let expected = if crate::apple::reachable() { vec![("+15550100".to_string(), TEXT.to_string())] } else { vec![] };
    assert_eq!(*f.sent.lock().unwrap(), expected, "only the first, once");
}

#[tokio::test(start_paused = true)]
async fn a_stop_sent_as_the_card_says_its_last_second_is_never_late() {
    // The window counts from when the card reached it, so its "Sends in 1" can run past the core's 5 s.
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(5_000 + LATE_STOP_MS - 1).await;
    assert!(stop(&f.core, 1), "still stoppable just before the late end");
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
}

#[tokio::test(start_paused = true)]
async fn no_i_meant_takes_the_counting_message_down_before_the_new_one() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(1_000).await;
    f.core.add_thought("me", "No, I meant text Colleague Reviewer that I'm running late");
    settle().await;
    let live = crate::apple::reachable();
    let told = f.told();
    assert_eq!(told[0], format!("card Stopped Recipient: {TEXT} (0 ms, live {live})"), "{told:?}");
    assert!(told.contains(&format!("card Counting Colleague Reviewer: Hi Colleague Reviewer, I'm running late. (5000 ms, live {live})")), "{told:?}");
    wait(60_000).await;
    let expected = if live { vec![("colleague@example.com".to_string(), "Hi Colleague Reviewer, I'm running late.".to_string())] } else { vec![] };
    assert_eq!(*f.sent.lock().unwrap(), expected, "only the corrected one");
}

#[tokio::test(start_paused = true)]
async fn undo_after_the_count_says_it_is_too_late() {
    let mut f = Fixture::new(full(false));
    f.core.add_thought("me", ASK);
    settle().await;
    wait(60_000).await;
    f.told();
    f.core.add_thought("me", "Undo that");
    let told = f.told();
    assert!(told.iter().any(|t| t.contains("isn't counting down any more")), "{told:?}");
}

#[tokio::test(start_paused = true)]
async fn undo_after_a_corrected_message_sent_says_it_is_too_late() {
    let mut f = Fixture::new(full(false));
    f.core.add_thought("me", ASK);
    settle().await;
    f.core.add_thought("me", "No, I meant text Colleague Reviewer that I'm running late");
    settle().await;
    wait(60_000).await;
    f.told();
    f.core.add_thought("me", "Undo that");
    let told = f.told();
    assert!(told.iter().any(|t| t.contains("isn't counting down any more")), "{told:?}");
    assert!(!told.iter().any(|t| t.contains("Undone")), "{told:?}");
}

#[tokio::test(start_paused = true)]
async fn a_reloaded_window_gets_the_counting_card_back_with_the_time_left() {
    let mut f = Fixture::new(full(false));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(2_000).await;
    let back = card_for(&f.core, "me").expect("still counting");
    assert!(matches!(back, ServerMsg::SendCard { id: 1, state: SendState::Counting, in_ms: 3_000, .. }), "{}", serde_json::to_string(&back).unwrap());
    assert!(card_for(&f.core, "guest").is_none(), "only the asker's windows");
    let caught = crate::catch_up(&f.core, "me");
    // Before the world: the window reads the snapshot as the end of what the core says about its card.
    assert!(matches!(caught[0], ServerMsg::SendCard { id: 1, .. }) && matches!(caught[1], ServerMsg::Snapshot { .. }));
    wait(3_000 + LATE_STOP_MS).await;
    let ended = card_for(&f.core, "me").expect("how it ended");
    assert!(matches!(ended, ServerMsg::SendCard { id: 1, state: SendState::DryRun, in_ms: 0, .. }), "{}", serde_json::to_string(&ended).unwrap());
}

#[tokio::test(start_paused = true)]
async fn a_window_back_after_the_count_ended_learns_how_it_went() {
    // Its connection dropped mid-count and the end was said while it was away: catch-up says it, before the world.
    for (stopped, state) in [(true, SendState::Stopped), (false, SendState::DryRun)] {
        let f = Fixture::new(full(false));
        f.core.add_thought("me", ASK);
        settle().await;
        wait(1_000).await;
        if stopped {
            assert!(stop(&f.core, 1));
        }
        wait(60_000).await;
        let caught = crate::catch_up(&f.core, "me");
        assert!(matches!(&caught[0], ServerMsg::SendCard { id: 1, state: s, .. } if *s == state), "{state:?}");
        assert!(crate::catch_up(&f.core, "guest").iter().all(|m| !matches!(m, ServerMsg::SendCard { .. })), "only the asker's");
    }
}

#[tokio::test(start_paused = true)]
async fn a_count_that_ends_with_none_of_their_windows_open_never_sends() {
    // A phone's window lost its connection mid-count: a Stop pressed there never reached the core.
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.told();
    wait(2_000).await;
    f.window = None;
    wait(60_000).await;
    assert_eq!(f.sends(), 0, "nothing goes out unseen");
    let live = crate::apple::reachable();
    let offline = format!("card Stopped Recipient: {TEXT} (0 ms, live {live})");
    assert_eq!(f.told(), vec![offline]);
    // Back: the window learns why.
    let back = window(&f.core, "me");
    assert!(matches!(&crate::catch_up(&f.core, "me")[0], ServerMsg::SendCard { state: SendState::Stopped, message, .. } if message == OFFLINE));
    drop(back);
    // A window back before the end: it can stop it again, so it sends as before.
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", ASK);
    settle().await;
    f.window = None;
    wait(2_000).await;
    f.window = Some(window(&f.core, "me"));
    wait(60_000).await;
    assert_eq!(f.sends(), usize::from(live));
}

#[test]
fn stop_said_at_the_end_of_the_ask_is_never_part_of_the_message() {
    let s = full(false);
    for said in [
        "Ask Recipient to confirm what to bring, no, stop.",
        "Text Colleague Reviewer that I'm running late. Wait, don't send it",
        "Tell Recipient that I'm leaving now — never mind",
        // A closing "please" or "thanks" is said to the app; an en dash is a pause like any other.
        "Ask Recipient to bring chips, no, stop, please",
        "Ask Recipient to bring chips, no, stop please.",
        "Tell Recipient that I'm leaving now, never mind, thanks!",
        "Tell Recipient that I'm leaving now – stop",
    ] {
        assert_eq!(read(said, &s), None, "{said}");
    }
    // A stop word inside the words is part of them.
    assert_eq!(read("Tell Recipient that the answer is no", &s).map(|a| a.text), Some("Hi Recipient, the answer is no.".into()));
    assert_eq!(read("Ask Recipient to wait for me", &s).map(|a| a.text), Some("Hi Recipient, could you wait for me?".into()));
}

#[tokio::test(start_paused = true)]
async fn an_ask_taken_back_in_the_same_breath_counts_nothing_down_and_is_no_thought() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", "Ask Recipient to confirm what to bring, no, stop.");
    wait(60_000).await;
    assert_eq!(f.sends(), 0);
    assert_eq!(f.told(), vec!["notice Not sent: you said “stop” at the end.".to_string()]);
    assert!(f.thoughts().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_stopped_messages_late_timer_leaves_one_at_a_time_holding() {
    if !crate::apple::reachable() {
        return; // A dry run never waits on Messages.
    }
    let gate = Arc::new(tokio::sync::Notify::new());
    let g = gate.clone();
    let sender: Sender = Arc::new(move |_, _| {
        let g = g.clone();
        Box::pin(async move {
            g.notified().await;
            Ok(())
        })
    });
    let mut f = Fixture::sending(full(true), sender, Arc::default(), |core| core);
    let core = f.core.clone();
    // A long message (a longer count), stopped; then a short one, whose count ends first and goes to Messages.
    let long = "Ask Recipient to confirm what to bring on Saturday, and whether the park still has the covered tables by the lake";
    core.add_thought("me", long);
    settle().await;
    let long_ms = countdown_ms(&read(long, &full(true)).unwrap().text);
    assert!(long_ms > COUNTDOWN_MS + 2_000, "{long_ms}");
    assert!(stop(&core, 1));
    core.add_thought("me", ASK);
    settle().await;
    wait(COUNTDOWN_MS + LATE_STOP_MS).await;
    // Messages has the short one and hasn't answered; the long one's timer ends now.
    wait(long_ms).await;
    f.told();
    core.add_thought("me", "Text Colleague Reviewer that I'm running late");
    assert_eq!(f.told(), vec!["notice One message at a time: say “stop”, or wait for it to send.".to_string()]);
    gate.notify_one();
}

#[test]
fn the_words_sent_are_the_words_said() {
    let s = full(false);
    let text = |said: &str| read(said, &s).map(|a| a.text);
    assert_eq!(text("Text Recipient that it's for me"), Some("Hi Recipient, it's for me.".into()));
    assert_eq!(text("Text Recipient that -5 is the answer"), Some("Hi Recipient, -5 is the answer.".into()));
    assert_eq!(text("Tell Recipient that I'm leaving now."), Some("Hi Recipient, I'm leaving now.".into()));
    assert_eq!(text("Tell Recipient that, $20 is fine!"), Some("Hi Recipient, $20 is fine.".into()));
    assert_eq!(text("Ask Recipient to bring chips, please"), Some("Hi Recipient, could you bring chips?".into()));
    assert_eq!(text("Tell Recipient that ..."), None, "no words to send");
}

#[tokio::test(start_paused = true)]
async fn one_at_a_time_holds_while_messages_is_still_sending() {
    let gate = Arc::new(tokio::sync::Notify::new());
    let calls = Arc::new(Mutex::new(0));
    let (g, c) = (gate.clone(), calls.clone());
    let sender: Sender = Arc::new(move |_, _| {
        *c.lock().unwrap() += 1;
        let g = g.clone();
        Box::pin(async move {
            g.notified().await;
            Ok(())
        })
    });
    if !crate::apple::reachable() {
        return; // A dry run never waits on Messages.
    }
    let mut f = Fixture::sending(full(true), sender, Arc::default(), |core| core);
    let core = f.core.clone();
    core.add_thought("me", ASK);
    settle().await;
    wait(5_000 + LATE_STOP_MS).await;
    assert_eq!(*calls.lock().unwrap(), 1, "Messages has it, and hasn't answered");
    f.told();
    core.add_thought("me", "Text Colleague Reviewer that I'm running late");
    assert_eq!(f.told(), vec!["notice One message at a time: say “stop”, or wait for it to send.".to_string()]);
    gate.notify_one();
    settle().await;
    assert!(f.told().iter().any(|t| t.starts_with("card Sent Recipient")));
    core.add_thought("me", "Text Colleague Reviewer that I'm running late");
    assert!(f.told().iter().any(|t| t.starts_with("card Counting Colleague Reviewer")), "free again once Messages answered");
}

#[tokio::test(start_paused = true)]
async fn a_window_back_while_messages_still_has_it_shows_sending_then_how_it_ended() {
    if !crate::apple::reachable() {
        return; // A dry run never waits on Messages.
    }
    let gate = Arc::new(tokio::sync::Notify::new());
    let g = gate.clone();
    let sender: Sender = Arc::new(move |_, _| {
        let g = g.clone();
        Box::pin(async move {
            g.notified().await;
            Ok(())
        })
    });
    let mut f = Fixture::sending(full(true), sender, Arc::default(), |core| core);
    f.core.add_thought("me", ASK);
    settle().await;
    wait(5_000 + LATE_STOP_MS).await;
    f.told();
    // Its connection dropped and came back while Messages had it: the card, "Sending…", not the end before it.
    let back = card_for(&f.core, "me").expect("its card");
    assert!(matches!(back, ServerMsg::SendCard { id: 1, state: SendState::Counting, in_ms: 0, .. }), "{}", serde_json::to_string(&back).unwrap());
    assert!(card_for(&f.core, "guest").is_none(), "only the asker's windows");
    gate.notify_one();
    settle().await;
    assert!(f.told().iter().any(|t| t.starts_with("card Sent Recipient")));
    assert!(matches!(card_for(&f.core, "me"), Some(ServerMsg::SendCard { id: 1, state: SendState::Sent, .. })));
}

#[tokio::test(start_paused = true)]
async fn a_name_on_the_list_said_another_way_is_not_called_unknown() {
    let mut f = Fixture::new(full(true));
    f.core.add_thought("me", "Ask Recipient what to bring to the picnic");
    settle().await;
    let told = f.told();
    assert!(told.iter().any(|t| t.contains("say it as “ask Recipient to …”")), "{told:?}");
    assert!(told.iter().all(|t| !t.contains("no one by that name")), "{told:?}");
    assert_eq!(f.sends(), 0);
}

#[test]
fn only_the_error_number_reaches_the_log_and_a_dry_run_says_why() {
    assert_eq!(error_number("execution error: Messages got an error: Can’t get participant \"+15550100\". (-1728)"), "-1728");
    assert_eq!(error_number("Not authorized to send Apple events to Messages. (-1743)"), "-1743");
    assert_eq!(error_number("participant \"+15550100\" went wrong"), "unknown");
    assert!(dry_run("Recipient", false, Channel::Messages).contains("With MESSAGES_SEND=on"));
    let on = dry_run("Recipient", true, Channel::Messages);
    assert!(!on.contains("MESSAGES_SEND") && on.contains("only from a Mac"), "{on}");
}

#[path = "email_tests.rs"]
mod email;
