//! Explain: select a word or phrase and get one plain sentence on what it means in its thread,
//! from the fastest Muse setting, so it reads like a tooltip rather than a chat.

use crate::world::{Change, World};
use crate::{protocol::ServerMsg, Core};
use anyhow::bail;
use serde_json::json;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "The person selected a word or phrase in their own notes: a live map of their spoken thoughts, \
grouped into threads. Say what it means here, in one short plain sentence of at most 20 words, using the thread and \
the map for context. Start with the meaning itself: no preamble, and don't repeat the phrase. For a name, say who or \
what it is and why it comes up here; spell out an acronym. For an everyday word, say what it refers to in this thread \
rather than defining it. If it may be misheard by speech-to-text, start with what was probably meant. Say only what the \
notes or common knowledge support; when they don't make clear what it is, say what they do tell and mark a guess with \
\"probably\". Never give medical or health advice. Plain text, no markdown, in the language of the notes.";

/// An answer this late has missed its moment; the person can ask again.
const PATIENCE: Duration = Duration::from_secs(20);

const TTL: Duration = Duration::from_secs(5 * 60);
const CAPACITY: usize = 64;
const SERVED_IDS: usize = 128;
const MAX_ANSWER: usize = 2 * 1024;

#[derive(Clone, PartialEq, Eq)]
struct Key {
    speaker: String,
    phrase: String,
    notes: String,
    model: String,
    system: &'static str,
}

struct Entry {
    serial: u64,
    key: Key,
    text: String,
    at: Instant,
}
struct Served {
    speaker: String,
    id: String,
    serial: u64,
    at: Instant,
}

#[derive(Default)]
struct Cache {
    entries: VecDeque<Entry>,
    // Globally capped, which also bounds each speaker's request history.
    served: VecDeque<Served>,
    serial: u64,
}

impl Cache {
    fn prune(&mut self, now: Instant) {
        self.entries.retain(|e| now.duration_since(e.at) < TTL);
        self.served.retain(|s| {
            now.duration_since(s.at) < TTL && self.entries.iter().any(|e| e.serial == s.serial)
        });
    }

    fn served(&mut self, key: &Key, id: &str, serial: u64, now: Instant) {
        self.served
            .retain(|s| s.speaker != key.speaker || s.id != id);
        if self.served.len() == SERVED_IDS {
            self.served.pop_front();
        }
        self.served.push_back(Served {
            speaker: key.speaker.clone(),
            id: id.into(),
            serial,
            at: now,
        });
    }

    fn get(&mut self, key: &Key, id: &str, now: Instant) -> Option<String> {
        self.prune(now);
        let at = self.entries.iter().position(|e| e.key == *key)?;
        let entry = self.entries.remove(at).unwrap();
        let text = entry.text.clone();
        self.served(key, id, entry.serial, now);
        self.entries.push_back(entry);
        Some(text)
    }

    fn put(&mut self, key: Key, id: &str, text: &str, now: Instant) {
        self.prune(now);
        if text.trim().is_empty() || text.len() > MAX_ANSWER {
            return;
        }
        // Concurrent misses may both finish. Keep the newest answer, with its own identity.
        self.entries.retain(|e| e.key != key);
        if self.entries.len() == CAPACITY {
            self.entries.pop_front();
        }
        self.serial += 1;
        self.served(&key, id, self.serial, now);
        self.entries.push_back(Entry {
            serial: self.serial,
            key,
            text: text.into(),
            at: now,
        });
        self.prune(now);
    }

    fn mark_off(&mut self, speaker: &str, id: &str, now: Instant) {
        self.prune(now);
        if let Some(serial) = self
            .served
            .iter()
            .find(|s| s.speaker == speaker && s.id == id)
            .map(|s| s.serial)
        {
            self.entries.retain(|e| e.serial != serial);
            self.served.retain(|s| s.serial != serial);
        }
    }
}

