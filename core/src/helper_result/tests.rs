use super::*;
use serde_json::json;

async fn command(root: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .output()
        .await
        .unwrap();
    assert!(out.status.success(), "fixture git failed");
    String::from_utf8(out.stdout).unwrap().trim().into()
}

async fn repository() -> (PathBuf, String) {
    let root = std::env::temp_dir().join(format!("e2a2o-result-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    command(&root, &["init", "-q"]).await;
    std::fs::write(root.join("example.txt"), "initial\n").unwrap();
    std::fs::write(root.join("image.bin"), [0, 1, 2]).unwrap();
    command(&root, &["add", "."]).await;
    command(
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
    .await;
    let base = command(&root, &["rev-parse", "HEAD"]).await;
    (root, base)
}

fn record(root: &Path, base: &str, status: &str) -> Record {
    Record {
        worktree: root.into(),
        base: base.into(),
        status: status.into(),
        exit_code: (status == "failed").then_some(7),
        validation: "not_run".into(),
    }
}

fn core(root: &Path) -> Arc<Core> {
    let (journal, mut world) = crate::Journal::open(&root.join("host-log.jsonl")).unwrap();
    world.apply(&crate::world::Change::ThreadAdded {
        thread: crate::world::fixtures::thread("source", "Example source", crate::now_ms()),
    });
    world.apply(&crate::world::Change::ThoughtAdded {
        thought: crate::world::fixtures::thought(
            "source-thought",
            "source",
            "A visible source stays available while reviewing work.",
            crate::now_ms(),
        ),
    });
    world.apply(&crate::world::Change::ActiveChanged {
        thread_id: "source".into(),
        speaker: "you".into(),
    });
    Arc::new(Core::test(journal, world))
}

#[tokio::test]
async fn real_diff_new_binary_failed_stopped_and_read_only() {
    let (root, base) = repository().await;
    std::fs::write(root.join("example.txt"), "staged\n").unwrap();
    command(&root, &["add", "example.txt"]).await;
    std::fs::write(
        root.join("example.txt"),
        "<script>danger()</script>\nfinal\n",
    )
    .unwrap();
    std::fs::write(root.join("new.txt"), "new addition\n").unwrap();
    std::fs::write(root.join("image.bin"), [0, 3, 4]).unwrap();
    let tree = command(&root, &["write-tree"]).await;
    let before = command(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )
    .await;
    let index = std::fs::read(root.join(".git/index")).unwrap();
    for status in ["completed", "failed", "stopped", "running"] {
        let view = inspect(record(&root, &base, status)).await.unwrap();
        assert_eq!(view.status, status);
        assert_eq!(view.validation, "not_run");
        assert!(!view.no_change);
        assert_eq!(view.files.len(), 3);
        let modified = view.files.iter().find(|f| f.path == "example.txt").unwrap();
        assert!(modified.diff.contains("+<script>danger()</script>"));
        assert_eq!((modified.additions, modified.deletions), (2, 1));
        assert!(view
            .files
            .iter()
            .any(|f| f.path == "new.txt" && f.diff.contains("+new addition")));
        assert!(view
            .files
            .iter()
            .any(|f| f.path == "image.bin" && f.binary && f.diff.is_empty()));
        if status == "failed" {
            assert_eq!(view.exit_code, Some(7));
        }
    }
    assert_eq!(std::fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(command(&root, &["write-tree"]).await, tree);
    assert_eq!(command(&root, &["rev-parse", "HEAD"]).await, base);
    assert_eq!(
        command(
            &root,
            &["status", "--porcelain=v1", "--untracked-files=all"]
        )
        .await,
        before
    );
}

#[tokio::test]
async fn no_change_and_untracked_only_are_distinct() {
    let (root, base) = repository().await;
    assert!(
        inspect(record(&root, &base, "completed"))
            .await
            .unwrap()
            .no_change
    );
    assert!(!has_changes(&root, &base).await.unwrap());
    std::fs::write(root.join("new.txt"), "only new file\n").unwrap();
    assert!(has_changes(&root, &base).await.unwrap());
    let view = inspect(record(&root, &base, "completed")).await.unwrap();
    assert!(!view.no_change);
    assert_eq!(view.files[0].additions, 1);
}

#[tokio::test]
async fn bounded_and_private_files_and_paths_are_withheld() {
    let (root, base) = repository().await;
    std::fs::write(
        root.join("example.txt"),
        format!("{}\n{}example/private/value\n", root.display(), "/Users/"),
    )
    .unwrap();
    std::fs::write(root.join(".env"), "PRIVATE_FILE_SENTINEL").unwrap();
    std::fs::write(root.join("large.txt"), "a\n".repeat(MAX_BYTES)).unwrap();
    let view = inspect(record(&root, &base, "failed")).await.unwrap();
    let json = serde_json::to_string(&view).unwrap();
    assert!(
        !json.contains("PRIVATE_FILE_SENTINEL")
            && !json.contains("/Users/")
            && !json.contains(root.to_str().unwrap())
    );
    assert!(view.files.iter().any(|f| f.withheld));
    assert!(view.truncated);
    assert!(view.files.iter().map(|f| f.diff.len()).sum::<usize>() <= MAX_BYTES);
    for n in 0..MAX_FILES + 3 {
        std::fs::write(root.join(format!("file-{n:02}.txt")), "new\n").unwrap();
    }
    let view = inspect(record(&root, &base, "completed")).await.unwrap();
    assert_eq!(view.files.len(), MAX_FILES);
    assert!(view.truncated);
}

#[tokio::test]
async fn requests_refuse_paths_unknown_ids_and_guests() {
    let (root, base) = repository().await;
    let core = core(&root);
    let id = core
        .helpers
        .register_test_result("child", record(&root, &base, "failed"));
    assert_ne!(id, "child");
    assert_eq!(core.helpers.result_id("child"), Some(id.clone()));
    assert!(
        serde_json::from_value::<Request>(json!({"result_id":id,"path":"example.txt"})).is_err()
    );
    let link = Link {
        from: "127.0.0.1:51000".parse().unwrap(),
        to: "127.0.0.1:4321".parse().unwrap(),
        tls: false,
    };
    for id in ["../../example.txt", "unknown"] {
        assert_eq!(
            read(
                State(core.clone()),
                ConnectInfo(link),
                Extension(Access::Map),
                Json(Request {
                    result_id: id.into()
                })
            )
            .await
            .unwrap_err(),
            StatusCode::NOT_FOUND
        );
    }
    let remote = Link {
        from: "192.0.2.1:51000".parse().unwrap(),
        ..link
    };
    assert_eq!(
        read(
            State(core.clone()),
            ConnectInfo(remote),
            Extension(Access::Map),
            Json(Request {
                result_id: id.clone()
            })
        )
        .await
        .unwrap_err(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        read(
            State(core.clone()),
            ConnectInfo(link),
            Extension(Access::Page),
            Json(Request {
                result_id: id.clone()
            })
        )
        .await
        .unwrap_err(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        read(
            State(core),
            ConnectInfo(link),
            Extension(Access::Map),
            Json(Request { result_id: id })
        )
        .await
        .unwrap()
        .0
        .status,
        "failed"
    );
}

// Real read endpoint + isolated repositories + built UI. No model or external send.
#[tokio::test]
#[ignore]
async fn app() {
    let (root, _) = repository().await;
    let core = core(&root);
    core.guide.publish_core(
        &core,
        crate::guide::Job {
            id: "results".into(),
            title: "Coding proposals".into(),
            status: "done".into(),
            helper_kind: Some(crate::guide::HelperKind::Coding),
            requested_count: Some(5),
            ..Default::default()
        },
    );
    for (i, status) in ["completed", "failed", "stopped", "completed", "completed"]
        .iter()
        .enumerate()
    {
        let (repo, base) = repository().await;
        if i != 3 {
            std::fs::write(
                repo.join("example.txt"),
                "<img src=x onerror=alert(1)>\n".repeat(700),
            )
            .unwrap();
            std::fs::write(repo.join("new.txt"), "new addition\n").unwrap();
            std::fs::write(repo.join("image.bin"), [0, 3]).unwrap();
        }
        let id = format!("proposal-{i}");
        core.helpers
            .register_test_result(&id, record(&repo, &base, status));
        core.guide.publish_core(
            &core,
            crate::guide::Job {
                id,
                title: format!("Coding helper {}", i + 1),
                status: if *status == "completed" {
                    "done"
                } else {
                    status
                }
                .to_string(),
                parent: Some("results".into()),
                helper_kind: Some(crate::guide::HelperKind::Coding),
                ..Default::default()
            },
        );
    }
    core.guide.publish_core(
        &core,
        crate::guide::Job {
            id: "helpers:thinking:0".into(),
            parent: Some("thinking".into()),
            title: "Thinking helper".into(),
            helper_kind: Some(crate::guide::HelperKind::Thinking),
            status: "done".into(),
            result: Some("Independent answer <strong>plain text</strong>".into()),
            ..Default::default()
        },
    );
    let app = axum::Router::new()
        .route("/ws", axum::routing::get(crate::connect))
        .route("/room", axum::routing::get(crate::room_info))
        .route("/helper-result", axum::routing::post(read))
        .fallback_service(tower_http::services::ServeDir::new("../ui/dist"))
        .layer(axum::middleware::from_fn_with_state(
            core.clone(),
            crate::gate,
        ))
        .with_state(core);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!(
        "HELPER_RESULT_APP http://{}",
        listener.local_addr().unwrap()
    );
    axum::serve(listener, app.into_make_service_with_connect_info::<Link>())
        .await
        .unwrap();
}
