use super::*;

#[test]
fn source_only_files_have_tags_and_versions_advance_from_real_git_history() {
    let root = std::env::temp_dir().join(format!("canvas-parts-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("core/src")).unwrap();
    std::fs::create_dir_all(root.join("ui/src")).unwrap();
    git(&root, &["init", "-b", "main"]).unwrap();
    std::fs::write(root.join("core/src/prompt.rs"), "pub const PROMPT: &str = \"A synthetic task\";").unwrap();
    commit(&root);
    let first = read(&root, &[]);
    let prompt = first.iter().find(|p| p.file.ends_with("prompt.rs")).unwrap();
    assert_eq!(prompt.version, 1);
    assert!(prompt.tags.iter().any(|t| t == "prompt"));
    std::fs::write(root.join("core/src/prompt.rs"), "pub const PROMPT: &str = \"Another synthetic task\";").unwrap();
    commit(&root);
    assert_eq!(read(&root, &[]).iter().find(|p| p.file.ends_with("prompt.rs")).unwrap().version, 2);
    std::fs::write(root.join("ui/src/View.tsx"), "export type Data = { title: string };").unwrap();
    let uncommitted = read(&root, &[]);
    let view = uncommitted.iter().find(|p| p.file.ends_with("View.tsx")).unwrap();
    assert_eq!(view.version, 0);
    assert!(view.tags.iter().any(|t| t == "data"));
    assert!(view.tags.iter().any(|t| t == "view"));
}

fn commit(root: &Path) {
    git(root, &["add", "."]).unwrap();
    git(root, &["-c", "user.name=Fixture", "-c", "user.email=fixture.invalid", "commit", "-m", "Synthetic part version"]).unwrap();
}
