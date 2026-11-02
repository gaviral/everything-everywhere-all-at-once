//! Tests for small apps (apps.rs): asking for one, the composer's draft and its checks, watchers and
//! publishers on the map, and journals from before apps that still load. The model's answers are canned
//! (`Runtime::answers`), so nothing here calls it.

use super::*;
use crate::world::{Journal, Thought, World};
use std::path::PathBuf;

struct Fixture { core: Arc<Core>, path: PathBuf }

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-apps-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        Self { path, core: Arc::new(Core::test(journal, world)) }
    }
}

impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_file(&self.path); } }

fn app() -> MiniApp {
    let mut app = seeds(true).remove(1);
    app.id = "test-app".into();
    app.watcher = Watcher::Phrase { phrase: "demo".into() };
    app.publishers = vec![Publisher::Card { text: "Take a quiet moment.".into() }];
    app
}

#[test]
fn old_snapshots_and_journals_still_load_and_apps_replay() {
    let old: World = serde_json::from_str(r#"{"threads":[],"thoughts":[],"active":null}"#).unwrap();
    assert!(old.apps.is_empty());
    assert!(!old.apps_seeded);
    let fixture = Fixture::new();
    fixture.core.commit(vec![Change::ActiveChanged { thread_id: "T1".into(), speaker: "you".into() }, Change::AppRegistered { app: app() },
        Change::AppEnabled { id: "test-app".into(), enabled: false }, Change::AppRan { id: "test-app".into(), at_ms: 100 }]);
    let (_, loaded) = Journal::open(&fixture.path).unwrap();
    assert_eq!(loaded.active.as_deref(), Some("T1"));
    assert_eq!(loaded.apps.len(), 1);
    assert!(!loaded.apps[0].enabled);
    assert_eq!(loaded.apps[0].last_run_ms, 100);
}

#[test]
fn seed_defaults_are_journaled_once_and_removal_survives_restart() {
    for demo in [false, true] {
        let fixture = Fixture::new();
        seed(&fixture.core, demo);
        seed(&fixture.core, !demo);
        assert_eq!(fixture.core.snapshot().apps.len(), 3);
        assert!(fixture.core.snapshot().apps.iter().all(|a| a.enabled == demo));
        fixture.core.commit(vec![Change::AppRemoved { id: "app-volume".into() }]);
        let (_, loaded) = Journal::open(&fixture.path).unwrap();
        *fixture.core.world.lock().unwrap() = loaded.into();
        seed(&fixture.core, demo);
        assert_eq!(fixture.core.snapshot().apps.len(), 2);
    }
}

#[test]
fn an_earlier_builds_volume_watcher_moves_to_this_scale_and_keeps_its_choices() {
    let fixture = Fixture::new();
    seed(&fixture.core, true);
    // As a build before the measured scale left it, switched off and set to the card alone.
    let mut old = seeds(true).remove(1);
    old.watcher = Watcher::Volume { level: 0.15, seconds: 3 };
    fixture.core.commit(vec![Change::AppRemoved { id: old.id.clone() }, Change::AppRegistered { app: old },
        Change::AppEnabled { id: "app-volume".into(), enabled: false }, Change::AppOutput { id: "app-volume".into(), sound: false }]);
    seed(&fixture.core, true);
    let (_, loaded) = Journal::open(&fixture.path).unwrap();
    let app = loaded.apps.iter().find(|a| a.id == "app-volume").unwrap();
    let (loud, held) = loud_voices();
    assert!(matches!(app.watcher, Watcher::Volume { level, seconds } if (level - loud).abs() < 1e-9 && seconds == held), "{:?}", app.watcher);
    assert!(!app.enabled && !app.purpose.contains("tune"), "still off, still the card alone");
    assert_eq!(loaded.apps.len(), 3);
    // After a restart, read back from the journal, it has nothing more to move.
    let lines = std::fs::read_to_string(&fixture.path).unwrap().lines().count();
    *fixture.core.world.lock().unwrap() = loaded.into();
    seed(&fixture.core, true);
    assert_eq!(std::fs::read_to_string(&fixture.path).unwrap().lines().count(), lines);
}

#[test]
fn loud_voices_are_held_long_enough_that_normal_speech_cant_set_them_off() {
    let held = |level: f64, seconds: u64| {
        let answer = json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Loud tune", "purpose":"Play a silly tune when voices get loud.",
            "watcher":{"kind":"volume","level":level,"seconds":seconds}, "prompt":null, "publishers":[{"kind":"sound"}], "cooldown_secs":60}});
        let Watcher::Volume { seconds, .. } = draft(&answer).unwrap().watcher else { panic!("a volume watcher") };
        seconds
    };
    let (loud, _) = loud_voices();
    assert_eq!(held(loud, 2), LOUD_SECONDS, "beat 5's sentence, as the composer answered it before it was told");
    assert_eq!(held(loud, 10), 10);
    assert_eq!(held(0.05, 1), 1, "an app for any talk");
    assert_eq!(held(between(RAISED_VOICE, SHOUT), 1), 1, "shouting is well over normal speech");
}

