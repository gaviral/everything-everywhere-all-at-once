//! The trace: where each thought went and why, for checking the placer against what was meant. Off unless
//! `E2A2O_TRACE=1`; then `trace.jsonl` beside the journal gets one JSON line for each model call (what was
//! sent, what came back, how long it took), each placement (the thread chosen, the one active when it was said,
//! the changes it made), each finished voice turn (the words as heard and as kept) and each thread picture
//! saved (where). Lines about one thought share its id; a picture's call and its saved line share the thread's. Never the key or any header. A line that can't be written is warned about and dropped:
//! the trace never holds up or loses a thought. Read it with `node scripts/where.mjs`.

use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

/// What a model call was for: `extra`'s "feature" when it names one, else the prompt cache key without
/// "e2a2o-", else "other". The trace line and the window's model line (`ServerMsg::Step`) both say this.
pub fn feature(body: &Value, extra: &Value) -> String {
    extra["feature"]
        .as_str()
        .or_else(|| body["prompt_cache_key"].as_str().map(|k| k.strip_prefix("e2a2o-").unwrap_or(k)))
        .unwrap_or("other")
        .to_string()
}

#[derive(Default)]
pub struct Trace {
    file: Option<Mutex<File>>,
}

/// True for a switch that says on: "1", "on", "true" or "yes".
pub(crate) fn on(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "1" | "on" | "true" | "yes"
    )
}

impl Trace {
    /// From `E2A2O_TRACE`: `trace.jsonl` in `dir` when on, else nothing.
    pub fn from_env(dir: &Path) -> Trace {
        if !std::env::var("E2A2O_TRACE").is_ok_and(|v| on(&v)) {
            return Trace::default();
        }
        Trace::to(dir)
    }

