//! Coding helpers retain isolated proposals; the built-in adapter uses only Meta.
use super::*;
use anyhow::{ensure, Context};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
};

#[derive(Default)]
pub(super) struct Settings {
    pub enabled: bool,
    pub repo: Option<PathBuf>,
    pub command: Option<String>,
    pub commit: bool,
    // Server-owned records, never populated from runner output or client paths.
    pub results: Mutex<HashMap<String, ResultRecord>>,
    #[cfg(test)]
    pub test_only: bool,
    #[cfg(test)]
    pub meta_test_answer: Option<Value>,
    #[cfg(test)]
    pub meta_test_delay: Duration,
}
impl Settings {
    pub fn from_env() -> Self {
        Self {
            enabled: std::env::var("HELPERS_RUN").as_deref() == Ok("on"),
            repo: std::env::var_os("HELPERS_REPO").map(PathBuf::from),
            command: std::env::var("HELPERS_CMD").ok(),
            commit: std::env::var("HELPERS_COMMIT").as_deref() == Ok("on"),
            ..Self::default()
        }
    }
    fn argv(&self) -> anyhow::Result<Vec<String>> {
        let value = self.command.as_deref().unwrap_or("builtin-meta");
        let args: Vec<String> = if value.trim_start().starts_with('[') {
            serde_json::from_str(value).context("HELPERS_CMD must be an argv JSON array")?
        } else {
            value.split_whitespace().map(str::to_owned).collect()
        };
        ensure!(!args.is_empty(), "HELPERS_CMD is empty");
        Ok(args)
    }
}

pub(super) fn requested(topic: &str, turn: &str) -> bool {
    crate::words(turn).iter().any(|w| {
        matches!(
            w.as_str(),
            "fix" | "build" | "add" | "implement" | "code" | "coding" | "repo" | "repository"
        )
    }) || topic
        .split_whitespace()
        .any(|w| w == "readme" || w.contains('.') || w.contains('/'))
}

fn slug(topic: &str) -> String {
    let words = topic
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let value = words.chars().take(40).collect::<String>().to_lowercase();
    if value.is_empty() {
        "code".into()
    } else {
        value
    }
}