#[test]
fn rejects_unknown_blocks_fields_and_unsafe_ranges() {
    assert!(serde_json::from_str::<Publisher>(r#"{"kind":"shell","command":"open"}"#).is_err());
    assert!(serde_json::from_str::<Publisher>(r#"{"kind":"sound","url":"https://example.com"}"#).is_err());
    let mut a = app();
    a.watcher = Watcher::Volume { level: 0.2, seconds: 0 };
    assert!(validate(&a).is_err());
    a.watcher = Watcher::Time { at_ms: 1, every_secs: 1 };
    assert!(validate(&a).is_err());
    a.watcher = Watcher::NewThought { min_points: 1 };
    a.publishers = vec![Publisher::Card { text: "{unregistered}".into() }];
    assert!(validate(&a).is_err());
    a.publishers = vec![Publisher::Card { text: String::new() }];
    assert!(validate(&a).is_err());
    assert!(validate(&app()).is_ok());
    assert!(valid_date("2028-02-29"));
    assert!(!valid_date("2026-02-29"));
    assert!(!valid_date("2026-13-01"));
}

#[test]
fn templates_expand_once_and_commands_leave_ordinary_speech_alone() {
    assert_eq!(expand("{thought} / {text}", &[("thought", "I said {text}"), ("text", "hello")]), "I said {text} / hello");
    assert_eq!(command("Make an app that notices repetition."), Some("notices repetition.".into()));
    assert!(command("I might make an app that notices repetition").is_none());
    assert!(same_request(&app(), "volume watcher"));
}

#[test]
fn spoken_app_requests_can_open_with_filler_and_ask_for_me() {
    for (said, request) in [
        ("Okay, make an app that notices repetition.", "notices repetition."),
        ("Can you make me an app to remind me about rent?", "remind me about rent?"),
        ("Um, so, hey, could you please create an app that... plays a tune", "plays a tune"),
        ("Make an app, that pings me", "pings me"),
        ("MAKE US AN APP TO SHOUT", "SHOUT"),
        // Beat 5's sentence as people say it differently, and as speech-to-text writes it.
        ("Make a app which plays a silly tune if we get loud", "plays a silly tune if we get loud"),
        ("Make an app for when we get loud.", "for when we get loud."),
        ("Make an app: if we get loud, play a tune.", "if we get loud, play a tune."),
        ("Build an application that pings me", "pings me"),
        ("Can you make me a new app whenever we shout to play a tune?", "whenever we shout to play a tune?"),
    ] {
        assert_eq!(command(said).as_deref(), Some(request), "{said}");
    }
    for said in ["You make an app that people love", "We should make an app to track this", "Make an app.", "Let's make an app that helps",
        "Make an app store page", "Make a happy face", "Build an apple pie that tastes good"] {
        assert_eq!(command(said), None, "{said}");
    }
}

#[test]
fn volume_needs_a_sustained_stretch_from_one_source() {
    // A reading every 320 ms, as the UI sends them.
    let mut state = (0, 0, false);
    for now in (320..=3200).step_by(320) { assert!(!feed_volume(&mut state, now, true, 3)); }
    assert!(feed_volume(&mut state, 3520, true, 3), "3 s after the first loud reading");
    let mut state = (0, 0, false);
    for now in (320..=3200).step_by(320) { assert!(!feed_volume(&mut state, now, now != 1600, 3)); }
    assert!(feed_volume(&mut state, 3520, true, 3), "one low reading, a breath between sentences, is ridden out");
    let mut state = (0, 0, false);
    for now in (320..=3520).step_by(320) { assert!(!feed_volume(&mut state, now, !(1600..=1920).contains(&now), 3)); }
    assert_eq!(state.0, 2240, "two low readings in a row start the stretch again");
    assert!(!feed_volume(&mut state, 8000, true, 3), "a missing mic report starts it again too");
    assert_eq!(state.0, 8000);
}

#[test]
fn the_composer_the_seed_and_the_voice_script_share_one_volume_scale() {
    let prompt = compose_prompt();
    let Watcher::Volume { level, seconds } = seeds(true)[1].watcher else { panic!("the Volume watcher is the second seed") };
    assert!(prompt.contains(&format!("use {level} for loud voices")) && !prompt.contains("{volume}"), "{prompt}");
    assert!(prompt.contains(&format!("at least {seconds} for loud voices")), "{prompt}");
    assert!(NORMAL_VOICE < level && level < RAISED_VOICE && RAISED_VOICE < SHOUT);
    assert_eq!(seconds, LOUD_SECONDS);
    // scripts/voice.mjs speaks at normal speech's level, so its talks can't set off the Volume watcher.
    let script = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/voice.mjs")).expect("voice.mjs");
    let spoken = script.lines().find_map(|line| line.strip_prefix("const LEVEL = ")?.strip_suffix(';')?.parse::<f64>().ok());
    assert_eq!(spoken, Some(NORMAL_VOICE));
}

#[tokio::test]
async fn keep_and_discard_are_explicit_and_idempotent() {
    let fixture = Fixture::new();
    fixture.core.apps.state.lock().unwrap().build = Some(Build { id: "b".into(), request: "quiet".into(), stage: "ready".into(),
        steps: Vec::new(), draft: Some(app()), match_id: None, ..Build::default() });
    assert!(fixture.core.snapshot().apps.is_empty());
    decide(&fixture.core, "wrong-id", true);
    assert!(fixture.core.snapshot().apps.is_empty());
    decide(&fixture.core, "b", false);
    decide(&fixture.core, "b", true);
    assert!(fixture.core.snapshot().apps.is_empty());
    fixture.core.apps.state.lock().unwrap().build.as_mut().unwrap().stage = "ready".into();
    decide(&fixture.core, "b", true);
    decide(&fixture.core, "b", true);
    assert_eq!(fixture.core.snapshot().apps.len(), 1);
    assert!(fixture.core.snapshot().apps[0].enabled);
}

/// "Keep it" and "discard it" are the build's buttons by voice, only while it waits for one; otherwise they're talk.
#[tokio::test]
async fn keep_it_said_aloud_keeps_the_app_waiting_and_is_a_thought_otherwise() {
    let fixture = Fixture::new();
    let thoughts = |core: &Core| core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect::<Vec<_>>();
    fixture.core.add_thought("you", "Keep it");
    assert_eq!(thoughts(&fixture.core), ["Keep it"]);
    let ready = || Some(Build { id: "b".into(), request: "quiet".into(), stage: "ready".into(), steps: Vec::new(), draft: Some(app()), match_id: None, ..Build::default() });
    fixture.core.apps.state.lock().unwrap().build = ready();
    fixture.core.add_thought("you", "Okay, discard it.");
    assert!(fixture.core.snapshot().apps.is_empty() && waiting(&fixture.core).is_none());
    fixture.core.apps.state.lock().unwrap().build = ready();
    fixture.core.add_thought("you", "Yes, keep it");
    assert_eq!(fixture.core.snapshot().apps.len(), 1);
    assert_eq!(thoughts(&fixture.core), ["Keep it"]);
}

/// Beat 5 as the take does it, with the Volume watcher removed: the sentence said aloud builds a new app through every
/// stage, Keep starts it, normal speech doesn't set it off, and a raised voice held for its seconds plays the silly
/// tune once, with nothing on the map (a sound needs no thread).
#[tokio::test]
async fn beat_five_said_aloud_builds_an_app_that_plays_the_silly_tune_on_a_raised_voice() {
    let fixture = Fixture::new();
    seed(&fixture.core, true);
    fixture.core.commit(vec![Change::AppRemoved { id: "app-volume".into() }]);
    let (loud, held) = loud_voices();
    fixture.core.apps.answers.lock().unwrap().extend([json!({"match_id":"", "text":"No app plays a tune for loud voices."}),
        json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Loud tune", "purpose":"Play a silly tune when voices get loud.",
            "watcher":{"kind":"volume","level":loud,"seconds":2}, "prompt":null, "publishers":[{"kind":"sound"}], "cooldown_secs":60}})]);
    let mut messages = fixture.core.updates.subscribe();
    fixture.core.add_thought("you", "Okay, make an app that plays a silly tune if we get loud.");
    tokio::task::yield_now().await;
    let mut stages = Vec::new();
    while let Ok(message) = messages.try_recv() { if let ServerMsg::AppsBuild { build } = message.message { stages.push(build.stage); } }
    assert_eq!(stages, ["searching", "composing", "validating", "ready"]);
    assert!(fixture.core.snapshot().thoughts.is_empty(), "a request is never a thought");
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.request, "plays a silly tune if we get loud.");
    decide(&fixture.core, &b.id, true);
    let app = fixture.core.snapshot().apps.iter().find(|a| a.name == "Loud tune").cloned().expect("kept");
    assert!(app.enabled && matches!(app.watcher, Watcher::Volume { seconds, .. } if seconds == held));
    let tunes = |messages: &mut tokio::sync::broadcast::Receiver<Outgoing>| {
        let mut played = Vec::new();
        while let Ok(message) = messages.try_recv() { if let ServerMsg::AppsSound { playful, name, why } = message.message { played.push((playful, name, why)); } }
        played
    };
    // Normal speech, read after read, never sets it off; a raised voice that has held its seconds does.
    for _ in 0..20 { volume(&fixture.core, "mic", NORMAL_VOICE); }
    tokio::task::yield_now().await;
    assert!(tunes(&mut messages).is_empty(), "normal speech never sets it off");
    volume(&fixture.core, "mic", RAISED_VOICE);
    tokio::task::yield_now().await;
    assert!(tunes(&mut messages).is_empty(), "not on the first loud reading");
    let now = now_ms();
    fixture.core.apps.state.lock().unwrap().volume.insert(("mic".into(), app.id.clone()), (now - held * 1000, now - 320, false));
    volume(&fixture.core, "mic", RAISED_VOICE);
    for _ in 0..3 { tokio::task::yield_now().await; }
    // Which app played it, and why, for the window's line under the tune (onrecord).
    assert_eq!(tunes(&mut messages), [(true, "Loud tune".to_string(), format!("voices stayed loud for {held} s"))], "the silly tune, once, within its seconds");
    assert!(fixture.core.snapshot().suggestions.is_empty() && fixture.core.snapshot().threads.is_empty());
}

