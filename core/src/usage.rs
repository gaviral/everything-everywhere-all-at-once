//! Usage allowances from USAGE_FILE, plus this core's rolling-hour model budget. Transient: never journaled.
use crate::{model, protocol::ServerMsg, Core};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const REFRESH: Duration = Duration::from_secs(60);

#[derive(Clone, Deserialize, Serialize)]
pub struct Row {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spent_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap_usd: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Data {
    pub updated: String,
    pub rows: Vec<Row>,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    #[serde(flatten)]
    data: Data,
    calls: model::Calls,
}

#[derive(Default)]
pub struct Runtime {
    path: Option<PathBuf>,
    data: Mutex<Option<Data>>,
}

impl Runtime {
    pub async fn from_env() -> Self {
        let path = std::env::var_os("USAGE_FILE").filter(|path| !path.is_empty()).map(PathBuf::from);
        Self::with_path(path).await
    }

    async fn with_path(path: Option<PathBuf>) -> Self {
        let runtime = Self { path, data: Mutex::new(None) };
        runtime.refresh().await;
        runtime
    }

    async fn refresh(&self) {
        let Some(path) = &self.path else { return };
        let data = match tokio::fs::read(path).await {
            Ok(bytes) => serde_json::from_slice::<Data>(&bytes).ok().filter(|data| {
                !data.updated.trim().is_empty() && data.rows.iter().all(|row| {
                    !row.label.trim().is_empty() && match (row.used_pct, row.left.as_deref(), row.spent_usd, row.cap_usd) {
                        (Some(pct), _, _, _) => pct.is_finite() && pct >= 0.0,
                        (_, Some(left), _, _) => !left.trim().is_empty(),
                        (_, _, Some(spent), Some(cap)) => spent.is_finite() && spent >= 0.0 && cap.is_finite() && cap >= 0.0,
                        _ => false,
                    }
                })
            }),
            Err(_) => None,
        };
        // A missing or malformed file clears the old allowances; never present them as current.
        *self.data.lock().unwrap() = data;
    }
}

pub fn message(core: &Core) -> ServerMsg {
    let data = core.usage.data.lock().unwrap().clone();
    ServerMsg::Usage { data: data.map(|data| Snapshot { data, calls: core.service.calls(crate::now_ms()) }) }
}

pub async fn run(core: Arc<Core>) {
    if core.usage.path.is_none() { return; }
    let mut timer = tokio::time::interval_at(tokio::time::Instant::now() + REFRESH, REFRESH);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        timer.tick().await;
        core.usage.refresh().await;
        core.send(message(&core));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::Journal;
    use serde_json::{json, Value};

    fn value(message: ServerMsg) -> Value { serde_json::to_value(message).unwrap() }

    #[tokio::test(start_paused = true)]
    async fn usage_replays_and_refreshes_each_minute_and_clears_bad_data() {
        let dir = std::env::temp_dir().join(format!("e2a2o-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("usage.json");
        let sample = json!({"updated":"2026-11-03T14:40:00Z", "rows":[
            {"label":"Claude weekly", "used_pct":67.0}, {"label":"ChatGPT", "left":"25 messages"},
            {"label":"Meta API", "spent_usd":12.3, "cap_usd":100.0}, {"label":"Muse", "left":"10 credits"}
        ]});
        std::fs::write(&path, sample.to_string()).unwrap();
        let (journal, world) = Journal::open(&dir.join("journal.jsonl")).unwrap();
        let core = Arc::new(Core { usage: Runtime::with_path(Some(path.clone())).await, ..Core::test(journal, world) });
        core.spend().unwrap();
        let replay = crate::catch_up(&core, "you").into_iter().find(|msg| matches!(msg, ServerMsg::Usage { .. })).unwrap();
        let replay = value(replay);
        assert_eq!(replay["data"]["rows"], sample["rows"]);
        assert_eq!(replay["data"]["updated"], sample["updated"]);
        assert_eq!(replay["data"]["calls"]["used"], 1);
        assert_eq!(replay["data"]["calls"]["limit"], model::CALLS_PER_HOUR);

        let mut updates = core.updates.subscribe();
        let task = tokio::spawn(run(core.clone()));
        tokio::task::yield_now().await;
        std::fs::write(&path, r#"{"updated":"2026-11-03T14:41:00Z","rows":[{"label":"Claude weekly","used_pct":68}]}"#).unwrap();
        tokio::time::advance(Duration::from_secs(59)).await;
        assert!(updates.try_recv().is_err(), "no polling before the minute ends");
        tokio::time::advance(Duration::from_secs(1)).await;
        let next = value(updates.recv().await.unwrap().message);
        assert_eq!(next["data"]["rows"][0]["used_pct"], 68.0);
        let replay = value(message(&core));
        assert_eq!(replay["data"]["updated"], "2026-11-03T14:41:00Z");

        for contents in [
            "not JSON",
            r#"{"updated":"now","rows":[{"label":"Broken"}]}"#,
            r#"{"updated":"now","rows":[{"label":"Broken","used_pct":-1,"left":"valid text"}]}"#,
        ] {
            std::fs::write(&path, contents).unwrap();
            tokio::time::advance(REFRESH).await;
            assert!(value(updates.recv().await.unwrap().message)["data"].is_null());
        }
        std::fs::remove_file(&path).unwrap();
        tokio::time::advance(REFRESH).await;
        assert!(value(updates.recv().await.unwrap().message)["data"].is_null());
        task.abort();
        drop(core);
        assert!(std::fs::read(dir.join("journal.jsonl")).unwrap().is_empty(), "usage never enters the journal");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn no_file_has_no_allowances_or_core_row() {
        let path = std::env::temp_dir().join(format!("e2a2o-usage-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core { usage: Runtime::with_path(None).await, ..Core::test(journal, world) };
        core.spend().unwrap();
        assert_eq!(value(message(&core)), json!({"type":"usage", "data":null}));
        let missing = Core { usage: Runtime::with_path(Some(path.with_extension("missing"))).await, ..core };
        assert_eq!(value(message(&missing)), json!({"type":"usage", "data":null}));
        drop(missing);
        std::fs::remove_file(path).unwrap();
    }
}
