//! Coding helpers use isolated worktrees and local child processes, never a model API.
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
}
impl Settings {
    pub fn from_env() -> Self {
        Self {
            enabled: std::env::var("HELPERS_RUN").as_deref() == Ok("on"),
            repo: std::env::var_os("HELPERS_REPO").map(PathBuf::from),
            command: std::env::var("HELPERS_CMD").ok(),
        }
    }
    fn argv(&self) -> anyhow::Result<Vec<String>> {
        let value = self.command.as_deref().unwrap_or("muse exec --provider meta --model muse-spark-1.3");
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
    let mut command = Command::new("git");
    command.args(args)
        .current_dir(repo)
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

struct Work {
    path: PathBuf,
    brief: PathBuf,
}

async fn prepare(core: &Core, run: &Run) -> anyhow::Result<(PathBuf, Vec<Work>)> {
    let settings = &core.helpers.coding;
    let repo = settings
        .repo
        .as_deref()
        .context("Set HELPERS_REPO to a git repository")?;
    settings.argv()?;
    // Pin once: every brief starts at the same HEAD even if the source moves later.
    let base = git(repo, &["rev-parse", "HEAD"]).await?;
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
            "Coding helper {} of {}. Task: {}.\nFocus this independent implementation on {focus}. Inspect this repository and make a useful, small change for the task. Work only in this worktree. Do not commit, push, merge, or open a PR. Do not include personal paths, private data, secrets, .env files, journals, or personal quotes. Do not invoke other agents or providers.\n",
            i + 1, run.ask.count, run.ask.topic))?;
        jobs.push(Work {
            path,
            brief,
        });
    }
    Ok((folder, jobs))
}

async fn worker(core: &Core, run: &Run, _folder: &Path, i: usize, job: &Work) -> bool {
    if run.stopped.load(Ordering::Relaxed) {
        return false;
    }
    row(core, run, Some(i), &title(i), "queued", None);
    let result = work(core, run, i, job).await;
    if run.stopped.load(Ordering::Relaxed) {
        if !run.finished.lock().unwrap().contains(&i) {
            row(core, run, Some(i), &title(i), "stopped", Some("Stopped".into()));
        }
        return false;
    }
    row_with_outcome(
        core, run, Some(i), &title(i),
        if result.is_ok() { "done" } else { "failed" },
        Some(result.as_ref().map(|r| r.summary.clone()).unwrap_or_else(|_| "Coding helper failed · any local changes kept".into())),
        result.as_ref().ok().map(|r| r.outcome),
    );
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
    let argv = core.helpers.coding.argv()?;
    let mut command = Command::new(&argv[0]);
    command.args(&argv[1..]);
    if !argv.iter().any(|a| a == "--json") {
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
    // Spawn succeeded: only now can this child be running. Never expose argv or event text.
    let selected = |flag: &str| argv.windows(2).find(|pair| pair[0] == flag).map(|pair| pair[1].as_str())
        .or_else(|| argv.iter().find_map(|arg| arg.strip_prefix(&format!("{flag}="))));
    let provider = selected("--provider").unwrap_or("local-command");
    let model = selected("--model").unwrap_or("unspecified");
    let execution = Execution::new(core, run, i, provider, model, json!({"pid":child.id().unwrap()}));
    execution.start();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let status: anyhow::Result<std::process::ExitStatus> = loop {
        tokio::select! {
            biased;
            _ = cancelled(run) => {
                stop_child(&mut child).await;
                break Err(anyhow::anyhow!("Stopped"));
            },
            line = lines.next_line() => match line {
                Ok(Some(line)) => if let Some(progress) = progress(&line) {
                    row(core, run, Some(i), &title(i), "running", Some(progress.into()));
                },
                Ok(None) => break tokio::select! {
                    biased;
                    _ = cancelled(run) => { stop_child(&mut child).await; Err(anyhow::anyhow!("Stopped")) },
                    status = child.wait() => status.map_err(Into::into),
                },
                Err(error) => {
                    stop_child(&mut child).await;
                    break Err(error.into());
                },
            }
        }
    };
    let reaped_at = crate::now_ms();
    // Postprocessing is preparation, never running time; retain the actual reap time on replay.
    execution.completed(reaped_at);
    row(core, run, Some(i), &title(i), "preparing", Some("Checking local outcome".into()));
    let outcome = if run.stopped.load(Ordering::Relaxed) { "stopped" }
        else if status.as_ref().is_ok_and(|s| s.success()) { "done" } else { "failed" };
    if outcome != "done" { execution.end(reaped_at, outcome); }
    let status = status?;
    ensure!(!run.stopped.load(Ordering::Relaxed), "Stopped");
    ensure!(status.success(), "HELPERS_CMD exited unsuccessfully; local changes kept");
    git(&job.path, &["add", "--all"]).await?;
    let stats = git(&job.path, &["diff", "--cached", "--numstat"]).await?;
    let (mut files, mut added, mut removed) = (0, 0_u64, 0_u64);
    for line in stats.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() >= 3 {
            files += 1;
            added += fields[0].parse::<u64>().unwrap_or(0);
            removed += fields[1].parse::<u64>().unwrap_or(0);
        }
    }
    ensure!(!run.stopped.load(Ordering::Relaxed), "Stopped");
    if files == 0 {
        execution.end(reaped_at, "no_change");
        return Ok(Completion { summary: "No changes · 0 files changed · +0 -0".into(), outcome: "no_change" });
    }
    git(
        &job.path,
        &[
            "-c",
            "user.name=E2A2O Helper",
            "-c",
            "user.email=helper@example.com",
            "commit",
            "--allow-empty",
            "--no-gpg-sign",
            "-m",
            "Implement coding helper brief",
        ],
    )
    .await?;
    execution.end(reaped_at, "done");
    Ok(Completion { summary: format!("{files} files changed · +{added} -{removed}"), outcome: "done" })
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
