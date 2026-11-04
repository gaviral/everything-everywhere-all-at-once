//! Optional, local-only source map. No source bodies or machine paths leave this reader.
use axum::{
    extract::ConnectInfo,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Serialize, Clone, Debug)]
pub struct Function {
    id: String,
    name: String,
    file: String,
    line: usize,
    end_line: usize,
    lines: usize,
    branches: usize,
    calls: Vec<String>,
    unresolved: usize,
    reasons: Vec<String>,
}
#[derive(Serialize)]
struct Branch {
    name: String,
    tip: String,
    parent: Option<String>,
    fork: Option<String>,
    state: String,
    current: bool,
    ahead: usize,
    behind: usize,
}
#[derive(Serialize)]
struct Snapshot {
    functions: Vec<Function>,
    branches: Vec<Branch>,
    files: usize,
    warnings: Vec<String>,
}

/// A room guest must never be able to read the host's source or local branch names.
pub async fn read(ConnectInfo(link): ConnectInfo<crate::Link>) -> Response {
    if let Err(status) = admission(
        std::env::var("E2A2O_CODE_CANVAS").as_deref() == Ok("1"),
        link.from.ip(),
        link.to.ip(),
    ) {
        return status.into_response();
    }
    let result = tokio::task::spawn_blocking(|| {
        snapshot(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
    })
    .await;
    let mut response = match result {
        Ok(Ok(value)) => Json(value).into_response(),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Source map unavailable. Check the local checkout.",
        )
            .into_response(),
    };
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

fn admission(
    enabled: bool,
    from: std::net::IpAddr,
    to: std::net::IpAddr,
) -> Result<(), StatusCode> {
    if !enabled {
        Err(StatusCode::NOT_FOUND)
    } else if !from.is_loopback() || !to.is_loopback() {
        Err(StatusCode::FORBIDDEN)
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct Token {
    word: String,
    line: usize,
}
/// Skip comments and literals, preserving line numbers. Delimiters inside them cannot create functions.
fn tokens(source: &str, rust: bool) -> Vec<Token> {
    let b = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut line = 1;
    while i < b.len() {
        if b[i] == b'\n' {
            line += 1;
            i += 1;
            continue;
        }
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            i += 2;
            let mut depth = 1;
            while i < b.len() && depth > 0 {
                if b[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if b[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    if b[i] == b'\n' {
                        line += 1;
                    }
                    i += 1;
                }
            }
            continue;
        }
        // Rust raw strings, including r###"..."###.
        if b[i] == b'r' {
            let mut at = i + 1;
            while at < b.len() && b[at] == b'#' {
                at += 1;
            }
            if at < b.len() && b[at] == b'"' {
                let hashes = at - i - 1;
                i = at + 1;
                while i < b.len() {
                    if b[i] == b'\n' {
                        line += 1;
                    }
                    if b[i] == b'"'
                        && b.get(i + 1..i + 1 + hashes)
                            .is_some_and(|v| v.iter().all(|c| *c == b'#'))
                    {
                        i += 1 + hashes;
                        break;
                    }
                    i += 1;
                }
                continue;
            }
        }
        // A Rust lifetime is an identifier, not an unterminated quote.
        let lifetime =
            rust && b[i] == b'\'' && b.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic()) && {
                let mut at = i + 2;
                while at < b.len() && (b[at].is_ascii_alphanumeric() || b[at] == b'_') {
                    at += 1;
                }
                b.get(at) != Some(&b'\'')
            };
        if b[i] == b'"' || b[i] == b'`' || (b[i] == b'\'' && !lifetime) {
            let quote = b[i];
            i += 1;
            while i < b.len() {
                if b[i] == b'\n' {
                    line += 1;
                }
                if b[i] == b'\\' {
                    i += 1;
                    if b.get(i) == Some(&b'\n') {
                        line += 1;
                    }
                    i += 1;
                } else if b[i] == quote {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        let start = i;
        i += 1;
        if b[start].is_ascii_alphabetic() || b[start] == b'_' || b[start] == b'$' {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$') {
                i += 1;
            }
        }
        out.push(Token {
            word: String::from_utf8_lossy(&b[start..i]).into_owned(),
            line,
        });
    }
    out
}
fn matching(t: &[Token]) -> HashMap<usize, usize> {
    let mut stack = Vec::new();
    let mut pairs = HashMap::new();
    for (i, token) in t.iter().enumerate() {
        match token.word.as_str() {
            "(" | "{" | "[" => stack.push(i),
            ")" | "}" | "]" => {
                let expected = match token.word.as_str() {
                    ")" => "(",
                    "}" => "{",
                    _ => "[",
                };
                if let Some(at) = stack.iter().rposition(|at| t[*at].word == expected) {
                    let start = stack[at];
                    stack.truncate(at);
                    pairs.insert(start, i);
                }
            }
            _ => (),
        }
    }
    pairs
}
fn identifier(s: &str) -> bool {
    s.as_bytes()
        .first()
        .is_some_and(|b| b.is_ascii_alphabetic() || *b == b'_' || *b == b'$')
}
#[derive(Clone)]
struct Parsed {
    function: Function,
    calls: Vec<(String, Option<String>)>,
}
fn parse(file: &str, source: &str) -> Vec<Parsed> {
    let t = tokens(source, file.ends_with(".rs"));
    let pairs = matching(&t);
    let mut spans = Vec::new();
    let word = |i: usize| t.get(i).map(|v| v.word.as_str()).unwrap_or("");
    for i in 0..t.len() {
        let declaration = matches!(word(i), "fn" | "function");
        let arrow = matches!(word(i), "const" | "let") && identifier(word(i + 1));
        if !declaration && !arrow {
            continue;
        }
        let name_at = if word(i + 1) == "*" { i + 2 } else { i + 1 };
        if !identifier(word(name_at)) {
            continue;
        }
        let mut at = name_at + 1;
        let mut arrow_seen = false;
        while at < t.len() {
            if word(at) == ";" {
                break;
            }
            if word(at) == "=" && word(at + 1) == ">" {
                arrow_seen = true;
                at += 2;
                continue;
            }
            if word(at) == "(" || word(at) == "[" {
                at = pairs.get(&at).copied().unwrap_or(at) + 1;
                continue;
            }
            if word(at) == "{" {
                // For arrow declarations, object type annotations occur before =>.
                if arrow && !arrow_seen {
                    if word(at.saturating_sub(1)) == "=" {
                        break;
                    }
                    at = pairs.get(&at).copied().unwrap_or(at) + 1;
                    continue;
                }
                if let Some(end) = pairs.get(&at) {
                    spans.push((name_at, at, *end));
                }
                break;
            }
            // Expression arrows end at a semicolon or at their containing block.
            if arrow && arrow_seen {
                let start = at;
                while at < t.len() && !matches!(word(at), ";" | "}") {
                    at = pairs.get(&at).copied().unwrap_or(at) + 1;
                }
                if at > start {
                    spans.push((name_at, start.saturating_sub(1), at - 1));
                }
                break;
            }
            at += 1;
        }
    }
    spans
        .iter()
        .map(|&(name, start, end)| {
            let mut calls = Vec::new();
            let mut branches = 0;
            let mut at = start + 1;
            while at < end {
                if let Some((_, _, child_end)) = spans.iter().find(|(n, _, e)| *n == at && *e < end)
                {
                    at = *child_end + 1;
                    continue;
                }
                if matches!(
                    word(at),
                    "if" | "else" | "match" | "for" | "while" | "catch" | "case"
                ) {
                    branches += 1;
                }
                let call = identifier(word(at)) && word(at + 1) == "(";
                let jsx = word(at.saturating_sub(1)) == "<"
                    && word(at)
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase);
                if (call || jsx)
                    && !matches!(
                        word(at),
                        "if" | "for"
                            | "while"
                            | "match"
                            | "switch"
                            | "catch"
                            | "function"
                            | "Some"
                            | "Ok"
                            | "Err"
                    )
                    && word(at.saturating_sub(1)) != "fn"
                    && word(at.saturating_sub(1)) != "function"
                {
                    let qualifier = if at >= 3 && word(at - 1) == ":" && word(at - 2) == ":" {
                        Some(word(at - 3).to_string())
                    } else if at >= 2 && word(at - 1) == "." {
                        Some(word(at - 2).to_string())
                    } else {
                        None
                    };
                    calls.push((word(at).to_string(), qualifier));
                }
                at += 1;
            }
            calls.sort();
            calls.dedup();
            let lines = t[end].line - t[name].line + 1;
            let mut reasons = Vec::new();
            if lines > 60 {
                reasons.push(format!("{lines} lines (over 60)"));
            }
            if branches > 8 {
                reasons.push(format!("{branches} decision points (over 8)"));
            }
            Parsed {
                function: Function {
                    id: format!("{file}:{}:{}", t[name].line, word(name)),
                    name: word(name).into(),
                    file: file.into(),
                    line: t[name].line,
                    end_line: t[end].line,
                    lines,
                    branches,
                    calls: Vec::new(),
                    unresolved: 0,
                    reasons,
                },
                calls,
            }
        })
        .collect()
}
fn source_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let p = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            source_files(root, &p, out)?;
        } else if matches!(
            p.extension().and_then(|s| s.to_str()),
            Some("rs" | "ts" | "tsx")
        ) && p.strip_prefix(root).is_ok()
        {
            out.push(p);
        }
    }
    Ok(())
}
fn compose(mut parsed: Vec<Parsed>) -> Vec<Function> {
    let mut names: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in parsed.iter().enumerate() {
        names.entry(p.function.name.clone()).or_default().push(i);
    }
    for i in 0..parsed.len() {
        let mut resolved = Vec::new();
        let mut unresolved = 0;
        for (name, qualifier) in &parsed[i].calls {
            let Some(all_candidates) = names.get(name) else {
                unresolved += 1;
                continue;
            };
            let candidates: Vec<_> = all_candidates
                .iter()
                .copied()
                .filter(|n| {
                    parsed[*n].function.file.ends_with(".rs")
                        == parsed[i].function.file.ends_with(".rs")
                })
                .collect();
            let local: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|n| parsed[*n].function.file == parsed[i].function.file)
                .collect();
            let qualified: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|n| {
                    qualifier.as_ref().is_some_and(|q| {
                        Path::new(&parsed[*n].function.file)
                            .file_stem()
                            .is_some_and(|stem| stem == q.as_str())
                    })
                })
                .collect();
            let chosen = if !qualified.is_empty() {
                &qualified
            } else if qualifier
                .as_ref()
                .is_none_or(|q| q == "self" || q == "Self")
                && !local.is_empty()
            {
                &local
            } else if qualifier.is_none() {
                &candidates
            } else {
                unresolved += 1;
                continue;
            };
            if chosen.len() == 1 {
                resolved.push(parsed[chosen[0]].function.id.clone());
            } else {
                unresolved += 1;
            }
        }
        resolved.sort();
        resolved.dedup();
        parsed[i].function.calls = resolved;
        parsed[i].function.unresolved = unresolved;
        let count = parsed[i].function.calls.len();
        if count > 10 {
            parsed[i]
                .function
                .reasons
                .push(format!("{count} known callees (over 10)"));
        }
    }
    parsed.into_iter().map(|p| p.function).collect()
}
fn git(root: &Path, args: &[&str]) -> Result<String, ()> {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|_| ())?;
    if !result.status.success() {
        return Err(());
    }
    Ok(String::from_utf8_lossy(&result.stdout).into_owned())
}
fn reachable(tip: &str, parents: &HashMap<String, Vec<String>>) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut pending = vec![tip.to_string()];
    while let Some(id) = pending.pop() {
        if seen.insert(id.clone()) {
            if let Some(p) = parents.get(&id) {
                pending.extend(p.iter().cloned());
            }
        }
    }
    seen
}
fn branch_state(name: &str, merged: bool, merging: bool) -> String {
    if merging {
        "merging"
    } else if name == "main" || merged {
        "main"
    } else if name
        .split(['/', '-', '_'])
        .any(|v| matches!(v, "staging" | "stage" | "train"))
    {
        "staging"
    } else {
        "dev"
    }
    .into()
}
/// Read only Git metadata; worktree locations and source contents never enter the response.
fn merging_branches(root: &Path, refs: &BTreeMap<String, String>) -> HashSet<String> {
    let mut merging = HashSet::new();
    let Ok(common) = git(root, &["rev-parse", "--git-common-dir"]) else {
        return merging;
    };
    let common = root.join(common.trim());
    let mut directories = vec![common.clone()];
    if let Ok(entries) = std::fs::read_dir(common.join("worktrees")) {
        directories.extend(entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
    }
    for directory in directories {
        let Ok(heads) = std::fs::read_to_string(directory.join("MERGE_HEAD")) else {
            continue;
        };
        if let Ok(target) = std::fs::read_to_string(directory.join("HEAD")) {
            if let Some(name) = target.trim().strip_prefix("ref: refs/heads/") {
                merging.insert(name.to_string());
            }
        }
        for head in heads.lines() {
            for (name, tip) in refs {
                if head == tip {
                    merging.insert(name.clone());
                }
            }
        }
    }
    merging
}
fn branches(root: &Path) -> Result<Vec<Branch>, ()> {
    let refs = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)\t%(objectname)",
            "refs/heads/",
        ],
    )?;
    let refs: BTreeMap<String, String> = refs
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(a, b)| (a.into(), b.into()))
        .collect();
    let main = refs.get("main").ok_or(())?;
    let log = git(root, &["rev-list", "--parents", "--branches"])?;
    let parents: HashMap<String, Vec<String>> = log
        .lines()
        .filter_map(|l| {
            let mut words = l.split_whitespace();
            Some((words.next()?.into(), words.map(str::to_string).collect()))
        })
        .collect();
    let main_history = reachable(main, &parents);
    let current = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_default();
    let merging = merging_branches(root, &refs);
    let mut out = Vec::new();
    for (name, tip) in &refs {
        let history = reachable(tip, &parents);
        let merged = main_history.contains(tip);
        let mut pending = VecDeque::from([(tip.clone(), 0usize)]);
        let mut seen = HashSet::new();
        let mut parent = None;
        let mut fork = None;
        while let Some((id, distance)) = pending.pop_front() {
            if !seen.insert(id.clone()) {
                continue;
            }
            if main_history.contains(&id) {
                if name != "main" {
                    parent = Some("main".into());
                    fork = Some(id);
                }
                break;
            }
            // Equal tips remain siblings, avoiding cycles; only a strictly earlier named tip is a parent.
            if distance > 0 {
                if let Some((p, _)) = refs.iter().find(|(n, h)| *n != name && **h == id) {
                    parent = Some(p.clone());
                    fork = Some(id);
                    break;
                }
            }
            if let Some(p) = parents.get(&id) {
                pending.extend(p.iter().cloned().map(|p| (p, distance + 1)));
            }
        }
        let is_merging = merging.contains(name);
        out.push(Branch {
            name: name.clone(),
            tip: tip[..8.min(tip.len())].into(),
            parent,
            fork: fork.map(|s| s[..8.min(s.len())].into()),
            state: branch_state(name, merged, is_merging),
            current: current.trim() == name,
            ahead: history.difference(&main_history).count(),
            behind: main_history.difference(&history).count(),
        });
    }
    Ok(out)
}
fn snapshot(root: &Path) -> Result<Snapshot, ()> {
    let mut paths = Vec::new();
    let mut warnings = Vec::new();
    for dir in ["core/src", "ui/src"] {
        source_files(root, &root.join(dir), &mut paths).map_err(|_| ())?;
    }
    paths.sort();
    let files = paths.len();
    let mut parsed = Vec::new();
    for path in paths {
        let file = path
            .strip_prefix(root)
            .map_err(|_| ())?
            .to_string_lossy()
            .replace('\\', "/");
        match std::fs::read_to_string(&path) {
            Ok(source) => parsed.extend(parse(&file, &source)),
            Err(_) => warnings.push(format!("Could not read {file}")),
        }
    }
    let branches = branches(root).unwrap_or_else(|_| {
        warnings.push("Branch history unavailable. Nothing was changed.".into());
        Vec::new()
    });
    Ok(Snapshot {
        functions: compose(parsed),
        branches,
        files,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_is_off_by_default_and_private_even_when_enabled() {
        let local = "127.0.0.1".parse().unwrap();
        let remote = "192.0.2.1".parse().unwrap();
        assert_eq!(admission(false, local, local), Err(StatusCode::NOT_FOUND));
        assert_eq!(admission(true, remote, local), Err(StatusCode::FORBIDDEN));
        assert_eq!(admission(true, local, remote), Err(StatusCode::FORBIDDEN));
        assert!(admission(true, local, local).is_ok());
    }
    #[test]
    fn file_changes_appear_without_a_maintained_catalog() {
        let root = std::env::temp_dir().join(format!("code-canvas-files-{}", uuid::Uuid::new_v4()));
        for dir in ["core/src", "ui/src"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        let path = root.join("core/src/new.rs");
        std::fs::write(&path, "fn first() {}\n").unwrap();
        assert_eq!(snapshot(&root).unwrap().functions.len(), 1);
        std::fs::write(&path, "fn first() { second(); }\nfn second() {}\n").unwrap();
        let next = snapshot(&root).unwrap();
        assert_eq!(next.functions.len(), 2);
        assert_eq!(next.functions[0].calls, ["core/src/new.rs:2:second"]);
        assert_eq!(next.files, 1);
    }
    #[test]
    fn rust_typescript_calls_lines_and_new_functions_come_from_source() {
        let rust = "// fn fake() {}\nfn main() { parts::run(); let s = r##\"fn fake() {}\"##; }\nfn lifetime<'a>(s: &'a str) {}";
        let mut p = parse("core/src/main.rs", rust);
        p.extend(parse(
            "core/src/parts.rs",
            "pub fn run() { leaf(); }\nfn leaf() {}",
        ));
        p.extend(parse("ui/src/Thing.tsx", "export function Thing() { return <Leaf />; }\nconst Leaf = () => { return null; };\nconst one = (n: number) => n + 1;"));
        let graph = compose(p);
        assert!(!graph.iter().any(|f| f.name == "fake"));
        assert_eq!(
            graph.iter().find(|f| f.name == "main").unwrap().calls,
            ["core/src/parts.rs:1:run"]
        );
        assert_eq!(
            graph.iter().find(|f| f.name == "Thing").unwrap().calls,
            ["ui/src/Thing.tsx:2:Leaf"]
        );
        assert!(graph.iter().any(|f| f.name == "one"));
        assert_eq!(parse("core/src/new.rs", "fn added() {}\n").len(), 1);
    }
    #[test]
    fn ambiguous_calls_and_split_signals_are_honest() {
        let graph = compose(
            [
                parse("core/src/a.rs", "fn leaf() {}"),
                parse("core/src/b.rs", "fn leaf() {}"),
                parse(
                    "core/src/c.rs",
                    &format!("fn big() {{ leaf();\n{}\n}}", "if true {}\n".repeat(65)),
                ),
            ]
            .concat(),
        );
        let big = graph.iter().find(|f| f.name == "big").unwrap();
        assert!(big.calls.is_empty());
        assert_eq!(big.unresolved, 1);
        assert_eq!(big.branches, 65);
        assert!(big.lines > 60);
        assert_eq!(big.reasons.len(), 2);
    }
    #[test]
    fn git_tree_tracks_ancestry_names_and_live_ref_changes() {
        let root = std::env::temp_dir().join(format!("code-canvas-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        git(&root, &["init", "-b", "main"]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Root",
            ],
        )
        .unwrap();
        git(&root, &["checkout", "-b", "dev/piece"]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Piece",
            ],
        )
        .unwrap();
        git(&root, &["branch", "staging/piece"]).unwrap();
        let b = branches(&root).unwrap();
        let lane = b.iter().find(|b| b.name == "dev/piece").unwrap();
        assert_eq!(lane.parent.as_deref(), Some("main"));
        assert_eq!(lane.ahead, 1);
        assert_eq!(lane.state, "dev");
        assert_eq!(
            b.iter().find(|b| b.name == "staging/piece").unwrap().state,
            "staging"
        );
        git(&root, &["checkout", "main"]).unwrap();
        let common = root.join(".git");
        std::fs::write(
            common.join("MERGE_HEAD"),
            format!(
                "{}\n",
                git(&root, &["rev-parse", "dev/piece"]).unwrap().trim()
            ),
        )
        .unwrap();
        let pending = branches(&root).unwrap();
        assert_eq!(
            pending.iter().find(|b| b.name == "main").unwrap().state,
            "merging"
        );
        assert_eq!(
            pending
                .iter()
                .find(|b| b.name == "dev/piece")
                .unwrap()
                .state,
            "merging"
        );
        std::fs::rename(common.join("MERGE_HEAD"), common.join("MERGE_HEAD.saved")).unwrap();
        git(&root, &["merge", "--ff-only", "dev/piece"]).unwrap();
        assert_eq!(
            branches(&root)
                .unwrap()
                .iter()
                .find(|b| b.name == "dev/piece")
                .unwrap()
                .state,
            "main"
        );
        // Kept in the OS temporary directory for inspection; no permanent cleanup here.
    }
}
