use super::*;
fn base() -> PathBuf {
    let root = std::env::temp_dir().join(format!("e2a2o-storage-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::canonicalize(root).unwrap()
}
fn config(root: &Path, platform: &str) -> Location {
    Location { platform: platform.into(), home: Some(root.join("home with spaces").into_os_string()),
        xdg: None, local: Some(root.join("local").into_os_string()), override_map: None, cwd: root.into() }
}
#[test]
fn storage_platform_defaults_names_and_missing_homes_are_injected() {
    let root = base();
    for (platform, suffix) in [("macos", "home with spaces/Library/Application Support/e2a2o"),
        ("linux", "home with spaces/.local/share/e2a2o"), ("windows", "local/e2a2o")] {
        let mut c = config(&root, platform);
        assert_eq!(c.resolve(None).unwrap(), root.join(suffix));
        assert_eq!(c.resolve(Some("team map")).unwrap(), root.join(suffix).join("team map"));
        c.home = None; c.local = None;
        assert!(c.resolve(None).is_err());
    }
    let mut c = config(&root, "linux");
    c.xdg = Some(root.join("xdg").into_os_string()); c.home = None;
    assert_eq!(c.resolve(None).unwrap(), root.join("xdg/e2a2o"));
    c.xdg = Some("relative".into()); assert!(c.resolve(None).is_err());
    assert_eq!(fs::read_dir(root).unwrap().count(), 0, "resolution never writes");
}
#[test]
fn storage_override_is_complete_and_relative_to_original_cwd() {
    let root = base(); let mut c = config(&root, "macos");
    c.override_map = Some("missing parent/map with spaces".into());
    for name in [None, Some("sample"), Some("demo"), Some("room"), Some("another") ] {
        assert_eq!(c.resolve(name).unwrap(), root.join("missing parent/map with spaces"));
    }
    c.override_map = Some(root.join("absolute").into_os_string());
    assert_eq!(c.resolve(Some("name")).unwrap(), root.join("absolute"));
    c.override_map = Some("".into()); assert!(c.resolve(None).is_err());
    for name in ["", "..", ".", "../other", "/absolute", "a/b", "a\\b", "C:drive", ".git", "bad\nname"] {
        assert!(config(&root, "linux").resolve(Some(name)).is_err(), "{name}");
    }
    assert_eq!(fs::read_dir(root).unwrap().count(), 0);
}
#[test]
fn storage_git_directories_files_and_linked_worktrees_refuse_without_writes() {
    let root = base();
    for (i, directory) in [true, false, false].into_iter().enumerate() {
        let repo = root.join(format!("repo-{i}")); fs::create_dir(&repo).unwrap();
        if directory { fs::create_dir(repo.join(".git")).unwrap(); }
        else { fs::write(repo.join(".git"), "gitdir: synthetic/worktrees/test").unwrap(); }
        let target = repo.join("missing/map");
        assert!(validate(&target).is_err()); assert!(!repo.join("missing").exists());
    }
    let checkout = root.join("repo-0");
    assert_eq!(validate(&checkout.join("../external sibling")).unwrap(), root.join("external sibling"));
    assert!(validate(&root.join("bad\npath")).is_err());
    let legacy_root = root.join("legacy"); fs::create_dir_all(legacy_root.join("data/sample")).unwrap();
    assert!(legacy(&legacy_root, Some("sample")).unwrap_err().to_string().contains("migration"));
}
#[cfg(unix)]
#[test]
fn storage_symlink_ancestors_escapes_and_runtime_entries_refuse_without_writes() {
    use std::os::unix::fs::symlink;
    let root = base(); let outside = base();
    symlink(&outside, root.join("link")).unwrap();
    for target in [root.join("link/new/map"), root.join("link/../new"), root.join("link")] {
        assert!(validate(&target).is_err());
    }
    let map = root.join("map"); fs::create_dir(&map).unwrap();
    symlink(&outside, map.join("images")).unwrap();
    assert!(validate(&map).is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}
#[test]
fn storage_samples_refuse_unknown_maps_and_preserve_reset_bytes_and_identity() {
    let root = base(); let unknown = root.join("unknown"); fs::create_dir(&unknown).unwrap();
    fs::write(unknown.join("journal.jsonl"), "synthetic personal stand-in").unwrap();
    assert!(sample_destination(&unknown, "student-week").is_err());
    assert_eq!(fs::read_dir(&unknown).unwrap().count(), 1);
    let samples = root.join("fixtures"); fs::create_dir_all(samples.join("images/student-week")).unwrap();
    fs::write(samples.join("student-week.jsonl"), "synthetic sample").unwrap();
    fs::write(samples.join("images/student-week/pic.webp"), "synthetic image").unwrap();
    let map = root.join("new"); sample_destination(&map, "student-week").unwrap();
    let lock = crate::data_lock::acquire(&map).unwrap();
    seed_sample(&map, "student-week", &samples).unwrap(); drop(lock);
    let id = fs::read(map.join(ID)).unwrap();
    let held = crate::data_lock::acquire(&map).unwrap();
    sample_destination(&map, "student-week").unwrap();
    assert!(crate::data_lock::acquire(&map).is_err(), "a running sample cannot be reset");
    drop(held);
    sample_destination(&map, "student-week").unwrap();
    sample_destination(&map, "founder-day").unwrap();
    sample_destination(&map, "developer-day").unwrap();
    fs::write(map.join("journal.jsonl"), "synthetic prior edits").unwrap();
    let _lock = crate::data_lock::acquire(&map).unwrap();
    seed_sample(&map, "student-week", &samples).unwrap();
    assert_eq!(fs::read(map.join(ID)).unwrap(), id);
    assert!(fs::read_dir(&map).unwrap().filter_map(Result::ok).any(|e|
        e.file_name().to_string_lossy().starts_with("sample-backup-") &&
        fs::read_to_string(e.path().join("journal.jsonl")).ok().as_deref() == Some("synthetic prior edits")));
    fs::write(map.join(ID), uuid::Uuid::new_v4().to_string()).unwrap();
    assert!(sample_destination(&map, "student-week").is_err());
}
