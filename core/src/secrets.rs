//! Remove the server credential before provider data reaches a page or trace.
use serde_json::Value;

pub fn text(text: &str, key: Option<&str>) -> String {
    match key.filter(|key| !key.is_empty()) {
        Some(key) => text.replace(key, "[redacted]"),
        None => text.to_owned(),
    }
}

pub fn value(value: &mut Value, key: Option<&str>) {
    let Some(key) = key.filter(|key| !key.is_empty()) else { return; };
    match value {
        Value::String(string) => *string = text(string, Some(key)),
        Value::Array(items) => items.iter_mut().for_each(|item| self::value(item, Some(key))),
        Value::Object(fields) => {
            for (name, mut item) in std::mem::take(fields) {
                self::value(&mut item, Some(key));
                fields.insert(text(&name, Some(key)), item);
            }
        }
        _ => {},
    }
}

pub fn result(result: anyhow::Result<Value>, key: Option<&str>) -> anyhow::Result<Value> {
    result.map(|mut answer| { value(&mut answer, key); answer })
        .map_err(|error| self::error(error, key))
}

pub fn error(error: anyhow::Error, key: Option<&str>) -> anyhow::Error {
    let rendered = format!("{error:#}");
    let safe = text(&rendered, key);
    // Retain typed refusal/rate-limit verdicts when no credential was present.
    if safe == rendered { error } else { anyhow::anyhow!(safe) }
}

/// Retain only a possible credential prefix between deltas, so split keys cannot escape.
pub struct Stream {
    key: Option<String>,
    pending: String,
}

impl Stream {
    pub fn new(key: Option<&str>) -> Self {
        Self { key: key.filter(|key| !key.is_empty()).map(str::to_owned), pending: String::new() }
    }

    pub fn push(&mut self, delta: &str) -> String {
        self.pending.push_str(delta);
        let Some(key) = &self.key else { return std::mem::take(&mut self.pending); };
        let mut safe = text(&std::mem::take(&mut self.pending), Some(key));
        let retained = key.char_indices().map(|(index, _)| index).rev()
            .find(|&index| safe.ends_with(&key[..index])).unwrap_or(0);
        self.pending = safe.split_off(safe.len() - retained);
        safe
    }

    pub fn finish(&mut self) -> String { std::mem::take(&mut self.pending) }
}
