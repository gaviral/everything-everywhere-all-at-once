use super::*;

pub(super) static GIT_CALLS: Mutex<Vec<(PathBuf, Vec<String>)>> = Mutex::new(Vec::new());

async fn repository() -> PathBuf {
    let root = if cfg!(target_os = "macos") {
        PathBuf::from("/private/tmp")
    } else {
        std::env::temp_dir()
    };
    let repo = root.join(format!("e2a2o-coding-check-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q"]).await.unwrap();
    std::fs::write(repo.join("README.md"), "# Example\n\nInitial README.\n").unwrap();
    git(&repo, &["add", "README.md"]).await.unwrap();
    git(
        &repo,
        &[
            "-c",
            "user.name=E2A2O Helper",
            "-c",
            "user.email=helper@example.com",
            "commit",
            "-q",
            "--no-gpg-sign",
            "-m",
            "Initial fixture",
        ],
    )
    .await
    .unwrap();
    repo
}

fn stub(repo: &Path, mode: &str) -> String {
    // Executable and observations stay outside the repository and helper commits.
    let script = repo.with_extension("py");
    std::fs::write(&script, format!(r#"import json, os, pathlib, subprocess, sys, time
brief = pathlib.Path(sys.argv[sys.argv.index('--prompt-file') + 1])
assert '--json' in sys.argv
assert brief.read_text().startswith('Coding helper')
child = subprocess.Popen(['python3', '-c', 'import time; time.sleep(60)']) if {slow} else None
if {change}:
    with open('README.md', 'a') as f: f.write('\nUseful helper update.\n')
    pathlib.Path('proposal.txt').write_text('Bounded proposal\n')
brief.with_suffix('.observed.json').write_text(json.dumps({{'pid': os.getpid(), 'child': child.pid if child else None, 'argv': sys.argv, 'cwd': os.getcwd()}}))
print(json.dumps({{'type': 'progress', 'text': 'Editing README'}}), flush=True)
if child:
    child.wait()
    sys.exit(0)
time.sleep(0.3)
print(json.dumps({{'type': 'done', 'model': 'muse-spark-1.3', 'text': 'proposal ready'}}), flush=True)
sys.exit({exit})
"#, slow = if mode == "stop" { "True" } else { "False" }, change = if mode == "no-change" { "False" } else { "True" }, exit = if mode == "failed" { 7 } else { 0 })).unwrap();
    serde_json::to_string(&vec![
        "python3".to_string(),
        script.to_string_lossy().into_owned(),
    ])
    .unwrap()
}

fn core(repo: &Path, command: String, enabled: bool) -> Arc<Core> {
    let (mut core, _) = super::super::tests::fixture(true, false, false);
    Arc::get_mut(&mut core).unwrap().helpers.coding = Settings {
        enabled,
        repo: Some(repo.to_owned()),
        command: Some(command),
        test_only: true,
        ..Settings::default()
    };
    let trace = repo.with_extension("trace");
    std::fs::create_dir(&trace).unwrap();
    Arc::get_mut(&mut core).unwrap().trace = crate::trace::Trace::to(&trace);
    core
}

fn trace_lines(repo: &Path) -> Vec<Value> {
    std::fs::read_to_string(repo.with_extension("trace").join("trace.jsonl"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn jobs(core: &Core) -> Vec<Job> {
    core.guide
        .subscribe(core)
        .1
        .into_iter()
        .filter_map(|message| {
            if let ServerMsg::Job { job, .. } = message {
                Some(job)
            } else {
                None
            }
        })
        .collect()
}

async fn finished(core: &Core) {
    tokio::time::timeout(Duration::from_secs(25), async {
        while core.helpers.state.lock().unwrap().active.is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("helpers finish and release active run");
}

async fn source_snapshot(repo: &Path) -> (String, Vec<u8>, String) {
    (
        git(repo, &["rev-parse", "HEAD", "HEAD^{tree}"])
            .await
            .unwrap(),
        std::fs::read(repo.join(".git/index")).unwrap(),
        git(repo, &["status", "--porcelain=v1", "--untracked-files=all"])
            .await
            .unwrap(),
    )
}

async fn assert_retained(
    core: &Core,
    repo: &Path,
    before: &(String, Vec<u8>, String),
    dirty: bool,
) {
    assert_eq!(
        &source_snapshot(repo).await,
        before,
        "source HEAD/tree/index unchanged"
    );
    let records = core.helpers.coding.results.lock().unwrap().clone();
    assert_eq!(records.len(), 3);
    for (id, record) in &records {
        assert!(jobs(core).iter().any(|job| &job.id == id));
        assert!(record.worktree.is_dir());
        assert_eq!(record.validation, ValidationStatus::NotRun);
        assert_eq!(
            git(&record.worktree, &["rev-parse", "HEAD"]).await.unwrap(),
            record.base
        );
        assert_eq!(
            git(
                &record.worktree,
                &["rev-list", "--count", &format!("{}..HEAD", record.base)]
            )
            .await
            .unwrap(),
            "0"
        );
        assert_eq!(
            git(repo, &["rev-parse", &record.branch]).await.unwrap(),
            record.base
        );
        assert_eq!(
            !git(&record.worktree, &["status", "--porcelain"])
                .await
                .unwrap()
                .is_empty(),
            dirty
        );
        assert!(git(&record.worktree, &["diff", "--cached", "--name-only"])
            .await
            .unwrap()
            .is_empty());
    }
    let calls = GIT_CALLS.lock().unwrap();
    // Fixture setup is the only source add/commit; no helper worktree may stage or commit.
    assert!(!calls
        .iter()
        .any(|(path, args)| records.values().any(|r| &r.worktree == path)
            && args.iter().any(|a| a == "add" || a == "commit")));
    assert_eq!(
        calls
            .iter()
            .filter(|(path, args)| path == repo && args.first().is_some_and(|a| a == "add"))
            .count(),
        1
    );
    assert_eq!(
        calls
            .iter()
            .filter(|(path, args)| path == repo && args.iter().any(|a| a == "commit"))
            .count(),
        1
    );
}

async fn acceptance(mode: &str) {
    let repo = repository().await;
    let before = source_snapshot(&repo).await;
    let core = core(&repo, stub(&repo, mode), true);
    assert!(said(&core, "you", "put three helpers on the README"));
    finished(&core).await;
    let children = jobs(&core)
        .into_iter()
        .filter(|j| j.parent.is_some())
        .collect::<Vec<_>>();
    assert_eq!(children.len(), 3);
    for job in children {
        assert_eq!(
            job.status,
            if mode == "failed" { "failed" } else { "done" },
            "{:?}",
            job.result
        );
        assert!(job.started_ms.is_some());
    }
    for record in core.helpers.coding.results.lock().unwrap().values() {
        assert_eq!(
            record.exit,
            ExitStatus::Exited(Some(if mode == "failed" { 7 } else { 0 }))
        );
        let brief = record.worktree.parent().unwrap().join("brief-1.txt");
        let text = std::fs::read_to_string(brief).unwrap();
        assert!(text.contains("separate bounded proposal"));
        assert!(text.contains("Do not run git add or git commit"));
        assert!(text.contains("Do not invoke other agents or providers"));
    }
    assert_retained(&core, &repo, &before, mode != "no-change").await;
    let lines = trace_lines(&repo);
    let provider = lines
        .iter()
        .find(|line| line["kind"] == "coding_provider")
        .unwrap();
    assert_eq!(provider["provider"], "test-only");
    assert_eq!(
        provider["model"], "test-only",
        "stdout's claimed model is not proof"
    );
}

#[tokio::test]
async fn success_changes_retained_without_staging_or_committing() {
    acceptance("change").await;
}

#[tokio::test]
async fn no_change_retains_head_without_empty_commit() {
    acceptance("no-change").await;
}

#[tokio::test]
async fn failed_dirty_exit_retained_without_commit() {
    acceptance("failed").await;
}

#[tokio::test]
async fn dry_run_does_not_launch_or_create_worktrees() {
    let repo = repository().await;
    let core = core(&repo, "does-not-exist".into(), false);
    assert!(said(&core, "you", "put three helpers on the README"));
    finished(&core).await;
    assert!(jobs(&core)
        .iter()
        .all(|job| job.result.as_deref().unwrap().contains("Dry run")));
    assert!(git(&repo, &["branch", "--list", "helpers/*"])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn stop_reaps_runner_and_descendants_by_pid() {
    let repo = repository().await;
    let before = source_snapshot(&repo).await;
    let core = core(&repo, stub(&repo, "stop"), true);
    assert!(said(&core, "you", "put three helpers on the README"));
    let observations = tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            // Observe only fully registered worktrees. `git worktree list`
            // can race Git's transient initializing metadata during prepare.
            let paths = core
                .helpers
                .coding
                .results
                .lock()
                .unwrap()
                .values()
                .map(|record| record.worktree.clone())
                .collect::<Vec<_>>();
            let observations = paths
                .iter()
                .filter_map(|path| path.parent().map(Path::to_owned))
                .flat_map(|folder| {
                    (1..=3).map(move |i| folder.join(format!("brief-{i}.observed.json")))
                })
                .collect::<HashSet<_>>()
                .into_iter()
                .filter_map(|path| std::fs::read_to_string(path).ok())
                .filter_map(|text| serde_json::from_str::<Value>(&text).ok())
                .collect::<Vec<_>>();
            if observations.len() >= 3 {
                break observations;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    if observations.is_err() {
        core.add_thought("you", "Stop");
        finished(&core).await;
    }
    let observations = observations.expect("owned runners start before the bounded deadline");
    assert!(jobs(&core)
        .iter()
        .filter(|job| job.parent.is_some())
        .any(|job| job
            .result
            .as_deref()
            .is_some_and(|v| v.contains("Editing README"))));
    assert!(matches!(
        card_for(&core, "you"),
        Some(ServerMsg::SendCard {
            state: SendState::Running,
            ..
        })
    ));
    core.add_thought("you", "Stop");
    finished(&core).await;
    for observation in observations {
        for field in ["pid", "child"] {
            let status = Command::new("kill")
                .args(["-0", &observation[field].to_string()])
                .stderr(Stdio::null())
                .status()
                .await
                .unwrap();
            assert!(!status.success(), "{field} process left after Stop");
        }
        let args = observation["argv"].as_array().unwrap();
        assert!(!args
            .iter()
            .any(|arg| arg.as_str().unwrap().contains("put three helpers")));
    }
    assert!(jobs(&core)
        .iter()
        .all(|job| job.result.as_deref() == Some("Stopped")));
    assert!(matches!(
        crate::messages::card_for(&core, "you"),
        Some(ServerMsg::SendCard {
            state: SendState::Stopped,
            ..
        })
    ));
    assert_retained(&core, &repo, &before, true).await;
    assert!(core
        .helpers
        .coding
        .results
        .lock()
        .unwrap()
        .values()
        .all(|r| r.exit == ExitStatus::Stopped));
}

#[test]
fn coding_turns_and_argv() {
    for topic in [
        "fix the parser",
        "build a tool",
        "add a test",
        "work in the repo",
        "readme",
    ] {
        assert!(requested(topic, topic));
    }
    assert!(!requested("the pitch", "put helpers on the pitch"));
    assert_eq!(Settings::default().argv().unwrap(), vec!["builtin-meta"]);
    assert_eq!(
        Settings {
            command: Some(r#"["/tmp/a path/muse", "exec"]"#.into()),
            ..Settings::default()
        }
        .argv()
        .unwrap()[0],
        "/tmp/a path/muse"
    );
}

#[tokio::test]
async fn provider_claims_fail_closed_before_jobs_start() {
    for claim in ["gpt-6", "echo", "unknown", "meta"] {
        let repo = repository().await;
        let mut core = core(&repo, stub(&repo, "change"), true);
        let settings = &mut Arc::get_mut(&mut core).unwrap().helpers.coding;
        settings.test_only = false;
        // A claimed provider/model, even a Meta label, is not proof.
        let mut argv = settings.argv().unwrap();
        argv.extend([
            "--provider".into(),
            claim.into(),
            "--model".into(),
            "muse-spark-1.3".into(),
        ]);
        settings.command = Some(serde_json::to_string(&argv).unwrap());
        assert!(said(&core, "you", "put three helpers on the README"));
        finished(&core).await;
        assert!(core.helpers.coding.results.lock().unwrap().is_empty());
        let lines = trace_lines(&repo);
        let refusal = lines
            .iter()
            .find(|line| line["kind"] == "coding_provider_refused")
            .unwrap();
        assert_eq!(refusal["model"], "unknown");
        assert!(jobs(&core)
            .iter()
            .all(|j| j.status == "failed" && j.started_ms.is_none()));
        assert_eq!(
            git(&repo, &["worktree", "list", "--porcelain"])
                .await
                .unwrap()
                .lines()
                .filter(|l| l.starts_with("worktree "))
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn dirty_private_targets_and_commit_toggle_refused() {
    for mode in ["dirty", "ignored", "private", "commit"] {
        let repo = repository().await;
        if mode == "dirty" {
            std::fs::write(repo.join("README.md"), "dirty").unwrap();
        }
        if mode == "ignored" {
            std::fs::write(repo.join(".git/info/exclude"), "hidden\n").unwrap();
            std::fs::write(repo.join("hidden"), "private").unwrap();
        }
        if mode == "private" {
            std::fs::write(repo.join("journal.jsonl"), "fixture").unwrap();
            git(&repo, &["add", "journal.jsonl"]).await.unwrap();
            git(
                &repo,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.com",
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    "private fixture",
                ],
            )
            .await
            .unwrap();
        }
        let before = source_snapshot(&repo).await;
        let mut core = core(&repo, stub(&repo, "change"), true);
        Arc::get_mut(&mut core).unwrap().helpers.coding.commit = mode == "commit";
        assert!(said(&core, "you", "put three helpers on the README"));
        finished(&core).await;
        assert!(core.helpers.coding.results.lock().unwrap().is_empty());
        assert!(jobs(&core)
            .iter()
            .all(|j| j.status == "failed" && j.started_ms.is_none()));
        assert_eq!(source_snapshot(&repo).await, before);
    }
}

#[test]
fn commit_defaults_off_and_stubs_are_test_only() {
    assert!(!Settings::default().commit);
    assert!(!Settings::default().test_only);
}

#[test]
fn executable_resolution_and_argv_stay_literal() {
    let settings = Settings {
        command: Some(r#"["python3", "a file.py", ";", "$(false)"]"#.into()),
        test_only: true,
        ..Settings::default()
    };
    let runner = provider::resolve(&settings).unwrap();
    assert!(runner.executable.as_ref().unwrap().is_absolute());
    assert_eq!(
        runner.executable.as_ref().unwrap().canonicalize().unwrap(),
        *runner.executable.as_ref().unwrap()
    );
    assert_eq!(runner.args, ["a file.py", ";", "$(false)"]);
    assert_eq!(runner.provider, "test-only");
    assert_eq!(runner.model, "test-only");
    assert_eq!(runner.evidence, "compiled-test-fixture");
}

// These exercise the production adapter with an explicitly compiled test-only
// transport. No socket is opened and no real model request is sent.
fn meta_answer(model: &str, edits: Value) -> Value {
    json!({"model":model,"choices":[{"message":{"content":json!({"edits":edits}).to_string()}}]})
}

#[test]
fn builtin_meta_resolution_is_owned_code_not_a_command_claim() {
    let runner = provider::resolve(&Settings::default()).unwrap();
    assert!(runner.executable.is_none());
    assert!(runner.args.is_empty());
    assert_eq!(runner.provider, "meta");
    assert_eq!(runner.model, "muse-spark-1.3");
    assert_eq!(runner.evidence, "built-in-meta-client");
    let request = provider::request("bounded proposal", &HashMap::new());
    assert_eq!(request["model"], runner.model);
    assert!(request.get("tools").is_none());
    for command in [
        "muse exec",
        "echo",
        "builtin-meta --provider meta",
        "builtin-meta --model other",
    ] {
        assert!(provider::resolve(&Settings {
            command: Some(command.into()),
            ..Settings::default()
        })
        .is_err());
    }
}

#[tokio::test]
async fn builtin_meta_proposals_retain_heads_and_trace_fixed_request() {
    for change in [true, false] {
        let repo = repository().await;
        let before = source_snapshot(&repo).await;
        let mut core = core(&repo, "builtin-meta".into(), true);
        let settings = &mut Arc::get_mut(&mut core).unwrap().helpers.coding;
        settings.test_only = false;
        settings.meta_test_answer = Some(meta_answer(
            "muse-spark-1.3",
            if change {
                json!([{"path":"README.md","content":"# Example\n\nUseful bounded proposal.\n"}])
            } else {
                json!([])
            },
        ));
        assert!(said(&core, "you", "put three helpers on the README"));
        finished(&core).await;
        assert_retained(&core, &repo, &before, change).await;
        assert!(core
            .helpers
            .coding
            .results
            .lock()
            .unwrap()
            .values()
            .all(|r| r.exit == ExitStatus::Completed));
        assert!(jobs(&core).iter().all(|j| j.status == "done"));
        let lines = trace_lines(&repo);
        let requests: Vec<_> = lines
            .iter()
            .filter(|l| l["kind"] == "coding_meta_request")
            .collect();
        assert_eq!(requests.len(), 3);
        for request in requests {
            assert_eq!(request["provider"], "meta");
            assert_eq!(request["model"], "muse-spark-1.3");
            assert_eq!(
                request["endpoint"],
                "https://api.meta.ai/v1/chat/completions"
            );
            assert_eq!(request["evidence"], "built-in-meta-client");
        }
        assert_eq!(
            lines
                .iter()
                .filter(|l| l["kind"] == "coding_test_transport")
                .count(),
            3
        );
        assert_eq!(
            lines
                .iter()
                .filter(|l| l["kind"] == "coding_meta_answer")
                .count(),
            3
        );
    }
}

#[tokio::test]
async fn builtin_meta_rejects_mismatched_response_and_unsafe_proposals() {
    for (model, edits) in [
        ("gpt-6", json!([])),
        ("echo", json!([])),
        ("unknown", json!([])),
        (
            "muse-spark-1.3",
            json!([{"path":"README.md","content":"changed"},{"path":"../escape","content":"bad"}]),
        ),
        (
            "muse-spark-1.3",
            json!([{"path":".git/config","content":"bad"}]),
        ),
        (
            "muse-spark-1.3",
            json!([{"path":"README.md","content":"first"},{"path":"README.md","content":"second"}]),
        ),
    ] {
        let repo = repository().await;
        let before = source_snapshot(&repo).await;
        let mut core = core(&repo, "builtin-meta".into(), true);
        let settings = &mut Arc::get_mut(&mut core).unwrap().helpers.coding;
        settings.test_only = false;
        settings.meta_test_answer = Some(meta_answer(model, edits));
        assert!(said(&core, "you", "put three helpers on the README"));
        finished(&core).await;
        assert_retained(&core, &repo, &before, false).await;
        assert!(core
            .helpers
            .coding
            .results
            .lock()
            .unwrap()
            .values()
            .all(|r| r.exit == ExitStatus::Failed));
        assert!(jobs(&core).iter().all(|j| j.status == "failed"));
        assert!(!trace_lines(&repo)
            .iter()
            .any(|l| l["kind"] == "coding_meta_answer"));
    }
}

#[tokio::test]
async fn builtin_meta_stop_cancels_before_writing() {
    let repo = repository().await;
    let before = source_snapshot(&repo).await;
    let mut core = core(&repo, "builtin-meta".into(), true);
    let settings = &mut Arc::get_mut(&mut core).unwrap().helpers.coding;
    settings.test_only = false;
    settings.meta_test_answer = Some(meta_answer(
        "muse-spark-1.3",
        json!([{"path":"README.md","content":"must not write"}]),
    ));
    settings.meta_test_delay = Duration::from_secs(60);
    assert!(said(&core, "you", "put three helpers on the README"));
    let started = tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            if trace_lines(&repo)
                .iter()
                .filter(|l| l["kind"] == "coding_test_transport")
                .count()
                == 3
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    core.add_thought("you", "Stop");
    finished(&core).await;
    started.expect("test transport starts before the bounded deadline");
    assert_retained(&core, &repo, &before, false).await;
    assert!(core
        .helpers
        .coding
        .results
        .lock()
        .unwrap()
        .values()
        .all(|r| r.exit == ExitStatus::Stopped));
}
