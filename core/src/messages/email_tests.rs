//! Email extends Messages' runtime; every sender here is a stand-in, never Mail.app.
use super::*;

type MailSent = Arc<Mutex<Vec<(String, String, String)>>>;
const EMAIL: &str = "Email Mia that the cut is ready";
const BODY: &str = "Hi Mia, the cut is ready.";

fn settings(live: bool) -> Settings {
    Settings { email_contacts: contacts("Mia=mia@example.com; Mia Chen=mia.chen@example.com; Sam=sam@example.com"), email_live: live, ..full(false) }
}

fn email_with(settings: Settings, adjust: impl FnOnce(Core) -> Core) -> (Fixture, MailSent) {
    let sent: MailSent = Arc::default();
    let log = sent.clone();
    let fixture = Fixture::with(settings, move |mut core| {
        core.messages.email_sender = Arc::new(move |address, subject, body| {
            log.lock().unwrap().push((address, subject, body));
            Box::pin(async { Ok(()) })
        });
        adjust(core)
    });
    (fixture, sent)
}

fn email(live: bool) -> (Fixture, MailSent) { email_with(settings(live), |core| core) }

#[test]
fn email_reads_only_a_request_as_the_whole_turn_and_subject_is_a_rule() {
    let s = settings(false);
    let ask = read(EMAIL, &s).unwrap();
    assert_eq!(ask.channel, Channel::Email);
    assert_eq!((ask.to.as_str(), ask.handle.as_str(), ask.subject.as_str(), ask.text.as_str()),
        ("Mia", "mia@example.com", "the cut is ready", BODY));
    assert_eq!(read("Okay, can you email Mia Chen that Version 2 is ready, please?", &s).unwrap().subject, "Version 2 is ready");
    assert_eq!(read("Email Sam to review the cut", &s).unwrap().text, "Hi Sam, could you review the cut?");
    assert_eq!(subject("One two three four five six seven eight nine ten."), "One two three four five six seven eight");
    for talk in ["I should email Mia that the cut is ready", "We could email Mia that the cut is ready", "Email Mia", "Email Mia that", "Email me that the cut is ready", "Email Mia that the cut is ready, no, stop."] {
        assert!(read(talk, &s).is_none(), "{talk}");
    }
    assert_eq!(crate::catalog::classify(EMAIL), Some(Act::Message), "email has the same external-action guard as Messages");
}

#[test]
fn email_allow_list_is_separate_and_never_accepts_an_address_as_a_name() {
    let mut s = settings(false);
    assert!(read("Email Bob that the cut is ready", &s).is_none());
    assert!(read("Email mia@example.com that the cut is ready", &s).is_none());
    assert_eq!(read("Email Mia Chen that the cut is ready", &s).unwrap().handle, "mia.chen@example.com");
    assert_eq!(read(ASK, &s).unwrap().handle, "+15550100", "Messages retains its own list");
    for bad in ["", "mia", "mia@", "@example.com", "mia@example.com other@example.com", "mia@example.com,other@example.com"] {
        s.email_contacts = vec![("Mia".into(), bad.into())];
        assert!(read(EMAIL, &s).is_none(), "{bad}");
    }
    s.email_contacts = contacts("mia@example.com=mia@example.com");
    assert!(read("Email mia@example.com that the cut is ready", &s).is_none());
}

#[tokio::test(start_paused = true)]
async fn email_card_is_immediate_dry_run_keeps_subject_body_and_no_address_leaves_core() {
    let (mut f, sent) = email(false);
    f.core.add_typed("me", EMAIL);
    let first = card_for(&f.core, "me").unwrap();
    assert!(matches!(&first, ServerMsg::SendCard { channel: Channel::Email, subject, text, state: SendState::Counting, in_ms, live: false, .. }
        if subject == "the cut is ready" && text == BODY && *in_ms >= COUNTDOWN_MS));
    assert!(!serde_json::to_string(&first).unwrap().contains("@"));
    assert!(f.thoughts().is_empty(), "no model placement needed before the card");
    settle().await;
    wait(60_000).await;
    let last = card_for(&f.core, "me").unwrap();
    assert!(matches!(&last, ServerMsg::SendCard { channel: Channel::Email, subject, text, state: SendState::DryRun, message, .. }
        if subject == "the cut is ready" && text == BODY && message.contains("EMAIL_SEND=on")));
    assert!(!serde_json::to_string(&last).unwrap().contains("@"));
    assert!(sent.lock().unwrap().is_empty());
    assert_eq!(f.sends(), 0, "email never calls Messages");
    f.told();
}

