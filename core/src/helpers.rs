//! Full's voice-started thinking helpers. Recognition and first rows never wait on a model.
use crate::{
    guide::Job,
    messages::{Preset, SendState},
    protocol::ServerMsg,
    world::{Change, Thought, Thread, ThreadStatus},
    Core,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{sync::Notify, time::Instant};

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const MODEL: &str = "muse-spark-1.3";
const FIRST_ID: u64 = 1 << 52; // Separate from Messages, and exactly representable by the browser.

#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub count: usize,
    pub topic: String,
}

/// A whole imperative turn, never a mention of helpers inside ordinary talk.
pub fn read(text: &str, max: usize) -> Option<Ask> {
    let w = crate::words(crate::spoken::plain(text));
    if !matches!(w.first()?.as_str(), "put" | "get" | "have") {
        return None;
    }
    let number = |s: &str| -> Option<usize> {
        const SMALL: [&str; 20] = [
            "zero",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
            "eleven",
            "twelve",
            "thirteen",
            "fourteen",
            "fifteen",
            "sixteen",
            "seventeen",
            "eighteen",
            "nineteen",
        ];
        SMALL.iter().position(|n| *n == s).or_else(|| match s {
            "twenty" => Some(20),
            "thirty" => Some(30),
            "forty" => Some(40),
            "fifty" => Some(50),
            "sixty" => Some(60),
            "seventy" => Some(70),
            "eighty" => Some(80),
            "ninety" => Some(90),
            "hundred" => Some(100),
            _ => s.parse().ok(),
        })
    };
    let mut at = 1;
    let count = if let Some(n) = w.get(at).and_then(|s| number(s)) {
        at += 1;
        let mut n = n;
        if n >= 20 && n % 10 == 0 {
            if let Some(unit) = w
                .get(at)
                .and_then(|s| number(s))
                .filter(|u| (1..10).contains(u))
            {
                n += unit;
                at += 1;
            }
        }
        n
    } else {
        3
    };
    if count == 0 || w.get(at)?.as_str() != "helpers" {
        return None;
    }
    at += 1;
    match w[0].as_str() {
        "put" | "get" if w.get(at)?.as_str() == "on" => at += 1,
        "have" if w.get(at)?.as_str() == "look" && w.get(at + 1)?.as_str() == "at" => at += 2,
        _ => return None,
    }
    if w.get(at).is_some_and(|w| w == "the") {
        at += 1;
    }
    let topic = w.get(at..)?.join(" ");
    if topic.is_empty() {
        return None;
    }
    Some(Ask {
        count: count.min(max.max(1)),
        topic,
    })
}

