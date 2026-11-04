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
    tests::GIT_CALLS.lock().unwrap().push((
        repo.to_owned(),
        args.iter().map(|s| s.to_string()).collect(),
    ));
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_OPTIONAL_LOCKS", "0")
        // The helper's own identity, passed with -c, must beat whatever the host exports.
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .kill_on_drop(true)
        .output()
        .await
        .context("Couldn't start git")?;
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
            row(core, run, Some(i), &title(i), "done", Some(format!(
                "Dry run: would create helpers/{}-{} from HELPERS_REPO HEAD and run HELPERS_CMD for brief {}: {}",
                slug(&run.ask.topic), i + 1, i + 1, run.ask.topic)));
        }
        row(
            core,
            run,
            None,
            "Coding helpers",
            "done",
            Some(format!(
                "Dry run: {} helpers would start; set HELPERS_RUN=on",
                run.ask.count
            )),
        );
        end_card(
            core,
            run,
            SendState::DryRun,
            "Dry run: coding helpers listed in Work spine",
        );
        return;
    }
    end_card(core, run, SendState::Running, "Coding helpers running");
    let result = prepare(core, run).await;
    let (folder, jobs) = match result {
        Ok(value) => value,
        Err(error) => {
            if !run.stopped.load(Ordering::Relaxed) {
                for i in 0..run.ask.count {
                    row(
                        core,
                        run,
                        Some(i),
                        &title(i),
                        "failed",
                        Some(error.to_string()),
                    );
                }
                row(
                    core,
                    run,
                    None,
                    "Coding helpers",
                    "failed",
                    Some(error.to_string()),
                );
                end_card(core, run, SendState::Failed, &error.to_string());
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
        let result_id = format!("{}:{i}", parent(run));
        settings.results.lock().unwrap().insert(
            result_id.clone(),
            ResultRecord {
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

async fn worker(core: &Core, run: &Run, _folder: &Path, i: usize, job: &Work) -> bool {
    if run.stopped.load(Ordering::Relaxed) {
        set_exit(core, job, ExitStatus::Stopped);
        return false;
    }
    run.started.lock().unwrap().insert(i, crate::now_ms());
    row(
        core,
        run,
        Some(i),
        &title(i),
        "running",
        Some(format!("{} · starting", job.branch)),
    );
    let result = work(core, run, i, job).await;
    if run.stopped.load(Ordering::Relaxed) {
        set_exit(core, job, ExitStatus::Stopped);
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
    row(
        core,
        run,
        Some(i),
        &title(i),
        if result.is_ok() { "done" } else { "failed" },
        Some(
            result
                .as_ref()
                .cloned()
                .unwrap_or_else(|e| format!("{} · {e}", job.branch)),
        ),
    );
    result.is_ok()
}

async fn work(core: &Core, run: &Run, i: usize, job: &Work) -> anyhow::Result<String> {
    let runner = core
        .helpers
        .coding
        .results
        .lock()
        .unwrap()
        .get(&job.result_id)
        .context("Unknown coding result identity")?
        .runner
        .clone();
    if runner.executable.is_none() {
        set_exit(core, job, ExitStatus::Running);
        provider::work(core, run, job).await?;
        set_exit(core, job, ExitStatus::Completed);
        return Ok(format!(
            "{} · proposal retained · validation not run",
            job.branch
        ));
    }
    let mut command = Command::new(runner.executable.as_ref().unwrap());
    command.args(&runner.args);
    if !runner.args.iter().any(|a| a == "--json") {
        command.arg("--json");
    }
    let mut child = command
        .arg("--prompt-file")
        .arg(&job.brief)
        .current_dir(&job.path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("Couldn't start HELPERS_CMD")?;
    set_exit(core, job, ExitStatus::Running);
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let status = loop {
        tokio::select! {
            biased;
            _ = cancelled(run) => { stop_child(&mut child).await; return Err(anyhow::anyhow!("Stopped")); },
            line = lines.next_line() => match line {
                Err(_) => { stop_child(&mut child).await; return Err(anyhow::anyhow!("Runner output unreadable")); },
                Ok(line) => match line {
                Some(line) => if serde_json::from_str::<Value>(&line).is_ok() {
                    row(core, run, Some(i), &title(i), "running", Some(line));
                },
                None => break tokio::select! {
                    biased;
                    _ = cancelled(run) => { stop_child(&mut child).await; return Err(anyhow::anyhow!("Stopped")); },
                    status = child.wait() => status?,
                },
                }
            }
        }
    };
    set_exit(core, job, ExitStatus::Exited(status.code()));
    ensure!(!run.stopped.load(Ordering::Relaxed), "Stopped");
    ensure!(
        status.success(),
        "HELPERS_CMD exited unsuccessfully; dirty worktree retained"
    );
    Ok(format!(
        "{} · proposal retained · validation not run",
        job.branch
    ))
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
