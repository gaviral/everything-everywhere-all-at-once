//! What every model call shares: whether the key still works, and what an answer's status means for the
//! calls after it. A refused key (401 or 403) won't fix itself, so it stops every model call until a
//! restart and every window is told; a busy service (429) is said once a spell, and a caller that tries
//! again does so on its own schedule. A default model in Contributor mode that the key can't use gives
//! way to the same model without it, for the rest of the session.

use crate::{protocol::ServerMsg, Core};
use reqwest::StatusCode;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// What every window is told when the service refuses the key, then and on connecting after.
/// The UI knows it by "MODEL_API_KEY" and "refused".
pub const REFUSED: &str = "The AI key was refused. Check MODEL_API_KEY in .env, then restart.";

/// Said when the service is busy. Thoughts are placed again on their own (placer.rs); a Recap, Explain or search
/// asks once, so the person asks again.
const BUSY: &str = "The AI service is busy. Thoughts retry on their own; try anything else again shortly.";

/// A busy spell is said once. It lasts as long as callers back off from it, and the longest wait between
/// tries is the refiner's 5 minutes (`refiner::rest_ms`), so one spell's own retries never say it twice.
const SPELL_MS: u64 = 5 * 60_000;

/// What a model answer's status means for the calls after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// 2xx: it worked.
    Fine,
    /// 401 or 403: the key is wrong, expired or revoked; no call works until a restart with another.
    Refused,
    /// 429: too many calls for now; worth trying again later.
    Busy,
    /// Anything else, such as a 500: maybe a blip; the caller decides, as before.
    Other,
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

/// What the model service has said about the key and its load. It lives on the core, so it lasts until a restart.
#[derive(Default)]
pub struct Service {
    /// Set by the first 401 or 403 and never cleared: a restart reads the key again.
    refused: AtomicBool,
    /// When a busy spell was last said.
    busy_said_ms: AtomicU64,
}

impl Core {
    /// The key for a model call, or why there's none (missing, or refused), so nothing is sent that can't work.
    pub fn key(&self) -> anyhow::Result<&str> {
        if self.key_refused() {
            return Err(Verdict::Refused.into());
        }
        self.key.as_deref().ok_or_else(|| anyhow::anyhow!("MODEL_API_KEY is not set"))
    }

    /// True once the service refused the key, until a restart.
    pub fn key_refused(&self) -> bool {
        self.service.refused.load(Ordering::Relaxed)
    }

    /// Reads a model answer's status before its body, which may not be JSON. A refused key stops every model
    /// call from here on and tells every window; a busy service is said once a spell. Both end the call with
    /// their verdict as the error. Any other failure is the caller's to report, as before.
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
            Verdict::Fine | Verdict::Other => Ok(()),
        }
    }

    /// Asks a feature's model: `send` posts the request for one model name, and the answer's status is read as
    /// `check` reads it. When the key can't use a default model in Contributor mode (401, 403 or 404), the same
    /// request goes once to the model without it; if that one works, the feature keeps it until a restart, said
    /// once. The key counts as refused only if that model refuses it too.
    pub async fn ask_model<F, R>(&self, setting: &Setting, send: F) -> anyhow::Result<reqwest::Response>
    where
        F: Fn(&str) -> R,
        R: std::future::Future<Output = reqwest::Result<reqwest::Response>>,
    {
        let model = setting.name();
        let mut response = send(model).await?;
        if let Some(base) = setting.base.as_deref().filter(|base| *base != model && cant_use(response.status())) {
            tracing::info!("{model} answered {}: asking {base} instead", response.status());
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

#[cfg(test)]
mod tests {
    use super::{status_of, verdict, Setting, Verdict, REFUSED};
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
            let (updates, _) = broadcast::channel(64);
            let (placer_queue, queue) = mpsc::unbounded_channel();
            let core = Arc::new(Core {
                find: Default::default(),
                recap: Default::default(),
                apps: Default::default(),
                imports: Default::default(),
                world: Mutex::new(world.into()),
                journal: Mutex::new(journal),
                updates,
                placer_queue,
                room: None,
                key: key.map(Into::into),
                placer_model: "test".into(),
                http: reqwest::Client::new(),
                last_activity: Default::default(),
                looked: Default::default(),
                wake: Default::default(),
                service: Default::default(),
            });
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