#[cfg(test)]
type FakeProvider = Arc<dyn Fn(&str, &str) -> anyhow::Result<String> + Send + Sync>;

#[derive(Default)]
pub struct Runtime {
    cache: Mutex<Cache>,
    #[cfg(test)]
    provider: Option<FakeProvider>,
}

impl Runtime {
    pub fn mark_off(&self, speaker: &str, id: &str) {
        self.cache
            .lock()
            .unwrap()
            .mark_off(speaker, id, Instant::now());
    }
}

pub async fn run(
    core: Arc<Core>,
    id: String,
    phrase: String,
    context: String,
    thread_id: Option<String>,
    speaker: String,
    reuse: bool,
) {
    let started = crate::now_ms();
    let notes = notes(&core.snapshot(), thread_id.as_deref(), &context, &phrase);
    let mut key = Key {
        speaker,
        phrase: phrase.clone(),
        notes: notes.clone(),
        model: core.placer_model.name().into(),
        system: SYSTEM,
    };
    // Off does not even inspect the cache. Only an explicit request reaches this path.
    let cached = if reuse {
        core.explain
            .cache
            .lock()
            .unwrap()
            .get(&key, &id, Instant::now())
    } else {
        None
    };
    let answer = if let Some(text) = cached {
        Ok((text, key.model.clone()))
    } else {
        let answer = ask(&core, &phrase, &notes).await;
        if let Ok((text, model)) = &answer {
            if reuse {
                key.model = model.clone();
                core.explain
                    .cache
                    .lock()
                    .unwrap()
                    .put(key, &id, text, Instant::now());
            }
        }
        answer
    };
    let message = match answer {
        Ok((text, model)) => {
            // Kept with what it was asked and how long it took, so a later change to the prompt is judged on real
            // answers and the person's "off" marks (C42).
            core.record(Change::ExplainAnswered {
                id: id.clone(),
                phrase: phrase.chars().take(200).collect(),
                context: context.chars().take(600).collect(),
                thread_id,
                model,
                ms: crate::now_ms().saturating_sub(started),
                text: text.clone(),
                at_ms: started,
            });
            ServerMsg::Explanation {
                id,
                text,
                failed: false,
            }
        }
        Err(e) => {
            tracing::warn!("explain failed: {e:#}");
            let text: String = if core.key.is_none() {
                "Explaining needs the AI key: add MODEL_API_KEY to .env, then restart.".into()
            } else if core.key_refused() {
                crate::model::REFUSED.into()
            } else if let Some(capped) = core.capped_message() {
                capped
            } else {
                "Couldn't explain that just now.".into()
            };
            ServerMsg::Explanation {
                id,
                text,
                failed: true,
            }
        }
    };
    core.send(message);
}

/// What the model reads before the phrase: the other threads' titles, the phrase's thread
/// (and the one it branched from) with its points, what other threads say about the phrase,
/// and the words around it.
fn notes(world: &World, thread_id: Option<&str>, around: &str, phrase: &str) -> String {
    let thread = thread_id.map(|id| world.resolve(id)).and_then(|id| world.thread(&id));
    let others: Vec<&str> = world
        .threads
        .iter()
        .rev()
        .filter(|t| Some(t.id.as_str()) != thread.map(|t| t.id.as_str()))
        .take(40)
        .map(|t| t.title.as_str())
        .collect();
    let mut notes = String::new();
    if !others.is_empty() {
        notes += &format!("Other threads: {}\n", others.join("; "));
    }
    if let Some(thread) = thread {
        notes += &format!("Thread: {}\n", thread.title);
        if let Some(parent) = thread.parent_id.as_deref().and_then(|id| world.thread(id)) {
            notes += &format!("A tangent from: {}\n", parent.title);
        }
        let points: Vec<&str> = world
            .thoughts
            .iter()
            .filter(|t| t.placed && t.thread_id.as_deref() == Some(thread.id.as_str()))
            .map(|t| t.point.as_str())
            .collect();
        for point in &points[points.len().saturating_sub(12)..] {
            notes += &format!("- {point}\n");
        }
    }
    let mentions = mentions(world, thread.map(|t| t.id.as_str()), phrase);
    if !mentions.is_empty() {
        notes += "Mentioned in other threads:\n";
        for line in mentions {
            notes += &format!("- {line}\n");
        }
    }
    let around: String = around.chars().take(600).collect();
    notes + &format!("Selected in: \"{around}\"")
}

