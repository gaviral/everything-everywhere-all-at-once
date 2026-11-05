use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

const CAPACITY: usize = 128;
const MAX_BYTES: usize = 64 * 1024;
const TTL: Duration = Duration::from_secs(300);

pub(crate) struct Ticket {
    key: String,
    generation: u64,
    json: bool,
}
struct Answer {
    value: Value,
    at: Instant,
}

#[derive(Default)]
pub(super) struct Answers {
    entries: HashMap<String, Answer>,
    order: VecDeque<String>,
    generation: u64,
}

impl Answers {
    pub fn invalidate(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.generation = self.generation.wrapping_add(1);
    }

    /// Exact request bytes, endpoint and model are the key, never fuzzy wording.
    /// Bounded, text-only completions avoid retaining image payloads or tools.
    pub fn lookup(&mut self, url: &str, body: &Value) -> (Option<Value>, Option<Ticket>) {
        if body["stream"] == true || body.get("tools").is_some() {
            return (None, None);
        }
        let Some(messages) = body["messages"].as_array() else {
            return (None, None);
        };
        if !messages
            .iter()
            .all(|message| message["content"].is_string())
        {
            return (None, None);
        }
        let key = format!("{url}\n{body}");
        if key.len() > MAX_BYTES {
            return (None, None);
        }
        let answer = self
            .entries
            .get(&key)
            .filter(|answer| answer.at.elapsed() < TTL)
            .map(|answer| answer.value.clone());
        (
            answer,
            Some(Ticket {
                key,
                generation: self.generation,
                json: body.get("response_format").is_some(),
            }),
        )
    }

    pub fn remember(&mut self, ticket: Ticket, answer: &Value) {
        if ticket.generation != self.generation || answer.to_string().len() > MAX_BYTES {
            return;
        }
        let choice = &answer["choices"][0];
        if choice["finish_reason"] != "stop"
            || !choice["message"]["content"]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        {
            return;
        }
        // A constrained JSON call that returned malformed JSON must remain retryable.
        if ticket.json
            && serde_json::from_str::<Value>(choice["message"]["content"].as_str().unwrap())
                .is_err()
        {
            return;
        }
        self.order.retain(|key| key != &ticket.key);
        while self.order.len() >= CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
        self.order.push_back(ticket.key.clone());
        self.entries.insert(
            ticket.key,
            Answer {
                value: answer.clone(),
                at: Instant::now(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cache_evicts_expires_and_rejects_incomplete_json() {
        let mut cache = Answers::default();
        let request = |n| json!({"messages":[{"role":"user","content":format!("Question {n}")}]});
        let answer =
            json!({"choices":[{"finish_reason":"stop","message":{"content":"Example answer"}}]});
        for n in 0..=CAPACITY {
            let (_, ticket) = cache.lookup("endpoint", &request(n));
            cache.remember(ticket.unwrap(), &answer);
        }
        assert_eq!(cache.entries.len(), CAPACITY);
        assert!(cache.lookup("endpoint", &request(0)).0.is_none());
        assert!(cache.lookup("endpoint", &request(CAPACITY)).0.is_some());
        for entry in cache.entries.values_mut() {
            entry.at = Instant::now() - TTL;
        }
        assert!(cache.lookup("endpoint", &request(CAPACITY)).0.is_none());
        let mut body = request(999);
        body["response_format"] = json!({"type":"json_object"});
        let (_, ticket) = cache.lookup("endpoint", &body);
        cache.remember(ticket.unwrap(), &answer);
        assert!(cache.lookup("endpoint", &body).0.is_none());
    }
}