pub struct Runtime {
    max: usize,
    hosted: bool,
    url: String,
    state: Mutex<State>,
}
#[derive(Default)]
struct State {
    next: u64,
    active: Option<Arc<Run>>,
    off: HashSet<String>,
    stopped_voice: HashSet<String>,
    speech_end: HashMap<String, Instant>,
}
struct Run {
    id: u64,
    speaker: String,
    ask: Ask,
    topic: Option<String>,
    context: String,
    end: Instant,
    counting: AtomicBool,
    started: Mutex<HashMap<usize, u64>>,
    cancel: Notify,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            max: 12,
            hosted: false,
            url: URL.into(),
            state: Mutex::default(),
        }
    }
}
impl Runtime {
    pub fn from_env() -> Self {
        Self {
            max: std::env::var("HELPERS_MAX")
                .ok()
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(12),
            hosted: crate::hosted(),
            ..Self::default()
        }
    }
}
pub fn available(core: &Core) -> bool {
    core.messages.settings.preset == Preset::Full && !core.helpers.hosted
}
pub fn switch(core: &Core, speaker: &str, on: bool) {
    if !available(core) || !core.is_host(speaker) {
        return;
    }
    let mut state = core.helpers.state.lock().unwrap();
    if on {
        state.off.remove(speaker);
    } else {
        state.off.insert(speaker.into());
    }
    let pending = (!on)
        .then(|| state.active.as_ref().filter(|r| r.speaker == speaker).map(|r| r.id))
        .flatten();
    drop(state);
    if let Some(id) = pending {
        stop(core, id);
    }
}
pub fn speech_end(core: &Core, speaker: &str) {
    if available(core) {
        core.helpers
            .state
            .lock()
            .unwrap()
            .speech_end
            .insert(speaker.into(), Instant::now());
    }
}
fn parent(run: &Run) -> String {
    format!("helpers:{}", run.id)
}
fn row(
    core: &Core,
    run: &Run,
    i: Option<usize>,
    title: &str,
    status: &str,
    result: Option<String>,
) {
    let id = parent(run);
    core.guide.publish_core(
        core,
        Job {
            id: i.map_or_else(|| id.clone(), |i| format!("{id}:{i}")),
            title: title.into(),
            status: status.into(),
            result,
            parent: i.map(|_| id),
            demo: false,
            started_ms: i.and_then(|i| run.started.lock().unwrap().get(&i).copied()),
        },
    );
}
fn card(run: &Run, state: SendState, message: &str) -> ServerMsg {
    ServerMsg::SendCard {
        id: run.id,
        to: format!("{} helpers", run.ask.count),
        text: format!("Think about {}", run.ask.topic),
        state,
        in_ms: if state == SendState::Counting {
            run.end
                .saturating_duration_since(Instant::now())
                .as_millis() as u64
        } else {
            0
        },
        live: true,
        message: message.into(),
        purpose: Some("helpers".into()),
    }
}
fn end_card(core: &Core, run: &Run, state: SendState, message: &str) {
    let card = card(run, state, message);
    crate::messages::end(core, &run.speaker, card);
}
pub fn card_for(core: &Core, speaker: &str) -> Option<ServerMsg> {
    let state = core.helpers.state.lock().unwrap();
    state
        .active
        .as_ref()
        .filter(|r| r.speaker == speaker && r.counting.load(Ordering::Relaxed))
        .map(|r| card(r, SendState::Counting, ""))
}
pub fn counting(core: &Core) -> bool {
    core.helpers
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .is_some_and(|r| r.counting.load(Ordering::Relaxed))
}
pub fn stop(core: &Core, id: u64) -> bool {
    let run = {
        let mut state = core.helpers.state.lock().unwrap();
        if !state
            .active
            .as_ref()
            .is_some_and(|r| r.id == id && r.counting.load(Ordering::Relaxed))
        {
            return false;
        }
        state.active.take().unwrap()
    };
    run.counting.store(false, Ordering::Relaxed);
    run.cancel.notify_one();
    end_card(core, &run, SendState::Stopped, "Stopped: helpers won't run");
    row(
        core,
        &run,
        None,
        "Thinking helpers",
        "failed",
        Some("Stopped before starting".into()),
    );
    for i in 0..run.ask.count {
        row(
            core,
            &run,
            Some(i),
            &format!("Helper {}", i + 1),
            "failed",
            Some("Stopped before starting".into()),
        );
    }
    core.trace
        .write(|| json!({"kind":"helpers_stopped", "swarm":run.id}));
    true
}
pub fn heard(core: &Core, speaker: &str, text: &str) {
    if !crate::messages::is_stop(text) {
        return;
    }
    let id = core
        .helpers
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .filter(|r| r.speaker == speaker)
        .map(|r| r.id);
    if id.is_some_and(|id| stop(core, id)) {
        core.helpers
            .state
            .lock()
            .unwrap()
            .stopped_voice
            .insert(speaker.into());
    }
}