/// Other threads' thoughts that name the phrase, or a name or acronym in a longer phrase, newest last:
/// on a list of the week's tasks, "tomorrow: Jordan" is the teammate whose yes decides a hire, and
/// that is said on the hiring thread. A handful is enough for one sentence; more only slows the answer.
fn mentions(world: &World, thread_id: Option<&str>, phrase: &str) -> Vec<String> {
    // Possessives too: double-clicking "Priya's" selects the 's.
    let bare = |words: &str| {
        let words = words.trim_matches(|c: char| !c.is_alphanumeric());
        words.strip_suffix("'s").or_else(|| words.strip_suffix("’s")).unwrap_or(words).to_lowercase()
    };
    let mut terms = vec![bare(phrase)];
    if phrase.split_whitespace().nth(1).is_some() {
        terms.extend(phrase.split_whitespace().filter(|w| w.chars().any(char::is_uppercase)).map(bare));
    }
    terms.retain(|term| term.chars().count() >= 3);
    let mut found: Vec<String> = world
        .thoughts
        .iter()
        .filter(|t| t.placed && t.thread_id.as_deref() != thread_id)
        .filter_map(|t| {
            // The point, unless only the spoken words name it.
            let line = [&t.point, &t.text].into_iter().find(|line| terms.iter().any(|term| names(line, term)))?;
            let thread = world.thread(&world.resolve(t.thread_id.as_deref()?))?;
            Some(format!("{} (in {})", line.chars().take(300).collect::<String>(), thread.title))
        })
        .collect();
    found.drain(..found.len().saturating_sub(8));
    found
}

/// Whether `text` has `term` (lowercase) as whole words: "Rent" names "rent", "current" doesn't.
fn names(text: &str, term: &str) -> bool {
    let text = text.to_lowercase();
    text.match_indices(term).any(|(at, _)| {
        !text[..at].chars().next_back().is_some_and(char::is_alphanumeric)
            && !text[at + term.len()..].chars().next().is_some_and(char::is_alphanumeric)
    })
}

async fn ask(core: &Core, phrase: &str, notes: &str) -> anyhow::Result<(String, String)> {
    #[cfg(test)]
    if let Some(provider) = &core.explain.provider {
        return provider(phrase, notes).map(|text| (text, core.placer_model.name().into()));
    }
    // Capture the setting actually used, including the existing Contributor fallback.
    let selected = Mutex::new(String::new());
    let phrase: String = phrase.chars().take(200).collect();
    let body = |model: &str| {
        *selected.lock().unwrap() = model.into();
        json!({
            "model": model,
            "reasoning_effort": "minimal",
            // Spark's reasoning counts here too (about 200 to 300 tokens): a tight cap leaves no answer.
            "max_tokens": 1200,
            "prompt_cache_key": "e2a2o-explain",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": format!("{notes}\nPhrase: \"{phrase}\"")},
            ],
        })
    };
    let value = core
        .ask_model(
            &core.placer_model,
            URL,
            PATIENCE,
            body,
            serde_json::Value::Null,
        )
        .await?;
    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .trim();
    if text.is_empty() {
        bail!(
            "no answer ({})",
            value["choices"][0]["finish_reason"]
                .as_str()
                .unwrap_or("no reason given")
        );
    }
    Ok((text.to_string(), selected.into_inner().unwrap()))
}

