use super::*;

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

fn stub(repo: &Path, slow: bool) -> String {
    // Executable and observations stay outside the repository and helper commits.
    let script = repo.with_extension("py");
    std::fs::write(&script, format!(r#"import json, os, pathlib, subprocess, sys, time
brief = pathlib.Path(sys.argv[sys.argv.index('--prompt-file') + 1])
assert '--json' in sys.argv
assert brief.read_text().startswith('Coding helper')
child = subprocess.Popen(['python3', '-c', 'import time; time.sleep(60)']) if {slow} else None
brief.with_suffix('.observed.json').write_text(json.dumps({{'pid': os.getpid(), 'child': child.pid if child else None, 'argv': sys.argv, 'cwd': os.getcwd()}}))
print(json.dumps({{'type': 'progress', 'text': 'Editing README'}}), flush=True)
if child:
    child.wait()
    sys.exit(0)
time.sleep(0.3)
with open('README.md', 'a') as f: f.write('\nUseful helper update.\n')
print(json.dumps({{'type': 'done', 'text': 'README updated'}}), flush=True)
"#, slow = if slow { "True" } else { "False" })).unwrap();
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
    };
    core
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
    tokio::time::timeout(Duration::from_secs(90), async {
        while core.helpers.state.lock().unwrap().active.is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("helpers finish and release active run");
}

async fn acceptance(command: Option<String>) {
    let repo = repository().await;
    let base = git(&repo, &["rev-parse", "HEAD"]).await.unwrap();
    let echo = command.is_some();
    let command = command.unwrap_or_else(|| stub(&repo, false));
    let mut core = core(&repo, command, true);
    let spawn_gate = Arc::new(tokio::sync::Semaphore::new(0));
    Arc::get_mut(&mut core).unwrap().helpers.spawn_gate = Some(spawn_gate.clone());
    let trace_dir = repo.with_extension("trace");
    std::fs::create_dir(&trace_dir).unwrap();
    Arc::get_mut(&mut core).unwrap().trace = crate::trace::Trace::to(&trace_dir);
    let start = Instant::now();
    assert!(said(&core, "you", "put three helpers on the README"));
    let initial = jobs(&core);
    assert_eq!(initial.iter().filter(|job| job.parent.is_some()).count(), 3);
    assert!(initial.iter().all(|job| job.started_ms.is_none() && job.status != "running"));
    let mut updates = core.updates.subscribe();
    // All worktrees are prepared and each worker is blocked immediately before OS spawn.
    tokio::time::timeout(Duration::from_secs(90), async {
        while core.helpers.spawn_waiting.load(Ordering::Relaxed) < 3 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    assert!(jobs(&core).iter().all(|job| job.status != "running" && job.started_ms.is_none()));
    spawn_gate.add_permits(3);
    finished(&core).await;
    let mut events = 0;
    while let Ok(update) = updates.try_recv() {
        if let ServerMsg::Job { job, .. } = update.message {
            if job.parent.is_some()
                && job
                    .result
                    .as_deref()
                    .is_some_and(|v| v == "Working on brief" || v == "Finishing execution")
            {
                events += 1;
            }
        }
    }
    assert!(events >= 3, "whitelisted progress reached helper rows");
    let children = jobs(&core)
        .into_iter()
        .filter(|job| job.parent.is_some())
        .collect::<Vec<_>>();
    assert_eq!(children.len(), 3);
    let receipts: Vec<Value> = std::fs::read_to_string(trace_dir.join("trace.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).filter(|r: &Value| r["kind"] == "helpers_execution").collect();
    assert_eq!(receipts.len(), 6);
    for start in receipts.iter().filter(|r| r["phase"] == "start") {
        assert!(start["pid"].as_u64().is_some());
        assert_eq!(start["provider"], "local-command");
        let end = receipts.iter().find(|r| r["phase"] == "end" && r["pid"] == start["pid"]).unwrap();
        let child = children.iter().find(|job| job.id == start["child_id"].as_str().unwrap()).unwrap();
        assert_eq!(child.started_ms, start["at"].as_u64());
        assert_eq!(child.ended_ms, end["at"].as_u64());
    }
    for job in &children {
        assert_eq!(job.status, "done", "{:?}", job.result);
        assert!(job.started_ms.is_some());
        let result = job.result.as_ref().unwrap();
        assert!(
            result.contains(if echo {
                "0 files changed · +0 -0"
            } else {
                "1 files changed · +2 -0"
            }),
            "{result}"
        );
        println!(
            "{}; {:.2} execution seconds",
            result,
            (crate::now_ms() - job.started_ms.unwrap()) as f64 / 1000.0
        );
    }
    let branches = git(
        &repo,
        &["branch", "--list", "helpers/*", "--format=%(refname:short)"],
    )
    .await
    .unwrap();
    assert_eq!(branches.lines().count(), 3);
    for branch in branches.lines() {
        assert_eq!(
            git(&repo, &["rev-parse", &format!("{branch}^")])
                .await
                .unwrap(),
            base
        );
        assert_eq!(
            git(
                &repo,
                &["rev-list", "--count", &format!("{base}..{branch}")]
            )
            .await
            .unwrap(),
            "1"
        );
        // Both identities must stay local to the helper, even under a host's
        // exported GIT_AUTHOR_* and GIT_COMMITTER_* environment variables.
        for format in ["--format=%an <%ae>", "--format=%cn <%ce>"] {
            assert_eq!(
                git(&repo, &["log", "-1", format, branch])
                    .await
                    .unwrap(),
                "E2A2O Helper <helper@example.com>"
            );
        }
    }
    assert_eq!(git(&repo, &["rev-parse", "HEAD"]).await.unwrap(), base);
    assert!(git(&repo, &["status", "--porcelain"])
        .await
        .unwrap()
        .is_empty());
    println!(
        "{}: 3 rows, 3 branches, 3 commits, {:.2} total seconds; source HEAD unchanged",
        if echo { "muse echo" } else { "stub" },
        start.elapsed().as_secs_f64()
    );
}

#[tokio::test]
async fn stub_command_three_worktrees_commits_and_json_rows() {
    acceptance(None).await;
}

/// Opt-in real CLI acceptance, no provider allowance or API key required.
#[tokio::test]
#[ignore]
async fn real_muse_echo_three_helpers() {
    acceptance(Some("muse exec --provider echo --no-session-log".into())).await;
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
    let core = core(&repo, stub(&repo, true), true);
    assert!(said(&core, "you", "put three helpers on the README"));
    let observations = tokio::time::timeout(Duration::from_secs(90), async {
        loop {
            let paths = git(&repo, &["worktree", "list", "--porcelain"])
                .await
                .unwrap();
            let observations = paths
                .lines()
                .filter_map(|line| line.strip_prefix("worktree "))
                .filter_map(|path| Path::new(path).parent().map(Path::to_owned))
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
    .await
    .unwrap();
    assert!(jobs(&core)
        .iter()
        .filter(|job| job.parent.is_some())
        .any(|job| job
            .result
            .as_deref()
            .is_some_and(|v| v.contains("Working on brief"))));
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
        .all(|job| job.status == "stopped" && job.result.as_deref() == Some("Stopped")));
    assert!(matches!(
        crate::messages::card_for(&core, "you"),
        Some(ServerMsg::SendCard {
            state: SendState::Stopped,
            ..
        })
    ));
    println!("Stop: all 3 runners and their child PIDs exited; all rows stopped");
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
    assert_eq!(Settings::default().argv().unwrap(), vec!["muse", "exec", "--provider", "meta", "--model", "muse-spark-1.3"]);
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
async fn mixed_outcomes_and_private_progress_stay_truthful() {
    let repo = repository().await;
    let script = r#"import json, pathlib, sys, time
print(json.dumps({'type': 'progress', 'text': 'PRIVATE_SENTINEL', 'path': '/hidden/worktree', 'prompt': 'PRIVATE_SENTINEL'}), flush=True)
time.sleep(0.2)
n = int(pathlib.Path.cwd().name.split('-')[-1])
if n == 2: sys.exit(7)
if n == 1:
    with open('README.md', 'a') as f: f.write('\nA useful change.\n')
"#;
    let command = serde_json::to_string(&vec!["python3", "-c", script]).unwrap();
    let core = core(&repo, command, true);
    assert!(said(&core, "you", "put three helpers on the README"));
    let mut updates = core.updates.subscribe();
    finished(&core).await;
    let rows = jobs(&core);
    let parent = rows.iter().find(|j| j.parent.is_none()).unwrap();
    assert_eq!(parent.status, "failed");
    assert_eq!(parent.outcome.as_deref(), Some("partial"));
    assert_eq!(rows.iter().filter(|j| j.parent.is_some() && j.status == "failed").count(), 1);
    assert_eq!(rows.iter().filter(|j| j.outcome.as_deref() == Some("no_change")).count(), 1);
    while let Ok(update) = updates.try_recv() {
        if let ServerMsg::Job { job, .. } = update.message {
            let wire = serde_json::to_string(&job).unwrap();
            assert!(!wire.contains("PRIVATE_SENTINEL") && !wire.contains("/hidden/worktree"));
        }
    }
}

#[tokio::test]
async fn failed_spawn_has_no_execution_time() {
    let repo = repository().await;
    let core = core(&repo, "does-not-exist".into(), true);
    assert!(said(&core, "you", "put three helpers on the README"));
    finished(&core).await;
    for row in jobs(&core).iter().filter(|j| j.parent.is_some()) {
        assert_eq!(row.status, "failed");
        assert!(row.started_ms.is_none() && row.ended_ms.is_none());
    }
}
