//! What every model call shares: the call itself (`call_model`, or `ask_model` for a feature's own model
//! setting), how its answer is read, whether the key still works, and what an answer's status means for
//! the calls after it. A refused key (401 or 403) won't fix itself, so it stops every model call until a
//! restart and every window is told; a busy service (429) is said once a spell, and a caller that tries
//! again does so on its own schedule. A default model in Contributor mode that the key can't use gives
//! way to the same model without it, for the rest of the session. The core makes at most a set number of model
//! calls in any hour (`CALLS_PER_HOUR`), so a loop nobody is watching can't run up the bill; past it, every model
//! feature rests as it does without a key, said once, until the oldest call is an hour old.

use crate::{protocol::ServerMsg, Core};
use anyhow::bail;
use reqwest::StatusCode;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// What every window is told when the service refuses the key, then and on connecting after.
/// The UI knows it by "MODEL_API_KEY" and "refused".
pub const REFUSED: &str = "The AI key was refused. Check MODEL_API_KEY in .env, then restart.";

/// Said when the service is busy. Thoughts are placed again on their own (placer.rs); a Recap, Explain or search
/// asks once, so the person asks again.
const BUSY: &str = "The AI service is busy. Thoughts retry on their own; try anything else again shortly.";

/// A busy spell is said once. It lasts as long as callers back off from it, and the longest wait between
/// tries is the refiner's 5 minutes (`refiner::rest_ms`), so one spell's own retries never say it twice.
const SPELL_MS: u64 = 5 * 60_000;

/// The most model calls the core makes in any 60 minutes, unless MODEL_CALLS_PER_HOUR says otherwise (0 turns it off).
/// Worked back from User's own map on Nov 1: its busiest hour held 74 spoken thoughts, 30 new threads and 3 recaps,
/// which is at most ≈ 200 calls (77 placements, 3 of them splits; the Argument app on ≤ 44 thoughts with an earlier
/// point; the refiner on ≤ 37, one per two thoughts; 30 pictures; 3 recaps; a few Explains and searches). Twice that
/// leaves room for a faster talker or a room of two, and a runaway (a timer app every 10 s is 360 an hour) still
/// stops within the hour, at ≈ US$0.50 of text calls.
pub const CALLS_PER_HOUR: usize = 400;
const HOUR_MS: u64 = 60 * 60_000;

/// What a model answer's status means for the calls after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// 2xx: it worked.
    Fine,
    /// 401 or 403: the key is wrong, expired or revoked; no call works until a restart with another.
    Refused,
    /// 429: too many calls for now; worth trying again later.
    Busy,
    /// Anything else, such as a 500: maybe a blip; the caller decides.
    Other,
    /// Not sent: the core already made its `CALLS_PER_HOUR` in the last hour.
    Capped,
}

/// Sorts a model answer by its HTTP status.
pub fn verdict(status: StatusCode) -> Verdict {
    match status {
        s if s.is_success() => Verdict::Fine,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Verdict::Refused,
        StatusCode::TOO_MANY_REQUESTS => Verdict::Busy,
        _ => Verdict::Other,
    }
}

/// Voice Transcribe answers on a WebSocket that opens before the key is read, so its errors name a type
/// instead of a status: a wrong key is an "authentication_error", as in the chat API's 401 body.
pub fn status_of(error_type: &str) -> Option<StatusCode> {
    match error_type {
        "authentication_error" => Some(StatusCode::UNAUTHORIZED),
        "permission_error" => Some(StatusCode::FORBIDDEN),
        "rate_limit_error" => Some(StatusCode::TOO_MANY_REQUESTS),
        _ => None,
    }
}

impl Verdict {
    /// The verdict that ended a call, when it was the service's answer rather than the call itself.
    pub fn of(e: &anyhow::Error) -> Option<Verdict> {
        e.downcast_ref::<Verdict>().copied()
    }
}

impl std::fmt::Display for Verdict {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str(match self {
            Verdict::Fine => "the AI service answered",
            Verdict::Refused => "the AI key was refused",
            Verdict::Busy => "the AI service is busy",
            Verdict::Other => "the AI service failed",
            Verdict::Capped => "this hour's AI calls are used up",
        })
    }
}

