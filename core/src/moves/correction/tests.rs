use super::*;
use crate::world::{fixtures::{thought, thread}, Journal};

fn setup() -> (Arc<Core>, World, std::path::PathBuf) {
    let world = World {
        threads: vec![thread("garden", "Garden", 1), thread("pottery", "Pottery class", 2), thread("bills", "Bills", 3)],
        thoughts: vec![thought("wheel", "garden", "Learn to throw on the pottery wheel", 10), thought("tomato", "garden", "Plant tomatoes", 11)],
        ..World::default()
    };
    let path = std::env::temp_dir().join(format!("correction-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, _) = Journal::open(&path).unwrap();
    (Arc::new(Core::test(journal, world.clone())), world, path)
}

fn request() -> CorrectionRequest {
    CorrectionRequest { request_id: uuid::Uuid::new_v4().to_string(), thought_id: "wheel".into(), observed_text: "Learn to throw on the pottery wheel".into(), from: "garden".into(), to: "pottery".into(), undo_of: None }
}

fn landing(core: &Core, id: &str) -> String {
    core.snapshot().thoughts.iter().find(|t| t.id == id).unwrap().thread_id.clone().unwrap()
}

#[tokio::test]
async fn correction_exact_undo_retries_and_replay() {
    let (core, mut base, path) = setup();
    let move_request = request();
    assert!(correction(&core, "you", false, &move_request).is_err());
    let first = correction(&core, "you", true, &move_request).unwrap();
    assert_eq!(first, "Moved to Pottery class");
    assert_eq!(landing(&core, "wheel"), "pottery");
    assert_eq!(landing(&core, "tomato"), "garden");
    let length = std::fs::metadata(&path).unwrap().len();
    assert_eq!(correction(&core, "you", true, &move_request).unwrap(), first);
    assert_eq!(std::fs::metadata(&path).unwrap().len(), length);
    let undo = CorrectionRequest { request_id: uuid::Uuid::new_v4().to_string(), from: "pottery".into(), to: "garden".into(), undo_of: Some(move_request.request_id.clone()), ..move_request.clone() };
    assert!(correction(&core, "someone-else", true, &undo).is_err());
    assert_eq!(correction(&core, "you", true, &undo).unwrap(), "Restored to Garden");
    assert_eq!(landing(&core, "wheel"), "garden");
    assert_eq!(landing(&core, "tomato"), "garden");
    assert!(correction(&core, "you", true, &undo).is_ok());
    // Retrying the original after Undo acknowledges it without moving anything again.
    assert_eq!(correction(&core, "you", true, &move_request).unwrap(), first);
    assert_eq!(landing(&core, "wheel"), "garden");
    for line in std::fs::read_to_string(path).unwrap().split_inclusive('\n') {
        for (change, _) in crate::world::journal_record(line.as_bytes(), true).unwrap() { base.apply(&change); }
    }
    assert_eq!(base.thoughts[0].thread_id.as_deref(), Some("garden"));
    assert_eq!(base.correction_receipts.len(), 2);
    assert_eq!(base.landing_versions["wheel"], 2);
}

#[tokio::test]
async fn correction_rejects_stale_landing_and_reused_identity() {
    let (core, _, _) = setup();
    let req = request();
    let mut stale = req.clone(); stale.observed_text = "different words".into();
    assert!(correction(&core, "you", true, &stale).is_err());
    correction(&core, "you", true, &req).unwrap();
    let mut conflict = req.clone(); conflict.to = "bills".into();
    assert!(correction(&core, "you", true, &conflict).is_err());
    let undo = CorrectionRequest { request_id: uuid::Uuid::new_v4().to_string(), from: "pottery".into(), to: "garden".into(), undo_of: Some(req.request_id.clone()), ..req };
    core.commit(vec![Change::ThoughtMoved { thought_id: "wheel".into(), from: "pottery".into(), thread_id: "bills".into(), undo: false }]);
    core.commit(vec![Change::ThoughtMoved { thought_id: "wheel".into(), from: "bills".into(), thread_id: "pottery".into(), undo: false }]);
    assert!(correction(&core, "you", true, &undo).is_err(), "returning to the same topic must not revive a stale Undo");
    assert_eq!(landing(&core, "wheel"), "pottery");
}
