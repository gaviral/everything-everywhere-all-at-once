//! File and function parts, tagged from source, versioned by file history.
use super::{git, Function};
use serde::Serialize;
use std::{collections::BTreeMap, path::Path};
#[cfg(test)]
mod tests;

#[derive(Serialize)]
pub struct Part {
    id: String,
    name: String,
    file: String,
    line: usize,
    tags: Vec<String>,
    version: usize,
    version_scope: &'static str,
}

fn tags(file: &str, source: &str) -> Vec<String> {
    let mut tags = vec![if file.ends_with(".tsx") { "view" } else { "mechanism" }.into()];
    let name = file.to_lowercase();
    if name.contains("prompt") || source.contains("system_prompt") { tags.push("prompt".into()); }
    if source.contains("struct ") || source.contains("export type ") || name.contains("data") { tags.push("data".into()); }
    tags
}

fn versions(root: &Path) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    // One log, no author names, messages or machine paths. File history is the stated version unit.
    if let Ok(log) = git(root, &["log", "--format=", "--name-only", "--", "core/src", "ui/src"]) {
        for file in log.lines().filter(|l| l.starts_with("core/src/") || l.starts_with("ui/src/")) {
            *counts.entry(file.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

pub fn read(root: &Path, functions: &[Function]) -> Vec<Part> {
    let versions = versions(root);
    let mut files = BTreeMap::new();
    for f in functions { files.entry(f.file.clone()).or_insert_with(Vec::new).push(f); }
    let mut paths = Vec::new();
    for directory in ["core/src", "ui/src"] { let _ = super::source_files(root, &root.join(directory), &mut paths); }
    for path in paths {
        if let Ok(file) = path.strip_prefix(root) { files.entry(file.to_string_lossy().replace('\\', "/")).or_insert_with(Vec::new); }
    }
    let mut out = Vec::new();
    for (file, functions) in files {
        let source = std::fs::read_to_string(root.join(&file)).unwrap_or_default();
        let tags = tags(&file, &source);
        let version = *versions.get(&file).unwrap_or(&0);
        out.push(Part { id: file.clone(), name: file.rsplit('/').next().unwrap_or(&file).into(), file: file.clone(), line: 1, tags: tags.clone(), version, version_scope: "file history" });
        for f in functions {
            let mut own_tags = tags.clone();
            own_tags.push("function".into());
            out.push(Part { id: f.id.clone(), name: f.name.clone(), file: file.clone(), line: f.line, tags: own_tags, version, version_scope: "file history" });
        }
    }
    out
}