/// Before catalog/model routing. PRESET unset returns false without interpreting the words.
pub fn said(core: &Arc<Core>, speaker: &str, text: &str) -> bool {
    if core.messages.settings.preset != Preset::Full {
        return false;
    }
    let speech_end = core
        .helpers
        .state
        .lock()
        .unwrap()
        .speech_end
        .remove(speaker)
        .unwrap_or_else(Instant::now);
    if crate::messages::is_stop(text) {
        heard(core, speaker, text);
        return core
            .helpers
            .state
            .lock()
            .unwrap()
            .stopped_voice
            .remove(speaker);
    }
    core.helpers
        .state
        .lock()
        .unwrap()
        .stopped_voice
        .remove(speaker);
    let Some(ask) = read(text, core.helpers.max) else {
        return false;
    };
    let refuse = if core.helpers.hosted {
        Some("Helpers run only on the host's own app, not a hosted app.")
    } else if !core.is_host(speaker) {
        Some("Only the host can start helpers.")
    } else {
        None
    };
    if let Some(message) = refuse {
        core.send_to(
            speaker,
            ServerMsg::Notice {
                message: message.into(),
            },
        );
        return true;
    }
    if core.helpers.state.lock().unwrap().off.contains(speaker) {
        return false;
    }
    if crate::messages::withdrawn(text) {
        core.send_to(speaker, ServerMsg::Notice { message: "Helpers won't start: you said “stop” at the end.".into() });
        return true;
    }
    let world = core.snapshot();
    let topic = world
        .threads
        .iter()
        .filter(|t| ask.topic.contains(&crate::words(&t.title).join(" ")))
        .max_by_key(|t| t.title.len())
        .map(|t| t.id.clone())
        .or_else(|| world.active_for(speaker).cloned());
    let context = world
        .thoughts
        .iter()
        .filter(|t| t.thread_id == topic)
        .map(|t| t.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let message_counting = matches!(
        crate::messages::card_for(core, speaker),
        Some(ServerMsg::SendCard {
            state: SendState::Counting,
            ..
        })
    );
    let mut state = core.helpers.state.lock().unwrap();
    if state.active.is_some() || message_counting {
        drop(state);
        core.send_to(speaker, ServerMsg::Notice { message: "Wait for the current card or helpers to finish, or say Stop during the countdown.".into() });
        return true;
    }
    state.next += 1;
    let delay = crate::messages::countdown_ms(&format!("Think about {}", ask.topic));
    let run = Arc::new(Run {
        id: FIRST_ID + state.next,
        speaker: speaker.into(),
        ask,
        topic,
        context,
        end: Instant::now() + Duration::from_millis(delay),
        counting: AtomicBool::new(true),
        started: Mutex::default(),
        cancel: Notify::new(),
    });
    state.active = Some(run.clone());
    drop(state);
    core.send_to(speaker, card(&run, SendState::Counting, ""));
    row(
        core,
        &run,
        None,
        "Thinking helpers",
        "running",
        Some(format!(
            "{} helpers · starts after the countdown",
            run.ask.count
        )),
    );
    for i in 0..run.ask.count {
        row(
            core,
            &run,
            Some(i),
            &format!("Helper {}", i + 1),
            "running",
            None,
        );
    }
    core.trace.write(|| json!({"kind":"helpers_first_row", "swarm":run.id, "speech_end_to_first_row_ms":speech_end.elapsed().as_millis() as u64, "count":run.ask.count}));
    let core = core.clone();
    tokio::spawn(async move {
        tokio::select! {
            biased;
            _ = run.cancel.notified() => {},
            _ = execute(&core, &run) => {},
        }
        let mut state = core.helpers.state.lock().unwrap();
        if state.active.as_ref().is_some_and(|r| r.id == run.id) {
            state.active = None;
        }
    });
    true
}

#[derive(Deserialize)]
struct Brief {
    title: String,
    brief: String,
}
fn limit(text: &str, words: usize) -> String {
    text.split_whitespace()
        .take(words)
        .collect::<Vec<_>>()
        .join(" ")
}
async fn ask(
    core: &Core,
    run: &Run,
    phase: &str,
    helper: Option<usize>,
    instruction: &str,
    input: Value,
) -> anyhow::Result<String> {
    let value = core.ask_model(&MODEL.into(), &core.helpers.url, Duration::from_secs(90), |model| json!({
        "model":model, "messages":[{"role":"system", "content":instruction}, {"role":"user", "content":input.to_string()}],
        "max_tokens": if phase == "split" { run.ask.count * 256 + 1000 } else { 2000 },
        "reasoning_effort":"minimal",
        "temperature":0.5,
    }), json!({"feature":format!("helpers_{phase}"), "swarm":run.id, "helper":helper})).await?;
    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .trim();
    anyhow::ensure!(!text.is_empty(), "empty helper answer");
    Ok(text.into())
}
async fn execute(core: &Arc<Core>, run: &Arc<Run>) {
    let split = ask(core, run, "split", None, "Split the thinking request into exactly count independent, useful briefs. Return only JSON: {\"briefs\":[{\"title\":\"at most six words\",\"brief\":\"what to examine\"}]}. Use the topic thoughts as context. Helpers only think; they take no external actions.", json!({"count":run.ask.count,"ask":run.ask.topic,"thoughts":run.context})).await;
    let briefs = split.and_then(|s| {
        let value: Value = serde_json::from_str(
            s.trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim(),
        )?;
        let briefs: Vec<Brief> = serde_json::from_value(value["briefs"].clone())?;
        anyhow::ensure!(
            briefs.len() == run.ask.count
                && briefs
                    .iter()
                    .all(|b| !b.title.trim().is_empty() && !b.brief.trim().is_empty()),
            "invalid helper briefs"
        );
        Ok(briefs)
    });
    let briefs = match briefs {
        Ok(briefs) => briefs,
        Err(_) => {
            run.counting.store(false, Ordering::Relaxed);
            end_card(
                core,
                run,
                SendState::Failed,
                "Helpers couldn't prepare their briefs. Try again.",
            );
            row(
                core,
                run,
                None,
                "Thinking helpers",
                "failed",
                Some("Couldn't prepare briefs".into()),
            );
            for i in 0..run.ask.count {
                row(
                    core,
                    run,
                    Some(i),
                    &format!("Helper {}", i + 1),
                    "failed",
                    Some("Couldn't prepare brief".into()),
                );
            }
            return;
        }
    };
    for (i, b) in briefs.iter().enumerate() {
        row(core, run, Some(i), &limit(&b.title, 6), "running", None);
    }
    tokio::time::sleep_until(run.end + Duration::from_millis(crate::messages::LATE_STOP_MS)).await;
    run.counting.store(false, Ordering::Relaxed);
    end_card(
        core,
        run,
        SendState::Sent,
        "Helpers started · follow their work in Work spine",
    );
    let answers = futures_util::future::join_all(briefs.iter().enumerate().map(|(i, b)| async move {
        run.started.lock().unwrap().insert(i, crate::now_ms());
        row(core, run, Some(i), &limit(&b.title, 6), "running", None);
        let answer = ask(core, run, "think", Some(i), "Answer this thinking brief in at most 120 words. Use the topic thoughts as context. Give concrete, useful points. Take no external actions.", json!({"ask":run.ask.topic,"title":b.title,"brief":b.brief,"thoughts":run.context})).await;
        let answer = answer.map(|s| limit(&s, 120));
        row(core, run, Some(i), &limit(&b.title, 6), if answer.is_ok() { "done" } else { "failed" }, Some(answer.as_ref().cloned().unwrap_or_else(|_| "Couldn't finish this brief. Try another swarm.".into())));
        answer.ok()
    })).await.into_iter().flatten().collect::<Vec<_>>();
    let summary = if answers.is_empty() {
        "The helpers couldn't finish their briefs. Try again.".into()
    } else {
        ask(core, run, "land", None, "Combine the best points from the helpers into one useful thought of at most 120 words. Do not invent findings. Note any disagreement.", json!({"ask":run.ask.topic,"answers":answers})).await.map(|s| limit(&s, 120)).unwrap_or_else(|_| limit(&answers.join(" "), 120))
    };
    let world = core.snapshot();
    let topic = run
        .topic
        .as_deref()
        .map(|t| world.resolve(t))
        .filter(|id| world.threads.iter().any(|t| &t.id == id));
    let mut changes = Vec::new();
    let topic = topic.unwrap_or_else(|| {
        let id = format!("topic-{}", uuid::Uuid::new_v4().simple());
        changes.push(Change::ThreadAdded {
            thread: Thread {
                id: id.clone(),
                title: limit(&run.ask.topic, 6),
                parent_id: None,
                status: ThreadStatus::Open,
                last_point: String::new(),
                touched_ms: crate::now_ms(),
                tags: vec![],
                picture: None,
                dropped_by: String::new(),
            },
        });
        id
    });
    let text = format!("Helpers: {summary}");
    changes.push(Change::ThoughtAdded {
        thought: Thought {
            id: format!("th-{}", uuid::Uuid::new_v4().simple()),
            speaker: "Helpers".into(),
            text: text.clone(),
            point: text,
            thread_id: Some(topic.clone()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: crate::now_ms(),
            place_ms: Some(0),
            decided: false,
        },
    });
    changes.push(Change::ThreadTouched {
        thread_id: topic.clone(),
        last_point: format!("Helpers: {summary}"),
        at_ms: crate::now_ms(),
    });
    core.commit(changes);
    row(
        core,
        run,
        None,
        "Thinking helpers",
        if answers.is_empty() { "failed" } else { "done" },
        Some(summary),
    );
    core.trace.write(|| json!({"kind":"helpers_landed", "swarm":run.id, "topic":topic, "done":answers.len(), "failed":run.ask.count - answers.len()}));
}

#[cfg(test)]
mod tests;
