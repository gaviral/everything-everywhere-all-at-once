use super::*;
fn block() -> AppBlock { AppBlock { query: "rent".into(), when: "2026-11-06".into() } }
#[test]
fn three_proposals_require_separate_confirmations_and_receipts() {
    let mut hub = Hub::default();
    let id = hub.propose(block(), "fixture").unwrap();
    assert_eq!(hub.plans[0].steps.len(), 3);
    assert!(hub.claim(&id, 1).is_err());
    let first = hub.claim(&id, 0).unwrap();
    assert!(script(&first, 0).unwrap().contains("list \"E2A2O\""));
    assert!(hub.claim(&id, 0).is_err());
    hub.finish(&id, 0, Ok("Pay rent".into()));
    let calendar = hub.claim(&id, 1).unwrap();
    let text = script(&calendar, 1).unwrap();
    assert!(text.contains("summary:\"Pay rent\""));
    assert!(text.contains("set day of d to 06"));
    assert!(hub.claim(&id, 2).is_err());
    hub.finish(&id, 1, Ok("Calendar accepted".into()));
    hub.claim(&id, 2).unwrap();
    assert!(hub.finish(&id, 2, Ok("Tune confirmed".into())));
    assert!(hub.claim(&id, 1).is_err());
}
#[test]
fn failure_blocks_dependents_and_never_retries() {
    let mut hub = Hub::default(); let id = hub.propose(block(), "fixture").unwrap();
    hub.claim(&id, 0).unwrap(); hub.finish(&id, 0, Err(anyhow::anyhow!("permission refused")));
    assert!(hub.claim(&id, 0).is_err()); assert!(hub.claim(&id, 1).is_err());
    assert!(hub.propose(AppBlock { when: "2026-02-30".into(), ..block() }, "fixture").is_err());
    assert!(hub.propose(AppBlock { query: "\nrent".into(), ..block() }, "fixture").is_err());
    assert_eq!(quoted("a\"b\\c"), "\"a\\\"b\\\\c\"");
}

#[tokio::test]
async fn handler_enforces_opt_in_locality_replay_and_runs_only_claimed_step() {
    use crate::world::Journal;
    let path = std::env::temp_dir().join(format!("e2a2o-connections-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, world) = Journal::open(&path).unwrap();
    let core = crate::Core::test(journal, world);
    let refuse = |_, _| async { panic!("adapter must not run"); #[allow(unreachable_code)] Ok(String::new()) };
    let remote = handle_with(&core, "r1", Request::Plan { block: block() }, false, true, true, refuse).await;
    assert!(remote.plans.is_empty());
    let off = handle_with(&core, "r2", Request::Plan { block: block() }, true, false, true, refuse).await;
    assert!(off.plans.is_empty());
    let hosted = handle_with(&core, "r3", Request::Plan { block: block() }, true, true, false, refuse).await;
    assert!(hosted.plans.is_empty());
    let planned = handle_with(&core, "r4", Request::Plan { block: block() }, true, true, true, refuse).await;
    let id = planned.plans[0].id.clone();
    let early = handle_with(&core, "r5", Request::Confirm { plan_id: id.clone(), step: 1 }, true, true, true, refuse).await;
    assert!(early.message.contains("preceding"));
    let read = handle_with(&core, "r6", Request::Confirm { plan_id: id.clone(), step: 0 }, true, true, true, |_, step| async move { assert_eq!(step, 0); Ok("Pay rent".into()) }).await;
    assert_eq!(read.plans[0].title.as_deref(), Some("Pay rent"));
    let replay = handle_with(&core, "r6", Request::Confirm { plan_id: id.clone(), step: 1 }, true, true, true, refuse).await;
    assert!(replay.message.contains("already handled"));
    let calendar = handle_with(&core, "r7", Request::Confirm { plan_id: id.clone(), step: 1 }, true, true, true, |_, step| async move { assert_eq!(step, 1); Ok("Calendar fixture accepted".into()) }).await;
    assert!(!calendar.play);
    let tune = handle_with(&core, "r8", Request::Confirm { plan_id: id.clone(), step: 2 }, true, true, true, |_, step| async move { assert_eq!(step, 2); Ok("Tune fixture confirmed".into()) }).await;
    assert!(tune.play);
    let duplicate = handle_with(&core, "r9", Request::Confirm { plan_id: id, step: 2 }, true, true, true, refuse).await;
    assert!(!duplicate.play);
    let remote = handle_with(&core, "r10", Request::List, false, true, true, refuse).await;
    assert!(remote.plans.is_empty());
    drop(core);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn wire_messages_preserve_closed_operation_and_correlated_reply() {
    let request = serde_json::json!({"type":"app_connection","request_id":"fixture-1","operation":"plan","block":{"query":"rent","when":"2026-11-06"}});
    assert!(matches!(serde_json::from_value::<crate::protocol::ClientMsg>(request).unwrap(), crate::protocol::ClientMsg::AppConnection { request: Request::Plan { .. }, .. }));
    let bad = serde_json::json!({"type":"app_connection","request_id":"fixture-2","operation":"plan","block":{"query":"rent","when":"2026-11-06","script":"arbitrary"}});
    assert!(serde_json::from_value::<crate::protocol::ClientMsg>(bad).is_err());
    let reply = Hub::default().reply("fixture-1", "Ready".into(), false);
    let value = serde_json::to_value(crate::protocol::ServerMsg::AppConnectionResult { reply }).unwrap();
    assert_eq!(value["type"], "app_connection_result");
    assert_eq!(value["request_id"], "fixture-1");
    assert_eq!(value["plans"], serde_json::json!([]));
}