impl std::error::Error for Verdict {}

/// What a key gets for a model it isn't allowed (401 or 403), or can't see (404).
fn cant_use(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
}

/// A feature's model: the person's own setting, asked as is, or the default. A default in Contributor mode
/// (Meta may keep what it reads) gives way to the same model without it when the key can't use it, since
/// not every key is allowed Contributor mode.
pub struct Setting {
    name: String,
    /// The same model without Contributor mode, for a default that has one; never for the person's own choice.
    base: Option<String>,
    /// Set once the key couldn't use `name` and `base` worked: `base` from then on, until a restart.
    on_base: AtomicBool,
}

impl Setting {
    /// The environment's `var`, the person's choice, when it's set and not empty; else `default`.
    pub fn from_env(var: &str, default: &str) -> Self {
        Self::new(std::env::var(var).ok().filter(|m| !m.trim().is_empty()), default)
    }

    fn new(chosen: Option<String>, default: &str) -> Self {
        let base = if chosen.is_none() { default.strip_suffix("-contributor").map(String::from) } else { None };
        Setting { name: chosen.unwrap_or_else(|| default.into()), base, on_base: AtomicBool::new(false) }
    }

    /// The model to ask now.
    pub fn name(&self) -> &str {
        match &self.base {
            Some(base) if self.on_base.load(Ordering::Relaxed) => base,
            _ => &self.name,
        }
    }
}

/// A fixed name, as the tests use: asked as is, like the person's own setting.
impl From<&str> for Setting {
    fn from(name: &str) -> Self {
        Setting::new(Some(name.into()), name)
    }
}

/// What the model service has said about the key and its load, and the calls made this hour. It lives on the core,
/// so it lasts until a restart.
pub struct Service {
    /// Set by the first 401 or 403 and never cleared: a restart reads the key again.
    refused: AtomicBool,
    /// When a busy spell was last said.
    busy_said_ms: AtomicU64,
    /// The most calls in any hour; 0 for no cap.
    limit: usize,
    /// When each call of the last hour was sent, oldest first.
    calls: Mutex<VecDeque<u64>>,
    /// Set when the cap was said, cleared by the next call that goes out, so each spell is said once.
    capped_said: AtomicBool,
}

impl Default for Service {
    fn default() -> Self {
        Service::with_limit(CALLS_PER_HOUR)
    }
}

impl Service {
    pub fn with_limit(limit: usize) -> Self {
        Service { refused: AtomicBool::new(false), busy_said_ms: AtomicU64::new(0), limit, calls: Mutex::default(), capped_said: AtomicBool::new(false) }
    }

    /// MODEL_CALLS_PER_HOUR when it's a number, else `CALLS_PER_HOUR`.
    pub fn from_env() -> Self {
        let set = std::env::var("MODEL_CALLS_PER_HOUR").ok();
        let limit = match set.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            None => CALLS_PER_HOUR,
            Some(v) => v.parse().unwrap_or_else(|_| {
                tracing::warn!("MODEL_CALLS_PER_HOUR={v:?} isn't a whole number: using {CALLS_PER_HOUR}");
                CALLS_PER_HOUR
            }),
        };
        if limit == 0 {
            tracing::warn!("MODEL_CALLS_PER_HOUR=0: no cap on model calls");
        }
        Service::with_limit(limit)
    }

    /// While the cap is reached at `now`: how long until the oldest call of the hour leaves it.
    fn capped_for(&self, now: u64) -> Option<u64> {
        if self.limit == 0 {
            return None;
        }
        let mut calls = self.calls.lock().unwrap();
        while calls.front().is_some_and(|&at| now.saturating_sub(at) >= HOUR_MS) {
            calls.pop_front();
        }
        (calls.len() >= self.limit).then(|| (calls[calls.len() - self.limit] + HOUR_MS).saturating_sub(now))
    }

    /// Counts a call about to be sent at `now`, or says how long until one may be.
    fn spend(&self, now: u64) -> Result<(), u64> {
        if let Some(wait) = self.capped_for(now) {
            return Err(wait);
        }
        if self.limit > 0 {
            self.calls.lock().unwrap().push_back(now);
        }
        self.capped_said.store(false, Ordering::Relaxed);
        Ok(())
    }
}