/// Search-first is one model call before the composer; when it fails, the composer, which checks the catalog too,
/// still makes the app instead of the build failing on camera.
#[tokio::test]
async fn a_failed_search_still_makes_the_app() {
    let fixture = Fixture::new();
    seed(&fixture.core, true);
    fixture.core.apps.answers.lock().unwrap().extend([json!({"unexpected": true}),
        json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Demo nudge", "purpose":"Show a card when the demo comes up.",
            "watcher":{"kind":"phrase","phrase":"demo"}, "prompt":null, "publishers":[{"kind":"card","text":"Rehearse."}], "cooldown_secs":30}})]);
    compose(fixture.core.clone(), "show a card when I mention the demo".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "ready", "{:?}", b.steps);
    assert_eq!(fixture.core.apps.asked.lock().unwrap().len(), 2, "the search, then the composition");
}

/// A tune says what set it off, from the watcher that fired it: a stray tune with no reason reads as a glitch on camera.
#[test]
fn a_tune_says_what_set_it_off() {
    let (loud, held) = loud_voices();
    let cases = [
        (Watcher::Volume { level: loud, seconds: held }, format!("voices stayed loud for {held} s")),
        (Watcher::Volume { level: SHOUT, seconds: 2 }, "voices stayed at a shout for 2 s".into()),
        (Watcher::Phrase { phrase: " deadline ".into() }, "you said “deadline”".into()),
        (Watcher::Topic { topic: "rent".into() }, "rent came up".into()),
        (Watcher::Time { at_ms: 0, every_secs: 1800 }, "its timer, every 30 min".into()),
        (Watcher::Time { at_ms: 0, every_secs: 86_400 }, "its timer, every day".into()),
        (Watcher::Time { at_ms: 0, every_secs: 45 }, "its timer, every 45 s".into()),
        (Watcher::NewThought { min_points: 0 }, "a new thought landed".into()),
        (Watcher::NewThought { min_points: 5 }, "a thread reached 5 points".into()),
    ];
    for (watcher, expected) in cases { assert_eq!(why(&watcher), expected); }
    let once = why(&Watcher::Time { at_ms: 1_793_800_000_000, every_secs: 0 });
    assert!(once.starts_with("it was set for ") && once.len() == "it was set for 12:00".len(), "{once}");
}

