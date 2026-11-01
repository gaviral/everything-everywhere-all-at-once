//! Explain: select a word or phrase and get one plain sentence on what it means in its thread,
//! from the fastest Muse setting, so it reads like a tooltip rather than a chat.

use crate::world::World;
use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, bail};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

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

pub async fn run(core: Arc<Core>, id: String, phrase: String, context: String, thread_id: Option<String>) {
    let notes = notes(&core.snapshot(), thread_id.as_deref(), &context, &phrase);
    let message = match ask(&core, &phrase, &notes).await {
        Ok(text) => ServerMsg::Explanation { id, text, failed: false },
        Err(e) => {
            tracing::warn!("explain failed: {e:#}");
            let text = if core.key.is_none() { "Explaining needs MODEL_API_KEY in .env." } else { "Couldn't explain that just now." };
            ServerMsg::Explanation { id, text: text.into(), failed: true }
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

async fn ask(core: &Core, phrase: &str, notes: &str) -> anyhow::Result<String> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let phrase: String = phrase.chars().take(200).collect();
    let body = json!({
        "model": core.placer_model,
        "reasoning_effort": "minimal",
        // Spark's reasoning counts here too (about 200 to 300 tokens): a tight cap leaves no answer.
        "max_tokens": 1200,
        "prompt_cache_key": "e2a2o-explain",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("{notes}\nPhrase: \"{phrase}\"")},
        ],
    });
    let response = core.http.post(URL).bearer_auth(key).timeout(PATIENCE).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    let text = value["choices"][0]["message"]["content"].as_str().unwrap_or_default().trim();
    if text.is_empty() {
        bail!("no answer ({})", value["choices"][0]["finish_reason"].as_str().unwrap_or("no reason given"));
    }
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

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
        use std::sync::{Arc, Mutex};
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
            let (updates, _) = tokio::sync::broadcast::channel(1024);
            let (placer_queue, _) = tokio::sync::mpsc::unbounded_channel();
            cores.insert(map, Arc::new(Core {
                find: crate::find::Runtime::default(),
                recap: crate::recap::Runtime::default(),
                apps: crate::apps::Runtime::default(),
                imports: crate::import::Imports::default(),
                world: Mutex::new(world.into()),
                journal: Mutex::new(journal),
                updates,
                placer_queue,
                room: None,
                key: Some(key.clone()),
                // As main.rs.
                placer_model: std::env::var("PLACER_MODEL").unwrap_or_else(|_| "muse-spark-1.2-contributor".into()),
                http: reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(10)).build().unwrap(),
                last_activity: std::sync::atomic::AtomicU64::new(0),
                looked: std::sync::atomic::AtomicBool::new(false),
                wake: tokio::sync::Notify::new(),
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
                    super::run(core.clone(), id.clone(), phrase.into(), context, Some(thread)).await;
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