/// What the person is told while the cap holds: for how long, why, and that nothing they say is lost. Short enough
/// for the 5 s a notice shows (App.tsx).
pub fn capped(limit: usize, wait_ms: u64) -> String {
    let minutes = wait_ms.div_ceil(60_000).max(1);
    format!("AI paused up to {minutes} min (hourly limit of {limit} calls). Your words are kept.")
}

impl Core {
    /// The key for a model call, or why there's none (missing, or refused), so nothing is sent that can't work.
    /// While this hour's calls are used up, it's that, said once a spell: every feature rests as it does without a key.
    pub fn key(&self) -> anyhow::Result<&str> {
        let key = self.listening_key()?;
        if let Some(wait) = self.service.capped_for(crate::now_ms()) {
            self.say_capped(wait);
            return Err(Verdict::Capped.into());
        }
        Ok(key)
    }

    /// The key for Voice Transcribe, which the cap doesn't stop: a stream is one call a session, not a loop, and
    /// what's heard while the cap holds is kept and placed after.
    pub fn listening_key(&self) -> anyhow::Result<&str> {
        if self.key_refused() {
            return Err(Verdict::Refused.into());
        }
        self.key.as_deref().ok_or_else(|| anyhow::anyhow!("MODEL_API_KEY is not set"))
    }

    /// What the person is told while this hour's calls are used up, or None.
    pub fn capped_message(&self) -> Option<String> {
        self.service.capped_for(crate::now_ms()).map(|wait| capped(self.service.limit, wait))
    }

    /// Counts one model call about to go out; past the cap, ends it unsent instead.
    pub fn spend(&self) -> anyhow::Result<()> {
        self.service.spend(crate::now_ms()).map_err(|wait| {
            self.say_capped(wait);
            Verdict::Capped.into()
        })
    }

    fn say_capped(&self, wait: u64) {
        if !self.service.capped_said.swap(true, Ordering::Relaxed) {
            tracing::warn!("{} model calls in the last hour (MODEL_CALLS_PER_HOUR): model features rest for {} s", self.service.limit, wait / 1000);
            self.send(ServerMsg::Notice { message: capped(self.service.limit, wait) });
        }
    }

    /// True once the service refused the key, until a restart.
    pub fn key_refused(&self) -> bool {
        self.service.refused.load(Ordering::Relaxed)
    }

    /// Reads a model answer's status before its body, which may not be JSON. A refused key stops every model
    /// call from here on and tells every window; a busy service is said once a spell. Both end the call with
    /// their verdict as the error. Any other failure is the caller's to report (`answer` does it for a model call).
    pub fn check(&self, status: StatusCode) -> anyhow::Result<()> {
        match verdict(status) {
            Verdict::Refused => {
                if !self.service.refused.swap(true, Ordering::Relaxed) {
                    tracing::warn!("the model service refused MODEL_API_KEY ({status}): no more model calls until a restart");
                    self.send(ServerMsg::Notice { message: REFUSED.into() });
                }
                Err(Verdict::Refused.into())
            }
            Verdict::Busy => {
                let (now, said) = (crate::now_ms(), self.service.busy_said_ms.load(Ordering::Relaxed));
                // Two calls turned away at once say it once.
                let fresh = now.saturating_sub(said) >= SPELL_MS
                    && self.service.busy_said_ms.compare_exchange(said, now, Ordering::Relaxed, Ordering::Relaxed).is_ok();
                if fresh {
                    tracing::warn!("the model service is busy ({status}): each caller backs off and tries again");
                    self.send(ServerMsg::Notice { message: BUSY.into() });
                }
                Err(Verdict::Busy.into())
            }
            Verdict::Fine | Verdict::Other | Verdict::Capped => Ok(()),
        }
    }