/// A search slower than its patience doesn't hold the build: the composition, asked at the same time, is shown once
/// the search is cut at `SEARCH_PATIENCE`, not when the search would have answered.
#[tokio::test(start_paused = true)]
async fn a_search_past_its_patience_is_cut_and_the_composition_is_shown() {
    let fixture = Fixture::new();
    seed(&fixture.core, true);
    fixture.core.apps.answers.lock().unwrap().extend([
        json!({"wait_ms": 16_200, "answer": {"match_id":"app-volume", "text":"Too late to count."}}),
        json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Demo nudge", "purpose":"Show a card when the demo comes up.",
            "watcher":{"kind":"phrase","phrase":"demo"}, "prompt":null, "publishers":[{"kind":"card","text":"Rehearse."}], "cooldown_secs":30}})]);
    compose(fixture.core.clone(), "show a card when I mention the demo".into());
    tokio::time::sleep(SEARCH_PATIENCE - Duration::from_millis(100)).await;
    assert_eq!(build(&fixture.core).unwrap().stage, "searching", "the search still has its time");
    tokio::time::sleep(Duration::from_millis(200)).await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "ready", "{:?}", b.steps);
    assert_eq!(b.draft.unwrap().name, "Demo nudge");
    assert_eq!(fixture.core.apps.asked.lock().unwrap().len(), 2, "asked at once: no composer call after the cut");
}

/// A composition that answers first waits for the search: a match the search finds within its patience is offered
/// instead, and the composition is thrown away.
#[tokio::test(start_paused = true)]
async fn a_search_match_wins_over_a_composition_that_answered_first() {
    let fixture = Fixture::new();
    seed(&fixture.core, true);
    fixture.core.apps.answers.lock().unwrap().extend([
        json!({"wait_ms": 3_000, "answer": {"match_id":"app-volume", "text":"A quiet pause for loud voices."}}),
        json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Loud card", "purpose":"Show a card when voices get loud.",
            "watcher":{"kind":"phrase","phrase":"loud"}, "prompt":null, "publishers":[{"kind":"card","text":"Pause."}], "cooldown_secs":30}})]);
    compose(fixture.core.clone(), "help us take a pause when our voices get loud".into());
    tokio::time::sleep(Duration::from_secs(4)).await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "matched", "{:?}", b.steps);
    assert_eq!(b.match_id.as_deref(), Some("app-volume"));
    assert!(b.draft.is_none() && b.steps.len() == 2, "the composition is never shown: {:?}", b.steps);
}

#[test]
fn a_window_that_connects_sees_a_build_only_while_it_is_composing_or_waiting() {
    let fixture = Fixture::new();
    for (stage, sent) in [("searching", true), ("composing", true), ("validating", true), ("ready", true), ("matched", true),
        ("kept", false), ("discarded", false), ("failed", false)] {
        fixture.core.apps.state.lock().unwrap().build = Some(Build { id: "b".into(), request: "quiet".into(), stage: stage.into(),
            steps: Vec::new(), draft: None, match_id: None, ..Build::default() });
        assert_eq!(unsettled_build(&fixture.core).is_some(), sent, "{stage}");
    }
}

#[tokio::test]
async fn search_offers_an_existing_app_without_a_model_and_failures_are_gentle() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    fixture.core.apps.state.lock().unwrap().build = Some(Build { id: "b".into(), request: "".into(), stage: "searching".into(),
        steps: Vec::new(), draft: None, match_id: None, ..Build::default() });
    compose_inner(&fixture.core, "b", "Argument resolver").await.unwrap();
    assert_eq!(build(&fixture.core).unwrap().stage, "matched");
    assert_eq!(build(&fixture.core).unwrap().match_id.as_deref(), Some("app-argument"));
    decide(&fixture.core, "b", true);
    assert_eq!(fixture.core.snapshot().apps.len(), 3);
    assert!(fixture.core.snapshot().apps.iter().find(|a| a.id == "app-argument").unwrap().enabled);
    compose(fixture.core.clone(), "A completely new app".into());
    tokio::task::yield_now().await;
    assert_eq!(build(&fixture.core).unwrap().stage, "failed");
    assert!(build(&fixture.core).unwrap().draft.is_none());
}

