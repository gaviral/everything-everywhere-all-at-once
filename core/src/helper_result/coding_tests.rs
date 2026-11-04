use super::*;

#[tokio::test]
async fn builtin_result_running_comes_from_provider_start_and_stop_is_truthful() {
    let root =
        std::env::temp_dir().join(format!("e2a2o-result-lifecycle-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    git(&root, &["init", "-q"]).await.unwrap();
    std::fs::write(root.join("README.md"), "# Example\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(
        &root,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
            "commit",
            "--no-gpg-sign",
            "-qm",
            "Fixture",
        ],
    )
    .await
    .unwrap();
    let (journal, world) = crate::Journal::open(&root.with_extension("jsonl")).unwrap();
    let mut core = Core::test(journal, world);
    core.messages.settings.preset = Preset::Full;
    core.helpers.coding = Settings {
        enabled: true,
        repo: Some(root.clone()),
        meta_test_answer: Some(
            json!({"model":"muse-spark-1.3","choices":[{"message":{"content":"{\"edits\":[]}"}}]}),
        ),
        meta_test_delay: Duration::from_secs(60),
        ..Settings::default()
    };
    let core = Arc::new(core);
    let mut updates = core.updates.subscribe();
    assert!(said(&core, "you", "put three helpers on the README"));
    let id = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let ServerMsg::Job {
                job,
                result_id: Some(id),
                ..
            } = updates.recv().await.unwrap().message
            {
                if job.status == "running" && job.parent.is_some() {
                    assert!(job.started_ms.is_some(), "actual start event recorded");
                    break id;
                }
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(core.helpers.result_record(&id).unwrap().status, "running");
    assert_eq!(
        core.helpers.coding.results.lock().unwrap()[&id].exit,
        ExitStatus::Running
    );
    let run = core
        .helpers
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .clone();
    assert!(stop(&core, run.id));
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if core.helpers.result_record(&id).unwrap().status == "stopped" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let result = crate::helper_result::inspect(core.helpers.result_record(&id).unwrap())
        .await
        .unwrap();
    let wire = serde_json::to_value(result).unwrap();
    assert_eq!(wire["status"], "stopped");
    assert_eq!(wire["validation"], "not_run");
    assert_eq!(wire["no_change"], true);
}
