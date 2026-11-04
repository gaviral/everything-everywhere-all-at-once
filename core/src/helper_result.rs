//! Read-only inspection of a server-owned coding proposal. No client path is used.
use crate::{Access, Core, Link};
use anyhow::{ensure, Context};
use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tokio::{io::AsyncReadExt, process::Command};

const MAX_FILES: usize = 32;
const MAX_FILE: usize = 32 * 1024;
const MAX_BYTES: usize = 128 * 1024;
const MAX_SCAN: usize = 1024 * 1024;

pub(crate) struct Record {
    pub worktree: PathBuf,
    pub base: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub validation: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    result_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ResultView {
    base: String,
    status: String,
    exit_code: Option<i32>,
    validation: String,
    no_change: bool,
    truncated: bool,
    files: Vec<FileView>,
}
#[derive(Debug, Serialize)]
struct FileView {
    path: String,
    additions: usize,
    deletions: usize,
    binary: bool,
    truncated: bool,
    withheld: bool,
    diff: String,
}

pub(crate) async fn read(
    State(core): State<Arc<Core>>,
    ConnectInfo(link): ConnectInfo<Link>,
    Extension(access): Extension<Access>,
    Json(request): Json<Request>,
) -> Result<Json<ResultView>, StatusCode> {
    // The existing origin/room middleware authenticates access; only the local
    // host connection may inspect coding output, including in a shared room.
    if access != Access::Map || !link.here() {
        return Err(StatusCode::FORBIDDEN);
    }
    let record = core
        .helpers
        .result_record(&request.result_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    inspect(record)
        .await
        .map(Json)
        .map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)
}

// Bound process output before collecting it; Git never stages, updates the index,
// invokes an external diff/textconv, or writes a commit during inspection.
async fn git(root: &Path, args: &[&str], limit: usize) -> anyhow::Result<(Vec<u8>, bool)> {
    let mut child = Command::new("git")
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut bytes = Vec::new();
    child
        .stdout
        .take()
        .context("Missing git output")?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await?;
    let truncated = bytes.len() > limit;
    if truncated {
        child.start_kill()?;
    }
    let status = child.wait().await?;
    ensure!(
        truncated || status.success(),
        "Result inspection unavailable"
    );
    bytes.truncate(limit);
    Ok((bytes, truncated))
}

async fn paths(root: &Path, base: &str) -> anyhow::Result<(Vec<(String, bool)>, bool)> {
    let (tracked, a) = git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--name-only",
            "-z",
            base,
            "--",
        ],
        MAX_SCAN,
    )
    .await?;
    let (new, b) = git(
        root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
        MAX_SCAN,
    )
    .await?;
    let mut paths = Vec::new();
    for (bytes, untracked) in [(&tracked, false), (&new, true)] {
        // split_terminator is intentional: a cut-off final name is never opened.
        for path in bytes
            .split_inclusive(|b| *b == 0)
            .filter(|p| p.last() == Some(&0))
        {
            paths.push((
                String::from_utf8_lossy(&path[..path.len() - 1]).into_owned(),
                untracked,
            ));
        }
    }
    paths.sort();
    paths.dedup_by(|a, b| a.0 == b.0);
    Ok((paths, a || b))
}

pub(crate) async fn has_changes(root: &Path, base: &str) -> anyhow::Result<bool> {
    let (paths, truncated) = paths(root, base).await?;
    Ok(truncated || !paths.is_empty())
}

fn private(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|p| !matches!(p, Component::Normal(_)))
        || path.split(['/', '\\']).any(|p| {
            let p = p.to_ascii_lowercase();
            p == ".git"
                || p == ".env"
                || p.starts_with(".env.")
                || p == "private"
                || p == "journal"
                || p == "journals"
                || p.starts_with("journal.")
                || p.starts_with("credentials")
                || p.ends_with(".pem")
                || p.ends_with(".key")
        })
}