#[tokio::test]
async fn publishers_stay_on_the_map_and_reminders_wait_for_approval() {
    let fixture = Fixture::new();
    let mut a = app();
    a.publishers.push(Publisher::Reminder { title: "Prepare the demo".into(), when: String::new() });
    fixture.core.commit(vec![Change::AppRegistered { app: a.clone() }]);
    execute(&fixture.core, &a, None).await.unwrap();
    let world = fixture.core.snapshot();
    assert_eq!(world.suggestions.len(), 1);
    assert!(world.thread(&world.suggestions[0].thread_id).is_some());
    assert_eq!(world.actions.len(), 1);
    assert_eq!(world.actions[0].status, ItemStatus::New);
    assert_eq!(world.actions[0].done_ms, None);
    toggle(&fixture.core, a.id.clone(), false);
    execute(&fixture.core, &a, None).await.unwrap();
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1, "a switched-off app cannot publish");
}

#[tokio::test]
async fn thought_and_timer_watchers_fire_once_and_respect_switches() {
    let fixture = Fixture::new();
    let mut a = app();
    a.cooldown_secs = 10;
    fixture.core.commit(vec![Change::AppRegistered { app: a.clone() }]);
    let thought = Thought { id: "th-test".into(), speaker: "you".into(), text: "Record the demo before lunch".into(),
        point: "Record the demo".into(), thread_id: Some("T1".into()), placed: true, unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(),
        complete: true, at_ms: now_ms(), place_ms: Some(10), decided: false };
    fixture.core.commit(vec![Change::ThoughtAdded { thought }]);
    on_thought(&fixture.core, "th-test");
    tokio::task::yield_now().await;
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1);
    on_thought(&fixture.core, "th-test");
    tokio::task::yield_now().await;
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1);
    let mut timer = app();
    timer.id = "timer".into();
    timer.watcher = Watcher::Time { at_ms: now_ms() - 1, every_secs: 0 };
    fixture.core.commit(vec![Change::AppRegistered { app: timer }]);
    let mut changes = fixture.core.updates.subscribe();
    let task = tokio::spawn(run(fixture.core.clone()));
    tokio::time::timeout(Duration::from_secs(2), async {
        loop { if matches!(changes.recv().await.unwrap().message, ServerMsg::Change { change: Change::SuggestionAdded { .. } }) { break; } }
    }).await.unwrap();
    assert_eq!(fixture.core.snapshot().suggestions.len(), 2);
    assert!(fixture.core.snapshot().apps.iter().find(|a| a.id == "timer").unwrap().last_run_ms > 0);
    task.abort();
}

#[test]
fn a_timer_with_a_prompt_waits_for_something_new_to_look_at() {
    let said = |at_ms| Thought { id: format!("th-{at_ms}"), speaker: "you".into(), text: "rent is due".into(), point: "Rent is due".into(),
        thread_id: Some("T1".into()), placed: true, unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(),
        complete: true, at_ms, place_ms: None, decided: false };
    let mut timer = app();
    timer.watcher = Watcher::Time { at_ms: 1, every_secs: 10 };
    timer.last_run_ms = 1_000;
    let mut world = World { thoughts: vec![said(500)], ..World::default() };
    let apps = Runtime::default();
    assert!(timer_due(&apps, &timer, &world, 20_000), "without a prompt it runs on time");
    timer.prompt = Some(Prompt { system: "Notice when I drift.".into(), template: "{points}".into() });
    assert!(!timer_due(&apps, &timer, &world, 20_000), "nothing new since it last ran");
    world.thoughts.push(said(1_500));
    assert!(timer_due(&apps, &timer, &world, 20_000));
    assert!(!timer_due(&apps, &timer, &world, 5_000), "not time yet");
}

/// On this machine's clock; in Los Angeles, Nov 1, 2026 is 25 hours long, and 24 hours after 5 PM the day
/// before was 4 PM, when a daily 5 PM app used to fire.
#[test]
fn a_daily_timer_keeps_its_hour_when_the_clocks_change() {
    let at = |local: &str| crate::clock::ms(local).unwrap();
    let mut timer = app();
    timer.watcher = Watcher::Time { at_ms: at("2026-10-31 17:00"), every_secs: 86_400 };
    timer.last_run_ms = at("2026-10-31 17:00");
    // The composer sees it in the local time it writes.
    assert_eq!(shown(&timer.watcher), json!({"kind": "time", "at": "2026-10-31 17:00", "every_secs": 86_400}));
    let (apps, world) = (Runtime::default(), World::default());
    assert!(!timer_due(&apps, &timer, &world, at("2026-11-01 16:00")));
    assert!(!timer_due(&apps, &timer, &world, at("2026-11-01 16:59")));
    assert!(timer_due(&apps, &timer, &world, at("2026-11-01 17:00")));
    // It ran late, at 9 PM, after the laptop slept through 5 PM: the next is still 5 PM.
    timer.last_run_ms = at("2026-11-02 21:00");
    assert!(!timer_due(&apps, &timer, &world, at("2026-11-03 16:59")));
    assert!(timer_due(&apps, &timer, &world, at("2026-11-03 17:00")));
}

