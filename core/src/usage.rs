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
    message_at(core, crate::now_ms())
}

fn message_at(core: &Core, now: u64) -> ServerMsg {
    let data = core.usage.data.lock().unwrap().clone().unwrap_or_else(|| {
        let seconds = now / 1000;
        let (year, month, day) = crate::import::civil_from_days((seconds / 86_400) as i64);
        Data {
            updated: format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
                seconds / 3600 % 24, seconds / 60 % 60, seconds % 60, now % 1000),
            rows: Vec::new(),
        }
    });
    ServerMsg::Usage { data: Some(Snapshot { data, calls: core.service.calls(now) }) }
}

pub async fn run(core: Arc<Core>) {
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

    fn assert_calls_only(message: ServerMsg, used: usize, limit: usize) -> Value {
        let data = value(message)["data"].clone();
        assert_eq!(data["rows"], json!([]), "no fabricated external allowances");
        assert_eq!(data["calls"]["used"], used);
        assert_eq!(data["calls"]["limit"], limit);
        let now = data["calls"]["at_ms"].as_u64().unwrap();
        let seconds = now / 1000;
        let (y, m, d) = crate::import::civil_from_days((seconds / 86_400) as i64);
        assert_eq!(data["updated"], format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
            seconds / 3600 % 24, seconds / 60 % 60, seconds % 60, now % 1000));
        data
    }

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
            assert_calls_only(updates.recv().await.unwrap().message, 1, model::CALLS_PER_HOUR);
        }
        std::fs::remove_file(&path).unwrap();
        tokio::time::advance(REFRESH).await;
        assert_calls_only(updates.recv().await.unwrap().message, 1, model::CALLS_PER_HOUR);
        // A repaired external file returns without a restart.
        std::fs::write(&path, sample.to_string()).unwrap();
        tokio::time::advance(REFRESH).await;
        let restored = value(updates.recv().await.unwrap().message);
        assert_eq!(restored["data"]["rows"], sample["rows"]);
        assert_eq!(restored["data"]["calls"]["used"], 1);
        task.abort();
        drop(core);
        assert!(std::fs::read(dir.join("journal.jsonl")).unwrap().is_empty(), "usage never enters the journal");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn no_file_keeps_live_core_calls_and_periodic_updates() {
        let path = std::env::temp_dir().join(format!("e2a2o-usage-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Arc::new(Core { usage: Runtime::with_path(None).await, service: model::Service::with_limit(2), ..Core::test(journal, world) });
        core.spend().unwrap();
        let first = assert_calls_only(message(&core), 1, 2);
        assert_eq!(core.calls_left(), 1, "remaining uses the existing budget");
        let mut updates = core.updates.subscribe();
        let task = tokio::spawn(run(core.clone()));
        tokio::task::yield_now().await;
        tokio::time::advance(REFRESH - Duration::from_secs(1)).await;
        assert!(updates.try_recv().is_err());
        core.spend().unwrap();
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_calls_only(updates.recv().await.unwrap().message, 2, 2);
        assert_eq!(core.calls_left(), 0);
        assert!(core.spend().is_err(), "reporting does not disable the cap");
        // The same reporting path ages out real calls at the rolling-hour boundary.
        let now = crate::now_ms();
        assert_calls_only(message_at(&core, now + 3_600_000), 0, 2);
        assert_eq!(core.calls_left(), 2);
        tokio::time::advance(REFRESH).await;
        // spend() above also emitted a cap notice; skip it to read the next periodic usage.
        let next = loop {
            let message = updates.recv().await.unwrap().message;
            if matches!(message, ServerMsg::Usage { .. }) { break message; }
        };
        let next = assert_calls_only(next, 0, 2);
        assert!(next["calls"]["at_ms"].as_u64().unwrap() >= first["calls"]["at_ms"].as_u64().unwrap());
        task.abort();
        task.await.unwrap_err();
        drop(core);
        assert!(std::fs::read(&path).unwrap().is_empty(), "usage never enters the journal");
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn missing_file_and_uncapped_calls_still_report() {
        let path = std::env::temp_dir().join(format!("e2a2o-usage-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core { usage: Runtime::with_path(Some(path.with_extension("missing"))).await,
            service: model::Service::with_limit(0), ..Core::test(journal, world) };
        core.spend().unwrap();
        assert_calls_only(message(&core), 1, 0);
        drop(core);
        std::fs::remove_file(path).unwrap();
    }
}