fn redact(text: &str, root: &Path) -> String {
    let text = text.replace(root.to_string_lossy().as_ref(), "[worktree]");
    // Absolute personal/runtime paths in source text are never returned. Keep
    // surrounding diff syntax and newlines while removing the whole path token.
    text.split_inclusive(char::is_whitespace)
        .map(|token| {
            if [
                concat!("/", "Users", "/"),
                "/home/",
                "/private/",
                "/tmp/",
                "/var/",
                "/Volumes/",
                "C:\\Users\\",
            ]
            .iter()
            .any(|p| token.contains(p))
            {
                format!(
                    "[private path]{}",
                    token
                        .chars()
                        .rev()
                        .take_while(|c| c.is_whitespace())
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect::<String>()
                )
            } else {
                token.to_string()
            }
        })
        .collect()
}

pub(crate) async fn inspect(record: Record) -> anyhow::Result<ResultView> {
    ensure!(
        record.base.len() == 40 && record.base.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid pinned base"
    );
    let root = record.worktree.canonicalize()?;
    let (paths, scan_cut) = paths(&root, &record.base).await?;
    let mut view = ResultView {
        base: record.base,
        status: record.status,
        exit_code: record.exit_code,
        validation: record.validation,
        no_change: paths.is_empty() && !scan_cut,
        truncated: scan_cut || paths.len() > MAX_FILES,
        files: Vec::new(),
    };
    let mut remaining = MAX_BYTES;
    for (path, untracked) in paths.into_iter().take(MAX_FILES) {
        if remaining == 0 {
            view.truncated = true;
            break;
        }
        let target = root.join(&path);
        let metadata = std::fs::symlink_metadata(&target).ok();
        let unsafe_file = private(&path)
            || metadata
                .as_ref()
                .is_some_and(|m| !m.is_file() || m.file_type().is_symlink())
            || (metadata.is_some() && !target.canonicalize()?.starts_with(&root));
        let mut file = FileView {
            path: if unsafe_file {
                "[private file]".into()
            } else {
                redact(&path, &root)
            },
            additions: 0,
            deletions: 0,
            binary: false,
            truncated: false,
            withheld: unsafe_file,
            diff: String::new(),
        };
        if !unsafe_file {
            let limit = MAX_FILE.min(remaining);
            let (bytes, cut) = if untracked {
                let mut bytes = Vec::new();
                tokio::fs::File::open(&target)
                    .await?
                    .take(limit as u64 + 1)
                    .read_to_end(&mut bytes)
                    .await?;
                let cut = bytes.len() > limit;
                bytes.truncate(limit);
                (bytes, cut)
            } else {
                git(
                    &root,
                    &[
                        "diff",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--no-renames",
                        "--unified=3",
                        &view.base,
                        "--",
                        &path,
                    ],
                    limit,
                )
                .await?
            };
            file.truncated = cut;
            file.binary = bytes.contains(&0)
                || (!cut && std::str::from_utf8(&bytes).is_err())
                || bytes.windows(13).any(|b| b == b"Binary files ");
            if !file.binary {
                let text = String::from_utf8_lossy(&bytes);
                if untracked {
                    file.additions = text.lines().count();
                    file.diff = format!(
                        "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n{}{}",
                        file.path,
                        file.additions,
                        text.lines()
                            .map(|line| format!("+{line}\n"))
                            .collect::<String>(),
                        if !text.is_empty() && !text.ends_with('\n') && !cut {
                            "\\ No newline at end of file\n"
                        } else {
                            ""
                        }
                    );
                } else {
                    let (counts, _) = git(
                        &root,
                        &[
                            "diff",
                            "--no-ext-diff",
                            "--no-textconv",
                            "--numstat",
                            &view.base,
                            "--",
                            &path,
                        ],
                        MAX_FILE,
                    )
                    .await?;
                    let counts = String::from_utf8_lossy(&counts);
                    let mut fields = counts.split('\t');
                    file.additions = fields.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                    file.deletions = fields.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                    file.diff = text.into_owned();
                }
                file.diff = redact(&file.diff, &root);
                // Added-line prefixes and redaction may grow text. Bound the wire
                // payload too, on a UTF-8 boundary, and tell the reader it was cut.
                let bound = limit.min(file.diff.len());
                let mut end = bound;
                while !file.diff.is_char_boundary(end) {
                    end -= 1;
                }
                if end < file.diff.len() {
                    file.truncated = true;
                    file.diff.truncate(end);
                }
                remaining -= file.diff.len();
            }
        }
        view.truncated |= file.truncated;
        view.files.push(file);
    }
    Ok(view)
}

#[cfg(test)]
mod tests;