#[tokio::test]
async fn one_composition_answer_becomes_a_reviewable_draft_then_a_journaled_app() {
    let fixture = Fixture::new();
    let mut messages = fixture.core.updates.subscribe();
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"", "app": {
        "name":"Demo nudge", "purpose":"Show a quiet card when the demo comes up.",
        "watcher":{"kind":"phrase","phrase":"demo"},"prompt":null,
        "publishers":[{"kind":"card","text":"A good moment to rehearse."}],"cooldown_secs":30
    }}));
    compose(fixture.core.clone(), "make an app that nudges me when I mention the demo".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "ready");
    assert!(fixture.core.snapshot().apps.is_empty(), "a preview never starts an app");
    assert!(!b.draft.as_ref().unwrap().enabled);
    let mut stages = Vec::new();
    while let Ok(message) = messages.try_recv() {
        if let ServerMsg::AppsBuild { build } = message.message { stages.push(build.stage); }
    }
    assert_eq!(stages, ["searching", "composing", "validating", "ready"]);
    decide(&fixture.core, &b.id, true);
    let (_, loaded) = Journal::open(&fixture.path).unwrap();
    assert_eq!(loaded.apps.len(), 1);
    assert_eq!(loaded.apps[0].name, "Demo nudge");
    assert!(loaded.apps[0].enabled);
    assert!(loaded.apps[0].created_ms > 0);
}

#[tokio::test]
async fn a_draft_that_doesnt_check_out_gets_one_more_try_told_why() {
    let fixture = Fixture::new();
    let spec = |template: &str| json!({"match_id":"", "app": {
        "name":"Drift check", "purpose":"Notice when I drift from the topic.", "watcher":{"kind":"new_thought"},
        "prompt":{"system":"Publish when the newest thought drifts from the topic.","template":template},
        "publishers":[{"kind":"card","text":"{text}"}],"cooldown_secs":30
    }});
    let fresh = || Some(Build { id: "b".into(), request: "drift".into(), stage: "searching".into(), steps: Vec::new(), draft: None,
        match_id: None, ..Build::default() });
    fixture.core.apps.state.lock().unwrap().build = fresh();
    fixture.core.apps.answers.lock().unwrap().extend([spec("Thread: {thread}\nNewest: {thought}"), spec("Topic: {topic}\nNewest: {thought}")]);
    compose_inner(&fixture.core, "b", "notice when I drift").await.unwrap();
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "ready", "no failure shows when the second try works");
    assert_eq!(b.draft.unwrap().prompt.unwrap().template, "Topic: {topic}\nNewest: {thought}");
    assert!(fixture.core.apps.asked.lock().unwrap().last().unwrap().contains("unknown template field {thread}"), "told what didn't check out");
    // Two misses in a row fail.
    fixture.core.apps.state.lock().unwrap().build = fresh();
    fixture.core.apps.answers.lock().unwrap().extend([spec("{thread}"), spec("{thread}")]);
    assert!(compose_inner(&fixture.core, "b", "notice when I drift").await.is_err());
}

#[tokio::test]
async fn semantic_search_offers_a_disabled_app_before_any_composition() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    toggle(&fixture.core, "app-search".into(), true);
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"app-volume", "text":"A quiet pause for loud voices."}));
    compose(fixture.core.clone(), "help us take a pause when our voices get loud".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "matched");
    assert_eq!(b.steps.len(), 2, "a search match shows no composing step");
    assert_eq!(b.match_id.as_deref(), Some("app-volume"));
    assert_eq!(fixture.core.snapshot().apps.len(), 3);
    decide(&fixture.core, &b.id, true);
    assert!(fixture.core.snapshot().apps.iter().find(|a| a.id == "app-volume").unwrap().enabled);
}

#[tokio::test]
async fn search_first_can_be_offered_too() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    let request = "check whether I already have an app before building a new one";
    let fresh = || Some(Build { id: "b".into(), request: request.into(), stage: "searching".into(), steps: Vec::new(), draft: None,
        match_id: None, ..Build::default() });
    // Off, the composer sees it among the existing apps; on, its own search pass does.
    for (on, answer) in [(false, json!({"match_id":"app-search", "app": null})), (true, json!({"match_id":"app-search", "text":"It checks first."}))] {
        toggle(&fixture.core, "app-search".into(), on);
        fixture.core.apps.state.lock().unwrap().build = fresh();
        fixture.core.apps.answers.lock().unwrap().push_back(answer);
        compose_inner(&fixture.core, "b", request).await.unwrap();
        assert_eq!(build(&fixture.core).unwrap().match_id.as_deref(), Some("app-search"));
        assert!(fixture.core.apps.asked.lock().unwrap().pop().unwrap().contains("\"id\":\"app-search\""), "on: {on}");
    }
}

#[tokio::test]
async fn an_unknown_model_block_fails_without_registering_anything() {
    let fixture = Fixture::new();
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"", "app": {
        "name":"Unknown", "purpose":"Unsupported behavior", "watcher":{"kind":"new_thought"},"prompt":null,
        "publishers":[{"kind":"webhook","url":"https://example.com"}],"cooldown_secs":30
    }}));
    compose(fixture.core.clone(), "a new request".into());
    tokio::task::yield_now().await;
    assert_eq!(build(&fixture.core).unwrap().stage, "failed");
    assert!(fixture.core.snapshot().apps.is_empty());
}

