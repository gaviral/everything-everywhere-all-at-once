use super::*;
fn term(word: &str) -> Term { Term { term: word.into(), explanation: "Synthetic example".into() } }

#[test]
fn glossary_save_is_durable_scoped_and_optimistic() {
    let dir = std::env::temp_dir().join(format!("my-words-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("my-words.jsonl");
    let runtime = Runtime::default();
    assert!(runtime.keywords("you").is_empty(), "off by default");
    let first = runtime.save(&path, "synthetic-map", "you", 0, vec![term("Wayfinder")]).unwrap();
    assert_eq!(first.revision, 1);
    assert!(runtime.keywords("you").is_empty(), "saved words alone cannot opt in");
    runtime.active.lock().unwrap().insert("you".into(), 1);
    assert_eq!(runtime.keywords("you"), vec!["Wayfinder"]);
    let next_session = runtime.keywords("you");
    assert!(runtime.keywords("other").is_empty());
    assert!(runtime.save(&path, "synthetic-map", "you", 0, vec![]).unwrap_err().contains("Another window"));
    runtime.save(&path, "synthetic-map", "you", 1, vec![term("Wide lens")]).unwrap();
    assert_eq!(next_session, vec!["Wayfinder"], "an in-flight session keeps its original snapshot");
    assert_eq!(runtime.keywords("you"), vec!["Wide lens"]);
    let restored = Runtime::default().read(&path, "synthetic-map", "you").unwrap();
    assert_eq!(restored.revision, 2); assert_eq!(restored.terms[0].term, "Wide lens");
    assert!(Runtime::default().read(&path, "another-map", "you").is_err());
    runtime.active.lock().unwrap().clear();
    assert!(runtime.keywords("you").is_empty());
    // Removal and undo are new durable revisions; earlier values remain recoverable in the log.
    runtime.save(&path, "synthetic-map", "you", 2, vec![]).unwrap();
    runtime.save(&path, "synthetic-map", "you", 3, restored.terms).unwrap();
    assert_eq!(Runtime::default().read(&path, "synthetic-map", "you").unwrap().revision, 4);
}

#[test]
fn glossary_literal_limits_and_storage_failures() {
    assert!(validate(&[term("Wayfinder"), term("  wAYfinder ")]).is_err());
    assert!(validate(&[term("Wide lens"), term("qorval  lens")]).is_err());
    assert!(validate(&[term("界".repeat(40).as_str())]).is_ok());
    assert!(validate(&[term("界".repeat(41).as_str())]).is_err());
    assert!(validate(&[term("bad\nname")]).is_err());
    assert!(validate(&[term("<literal>.*")]).is_ok());
    assert!(validate(&vec![term("Wayfinder"); 31]).is_err());
    let dir = std::env::temp_dir().join(format!("my-words-failure-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("partial.jsonl");
    std::fs::write(&path, b"{partial").unwrap();
    let original = std::fs::read(&path).unwrap();
    assert!(Runtime::default().save(&path, "map", "you", 0, vec![]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original, "unreadable data is preserved");
    assert!(Runtime::default().save(&dir.join("absent/words.jsonl"), "map", "you", 0, vec![]).is_err());
}

#[test]
fn glossary_handshake_keeps_product_names_and_only_sends_terms() {
    let sent = crate::asr::handshake_with_keywords("synthetic-fixture", &["Wayfinder".into(), "meta".into(), "Wide lens".into()]);
    let words: Vec<_> = sent["keywords"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert!(words.contains(&"Wayfinder") && words.contains(&"Wide lens"));
    assert!(words.contains(&"Palace") && words.contains(&"Recap"));
    assert_eq!(words.iter().filter(|w| w.to_lowercase() == "meta").count(), 1);
    assert!(!sent.to_string().contains("Synthetic example"));
    assert_eq!(sent["model"], "muse-voice-transcribe-1.0");
}