    /// Writes to `trace.jsonl` in `dir`, appending; nothing if it can't be opened (said once).
    pub fn to(dir: &Path) -> Trace {
        let path = dir.join("trace.jsonl");
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(file) => {
                tracing::info!("tracing model calls and placements to {}", path.display());
                Trace {
                    file: Some(Mutex::new(file)),
                }
            }
            Err(e) => {
                tracing::warn!("couldn't open {} for the trace: {e}", path.display());
                Trace::default()
            }
        }
    }

    pub fn is_on(&self) -> bool {
        self.file.is_some()
    }

    /// Appends `line` with the time, as one line. Built only when on, so an off trace costs nothing.
    pub fn write(&self, line: impl FnOnce() -> Value) {
        let Some(file) = &self.file else { return };
        let mut line = line();
        line["at"] = json!(crate::now_ms());
        let mut text = line.to_string();
        text.push('\n');
        if let Err(e) = file.lock().unwrap().write_all(text.as_bytes()) {
            tracing::warn!("trace write failed: {e}");
        }
    }

    /// One model call: the feature (its prompt cache key without "e2a2o-"), the model, what was sent (the
    /// messages, or the prompt), and the answer's text, finish reason and usage (for a picture, how many came
    /// back), or the error. `extra` adds fields, such as the thought being placed, and overrides them: a call
    /// with no prompt cache key names its feature there.
    pub fn call(
        &self,
        body: &Value,
        started: Instant,
        result: Result<&Value, &anyhow::Error>,
        extra: Value,
    ) {
        self.write(|| {
            let feature = feature(body, &extra);
            let sent = body
                .get("messages")
                .or_else(|| body.get("prompt"))
                .cloned()
                .unwrap_or(Value::Null);
            let mut line = json!({
                "kind": "call",
                "feature": feature,
                "model": body["model"],
                "ms": started.elapsed().as_millis() as u64,
                "sent": sent,
            });
            match result {
                // A picture comes back as `data`, not a message: how many, never the image itself (megabytes
                // of base64); the line the caller writes once it's saved says where (`picture`).
                Ok(value) if value["data"].is_array() => {
                    line["answer"] = json!({"images": value["data"].as_array().map_or(0, Vec::len)});
                    line["usage"] = value["usage"].clone();
                }
                Ok(value) => {
                    let choice = &value["choices"][0];
                    line["answer"] = choice["message"]["content"].clone();
                    line["finish"] = choice["finish_reason"].clone();
                    line["usage"] = value["usage"].clone();
                }
                Err(e) => line["error"] = json!(format!("{e:#}")),
            }
            if let (Some(line), Value::Object(extra)) = (line.as_object_mut(), extra) {
                line.extend(extra);
            }
            line
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{on, Trace};
    use serde_json::json;
    use std::time::Instant;

    fn lines(dir: &std::path::Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(dir.join("trace.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "e2a2o-trace-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_switch_reads_the_usual_ways_of_saying_on() {
        for yes in ["1", "on", "true", "YES", " 1 "] {
            assert!(on(yes), "{yes}");
        }
        for no in ["", "0", "off", "false", "no"] {
            assert!(!on(no), "{no}");
        }
    }

    #[test]
    fn off_writes_nothing() {
        let trace = Trace::default();
        assert!(!trace.is_on());
        trace.write(|| panic!("an off trace builds no line"));
    }

    #[test]
    fn a_call_is_one_line_with_what_was_sent_and_what_came_back_and_no_key() {
        let dir = dir("call");
        let trace = Trace::to(&dir);
        let body = json!({"model": "m", "prompt_cache_key": "e2a2o-placer", "messages": [{"role": "user", "content": "hi"}]});
        let answer = json!({"choices": [{"message": {"content": "{\"action\":\"new\"}"}, "finish_reason": "stop"}], "usage": {"total_tokens": 9}});
        trace.call(
            &body,
            Instant::now(),
            Ok(&answer),
            json!({"thought": "th-1", "try": 1}),
        );
        let failed = anyhow::anyhow!("500: down");
        trace.call(
            &json!({"model": "m"}),
            Instant::now(),
            Err(&failed),
            json!(null),
        );
        let lines = lines(&dir);
        assert_eq!(lines.len(), 2);
        let (ok, err) = (&lines[0], &lines[1]);
        assert_eq!(
            (
                ok["kind"].as_str(),
                ok["feature"].as_str(),
                ok["thought"].as_str()
            ),
            (Some("call"), Some("placer"), Some("th-1"))
        );
        assert_eq!(ok["sent"][0]["content"], "hi");
        assert_eq!(ok["answer"], "{\"action\":\"new\"}");
        assert_eq!(ok["finish"], "stop");
        assert_eq!(ok["usage"]["total_tokens"], 9);
        assert!(ok["at"].as_u64().is_some() && ok["ms"].as_u64().is_some());
        assert_eq!(
            (err["feature"].as_str(), err["error"].as_str()),
            (Some("other"), Some("500: down"))
        );
        assert!(!std::fs::read_to_string(dir.join("trace.jsonl"))
            .unwrap()
            .to_lowercase()
            .contains("bearer"));
    }

    #[test]
    fn a_picture_call_names_its_feature_and_counts_the_images_without_holding_them() {
        let dir = dir("picture");
        let trace = Trace::to(&dir);
        let body = json!({"model": "muse-image-1.0", "prompt": "a lighthouse", "n": 1});
        let image = "A".repeat(4096);
        let answer = json!({"data": [{"b64_json": image}], "usage": {"total_tokens": 3}});
        trace.call(&body, Instant::now(), Ok(&answer), json!({"feature": "picture", "thread": "T1"}));
        let text = std::fs::read_to_string(dir.join("trace.jsonl")).unwrap();
        let line = &lines(&dir)[0];
        assert_eq!((line["feature"].as_str(), line["thread"].as_str()), (Some("picture"), Some("T1")));
        assert_eq!((line["sent"].as_str(), line["answer"]["images"].as_u64()), (Some("a lighthouse"), Some(1)));
        assert_eq!(line["usage"]["total_tokens"], 3);
        assert!(!text.contains(&image) && text.len() < 1024, "the image stays out: {} bytes", text.len());
    }

    #[test]
    fn a_trace_that_cant_open_is_off_and_never_fails_a_thought() {
        let trace = Trace::to(std::path::Path::new("/nonexistent/e2a2o/trace"));
        assert!(!trace.is_on());
        trace.write(|| json!({"kind": "placed"}));
    }
}