#[tokio::test]
async fn what_apps_cant_do_is_declined_with_a_reason_and_the_closest_app() {
    let fixture = Fixture::new();
    let stand_in = json!({"name":"Rent note", "purpose":"Show a card when rent comes up.", "watcher":{"kind":"phrase","phrase":"rent"},
        "prompt":null, "publishers":[{"kind":"card","text":"Rent came up."}], "cooldown_secs":30});
    // A reason wins over any app sent with it, and the closest app reads as a request, not a command.
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"", "app": stand_in, "cannot":"  Apps can't send\nemail. ",
        "instead":"Make an app that shows a card when I mention rent"}));
    compose(fixture.core.clone(), "send me an email when I mention rent".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!((b.stage.as_str(), b.message.as_str(), b.instead.as_str()), ("declined", "Apps can't send email.", "shows a card when I mention rent"));
    assert!(b.draft.is_none() && fixture.core.snapshot().apps.is_empty());
    assert!(unsettled_build(&fixture.core).is_none(), "nothing to keep, so the next request can start");
    decide(&fixture.core, &b.id, true);
    assert!(fixture.core.snapshot().apps.is_empty());
    // An "instead" that only repeats the request is no help; a reason too long for a card is cut at a word.
    let long = format!("Apps can't {}", "flights ".repeat(40));
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"", "app": null, "cannot": long, "instead":"book me a flight"}));
    compose(fixture.core.clone(), "book me a flight".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!((b.stage.as_str(), b.instead.as_str()), ("declined", ""));
    assert!(b.message.ends_with("flights…") && b.message.chars().count() <= 201, "{}", b.message);
}

#[tokio::test]
async fn a_missing_app_or_a_reminder_that_cant_repeat_gets_the_retry_told_why() {
    let fixture = Fixture::new();
    let timed = |at: &str, every: u64, publishers: Value| json!({"match_id":"", "cannot":"", "instead":"", "app": {"name":"Water",
        "purpose":"Drink water now and then.", "watcher":{"kind":"time","at":at,"every_secs":every}, "prompt":null,
        "publishers":publishers, "cooldown_secs":60}});
    let timer = |publishers: Value| timed("2026-11-03 09:00", 2700, publishers);
    let fresh = || Some(Build { id: "b".into(), request: "water".into(), stage: "searching".into(), ..Build::default() });
    for (first, told) in [
        (json!({"match_id":"", "app": null, "cannot":"", "instead":""}), "say in cannot why"),
        (timer(json!([{"kind":"reminder","title":"Drink water","when":""}])), "a repeating timer needs a card or a sound"),
        (timed("9 AM", 2700, json!([{"kind":"card","text":"Water."}])), "isn't a local date and time as YYYY-MM-DD HH:MM"),
    ] {
        fixture.core.apps.state.lock().unwrap().build = fresh();
        fixture.core.apps.answers.lock().unwrap().extend([first, timer(json!([{"kind":"card","text":"Time for some water."}]))]);
        compose_inner(&fixture.core, "b", "remind me to drink water every 45 minutes").await.unwrap();
        let b = build(&fixture.core).unwrap();
        assert_eq!(b.stage, "ready");
        assert!(fixture.core.apps.asked.lock().unwrap().last().unwrap().contains(told), "{told}");
        // The model says when in local time; the core works out the instant, by this machine's clock rules.
        let at_ms = crate::clock::ms("2026-11-03 09:00").unwrap();
        assert!(matches!(b.draft.unwrap().watcher, Watcher::Time { at_ms: a, every_secs: 2700 } if a == at_ms));
    }
    // Once, a reminder is fine; so is one whose title the prompt writes each time.
    assert!(draft(&timed("2026-11-03 09:00", 0, json!([{"kind":"reminder","title":"Drink water","when":""}]))).is_ok());
    let mut written = timer(json!([{"kind":"reminder","title":"{text}","when":""}]));
    written["app"]["prompt"] = json!({"system": "Suggest something to drink.", "template": "{time}"});
    assert!(draft(&written).is_ok());
}

#[tokio::test]
async fn without_a_key_a_failed_build_says_so_instead_of_try_again() {
    let fixture = Fixture::new();
    compose(fixture.core.clone(), "show a card when I mention the demo".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "failed");
    assert!(b.message.contains("MODEL_API_KEY"), "{}", b.message);
}

#[test]
fn phrases_and_topics_match_whole_words() {
    for (text, words) in [("The deadline moved", "deadline"), ("two deadlines this week", "deadline"), ("Ask Meta's team", "meta"),
        ("um, I think", "um"), ("Is AI ready?", "AI"), ("remind me to call", "Remind me"), ("C++ talk", "c++"), ("明天开会", "开会")] {
        assert!(mentions(text, words), "{words} in {text}");
    }
    for (text, words) in [("I said again", "ai"), ("a number of humans", "um"), ("this one", "hi"), ("metadata", "meta"), ("anything", ""),
        ("the demonstration", "demo")] {
        assert!(!mentions(text, words), "{words} in {text}");
    }
}

#[tokio::test]
async fn prompt_decides_whether_to_publish_and_ordinary_rehearsal_does_not_need_a_card() {
    let fixture = Fixture::new();
    let a = seeds(true).remove(0);
    fixture.core.commit(vec![Change::AppRegistered { app: a.clone() }]);
    fixture.core.apps.answers.lock().unwrap().extend([
        json!({"publish":false,"text":"","when":""}),
        json!({"publish":true,"text":"We may be repeating the same point. Shall we try a new angle?","when":""})
    ]);
    execute(&fixture.core, &a, None).await.unwrap();
    assert!(fixture.core.snapshot().suggestions.is_empty());
    execute(&fixture.core, &a, None).await.unwrap();
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1);
    assert!(fixture.core.snapshot().suggestions[0].text.contains("repeating"));
}

