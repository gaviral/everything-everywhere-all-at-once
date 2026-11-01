use super::*;
use crate::world::{Journal, Thought, World};
use std::path::PathBuf;
use tokio::sync::{broadcast, mpsc};

struct Fixture { core: Arc<Core>, path: PathBuf }

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-apps-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let (updates, _) = broadcast::channel(1024);
        let (placer_queue, _) = mpsc::unbounded_channel();
        Self { path, core: Arc::new(Core {
            recap: crate::recap::Runtime::default(),
            apps: Runtime::default(), world: Mutex::new(world), journal: Mutex::new(journal), updates, placer_queue,
            key: None, placer_model: "test".into(), http: reqwest::Client::new(),
            last_activity: std::sync::atomic::AtomicU64::new(0), looked: std::sync::atomic::AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
        }) }
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
    fixture.core.commit(vec![Change::ActiveChanged { thread_id: "T1".into() }, Change::AppRegistered { app: app() },
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
        *fixture.core.world.lock().unwrap() = loaded;
        seed(&fixture.core, demo);
        assert_eq!(fixture.core.snapshot().apps.len(), 2);
    }
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
fn volume_needs_continuous_readings_from_one_source() {
    let mut state = (1000, 1000);
    for now in (1000..4000).step_by(320) { assert!(!feed_volume(&mut state, now, true, 3)); }
    assert!(feed_volume(&mut state, 4200, true, 3));
    assert!(!feed_volume(&mut state, 4300, false, 3));
    assert!(!feed_volume(&mut state, 4500, true, 3));
    assert!(!feed_volume(&mut state, 8000, true, 3), "a missing mic report resets the duration");
    assert_eq!(state.0, 8000);
}

#[tokio::test]
async fn keep_and_discard_are_explicit_and_idempotent() {
    let fixture = Fixture::new();
    fixture.core.apps.state.lock().unwrap().build = Some(Build { id: "b".into(), request: "quiet".into(), stage: "ready".into(),
        steps: Vec::new(), draft: Some(app()), match_id: None, message: String::new() });
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

#[tokio::test]
async fn search_offers_an_existing_app_without_a_model_and_failures_are_gentle() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    fixture.core.apps.state.lock().unwrap().build = Some(Build { id: "b".into(), request: "".into(), stage: "searching".into(),
        steps: Vec::new(), draft: None, match_id: None, message: String::new() });
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
        complete: true, at_ms: now_ms(), place_ms: Some(10) };
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
        loop { if matches!(changes.recv().await.unwrap(), ServerMsg::Change { change: Change::SuggestionAdded { .. } }) { break; } }
    }).await.unwrap();
    assert_eq!(fixture.core.snapshot().suggestions.len(), 2);
    assert!(fixture.core.snapshot().apps.iter().find(|a| a.id == "timer").unwrap().last_run_ms > 0);
    task.abort();
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
        if let ServerMsg::AppsBuild { build } = message { stages.push(build.stage); }
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
async fn semantic_search_offers_a_disabled_app_before_any_composition() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    toggle(&fixture.core, "app-search".into(), true);
    fixture.core.apps.answers.lock().unwrap().push_back(json!({"match_id":"app-volume", "text":"A quiet pause for loud voices."}));
    compose(fixture.core.clone(), "help us take a pause when our voices get loud".into());
    tokio::task::yield_now().await;
    let b = build(&fixture.core).unwrap();
    assert_eq!(b.stage, "matched");
    assert_eq!(b.steps.len(), 2, "the composer never runs for a search match");
    assert_eq!(b.match_id.as_deref(), Some("app-volume"));
    assert_eq!(fixture.core.snapshot().apps.len(), 3);
    decide(&fixture.core, &b.id, true);
    assert!(fixture.core.snapshot().apps.iter().find(|a| a.id == "app-volume").unwrap().enabled);
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
async fn volume_uses_separate_sources_and_the_selected_publisher() {
    let fixture = Fixture::new();
    seed(&fixture.core, false);
    toggle(&fixture.core, "app-volume".into(), true);
    let now = now_ms();
    fixture.core.apps.state.lock().unwrap().volume.insert(("mic-a".into(), "app-volume".into()), (now - 4000, now));
    volume(&fixture.core, "mic-b", 0.2);
    tokio::task::yield_now().await;
    assert!(fixture.core.snapshot().suggestions.is_empty(), "another tab cannot complete this mic's loud streak");
    volume(&fixture.core, "mic-a", 0.2);
    tokio::task::yield_now().await;
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1);
    disconnect(&fixture.core, "mic-a");
    assert!(!fixture.core.apps.state.lock().unwrap().volume.keys().any(|(s, _)| s == "mic-a"));
    volume_output(&fixture.core, "app-volume".into(), true);
    fixture.core.commit(vec![Change::AppRan { id: "app-volume".into(), at_ms: 0 }]);
    fixture.core.apps.state.lock().unwrap().volume.insert(("mic-b".into(), "app-volume".into()), (now - 4000, now));
    let mut messages = fixture.core.updates.subscribe();
    volume(&fixture.core, "mic-b", 0.2);
    tokio::task::yield_now().await;
    let mut sounded = false;
    while let Ok(message) = messages.try_recv() { if matches!(message, ServerMsg::AppsSound { .. }) { sounded = true; } }
    assert!(sounded);
    assert_eq!(fixture.core.snapshot().suggestions.len(), 1, "choosing sound replaces the card");
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
