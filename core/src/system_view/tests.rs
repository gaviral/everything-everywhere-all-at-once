use super::*;

fn step(name: &str, done: bool, ok: bool, dropped: bool) -> ServerMsg {
    ServerMsg::Step { id: 17, step: name.into(), model: Some("private-model-name".into()), done, ok, ms: 19, dropped }
}

#[test]
fn projection_has_only_fixed_event_names_and_real_directions() {
    for (name, part) in [("placer", "placer"), ("refiner", "refiner"), ("listen", "speech"), ("flow", "flow"), ("flow-plan", "flow"), ("helpers_plan", "helpers"), ("coding", "agents")] {
        assert_eq!(project(&step(name, false, false, false)), Some(Message::new("core", part, "started")));
        assert_eq!(project(&step(name, true, true, false)), Some(Message::new(part, "core", "completed")));
        assert_eq!(project(&step(name, true, false, false)), Some(Message::new(part, "core", "failed")));
        assert_eq!(project(&step(name, true, false, true)), Some(Message::new(part, "core", "cancelled")));
    }
    assert!(project(&step("unrecognized private feature", false, false, false)).is_none());
    let rule = ServerMsg::Step { id: 1, step: "placer".into(), model: None, done: true, ok: true, ms: 0, dropped: false };
    assert!(project(&rule).is_none());
    assert!(project(&ServerMsg::Notice { message: "private words".into() }).is_none());
    let safe = serde_json::to_string(&project(&ServerMsg::Partial { text: "private words".into() })).unwrap();
    assert!(!safe.contains("private"));
}

#[tokio::test(start_paused = true)]
async fn subscriptions_begin_empty_batch_real_counts_and_report_lag() {
    let runtime = Runtime::default();
    runtime.observe(&step("placer", false, false, false));
    let mut source = Subscription::new(&runtime);
    assert!(source.updates.try_recv().is_err(), "no replay or seeded traffic");
    for _ in 0..300 { runtime.observe(&step("placer", false, false, false)); }
    assert!(matches!(source.updates.recv().await, Err(broadcast::error::RecvError::Lagged(44))));
    // The live stream itself reports gaps and batches all retained messages exactly once.
    let mut source = Subscription::new(&runtime);
    for _ in 0..300 { runtime.observe(&step("placer", false, false, false)); }
    let _event = source.next().await.unwrap();
    assert_eq!(source.sequence, 1);
    assert!(source.pending.is_empty());
    // Count and gap independently before serialization; no body fields can enter the contract.
    let message = Message::new("core", "placer", "started");
    source.pending.insert(message, 12);
    source.missed = 3;
    let batch = serde_json::to_value(source.flush()).unwrap();
    assert_eq!(batch["messages"][0]["count"], 12);
    assert_eq!(batch["missed"], 3);
    assert_eq!(batch["messages"][0].as_object().unwrap().len(), 4);
}

#[test]
fn demo_jobs_and_unknown_states_never_generate_traffic() {
    let mut job = crate::guide::Job { id: "private-id".into(), title: "private task".into(), status: "running".into(), demo: true, ..Default::default() };
    let message = |job| ServerMsg::Job { result_id: Some("private-result".into()), job, by: "private-person".into(), at_ms: 0, from: 0 };
    assert!(project(&message(job.clone())).is_none());
    job.demo = false;
    let projected = project(&message(job.clone())).unwrap();
    assert_eq!(projected, Message::new("agents", "core", "job running"));
    assert!(!serde_json::to_string(&projected).unwrap().contains("private"));
    job.status = "private unknown state".into();
    assert!(project(&message(job)).is_none());
}

#[test]
fn core_transactions_emit_after_the_real_journal_write() {
    let path = std::env::temp_dir().join(format!("system-view-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = crate::Journal::open(&path).unwrap();
    let core = Core::test(journal, world);
    let mut receiver = core.system_view.updates.subscribe();
    core.commit(vec![crate::Change::AppsSeeded]);
    assert_eq!(receiver.try_recv().unwrap(), Message::new("core", "journal", "transaction saved"));
    assert_eq!(receiver.try_recv().unwrap(), Message::new("core", "browser", "map change"));
    assert!(std::fs::read_to_string(path).unwrap().contains("apps_seeded"));
    assert!(!core.commit_if(|_| false, vec![crate::Change::AppsSeeded]));
    assert!(receiver.try_recv().is_err(), "rejected writes produce no packet");
}