#[tokio::test]
async fn an_app_hears_the_newest_thought_once() {
    let fixture = Fixture::new();
    let resolver = seeds(true).remove(0);
    let said = |id: &str, text: &str, at_ms| Thought { id: id.into(), speaker: "you".into(), text: text.into(), point: text.into(),
        thread_id: Some("T1".into()), placed: true, unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(),
        complete: true, at_ms, place_ms: None, decided: false };
    fixture.core.commit(vec![Change::AppRegistered { app: resolver.clone() },
        Change::ThoughtAdded { thought: said("a", "rent is due friday", 1) }, Change::ThoughtAdded { thought: said("b", "pay it from savings", 2) }]);
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"publish":false,"text":"","when":""}));
    execute(&fixture.core, &resolver, Some(("T1".into(), "b".into()))).await.unwrap();
    let asked = fixture.core.apps.asked.lock().unwrap().pop().unwrap();
    assert_eq!(asked.matches("pay it from savings").count(), 1, "{asked}");
    assert!(asked.contains("rent is due friday\nNewest: pay it from savings"), "{asked}");
}

#[tokio::test]
async fn volume_uses_separate_sources_and_the_selected_publisher() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    toggle(&fixture.core, "app-volume".into(), true);
    let mut messages = fixture.core.updates.subscribe();
    let mut playful = move || {
        let mut tune = None;
        while let Ok(message) = messages.try_recv() { if let ServerMsg::AppsSound { playful, .. } = message.message { tune = Some(playful); } }
        tune
    };
    let now = now_ms();
    fixture.core.apps.state.lock().unwrap().volume.insert(("mic-a".into(), "app-volume".into()), (now - 4000, now, false));
    volume(&fixture.core, "mic-b", 0.2);
    tokio::task::yield_now().await;
    assert!(fixture.core.snapshot().suggestions.is_empty(), "another tab cannot complete this mic's loud streak");
    volume(&fixture.core, "mic-a", 0.2);
    tokio::task::yield_now().await;
    assert_eq!(playful(), Some(true), "by default loud voices get the silly tune");
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1, "and a light card that says why");
    disconnect(&fixture.core, "mic-a");
    assert!(!fixture.core.apps.state.lock().unwrap().volume.keys().any(|(s, _)| s == "mic-a"));
    volume_output(&fixture.core, "app-volume".into(), false);
    assert!(!fixture.core.snapshot().apps.iter().find(|a| a.id == "app-volume").unwrap().purpose.contains("tune"), "the purpose says what it does");
    fixture.core.commit(vec![Change::AppRan { id: "app-volume".into(), at_ms: 0 }]);
    fixture.core.apps.state.lock().unwrap().volume.insert(("mic-b".into(), "app-volume".into()), (now - 4000, now, false));
    volume(&fixture.core, "mic-b", 0.2);
    tokio::task::yield_now().await;
    assert_eq!(playful(), None, "the card alone is quiet");
    assert_eq!(fixture.core.snapshot().suggestions.len(), 2);
}

#[tokio::test]
async fn a_busy_app_keeps_the_latest_matching_thought_for_its_next_pass() {
    let fixture = Fixture::new();
    let a = app();
    fixture.core.apps.state.lock().unwrap().running.insert(a.id.clone());
    launch(&fixture.core, a.clone(), Some(("T1".into(), "old".into())));
    launch(&fixture.core, a.clone(), Some(("T1".into(), "new".into())));
    assert_eq!(fixture.core.apps.state.lock().unwrap().pending[&a.id], Some(("T1".into(), "new".into())));
    toggle(&fixture.core, a.id.clone(), false);
    // Register, then switching off also clears work waiting behind a model call.
    fixture.core.commit(vec![Change::AppRegistered { app: a.clone() }]);
    toggle(&fixture.core, a.id.clone(), false);
    assert!(!fixture.core.apps.state.lock().unwrap().pending.contains_key(&a.id));
}

#[tokio::test]
async fn a_refused_key_keeps_an_app_that_asks_the_model_from_running() {
    let fixture = Fixture::new();
    let asks = seeds(true).remove(0);
    assert!(asks.prompt.is_some());
    fixture.core.commit(vec![Change::AppRegistered { app: asks.clone() }]);
    let _ = fixture.core.check(reqwest::StatusCode::UNAUTHORIZED);
    let mut updates = fixture.core.updates.subscribe();
    for _ in 0..3 { launch(&fixture.core, asks.clone(), None); }
    tokio::task::yield_now().await;
    assert!(fixture.core.apps.asked.lock().unwrap().is_empty(), "no model call");
    assert!(updates.try_recv().is_err(), "nothing run or said: the header already says why");
}

#[test]
fn in_a_room_an_app_hears_who_said_what() {
    let said_by = |speaker: &str, text: &str| Thought { id: text.into(), speaker: speaker.into(), text: text.into(), point: String::new(),
        thread_id: Some("T1".into()), placed: true, unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(), complete: true, at_ms: 0, place_ms: None, decided: false };
    let (rent, friday, agree) = (said_by("User", "rent is due"), said_by("User", "pay it friday"), said_by("Sam", "friday works"));
    // One speaker: the prompt reads exactly as it did before rooms.
    assert_eq!(said(&[&rent], Some(&friday)), ("rent is due".to_string(), "pay it friday".to_string()));
    assert_eq!(said(&[&rent, &friday], Some(&agree)), ("User: rent is due\nAvi: pay it friday".to_string(), "Sam: friday works".to_string()));
}