    /// One model call: posts `body` to `url` with the key and waits at most `patience` for the whole answer,
    /// its body included. The answer's status goes through `check`, then its JSON through `answer`.
    pub async fn call_model(&self, url: &str, body: &Value, patience: Duration) -> anyhow::Result<Value> {
        let key = self.key()?;
        self.spend()?;
        let response = self.http.post(url).bearer_auth(key).timeout(patience).json(body).send().await?;
        self.check(response.status())?;
        answer(response).await
    }

    /// Asks a feature's model: `send` posts the request for one model name, and the answer's status is read as
    /// `check` reads it; the caller reads the rest with `answer`. When the key can't use a default model in
    /// Contributor mode (401, 403 or 404), the same request goes once to the model without it; if that one
    /// works, the feature keeps it until a restart, said once. The key counts as refused only if that model
    /// refuses it too.
    pub async fn ask_model<F, R>(&self, setting: &Setting, send: F) -> anyhow::Result<reqwest::Response>
    where
        F: Fn(&str) -> R,
        R: std::future::Future<Output = reqwest::Result<reqwest::Response>>,
    {
        let model = setting.name();
        self.spend()?;
        let mut response = send(model).await?;
        if let Some(base) = setting.base.as_deref().filter(|base| *base != model && cant_use(response.status())) {
            tracing::info!("{model} answered {}: asking {base} instead", response.status());
            self.spend()?;
            response = send(base).await?;
            // Two features finding out at once say it once.
            if response.status().is_success() && !setting.on_base.swap(true, Ordering::Relaxed) {
                tracing::warn!("this key can't use {model}: {base} from now on, until a restart");
                self.send(ServerMsg::Notice { message: format!("Using {base} (this key can't use the contributor model).") });
            }
        }
        self.check(response.status())?;
        Ok(response)
    }
}