#[cfg(test)]
mod tests {
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn fixture() -> (Arc<Core>, Arc<AtomicUsize>, std::path::PathBuf) {
        let dir = std::env::var_os("F7_EXPLAIN_FIXTURE_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!("f7-explain-{}", uuid::Uuid::new_v4()))
            });
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("synthetic.jsonl");
        let (journal, _) = crate::Journal::open(&path).unwrap();
        let mut world = map(
            &[("T1", "Garden plans", None)],
            &[("T1", "Mulch protects the soil", "Mulch protects the soil")],
        );
        world.apply(&Change::ActiveChanged {
            thread_id: "T1".into(),
            speaker: "you".into(),
        });
        let mut core = Core::test(journal, world);
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        core.explain.provider = Some(Arc::new(move |phrase, _notes| {
            count.fetch_add(1, Ordering::SeqCst);
            match phrase {
                "fail" => bail!("synthetic provider failure"),
                "large" => Ok("x".repeat(MAX_ANSWER + 1)),
                "empty" => Ok(String::new()),
                _ => Ok("A covering that protects garden soil.".into()),
            }
        }));
        (Arc::new(core), calls, path)
    }

    async fn request(
        core: &Arc<Core>,
        id: &str,
        phrase: &str,
        context: &str,
        speaker: &str,
        reuse: bool,
    ) -> String {
        let mut updates = core.updates.subscribe();
        run(
            core.clone(),
            id.into(),
            phrase.into(),
            context.into(),
            Some("T1".into()),
            speaker.into(),
            reuse,
        )
        .await;
        loop {
            if let ServerMsg::Explanation { id: got, text, .. } =
                updates.recv().await.unwrap().message
            {
                assert_eq!(got, id, "every response has the current request ID");
                return text;
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn f7_explain_exact_reuse_and_current_receipts() {
        let (core, calls, path) = fixture();
        let first = request(&core, "first", "Mulch", "soil", "you", true).await;
        tokio::time::advance(Duration::from_millis(25)).await;
        assert_eq!(
            request(&core, "second", "Mulch", "soil", "you", true).await,
            first
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let lines: Vec<serde_json::Value> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["id"], "first");
        assert_eq!(lines[1]["id"], "second");
        assert!(lines[1]["at_ms"].as_u64().unwrap() >= lines[0]["at_ms"].as_u64().unwrap());
        assert!(
            lines[1]["ms"].as_u64().unwrap() < 100,
            "hit timing belongs to this request"
        );
        assert_eq!(core.explain.cache.lock().unwrap().served.len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn f7_explain_freshness_model_speaker_expiry_and_off() {
        let (mut core, calls, _) = fixture();
        request(&core, "a", "Mulch", "soil", "you", true).await;
        request(&core, "b", "Mulch", "different words", "you", true).await;
        request(&core, "c", "mulch", "soil", "you", true).await;
        request(&core, "d", "Mulch", "soil", "guest", true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        // Real map notes, rather than only the selection's surrounding words, change the key.
        core.commit(vec![Change::ThoughtRepointed {
            thought_id: "th-0".into(),
            point: "Use leaf mulch".into(),
        }]);
        request(&core, "e", "Mulch", "soil", "you", true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 5);
        Arc::get_mut(&mut core).unwrap().placer_model = "another-meta-setting".into();
        request(&core, "f", "Mulch", "soil", "you", true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 6);
        tokio::time::advance(TTL - Duration::from_millis(1)).await;
        request(&core, "g", "Mulch", "soil", "you", true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 6);
        tokio::time::advance(Duration::from_millis(1)).await;
        request(&core, "h", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            7,
            "hits do not extend answer TTL"
        );
        crate::mark(&core, "guest", "explain".into(), "h".into(), true);
        request(&core, "i", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            7,
            "another speaker cannot invalidate this entry"
        );
        crate::mark(&core, "you", "explain".into(), "h".into(), true);
        request(&core, "j", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            8,
            "original ID invalidates its answer"
        );
        request(&core, "k", "Mulch", "soil", "you", true).await;
        crate::mark(&core, "you", "explain".into(), "k".into(), false);
        request(&core, "l", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            8,
            "taking a mark back does not invalidate"
        );
        crate::mark(&core, "you", "explain".into(), "k".into(), true);
        request(&core, "m", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            9,
            "hit ID invalidates its answer too"
        );
    }

    #[tokio::test]
    async fn f7_explain_off_errors_and_response_bound() {
        let (core, calls, _) = fixture();
        request(&core, "a", "Mulch", "soil", "you", false).await;
        request(&core, "b", "Mulch", "soil", "you", true).await;
        request(&core, "c", "Mulch", "soil", "you", false).await;
        request(&core, "d", "Mulch", "soil", "you", true).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "off neither reads nor populates"
        );
        for phrase in ["fail", "large", "empty"] {
            for id in ["x", "y"] {
                request(&core, id, phrase, "soil", "you", true).await;
            }
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            9,
            "errors, empty and oversized answers never reused"
        );
        let cache = core.explain.cache.lock().unwrap();
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.served.len(), 2);
        let old: crate::protocol::ClientMsg = serde_json::from_value(
            json!({"type":"explain","id":"old","text":"Mulch","context":"soil"}),
        )
        .unwrap();
        assert!(matches!(
            old,
            crate::protocol::ClientMsg::Explain { reuse: false, .. }
        ));
    }

    #[test]
    fn f7_explain_lru_id_bound_and_prompt_identity() {
        let now = Instant::now();
        let key = |n: usize| Key {
            speaker: "you".into(),
            phrase: n.to_string(),
            notes: "exact notes".into(),
            model: "meta-setting".into(),
            system: SYSTEM,
        };
        let mut cache = Cache::default();
        for n in 0..CAPACITY {
            cache.put(key(n), &format!("id-{n}"), "answer", now);
        }
        cache.get(&key(0), "touch", now).unwrap();
        cache.put(key(CAPACITY), "new", "answer", now);
        assert!(cache.get(&key(1), "evicted", now).is_none());
        assert!(cache.get(&key(0), "retained", now).is_some());
        let mut other_prompt = key(0);
        other_prompt.system = "different system prompt";
        assert!(cache.get(&other_prompt, "prompt", now).is_none());
        for n in 0..200 {
            cache.get(&key(0), &format!("hit-{n}"), now).unwrap();
        }
        assert_eq!(cache.entries.len(), CAPACITY);
        assert_eq!(cache.served.len(), SERVED_IDS);
        cache.mark_off("you", "hit-199", now);
        assert!(cache.get(&key(0), "gone", now).is_none());
        cache.prune(now + TTL);
        assert!(cache.entries.is_empty() && cache.served.is_empty());
    }

    /// Only the acceptance script starts this test-only server. No app startup, env loading or background jobs.
    #[tokio::test]
    #[ignore = "synthetic browser fixture, owned by scripts/f7-explain-check.mjs"]
    async fn f7_explain_browser_fixture() {
        let dir = std::path::PathBuf::from(
            std::env::var("F7_EXPLAIN_FIXTURE_DIR").expect("script-owned temporary directory"),
        );
        assert!(
            dir.starts_with(std::env::temp_dir().canonicalize().unwrap())
                || dir.starts_with(std::env::temp_dir())
        );
        let (core, calls, _) = fixture();
        let stats_core = core.clone();
        let routes = axum::Router::new()
            .route("/ws", axum::routing::get(crate::connect))
            .route("/room", axum::routing::get(crate::room_info))
            .route("/f7-stats", axum::routing::get(move || { let core = stats_core.clone(); let calls = calls.clone(); async move {
                let cache = core.explain.cache.lock().unwrap();
                axum::Json(json!({"calls":calls.load(Ordering::SeqCst),"entries":cache.entries.len(),"served":cache.served.len()}))
            }}))
            .fallback_service(tower_http::services::ServeDir::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/dist")))
            .layer(axum::middleware::from_fn_with_state(core.clone(), crate::gate))
            .with_state(core);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        std::fs::write(
            dir.join("port"),
            listener.local_addr().unwrap().port().to_string(),
        )
        .unwrap();
        axum::serve(
            listener,
            routes.into_make_service_with_connect_info::<crate::Link>(),
        )
        .await
        .unwrap();
    }

    fn map(threads: &[(&str, &str, Option<&str>)], thoughts: &[(&str, &str, &str)]) -> World {
        let mut world = World::default();
        for &(id, title, parent) in threads {
            world.apply(&Change::ThreadAdded {
                thread: Thread {
                    id: id.into(),
                    title: title.into(),
                    parent_id: parent.map(Into::into),
                    status: ThreadStatus::Open,
                    last_point: String::new(),
                    touched_ms: 0,
                    tags: vec![],
                    picture: None,
                    dropped_by: String::new(),
                },
            });
        }
        for (n, &(thread, text, point)) in thoughts.iter().enumerate() {
            world.apply(&Change::ThoughtAdded {
                thought: Thought {
                    id: format!("th-{n}"),
                    speaker: "you".into(),
                    text: text.into(),
                    point: point.into(),
                    thread_id: Some(thread.into()),
                    placed: true,
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    at_ms: 0,
                    place_ms: None,
                    decided: false,
                },
            });
        }
        world
    }

    #[test]
    fn notes_hold_the_thread_its_parent_and_the_other_titles() {
        let world = map(
            &[("T1", "The hackathon app", None), ("T2", "Placement speed", Some("T1")), ("T3", "Laundry", None)],
            &[("T2", "use JSON schema", "Use Muse Spark with JSON schema")],
        );
        let notes = super::notes(&world, Some("T2"), "I should use JSON schema", "JSON schema");
        assert_eq!(
            notes,
            "Other threads: Laundry; The hackathon app\nThread: Placement speed\nA tangent from: The hackathon app\n\
             - Use Muse Spark with JSON schema\nSelected in: \"I should use JSON schema\""
        );
        assert!(super::notes(&world, None, "Laundry", "Laundry").starts_with("Other threads: Laundry; Placement speed; The hackathon app\n"));
    }

    #[test]
    fn what_other_threads_say_about_a_name_comes_along() {
        let world = map(
            &[("T1", "This week", None), ("T2", "Hiring", None), ("T3", "Trip", None)],
            &[
                ("T1", "Tomorrow: talk to Jordan about Priya", "Tomorrow: Jordan"),
                ("T2", "I want Jordan's opinion on Priya first", "Leaning Priya, want Jordan's take"),
                ("T2", "Her offer deadline is Friday", "Offer deadline Friday"),
                ("T3", "The Jordanian visa takes a week", "Jordanian visa: a week"),
                ("T3", "Ask Jordan for the tent", "Borrow a tent"),
            ],
        );
        let mentions = |phrase: &str| super::mentions(&world, Some("T1"), phrase);
        // Whole words only; the spoken words when the point leaves the name out; the selected thread is already there.
        let jordan = ["Leaning Priya, want Jordan's take (in Hiring)", "Ask Jordan for the tent (in Trip)"];
        assert_eq!(mentions("Jordan"), jordan);
        assert_eq!(mentions("Jordan's"), jordan);
        // A name in a longer selection, or the whole of it.
        assert_eq!(mentions("talk to Priya"), ["Leaning Priya, want Jordan's take (in Hiring)"]);
        assert_eq!(mentions("offer deadline"), ["Offer deadline Friday (in Hiring)"]);
        assert!(mentions("X").is_empty() && mentions("about").is_empty());
        assert!(super::notes(&world, Some("T1"), "Tomorrow: talk to Jordan about Priya", "Priya").ends_with(
            "Mentioned in other threads:\n- Leaning Priya, want Jordan's take (in Hiring)\n\
             Selected in: \"Tomorrow: talk to Jordan about Priya\""
        ));
    }

    /// Words a judge might select on the sample maps, or on `health`: (map, where, the words). Where is a
    /// thought (the map shows its point), a thread (its title) or a suggestion, and gives the context the UI sends.
    const LIVE: &[(&str, &str, &str)] = &[
        // Jargon, names, a misheard word, a half sentence, a whole point, a title, a number.
        ("founder-day", "th-2", "MRR"),
        ("founder-day", "th-4", "Priya"),
        ("student-week", "th-6", "Priya"),
        ("founder-day", "th-9", "CSB"),
        ("student-week", "th-5", "need to transfer before fee"),
        ("student-week", "th-9", "Demo: mic, map building, then apps"),
        ("founder-day", "T3", "Checkout"),
        ("student-week", "T2", "Rent is due"),
        ("founder-day", "th-18", "Jordan"),
        ("founder-day", "th-2", "37K"),
        ("founder-day", "th-16", "Maya"),
        ("founder-day", "th-11", "CSP"),
        ("student-week", "th-14", "if under sixty dollars"),
        ("founder-day", "th-25", "Jordan yes → offer tomorrow; no → reopen, one month delay"),
        ("student-week", "T8", "Submission"),
        ("founder-day", "th-19", "Team lunch"),
        ("student-week", "th-19", "BC Hydra"),
        ("student-week", "th-2", "precheck"),
        ("student-week", "th-25", "X"),
        ("founder-day", "sg-2", "net revenue retention"),
        // On the thread each sample opens on, where a judge looks first: words that point to other threads.
        ("student-week", "th-29", "rent"),
        ("student-week", "th-29", "rent now"),
        ("student-week", "th-29", "text Priya"),
        ("student-week", "th-3", "README"),
        ("founder-day", "th-26", "offer deadline"),
        ("founder-day", "th-27", "Maya"),
        ("founder-day", "th-27", "Datadog"),
        ("founder-day", "th-27", "Jordan"),
        ("founder-day", "th-27", "Dr. Chen"),
        ("founder-day", "th-28", "Sequoia"),
        // Close to health: say what it refers to, never advise.
        ("founder-day", "th-12", "Dr. Chen"),
        ("founder-day", "th-12", "follow-up"),
        ("founder-day", "th-12", "within two weeks"),
        ("founder-day", "th-14", "I need to drive her"),
        ("health", "th-0", "push through"),
        ("health", "th-1", "Ibuprofen"),
        ("health", "th-2", "chest tightness"),
        ("health", "th-2", "Four hours of sleep"),
        ("health", "th-3", "metformin"),
    ];

    /// The samples barely touch health, and a judge may talk about their own: a short made-up map that does.
    fn health() -> World {
        map(
            &[("H1", "Running again", None), ("H2", "Launch week", None), ("H3", "Mom's meds", None)],
            &[
                (
                    "H1",
                    "My knee has been hurting after runs for two weeks, maybe I should just push through it",
                    "Knee hurts after runs for two weeks; maybe push through",
                ),
                ("H1", "I could take ibuprofen before the long run on Saturday", "Ibuprofen before Saturday's long run?"),
                (
                    "H2",
                    "I've been sleeping like four hours a night since the launch and I get this chest tightness in the afternoons",
                    "Four hours of sleep since launch; chest tightness afternoons",
                ),
                ("H3", "Mom is on metformin now and she keeps forgetting the evening dose", "Mom on metformin, forgets evening dose"),
            ],
        )
    }

    /// Real answers for `LIVE` through `run`, as the UI's request goes: the sample's notes, the model,
    /// the 20-second patience and the failure message. One JSON line per answer. EXPLAIN_RUNS asks each
    /// that many times, EXPLAIN_CASES=3,7 asks only those (numbered from 1), EXPLAIN_NOTES prints the notes.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "live model calls: MODEL_API_KEY=… EXPLAIN_RUNS=3 cargo test explain_live -- --ignored --nocapture"]
    async fn explain_live() {
        use crate::{protocol::ServerMsg, Core};
        use std::sync::Arc;
        let _ = tracing_subscriber::fmt().with_test_writer().try_init();
        let key = std::env::var("MODEL_API_KEY").expect("MODEL_API_KEY");
        let runs: usize = std::env::var("EXPLAIN_RUNS").ok().and_then(|n| n.parse().ok()).unwrap_or(1);
        let only: Vec<usize> =
            std::env::var("EXPLAIN_CASES").unwrap_or_default().split(',').filter_map(|n| n.trim().parse().ok()).collect();
        let samples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let mut cores = std::collections::HashMap::new();
        let mut journals = Vec::new();
        for map in ["founder-day", "student-week", "health"] {
            let world = match map {
                "health" => health(),
                _ => {
                    let mut world = World::default();
                    for line in std::fs::read_to_string(samples.join(format!("{map}.jsonl"))).unwrap().lines() {
                        world.apply(&serde_json::from_str(line).unwrap());
                    }
                    world
                }
            };
            let path = std::env::temp_dir().join(format!("e2a2o-explain-{}.jsonl", uuid::Uuid::new_v4()));
            let (journal, _) = crate::Journal::open(&path).unwrap();
            journals.push(path);
            cores.insert(map, Arc::new(Core {
                key: Some(key.clone()),
                // As main.rs.
                placer_model: crate::model::Setting::from_env("PLACER_MODEL", "muse-spark-1.2"),
                http: reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(10)).build().unwrap(),
                ..Core::test(journal, world)
            }));
        }
        // A few at a time, as one person clicking around would never send dozens at once.
        let gate = Arc::new(tokio::sync::Semaphore::new(4));
        let mut asks = Vec::new();
        for run in 1..=runs {
            for (n, &(map, at, phrase)) in LIVE.iter().enumerate() {
                if !only.is_empty() && !only.contains(&(n + 1)) {
                    continue;
                }
                let core = cores[map].clone();
                let world = core.snapshot();
                let (thread, context) = if let Some(t) = world.thoughts.iter().find(|t| t.id == at) {
                    (t.thread_id.clone().unwrap(), t.text.clone())
                } else if let Some(t) = world.thread(at) {
                    (t.id.clone(), t.title.clone())
                } else {
                    let s = world.suggestions.iter().find(|s| s.id == at).unwrap_or_else(|| panic!("{map} has no {at}"));
                    (s.thread_id.clone(), s.text.clone())
                };
                if run == 1 && std::env::var_os("EXPLAIN_NOTES").is_some() {
                    println!("--- {map} {at} \"{phrase}\"\n{}\n", super::notes(&world, Some(&thread), &context, phrase));
                }
                let gate = gate.clone();
                asks.push(tokio::spawn(async move {
                    let _turn = gate.acquire().await.unwrap();
                    let mut updates = core.updates.subscribe();
                    let id = format!("{n}-{run}");
                    let started = std::time::Instant::now();
                    super::run(core.clone(), id.clone(), phrase.into(), context, Some(thread), "you".into(), false).await;
                    let ms = started.elapsed().as_millis();
                    loop {
                        if let ServerMsg::Explanation { id: of, text, failed } = updates.recv().await.unwrap().message {
                            if of == id {
                                let words = text.split_whitespace().count();
                                break serde_json::json!({"case": n + 1, "map": map, "at": at, "phrase": phrase,
                                    "run": run, "ms": ms, "failed": failed, "words": words, "text": text});
                            }
                        }
                    }
                }));
            }
        }
        let (mut answers, mut failed) = (0, 0);
        for ask in asks {
            let answer = ask.await.unwrap();
            answers += 1;
            failed += answer["failed"].as_bool().unwrap() as usize;
            println!("{answer}");
        }
        for path in journals {
            let _ = std::fs::remove_file(path);
        }
        println!("{answers} answers, {failed} failed");
    }
}