#[tokio::test(start_paused = true)]
async fn email_at_zero_sends_exactly_the_card_once_through_its_own_sender() {
    let (f, sent) = email(true);
    f.core.add_thought("me", EMAIL);
    let Some(ServerMsg::SendCard { in_ms, .. }) = card_for(&f.core, "me") else { panic!("card") };
    settle().await;
    wait(in_ms - 1).await;
    assert!(sent.lock().unwrap().is_empty());
    wait(LATE_STOP_MS + 1).await;
    if crate::apple::reachable() {
        assert_eq!(*sent.lock().unwrap(), vec![("mia@example.com".into(), "the cut is ready".into(), BODY.into())]);
        assert!(matches!(card_for(&f.core, "me"), Some(ServerMsg::SendCard { state: SendState::Sent, .. })));
    } else { assert!(sent.lock().unwrap().is_empty()); }
    wait(60_000).await;
    assert!(sent.lock().unwrap().len() <= 1);
    assert_eq!(f.sends(), 0);
}

#[tokio::test(start_paused = true)]
async fn email_stop_by_typed_voice_draft_button_or_escape_and_withdrawal_never_sends() {
    for how in ["typed", "voice", "button", "esc", "withdrawn"] {
        let (f, sent) = email(true);
        let turn = if how == "withdrawn" { "Email Mia that the cut is ready, no, stop." } else { EMAIL };
        f.core.add_thought("me", turn);
        match how {
            "typed" => f.core.add_typed("me", "Stop"),
            "voice" => { heard(&f.core, "me", "Stop"); f.core.add_thought("me", "Stop"); }
            "button" | "esc" => assert!(stop(&f.core, 1)),
            _ => {}
        }
        settle().await;
        wait(60_000).await;
        assert!(sent.lock().unwrap().is_empty(), "{how}");
        assert!(f.thoughts().is_empty(), "{how}");
        assert!(!is_counting(&f.core, 1), "{how}");
    }
}

#[tokio::test(start_paused = true)]
async fn email_demo_hosted_and_features_off_leave_the_exact_words_as_talk() {
    for mode in ["demo", "hosted", "feature"] {
        let mut s = settings(true);
        if mode == "demo" { s.preset = Preset::parse(None); }
        if mode == "hosted" { s.hosted = true; }
        let (f, sent) = email_with(s, |core| core);
        if mode == "feature" { email_switch(&f.core, "me", false); }
        f.core.add_typed("me", EMAIL);
        settle().await;
        wait(60_000).await;
        assert!(card_for(&f.core, "me").is_none(), "{mode}");
        assert_eq!(f.thoughts(), vec![EMAIL.to_string()], "{mode}");
        assert!(sent.lock().unwrap().is_empty(), "{mode}");
    }
}

#[tokio::test(start_paused = true)]
async fn email_guest_and_unlisted_contact_never_send_from_the_host() {
    let (mut f, sent) = email_with(settings(true), |core| Core { room: Some(crate::Room::from("k7m2x9qp")), ..core });
    f.core.add_thought("guest", EMAIL);
    assert!(f.told().iter().any(|line| line.contains("Only the host can send email")));
    assert!(card_for(&f.core, "guest").is_none());
    let (mut unlisted, unlisted_sent) = email(false);
    unlisted.core.add_thought("me", "Email Bob that the cut is ready");
    assert!(unlisted.told().iter().any(|line| line.contains("EMAIL_TO")));
    settle().await;
    wait(60_000).await;
    assert!(sent.lock().unwrap().is_empty() && unlisted_sent.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn email_features_switch_stops_pending_delivery_and_can_be_reenabled() {
    let (f, sent) = email(true);
    f.core.add_thought("me", EMAIL);
    email_switch(&f.core, "me", false);
    assert!(matches!(card_for(&f.core, "me"), Some(ServerMsg::SendCard { state: SendState::Stopped, .. })));
    settle().await;
    wait(60_000).await;
    assert!(sent.lock().unwrap().is_empty());
    email_switch(&f.core, "me", true);
    f.core.add_thought("me", EMAIL);
    assert!(is_counting(&f.core, 2));
    stop(&f.core, 2);
}

#[tokio::test(start_paused = true)]
async fn email_trace_measures_speech_end_to_card_and_sent_without_addresses() {
    let dir = std::env::temp_dir().join(format!("e2a2o-email-trace-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let (f, _) = email_with(settings(true), |core| Core { trace: crate::trace::Trace::to(&dir), ..core });
    speech_end(&f.core, "me", true);
    wait(125).await;
    f.core.add_thought("me", EMAIL);
    settle().await;
    wait(60_000).await;
    let raw = std::fs::read_to_string(dir.join("trace.jsonl")).unwrap();
    let lines: Vec<serde_json::Value> = raw.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["event"], "card");
    assert_eq!(lines[0]["speech_end_to_event_ms"], 125);
    let event = if crate::apple::reachable() { "sent" } else { "dry_run" };
    let end = lines.iter().find(|l| l["event"] == event).unwrap();
    assert!(end["speech_end_to_event_ms"].as_u64().unwrap() > 125);
    assert!(!raw.contains("@"));
    std::fs::remove_dir_all(dir).unwrap();
}