/// The JSON of a model's answer, once `check` has read its status. Any other failure ends the call with the
/// service's own words, such as "400 Bad Request: …".
pub async fn answer(response: reqwest::Response) -> anyhow::Result<Value> {
    let status = response.status();
    let value: Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{answer, status_of, verdict, Setting, Verdict, REFUSED};
    use crate::placer::{self, Job};
    use crate::protocol::{Outgoing, ServerMsg};
    use crate::world::Journal;
    use crate::Core;
    use reqwest::StatusCode;
    use std::sync::{Arc, Mutex};
    use tokio::sync::{broadcast, mpsc};

    struct Fixture {
        core: Arc<Core>,
        queue: Option<mpsc::UnboundedReceiver<Job>>,
        path: std::path::PathBuf,
    }

    impl Fixture {
        fn new(key: Option<&str>) -> Self {
            let path = std::env::temp_dir().join(format!("e2a2o-model-{}.jsonl", uuid::Uuid::new_v4()));
            let (journal, world) = Journal::open(&path).unwrap();
            let (placer_queue, queue) = mpsc::unbounded_channel();
            let core = Arc::new(Core { placer_queue, key: key.map(Into::into), ..Core::test(journal, world) });
            Fixture { core, queue: Some(queue), path }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn notices(updates: &mut broadcast::Receiver<Outgoing>) -> Vec<String> {
        std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|o| match o.message {
                ServerMsg::Notice { message } | ServerMsg::Error { message } => Some(message),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn statuses_sort_into_refused_busy_and_the_rest() {
        for (status, expected) in [
            (200, Verdict::Fine),
            (201, Verdict::Fine),
            (401, Verdict::Refused),
            (403, Verdict::Refused),
            (429, Verdict::Busy),
            (400, Verdict::Other),
            (404, Verdict::Other),
            (500, Verdict::Other),
            (503, Verdict::Other),
        ] {
            assert_eq!(verdict(StatusCode::from_u16(status).unwrap()), expected, "{status}");
        }
        assert_eq!(status_of("authentication_error"), Some(StatusCode::UNAUTHORIZED), "what Voice Transcribe sends for a wrong key");
        assert_eq!(status_of("invalid_request_error"), None);
    }

    /// A stand-in for the model service on this machine: each call answers with the `status` and `answer`
    /// its body asks for, after `wait_ms`. `keys` records the key each call came with.
    async fn stand_in() -> (String, Arc<Mutex<Vec<String>>>) {
        let keys = Arc::new(Mutex::new(Vec::new()));
        let seen = keys.clone();
        let service = move |headers: axum::http::HeaderMap, axum::Json(body): axum::Json<serde_json::Value>| async move {
            seen.lock().unwrap().push(headers["authorization"].to_str().unwrap().to_string());
            tokio::time::sleep(std::time::Duration::from_millis(body["wait_ms"].as_u64().unwrap_or(0))).await;
            (StatusCode::from_u16(body["status"].as_u64().unwrap() as u16).unwrap(), body["answer"].to_string())
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        let routes = axum::Router::new().route("/v1/chat/completions", axum::routing::post(service));
        tokio::spawn(async move { axum::serve(listener, routes).await });
        (url, keys)
    }

    /// One call to the stand-in, with half a second's patience.
    async fn call(core: &Core, url: &str, status: u16, answer: serde_json::Value, wait_ms: u64) -> anyhow::Result<serde_json::Value> {
        let body = serde_json::json!({"status": status, "answer": answer, "wait_ms": wait_ms});
        core.call_model(url, &body, std::time::Duration::from_millis(500)).await
    }

    /// Every model call but placing and Explain goes through `call_model`, so this is how they all behave.
    #[tokio::test]
    async fn a_model_call_sends_the_key_reads_the_answer_and_gives_up_on_time() {
        use serde_json::json;
        let (url, keys) = stand_in().await;
        let fixture = Fixture::new(Some("good"));
        let core = &fixture.core;
        let reply = json!({"choices": [{"message": {"content": "hi"}}]});
        assert_eq!(call(core, &url, 200, reply.clone(), 0).await.unwrap(), reply);
        assert_eq!(*keys.lock().unwrap(), ["Bearer good"]);
        // Any other failure, in the service's own words, even with a body that looks like an answer.
        let failed = call(core, &url, 400, json!({"error": {"message": "bad schema"}}), 0).await.unwrap_err();
        assert_eq!(failed.to_string(), "400 Bad Request: bad schema");
        assert_eq!(call(core, &url, 503, reply.clone(), 0).await.unwrap_err().to_string(), "503 Service Unavailable: no message");
        let not_json = reqwest::Response::from(axum::http::Response::builder().status(502).body("<html>Bad gateway</html>".to_string()).unwrap());
        assert!(answer(not_json).await.is_err());
        // Too slow: cut off at the call's patience, reading the answer included.
        let started = std::time::Instant::now();
        let slow = call(core, &url, 200, reply.clone(), 3_000).await.unwrap_err();
        assert!(slow.downcast_ref::<reqwest::Error>().is_some_and(|e| e.is_timeout()), "{slow:#}");
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        // A refused key stops this call and every one after it, which isn't even sent.
        assert_eq!(Verdict::of(&call(core, &url, 401, json!({}), 0).await.unwrap_err()), Some(Verdict::Refused));
        let sent = keys.lock().unwrap().len();
        assert_eq!(Verdict::of(&call(core, &url, 200, reply, 0).await.unwrap_err()), Some(Verdict::Refused));
        assert_eq!(keys.lock().unwrap().len(), sent);
    }

    #[test]
    fn a_refused_key_stops_every_call_and_is_said_once() {
        let fixture = Fixture::new(Some("wrong"));
        let core = &fixture.core;
        let mut updates = core.updates.subscribe();
        assert_eq!(core.key().unwrap(), "wrong");
        assert!(core.check(StatusCode::OK).is_ok());
        assert!(core.check(StatusCode::INTERNAL_SERVER_ERROR).is_ok(), "a blip is the caller's to report, as before");
        assert!(!core.key_refused());
        for status in [StatusCode::UNAUTHORIZED, StatusCode::UNAUTHORIZED, StatusCode::FORBIDDEN] {
            let e = core.check(status).unwrap_err();
            assert_eq!(Verdict::of(&e), Some(Verdict::Refused));
        }
        assert!(core.key_refused());
        assert_eq!(Verdict::of(&core.key().unwrap_err()), Some(Verdict::Refused), "nothing more is sent");
        assert_eq!(notices(&mut updates), [REFUSED], "every window is told once");
        // A window that connects later is told too, the way it's told about a missing key.
        let told = crate::catch_up(core, "you").into_iter().filter(|m| matches!(m, ServerMsg::Notice { message } if message == REFUSED)).count();
        assert_eq!(told, 1);
        assert!(Fixture::new(None).core.key().unwrap_err().to_string().contains("MODEL_API_KEY is not set"));
    }

    #[test]
    fn a_busy_service_is_said_once_a_spell_and_the_key_keeps_working() {
        let fixture = Fixture::new(Some("good"));
        let core = &fixture.core;
        let mut updates = core.updates.subscribe();
        for _ in 0..3 {
            assert_eq!(Verdict::of(&core.check(StatusCode::TOO_MANY_REQUESTS).unwrap_err()), Some(Verdict::Busy));
        }
        assert!(core.check(StatusCode::OK).is_ok());
        assert_eq!(Verdict::of(&core.check(StatusCode::TOO_MANY_REQUESTS).unwrap_err()), Some(Verdict::Busy));
        let said = notices(&mut updates);
        assert_eq!(said.len(), 1, "once, however often it's busy within a spell: {said:?}");
        assert!(said[0].contains("busy") && !said[0].contains("MODEL_API_KEY"), "{said:?}");
        assert!(!core.key_refused());
        assert_eq!(core.key().unwrap(), "good");
    }

    #[test]
    fn the_busy_notice_promises_a_retry_only_for_thoughts() {
        // Placing tries a busy thought again on its own (placer.rs); a Recap, Explain or search asks once.
        let fixture = Fixture::new(Some("good"));
        let mut updates = fixture.core.updates.subscribe();
        let _ = fixture.core.check(StatusCode::TOO_MANY_REQUESTS);
        let said = notices(&mut updates).join("\n");
        assert!(said.contains("Thoughts retry on their own") && said.contains("try anything else again"), "{said}");
        assert!(said.split_whitespace().count() <= 15, "short enough to read in the 5 s a notice shows (App.tsx): {said}");
    }

    #[test]
    fn the_cap_counts_an_hour_of_calls_and_frees_one_as_the_oldest_ages_out() {
        let service = super::Service::with_limit(3);
        let hour = 60 * 60_000;
        for at in [0, 10, 20] {
            assert_eq!(service.spend(at), Ok(()));
        }
        assert_eq!(service.spend(30), Err(hour - 30), "full: the wait is until the oldest call is an hour old");
        assert_eq!(service.spend(hour - 1), Err(1));
        assert_eq!(service.spend(hour), Ok(()), "the call at 0 left the hour");
        assert_eq!(service.spend(hour + 5), Err(5), "the next to leave is the one at 10, 5 ms on");
        let off = super::Service::with_limit(0);
        assert!((0..1000).all(|at| off.spend(at).is_ok()), "0 is no cap");
        assert_eq!(super::Service::default().limit, super::CALLS_PER_HOUR);
    }

    #[tokio::test]
    async fn past_the_cap_nothing_is_sent_every_feature_rests_and_listening_goes_on() {
        use serde_json::json;
        let (url, keys) = stand_in().await;
        let path = std::env::temp_dir().join(format!("e2a2o-model-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, world) = Journal::open(&path).unwrap();
        let core = Core { key: Some("good".into()), service: super::Service::with_limit(2), ..Core::test(journal, world) };
        let mut updates = core.updates.subscribe();
        let reply = json!({"choices": [{"message": {"content": "hi"}}]});
        assert!(call(&core, &url, 200, reply.clone(), 0).await.is_ok());
        // Placing and Explain count each model they ask: here the default and then the one without Contributor mode.
        let asked = Mutex::new(Vec::new());
        assert_eq!(ask(&core, &Setting::from(CONTRIBUTOR), &[], &asked).await.unwrap(), StatusCode::OK);
        assert!(core.capped_message().is_some());
        for _ in 0..3 {
            assert_eq!(Verdict::of(&call(&core, &url, 200, reply.clone(), 0).await.unwrap_err()), Some(Verdict::Capped));
            assert_eq!(Verdict::of(&ask(&core, &Setting::from(CONTRIBUTOR), &[], &asked).await.unwrap_err()), Some(Verdict::Capped));
        }
        assert_eq!(keys.lock().unwrap().len(), 1, "nothing more reached the service");
        assert_eq!(asked.lock().unwrap().len(), 1);
        assert_eq!(Verdict::of(&core.key().unwrap_err()), Some(Verdict::Capped), "the refiner, pictures and search rest");
        assert_eq!(core.listening_key().unwrap(), "good", "the microphone still works: what's heard is kept");
        assert!(!core.key_refused());
        let said = notices(&mut updates);
        assert_eq!(said.len(), 1, "said once a spell: {said:?}");
        assert!(said[0].starts_with("AI paused up to 60 min (hourly limit of 2 calls)"), "{said:?}");
        assert!(said[0].split_whitespace().count() <= 15, "short enough for the 5 s a notice shows: {said:?}");
        let told = crate::catch_up(&core, "you").into_iter().filter(|m| matches!(m, ServerMsg::Notice { message } if message == &said[0])).count();
        assert_eq!(told, 1, "a window that connects later is told too");
        let _ = std::fs::remove_file(&path);
    }

    /// The default for placing and Explain (main.rs), and the same model without Contributor mode.
    const CONTRIBUTOR: &str = "muse-spark-1.2-contributor";
    const BASE: &str = "muse-spark-1.2";

    /// Asks `setting` through a stand-in for the service that answers each model with its status in `statuses`
    /// (else 200), after a yield, so two asks overlap the way placing and Explain can. `asked` records the models.
    async fn ask(core: &Core, setting: &Setting, statuses: &[(&str, u16)], asked: &Mutex<Vec<String>>) -> anyhow::Result<StatusCode> {
        let response = core
            .ask_model(setting, |model| {
                asked.lock().unwrap().push(model.to_string());
                let status = statuses.iter().find(|(m, _)| *m == model).map_or(200, |(_, s)| *s);
                async move {
                    tokio::task::yield_now().await;
                    let answer = axum::http::Response::builder().status(status).body(String::new()).unwrap();
                    Ok::<_, reqwest::Error>(reqwest::Response::from(answer))
                }
            })
            .await?;
        Ok(response.status())
    }

    #[tokio::test]
    async fn a_key_that_cant_use_contributor_mode_gets_the_same_model_without_it_said_once() {
        for status in [401, 403, 404] {
            let fixture = Fixture::new(Some("good"));
            let core = &fixture.core;
            let mut updates = core.updates.subscribe();
            let setting = Setting::new(None, CONTRIBUTOR);
            let (statuses, asked) = ([(CONTRIBUTOR, status)], Mutex::new(Vec::new()));
            // Placing and Explain at once: both find out, one says so.
            let (a, b) = tokio::join!(ask(core, &setting, &statuses, &asked), ask(core, &setting, &statuses, &asked));
            assert_eq!((a.unwrap(), b.unwrap()), (StatusCode::OK, StatusCode::OK), "{status}");
            assert_eq!(*asked.lock().unwrap(), [CONTRIBUTOR, CONTRIBUTOR, BASE, BASE], "{status}");
            assert_eq!(setting.name(), BASE);
            assert!(!core.key_refused(), "{status}");
            assert_eq!(notices(&mut updates), ["Using muse-spark-1.2 (this key can't use the contributor model)."], "{status}");
            // From then on, only the base is asked, and nothing more is said.
            asked.lock().unwrap().clear();
            assert_eq!(ask(core, &setting, &statuses, &asked).await.unwrap(), StatusCode::OK);
            assert_eq!(*asked.lock().unwrap(), [BASE]);
            assert!(notices(&mut updates).is_empty());
        }
    }

    #[tokio::test]
    async fn the_key_counts_as_refused_only_if_the_model_without_contributor_mode_refuses_it_too() {
        let fixture = Fixture::new(Some("wrong"));
        let core = &fixture.core;
        let mut updates = core.updates.subscribe();
        let setting = Setting::new(None, CONTRIBUTOR);
        let asked = Mutex::new(Vec::new());
        // Busy: nothing is switched or refused, and the next call starts from the default again.
        let busy = ask(core, &setting, &[(CONTRIBUTOR, 403), (BASE, 429)], &asked).await.unwrap_err();
        assert_eq!(Verdict::of(&busy), Some(Verdict::Busy));
        assert!(!core.key_refused());
        let refused = ask(core, &setting, &[(CONTRIBUTOR, 403), (BASE, 401)], &asked).await.unwrap_err();
        assert_eq!(Verdict::of(&refused), Some(Verdict::Refused));
        assert!(core.key_refused());
        assert_eq!(*asked.lock().unwrap(), [CONTRIBUTOR, BASE, CONTRIBUTOR, BASE]);
        assert_eq!(setting.name(), CONTRIBUTOR, "nothing worked, so nothing switched");
        let said = notices(&mut updates);
        assert_eq!(said.last().map(String::as_str), Some(REFUSED), "{said:?}");
        assert!(!said.iter().any(|s| s.starts_with("Using")), "{said:?}");
    }

    #[tokio::test]
    async fn the_persons_own_model_and_a_working_default_are_asked_once_as_before() {
        // PLACER_MODEL set, even to the default: never switched; a refusal stops every call, as before.
        let fixture = Fixture::new(Some("good"));
        let chosen = Setting::new(Some(CONTRIBUTOR.into()), CONTRIBUTOR);
        let asked = Mutex::new(Vec::new());
        let refused = ask(&fixture.core, &chosen, &[(CONTRIBUTOR, 403)], &asked).await.unwrap_err();
        assert_eq!(Verdict::of(&refused), Some(Verdict::Refused));
        assert_eq!(*asked.lock().unwrap(), [CONTRIBUTOR]);
        assert_eq!(chosen.name(), CONTRIBUTOR);
        // The default: the same answer as before when it works, is busy or fails another way.
        for (status, verdict) in [(200, None), (500, None), (429, Some(Verdict::Busy))] {
            let fixture = Fixture::new(Some("good"));
            let setting = Setting::new(None, CONTRIBUTOR);
            let asked = Mutex::new(Vec::new());
            let answer = ask(&fixture.core, &setting, &[(CONTRIBUTOR, status)], &asked).await;
            match verdict {
                None => assert_eq!(answer.unwrap().as_u16(), status, "the caller reads it, as before"),
                Some(verdict) => assert_eq!(Verdict::of(&answer.unwrap_err()), Some(verdict)),
            }
            assert_eq!(*asked.lock().unwrap(), [CONTRIBUTOR], "{status}");
            assert_eq!(setting.name(), CONTRIBUTOR);
            assert!(!fixture.core.key_refused());
        }
    }

    /// The placer used to retry a refused thought forever (15 s, doubling to 4 min) and say it would.
    #[tokio::test(start_paused = true)]
    async fn after_a_refusal_a_thought_waits_saved_and_unplaced_with_nothing_more_said() {
        let mut fixture = Fixture::new(Some("wrong"));
        let core = fixture.core.clone();
        let _ = core.check(StatusCode::UNAUTHORIZED);
        let mut updates = core.updates.subscribe();
        core.add_thought("you", "the rent is due on Friday");
        let id = core.snapshot().thoughts[0].id.clone();
        tokio::spawn(placer::run(core.clone(), fixture.queue.take().unwrap()));
        // Past every retry the placer used to schedule.
        tokio::time::sleep(std::time::Duration::from_secs(30 * 60)).await;
        let world = core.snapshot();
        assert_eq!(world.thoughts.len(), 1);
        assert!(!world.thoughts[0].placed, "it waits for a working key");
        assert_eq!(world.thoughts[0].id, id);
        let said = notices(&mut updates);
        assert!(said.is_empty(), "no \"will retry\" for a call that can't work: {said:?}");
        // Saved: a restart with a good key finds it waiting and places it.
        let (_, reopened) = Journal::open(&fixture.path).unwrap();
        assert!(reopened.thoughts.iter().any(|t| t.id == id && !t.placed));
    }
}