async fn git(repo: &Path, args: &[&str]) -> anyhow::Result<String> {
    #[cfg(test)]
    tests::GIT_CALLS.lock().unwrap().push((repo.to_owned(), args.iter().map(|s| s.to_string()).collect()));
    let mut command = Command::new("git");
    command.args(args)
        .current_dir(repo)
        .env("GIT_OPTIONAL_LOCKS", "0")
        // The helper's own identity, passed with -c, must beat whatever the host exports.
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .kill_on_drop(true);
    // Fixtures are self-contained: host Git hooks, filters and configuration are outside the test.
    #[cfg(test)]
    command.env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_NOSYSTEM", "1");
    let output = command.output().await.context("Couldn't start git")?;
    // Keep local paths and credentials out of cards and traces.
    ensure!(
        output.status.success(),
        "Git {} failed",
        args.first().unwrap_or(&"operation")
    );
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

async fn cancelled(run: &Run) {
    let notified = run.cancel.notified();
    if !run.stopped.load(Ordering::Relaxed) {
        notified.await;
    }
}

fn title(i: usize) -> String {
    format!("Coding helper {}", i + 1)
}

pub(super) async fn execute(core: &Arc<Core>, run: &Arc<Run>) {
    tokio::select! {
        _ = cancelled(run) => return,
        _ = tokio::time::sleep_until(run.end + Duration::from_millis(crate::messages::LATE_STOP_MS)) => {},
    }
    run.counting.store(false, Ordering::Relaxed);
    if !core.helpers.coding.enabled {
        for i in 0..run.ask.count {
            row_with_outcome(core, run, Some(i), &title(i), "done", Some("Dry run: no process started and no files changed".into()), Some("dry_run"));
        }
        row_with_outcome(
            core,
            run,
            None,
            "Coding helpers",
            "done",
            Some(format!(
                "Dry run: {} helpers would start; set HELPERS_RUN=on",
                run.ask.count
            )),
            Some("dry_run"),
        );
        end_card(
            core,
            run,
            SendState::DryRun,
            "Dry run: coding helpers listed in Work spine",
        );
        return;
    }
    row(core, run, None, "Coding helpers", "preparing", Some("Preparing isolated work".into()));
    end_card(core, run, SendState::Running, "Preparing coding helpers · follow Work");
    let result = prepare(core, run).await;
    let (folder, jobs) = match result {
        Ok(value) => value,
        Err(_) => {
            if !run.stopped.load(Ordering::Relaxed) {
                for i in 0..run.ask.count {
                    row(
                        core,
                        run,
                        Some(i),
                        &title(i),
                        "failed",
                        Some("Couldn’t prepare isolated work".into()),
                    );
                }
                row(
                    core,
                    run,
                    None,
                    "Coding helpers",
                    "failed",
                    Some("Couldn’t prepare isolated work".into()),
                );
                end_card(core, run, SendState::Failed, "Couldn’t prepare isolated work");
            }
            return;
        }
    };
    let answers = futures_util::future::join_all(
        jobs.iter()
            .enumerate()
            .map(|(i, job)| worker(core, run, &folder, i, job)),
    )
    .await;
    if run.stopped.load(Ordering::Relaxed) {
        return;
    }
    let done = answers.iter().filter(|ok| **ok).count();
    let summary = format!(
        "{done}/{} coding helpers done · branches kept locally",
        run.ask.count
    );
    row(
        core,
        run,
        None,
        "Coding helpers",
        if done == run.ask.count {
            "done"
        } else {
            "failed"
        },
        Some(summary.clone()),
    );
    end_card(
        core,
        run,
        if done == run.ask.count {
            SendState::Sent
        } else {
            SendState::Failed
        },
        &summary,
    );
}

mod provider;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ExitStatus {
    NotStarted,
    Running,
    Exited(Option<i32>),
    Completed,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ValidationStatus {
    NotRun,
}

#[derive(Clone, Debug)]
pub(super) struct ResultRecord {
    pub child_id: String,
    pub worktree: PathBuf,
    pub base: String,
    pub branch: String,
    pub exit: ExitStatus,
    pub validation: ValidationStatus,
    runner: provider::Runner,
}

struct Work {
    result_id: String,
    branch: String,
    path: PathBuf,
    brief: PathBuf,
}

async fn prepare(core: &Core, run: &Run) -> anyhow::Result<(PathBuf, Vec<Work>)> {
    let settings = &core.helpers.coding;
    let repo = settings
        .repo
        .as_deref()
        .context("Set HELPERS_REPO to a git repository")?;
    // This lane never commits. An environment toggle alone is not user authority;
    // a future explicit commit action needs its own reviewed request.
    ensure!(
        !settings.commit,
        "HELPERS_COMMIT needs a separate explicit user commit request; keep it off for recording"
    );
    let runner = match provider::resolve(settings) {
        Ok(runner) => runner,
        Err(error) => {
            core.trace.write(|| {
                json!({"kind":"coding_provider_refused", "swarm":run.id,
                "provider":"unknown", "model":"unknown", "evidence":"unverified"})
            });
            return Err(error);
        }
    };
    core.trace.write(|| {
        json!({"kind":"coding_provider", "swarm":run.id,
        "provider":runner.provider, "model":runner.model, "evidence":runner.evidence})
    });
    let root = git(repo, &["rev-parse", "--show-toplevel"]).await?;
    ensure!(
        repo.canonicalize()? == Path::new(&root).canonicalize()?,
        "HELPERS_REPO must be the repository root"
    );
    // Pin once; all worktrees use this base even if the source moves later.
    let base = git(repo, &["rev-parse", "HEAD"]).await?;
    ensure!(
        git(
            repo,
            &[
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--ignored"
            ]
        )
        .await?
        .is_empty(),
        "HELPERS_REPO must be clean, including ignored files"
    );
    let files = git(repo, &["ls-files"]).await?;
    ensure!(
        !files.lines().any(private_target),
        "HELPERS_REPO contains a private recording target"
    );

    ensure!(
        git(repo, &["rev-parse", "HEAD"]).await? == base,
        "HELPERS_REPO changed during preflight"
    );
    let folder = std::env::temp_dir().join(format!("e2a2o-coding-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&folder)?;
    let mut jobs = Vec::new();
    let mut n = 1;
    for i in 0..run.ask.count {
        ensure!(!run.stopped.load(Ordering::Relaxed), "Stopped");
        let branch = loop {
            let branch = format!("helpers/{}-{n}", slug(&run.ask.topic));
            n += 1;
            let branches = git(repo, &["branch", "--list", &branch]).await?;
            if branches.is_empty() {
                break branch;
            }
        };
        let path = folder.join(format!("helper-{}", i + 1));
        git(
            repo,
            &[
                "worktree",
                "add",
                "-b",
                &branch,
                path.to_str().context("Invalid temporary path")?,
                &base,
            ],
        )
        .await?;
        let brief = folder.join(format!("brief-{}.txt", i + 1));
        let focus = [
            "correctness and missing information",
            "clarity and useful examples",
            "structure and consistency",
        ][i % 3];
        std::fs::write(&brief, format!(
            "Coding helper {} of {}. Task: {}.\nMake a separate bounded proposal focused on {focus}. Inspect this repository and make only a small proposed change for the task. Leave it uncommitted for review. Work only in this worktree. Do not commit, push, merge, or open a PR. Do not include personal paths, private data, secrets, .env files, journals, or personal quotes. Use only the verified Meta provider and model. Do not invoke other agents or providers. Do not run git add or git commit.\n",
            i + 1, run.ask.count, run.ask.topic))?;
        let result_id = uuid::Uuid::new_v4().to_string();
        settings.results.lock().unwrap().insert(
            result_id.clone(),
            ResultRecord {
                child_id: format!("{}:{i}", parent(run)),
                worktree: path.clone(),
                base: base.clone(),
                branch: branch.clone(),
                exit: ExitStatus::NotStarted,
                validation: ValidationStatus::NotRun,
                runner: runner.clone(),
            },
        );
        jobs.push(Work {
            result_id,
            branch,
            path,
            brief,
        });
    }
    Ok((folder, jobs))
}

fn private_target(path: &str) -> bool {
    path.split('/').any(|part| {
        let part = part.to_ascii_lowercase();
        part == ".env"
            || part.starts_with(".env.")
            || part == "private"
            || part.starts_with("journal.")
            || part == "journal"
            || part == "journals"
            || part.starts_with("credentials")
            || part.ends_with(".pem")
            || part.ends_with(".key")
    })
}

fn set_exit(core: &Core, job: &Work, exit: ExitStatus) {
    if let Some(record) = core
        .helpers
        .coding
        .results
        .lock()
        .unwrap()
        .get_mut(&job.result_id)
    {
        record.exit = exit;
    }
}

// Keep access to coding settings inside helpers; callers receive no runner or local path.
impl super::Runtime {
    #[cfg(test)]
    pub(crate) fn register_test_result(&self, child: &str, record: crate::helper_result::Record) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.coding.results.lock().unwrap().insert(id.clone(), ResultRecord {
            child_id: child.into(), worktree: record.worktree, base: record.base, branch: "fixture".into(),
            exit: match record.status.as_str() { "failed" => ExitStatus::Exited(Some(7)), "stopped" => ExitStatus::Stopped, _ => ExitStatus::Completed },
            validation: ValidationStatus::NotRun,
            runner: provider::resolve(&Settings::default()).unwrap(),
        });
        id
    }

    pub(crate) fn result_id(&self, child: &str) -> Option<String> {
        self.coding.results.lock().unwrap().iter()
            .find(|(_, record)| record.child_id == child).map(|(id, _)| id.clone())
    }

    pub(crate) fn result_record(&self, id: &str) -> Option<crate::helper_result::Record> {
        let records = self.coding.results.lock().unwrap();
        let record = records.get(id)?;
        Some(crate::helper_result::Record {
            worktree: record.worktree.clone(), base: record.base.clone(),
            status: match record.exit {
                ExitStatus::NotStarted => "created",
                ExitStatus::Running => "running",
                ExitStatus::Exited(Some(0)) | ExitStatus::Completed => "completed",
                ExitStatus::Stopped => "stopped",
                _ => "failed",
            }.into(),
            exit_code: if let ExitStatus::Exited(code) = record.exit { code } else { None },
            validation: match record.validation { ValidationStatus::NotRun => "not_run" }.into(),
        })
    }
}

// The built-in adapter calls start only after context is ready, at the actual
// provider invocation. Mirror that event in its result record, just as spawn does.
struct Execution<'a> { inner: super::Execution<'a>, job: &'a Work }
impl<'a> Execution<'a> {
    fn new(core: &'a Core, run: &'a Run, i: usize, provider: &'a str, model: &'a str, identity: Value, job: &'a Work) -> Self {
        Self { inner: super::Execution::new(core, run, i, provider, model, identity), job }
    }
    fn start(&self) {
        set_exit(self.inner.core, self.job, ExitStatus::Running);
        self.inner.start();
    }
    fn completed(&self, at: u64) { self.inner.completed(at); }
    fn end(&self, at: u64, outcome: &str) { self.inner.end(at, outcome); }
}

async fn worker(core: &Core, run: &Run, _folder: &Path, i: usize, job: &Work) -> bool {
    if run.stopped.load(Ordering::Relaxed) {
        set_exit(core, job, ExitStatus::Stopped);
        return false;
    }
    row(core, run, Some(i), &title(i), "queued", None);
    let result = work(core, run, i, job).await;
    if run.stopped.load(Ordering::Relaxed) {
        set_exit(core, job, ExitStatus::Stopped);
        if !run.finished.lock().unwrap().contains(&i) {
            row(core, run, Some(i), &title(i), "stopped", Some("Stopped".into()));
        }
        return false;
    }
    if result.is_err() {
        let mut records = core.helpers.coding.results.lock().unwrap();
        if let Some(record) = records.get_mut(&job.result_id) {
            if matches!(record.exit, ExitStatus::NotStarted | ExitStatus::Running) {
                record.exit = ExitStatus::Failed;
            }
        }
    }
    row_with_outcome(core, run, Some(i), &title(i),
        if result.is_ok() { "done" } else { "failed" },
        Some(result.as_ref().map(|r| r.summary.clone()).unwrap_or_else(|_| "Coding helper failed · any local changes kept".into())),
        result.as_ref().ok().map(|r| r.outcome));
    result.is_ok()
}

struct Completion { summary: String, outcome: &'static str }

async fn work(core: &Core, run: &Run, i: usize, job: &Work) -> anyhow::Result<Completion> {
    #[cfg(test)]
    if let Some(gate) = &core.helpers.spawn_gate {
        core.helpers.spawn_waiting.fetch_add(1, Ordering::Relaxed);
        tokio::select! {
            _ = cancelled(run) => anyhow::bail!("Stopped"),
            permit = gate.acquire() => { permit.unwrap().forget(); },
        }
    }
    let runner = core.helpers.coding.results.lock().unwrap().get(&job.result_id)
        .context("Unknown coding result identity")?.runner.clone();
    if runner.executable.is_none() {
        let execution = Execution::new(core, run, i, runner.provider, runner.model, json!({"result":job.result_id}), job);
        let result = provider::work(core, run, job, &execution).await;
        let at = crate::now_ms();
        execution.completed(at);
        if run.stopped.load(Ordering::Relaxed) {
            set_exit(core, job, ExitStatus::Stopped);
            execution.end(at, "stopped");
            anyhow::bail!("Stopped");
        }
        if let Err(error) = result {
            set_exit(core, job, ExitStatus::Failed);
            execution.end(at, "failed");
            return Err(error);
        }
        set_exit(core, job, ExitStatus::Completed);
        row(core, run, Some(i), &title(i), "preparing", Some("Checking local outcome".into()));
        let changed = crate::helper_result::has_changes(&job.path, &core.helpers.result_record(&job.result_id).context("Unknown result")?.base).await?;
        let outcome = if changed { "done" } else { "no_change" };
        execution.end(at, outcome);
        return Ok(Completion { summary: if changed {
            format!("{} · proposal retained · validation not run", job.branch)
        } else { "No changes · proposal retained · validation not run".into() }, outcome });
    }
    let mut command = Command::new(runner.executable.as_ref().unwrap());
    command.args(&runner.args);
    if !runner.args.iter().any(|a| a == "--json") { command.arg("--json"); }
    let mut child = command.arg("--prompt-file").arg(&job.brief).current_dir(&job.path)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .kill_on_drop(true).spawn().context("Couldn't start HELPERS_CMD")?;
    set_exit(core, job, ExitStatus::Running);
    let execution = Execution::new(core, run, i, runner.provider, runner.model, json!({"pid":child.id().unwrap()}), job);
    execution.start();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let status: anyhow::Result<std::process::ExitStatus> = loop {
        tokio::select! {
            biased;
            _ = cancelled(run) => { stop_child(&mut child).await; break Err(anyhow::anyhow!("Stopped")); },
            line = lines.next_line() => match line {
                Ok(Some(line)) => if let Some(progress) = progress(&line) {
                    row(core, run, Some(i), &title(i), "running", Some(progress.into()));
                },
                Ok(None) => break tokio::select! {
                    biased;
                    _ = cancelled(run) => { stop_child(&mut child).await; Err(anyhow::anyhow!("Stopped")) },
                    status = child.wait() => status.map_err(Into::into),
                },
                Err(error) => { stop_child(&mut child).await; break Err(error.into()); },
            }
        }
    };
    let at = crate::now_ms();
    execution.completed(at);
    row(core, run, Some(i), &title(i), "preparing", Some("Checking local outcome".into()));
    let outcome = if run.stopped.load(Ordering::Relaxed) { "stopped" }
        else if status.as_ref().is_ok_and(|s| s.success()) { "done" } else { "failed" };
    if outcome != "done" { execution.end(at, outcome); }
    let status = status?;
    set_exit(core, job, ExitStatus::Exited(status.code()));
    ensure!(!run.stopped.load(Ordering::Relaxed), "Stopped");
    ensure!(status.success(), "HELPERS_CMD exited unsuccessfully; dirty worktree retained");
    // Inspect the proposal without staging or committing it, even after success.
    let changed = crate::helper_result::has_changes(&job.path, &core.helpers.result_record(&job.result_id).context("Unknown result")?.base).await?;
    let outcome = if changed { "done" } else { "no_change" };
    execution.end(at, outcome);
    Ok(Completion { summary: if changed {
        format!("{} · proposal retained · validation not run", job.branch)
    } else { "No changes · proposal retained · validation not run".into() }, outcome })
}

fn progress(line: &str) -> Option<&'static str> {
    let event: Value = serde_json::from_str(line).ok()?;
    match event.get("type")?.as_str()? {
        "progress" => Some("Working on brief"),
        "done" => Some("Finishing execution"),
        _ => None,
    }
}


/// Only the runner PID and descendants discovered beneath that PID belong to us.
async fn stop_child(child: &mut Child) {
    if let Some(pid) = child.id() {
        if let Ok(output) = Command::new("ps")
            .args(["-axo", "pid=,ppid="])
            .output()
            .await
        {
            let pairs = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let mut fields = line.split_whitespace();
                    Some((
                        fields.next()?.parse::<u32>().ok()?,
                        fields.next()?.parse::<u32>().ok()?,
                    ))
                })
                .collect::<Vec<_>>();
            let mut owned = vec![pid];
            let mut at = 0;
            while at < owned.len() {
                let parent = owned[at];
                for (pid, ppid) in &pairs {
                    if *ppid == parent && !owned.contains(pid) {
                        owned.push(*pid);
                    }
                }
                at += 1;
            }
            for pid in owned[1..].iter().rev() {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status()
                    .await;
            }
            // Let the runner reap its children before reaping the runner itself.
            tokio::time::sleep(Duration::from_millis(50)).await;
            for pid in owned[1..].iter().rev() {
                let _ = Command::new("kill")
                    .args(["-KILL", &pid.to_string()])
                    .stderr(Stdio::null())
                    .status()
                    .await;
            }
        }
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "../helper_result/coding_tests.rs"]
mod result_lifecycle_tests;
