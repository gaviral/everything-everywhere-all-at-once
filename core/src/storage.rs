//! The single, read-only map-location resolver. No environment files or services are consulted.
use anyhow::{bail, Context, Result};
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub struct Location {
    pub platform: String,
    pub home: Option<OsString>,
    pub xdg: Option<OsString>,
    pub local: Option<OsString>,
    pub override_map: Option<OsString>,
    pub cwd: PathBuf,
}

fn required(value: &Option<OsString>, label: &str) -> Result<PathBuf> {
    let value = value.as_ref().filter(|v| !v.is_empty())
        .with_context(|| format!("{label} is missing; set E2A2O_DATA to an external map directory"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() { bail!("{label} must be absolute"); }
    Ok(path)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.eq_ignore_ascii_case(".git")
        && !name.starts_with('-') && !name.ends_with('.') && !name.ends_with(' ')
        && name.chars().all(|c| c.is_alphanumeric() || "-_. ".contains(c))
}

impl Location {
    pub fn resolve(&self, name: Option<&str>) -> Result<PathBuf> {
        if name.is_some_and(|n| !valid_name(n)) { bail!("map name must be one safe path component"); }
        let path = if let Some(value) = &self.override_map {
            if value.is_empty() { bail!("E2A2O_DATA is explicitly empty"); }
            let path = PathBuf::from(value);
            if path.is_absolute() { path } else { self.cwd.join(path) }
        } else {
            let root = match self.platform.as_str() {
                "macos" => required(&self.home, "HOME")?.join("Library/Application Support/e2a2o"),
                "windows" => required(&self.local, "LOCALAPPDATA")?.join("e2a2o"),
                "linux" => if self.xdg.as_ref().is_some_and(|v| !v.is_empty()) {
                    required(&self.xdg, "XDG_DATA_HOME")?.join("e2a2o")
                } else { required(&self.home, "HOME")?.join(".local/share/e2a2o") },
                _ => bail!("unsupported platform; set E2A2O_DATA"),
            };
            match name { Some(n) => root.join(n), None => root }
        };
        validate(&path)
    }
}

/// Walk before normalizing: even `link/../new` must not hide a symlink. Missing suffixes stay unwritten.
/// Symlinks are refused, including links that currently point back inside the selected directory.
pub fn validate(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() { bail!("map directory must be absolute"); }
    if path.to_string_lossy().chars().any(char::is_control) { bail!("map directory contains a control character"); }
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => continue,
            Component::ParentDir => { clean.pop(); },
            _ => clean.push(part.as_os_str()),
        }
        match fs::symlink_metadata(&clean) {
            Ok(meta) => {
                if meta.file_type().is_symlink() { bail!("map path has a symlink ancestor: {}", clean.display()); }
                if !meta.is_dir() { bail!("map path is not a directory: {}", clean.display()); }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e).context("couldn't validate map directory"),
        }
    }
    // Check the final location: a caller inside a checkout may select an external sibling with `../map`.
    for ancestor in clean.ancestors() {
        if fs::symlink_metadata(ancestor.join(".git")).is_ok() {
            bail!("map directory is inside a Git checkout/worktree; choose external storage");
        }
    }
    // Existing runtime entries must not redirect later journal, picture, trace or TLS writes.
    if clean.exists() { validate_entries(&clean)?; }
    Ok(clean)
}

fn validate_entries(path: &Path) -> Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() { bail!("map contains a symlink: {}", entry.path().display()); }
        if entry.file_name() == ".git" { bail!("map contains a Git checkout/worktree"); }
        if meta.is_dir() { validate_entries(&entry.path())?; }
    }
    Ok(())
}

pub fn from_env(name: Option<&str>) -> Result<PathBuf> {
    let cwd = std::env::var_os("E2A2O_CALLER_CWD").map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?);
    if !cwd.is_absolute() { bail!("E2A2O_CALLER_CWD must be absolute"); }
    let location = Location {
        platform: std::env::consts::OS.into(), home: std::env::var_os("HOME"),
        xdg: std::env::var_os("XDG_DATA_HOME"), local: std::env::var_os("LOCALAPPDATA"),
        override_map: std::env::var_os("E2A2O_DATA"), cwd: cwd.clone(),
    };
    let path = location.resolve(name)?;
    if location.override_map.is_none() {
        let current = std::env::current_dir()?;
        for root in [cwd.as_path(), current.as_path(), current.parent().unwrap_or(&current)] {
            if root.join("core/Cargo.toml").is_file() {
                legacy(root, name)?;
            }
        }
    }
    Ok(path)
}

fn legacy(root: &Path, _name: Option<&str>) -> Result<()> {
    let old = root.join("data");
    if fs::symlink_metadata(old).is_ok() {
        bail!("legacy checkout data exists; stop and preserve it, then use separate migration tooling to copy it to an external map directory and explicitly select E2A2O_DATA (see docs/storage.md); no migration was performed");
    }
    Ok(())
}

const MARKER: &str = ".sample-map.json";
const ID: &str = "journal.jsonl.map-id";

/// An existing destination must carry both our fixture marker and its journal's identity.
/// This check runs before acquiring a lock (which can create a directory).
pub fn sample_destination(data: &Path, fixture: &str) -> Result<()> {
    if !["student-week", "founder-day"].contains(&fixture) { bail!("unknown sample fixture"); }
    if !data.exists() { return Ok(()); }
    if fs::read_dir(data)?.next().is_none() { return Ok(()); }
    let marker: serde_json::Value = fs::read(data.join(MARKER)).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).context("sample refuses an existing non-sample/unknown map; choose a new synthetic destination")?;
    let id = fs::read_to_string(data.join(ID)).context("sample identity is missing; refusing reset")?;
    if marker["version"] != 1 || !marker["fixture"].as_str().is_some_and(|f| ["student-week", "founder-day"].contains(&f)) || marker["map_id"] != id
        || uuid::Uuid::parse_str(&id).is_err() {
        bail!("sample marker/identity does not match; choose a new synthetic destination");
    }
    Ok(())
}

/// Caller holds the normal core lock. Old journal/images are retained beneath a unique backup directory.
pub fn seed_sample(data: &Path, fixture: &str, samples: &Path) -> Result<()> {
    let bytes = fs::read(samples.join(format!("{fixture}.jsonl")))?;
    let source_images = samples.join("images").join(fixture);
    let images: Vec<_> = fs::read_dir(source_images)?.collect::<std::io::Result<_>>()?;
    let id = if data.join(ID).exists() { fs::read_to_string(data.join(ID))? }
        else { uuid::Uuid::new_v4().to_string() };
    let backup = data.join(format!("sample-backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&backup)?;
    for file in ["journal.jsonl", "images", MARKER] {
        if data.join(file).exists() { fs::rename(data.join(file), backup.join(file))?; }
    }
    fs::create_dir(data.join("images"))?;
    for image in images {
        if !image.file_type()?.is_file() { bail!("sample image must be a regular file"); }
        fs::copy(image.path(), data.join("images").join(image.file_name()))?;
    }
    fs::write(data.join("journal.jsonl"), bytes)?;
    if !data.join(ID).exists() { fs::write(data.join(ID), &id)?; }
    fs::write(data.join(MARKER), serde_json::to_vec(&serde_json::json!({
        "version": 1, "fixture": fixture, "map_id": id,
    }))?)?;
    Ok(())
}

#[cfg(test)]
mod tests;
