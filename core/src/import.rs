//! Import: turns an export of someone's past AI chats into threads on the map. A fast model reads
//! their own messages a part at a time and pulls out each idea; a stronger model groups the ideas
//! into threads, open questions and dated tasks. Everything lands as ordinary changes, and every
//! point keeps the time it was first said, so search, focus, pictures and the refiner just work.
//! In a room, only the laptop running the core imports (the chats go out with its key), the points
//! land as that window's speaker, and the progress goes only to them.

use crate::protocol::ServerMsg;
use crate::world::{Action, Change, ItemStatus, Suggestion, Thought, Thread, ThreadStatus, World};
use crate::Core;
use anyhow::{anyhow, bail, Context};
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
/// The biggest file the core will read; anything larger gets a clear message instead.
pub const MAX_BYTES: usize = 100 << 20;
/// One import reads the person's latest messages up to this many characters, so it stays quick and cheap.
const MAX_CHARS: usize = 300_000;
/// Past this, a message is mostly pasted text; only its start is read.
const MAX_MESSAGE: usize = 2_000;
/// How much of each AI reply goes along, as context only.
const REPLY_CONTEXT: usize = 240;
/// The most one part for the fast model holds, in characters.
const PART: usize = 8_000;
/// Parts read at once.
const PARALLEL: usize = 6;

// Stable text first, so the API's prompt cache can reuse it.
const EXTRACT: &str = "You read part of someone's past chats with an AI assistant and pull out what the person was thinking: \
ideas, plans, decisions, questions, worries and things they need to do. Each of their messages is numbered, with the date it was sent; \
the \"AI\" line under it is the start of the assistant's reply, context only: never take items from it. \
Skip pasted text and code, greetings, thanks, and instructions about the reply itself (\"make it shorter\"). \
One item per distinct idea; a long message often holds several. For each item: \
msg: the message number; \
topic: 2 to 5 words naming the subject, general enough to group with other parts (for example \"Job search\", \"Kitchen renovation\", \"Marathon training\"); \
point: the idea in at most 12 words, in the person's own voice; \
quote: the person's own words for it, copied exactly, at most 40 words (cut with … rather than rewrite); \
kind: idea, plan, decision, question (a choice they're torn on counts: \"torn between renting and buying\" is a question), worry or task; \
open: for a question, true while the person hasn't decided it (a plain fact the AI answered is settled; advice doesn't settle a choice); \
for a task, true unless a later message here says it's done; else false; \
when: the date for a task, a plan, or anything set on a date (a deadline, a birthday, a class starting), as YYYY-MM-DD, \
worked out from the date the message was sent (\"by Friday\" sent on Tue 2026-10-13 is 2026-10-16); only a day, \
never a month alone (\"in January\" has no date); else empty. \
Answer with JSON only.";

const MERGE: &str = "You turn ideas pulled from someone's past AI chats into a map of their thinking: threads (topics, and tangents \
that branch from them), the questions still open, and the tasks still to do. Return JSON with: \
threads: group the numbered topics into threads a person would recognize as one subject each. key: a short id you choose; \
title: up to 5 plain words, all titles distinct; parent: the key of a broader thread this one branches from, else empty \
(one level of branching at most); existing: the id of a thread already on the map when it is clearly the same subject, else empty; \
topics: the topic numbers it holds. Every topic number goes to exactly one thread. Usually 3 to 12 threads for a few conversations, \
up to about 40 for many. \
questions: at most one per thread: the choice or question the person seems most undecided on at the end, asked back to them \
in under 14 words (for example \"Rent or buy this year?\"); the thread key. Skip questions that later ideas settle, \
and facts that were only to look up. \
actions: each task still to do and each upcoming date from the list, once: the thread key; kind \"event\" for something that \
happens on a date (a launch, a birthday, a class), \"reminder\" for something to do; a short title; when as YYYY-MM-DD from the list, \
else empty. Skip tasks that later ideas show are done, and dates already past. \
Use empty lists when nothing applies. Answer with JSON only.";

/// Where an import stands, sent to every window on each step.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Status {
    pub id: String,
    pub file: String,
    /// "reading", "grouping", "adding", then "done", "stopped" or "failed".
    pub state: String,
    pub parts: usize,
    pub parts_done: usize,
    pub ideas: usize,
    /// Topics found while reading; new threads once they land.
    pub threads: usize,
    /// Threads already on the map that got imported points.
    pub extended: usize,
    pub points: usize,
    pub questions: usize,
    pub actions: usize,
    /// What went wrong, or what was skipped; empty when all went well.
    pub note: String,
}

/// The import in progress: a read file waiting for a go-ahead, the running job, and its latest status.
#[derive(Default)]
pub struct Imports {
    prepared: Mutex<Option<Prepared>>,
    job: Mutex<Option<Job>>,
    status: Mutex<Option<Status>>,
}

/// The running import and whose it is: its points land as theirs, and only they see its progress.
struct Job {
    handle: tokio::task::AbortHandle,
    speaker: String,
}

impl Imports {
    fn running(&self) -> bool {
        self.job.lock().unwrap().as_ref().is_some_and(|job| !job.handle.is_finished())
    }

    /// The running import's status for a window that connects mid-way, when the import is its speaker's.
    pub fn live_for(&self, speaker: &str) -> Option<Status> {
        let theirs = self.job.lock().unwrap().as_ref().is_some_and(|job| !job.handle.is_finished() && job.speaker == speaker);
        if theirs {
            self.status.lock().unwrap().clone()
        } else {
            None
        }
    }
}

/// A read file, waiting for the person to start it.
struct Prepared {
    id: String,
    file: String,
    parts: Vec<Vec<Said>>,
}

/// What the person sees before anything is sent anywhere.
#[derive(Serialize)]
struct Preview {
    id: String,
    file: String,
    format: &'static str,
    conversations: usize,
    /// All of the person's messages in the file, those already on the map (skipped), and how many
    /// this import reads: the latest of the rest, up to the cap.
    total: usize,
    already: usize,
    messages: usize,
    words: usize,
    from_ms: u64,
    to_ms: u64,
    parts: usize,
    extract_model: String,
    merge_model: String,
    /// A rough price for the model calls, in US dollars.
    cost: f64,
}

#[derive(Deserialize)]
pub struct FileName {
    #[serde(default)]
    name: String,
}

/// POST /import: reads an export and says what an import would send to which model. Starts nothing;
/// the window starts it with an import_start message once the person agrees.
pub async fn prepare(
    State(core): State<Arc<Core>>,
    ConnectInfo(link): ConnectInfo<crate::Link>,
    Query(query): Query<FileName>,
    body: Bytes,
) -> Response {
    let refuse = |status: StatusCode, message: &str| (status, Json(json!({ "error": message }))).into_response();
    if !link.here() {
        return refuse(StatusCode::FORBIDDEN, ONLY_HERE);
    }
    if core.key.is_none() {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "Importing needs the model key. Set MODEL_API_KEY in .env (see .env.example).");
    }
    if core.imports.running() {
        return refuse(StatusCode::CONFLICT, "An import is already running. Stop it, or wait for it to finish.");
    }
    // An imported point keeps its message's exact time, so a message seen before is one already on the map
    // (whatever name it went under).
    let known: HashSet<u64> = core.snapshot().thoughts.iter().map(|t| t.at_ms).collect();
    let file: String = query.name.rsplit(['/', '\\']).next().unwrap_or_default().trim().chars().take(80).collect();
    let file = if file.is_empty() { "your file".to_string() } else { file };
    // A big export takes a moment to read; keep it off the threads that serve the map.
    let now = crate::now_ms();
    let read = tokio::task::spawn_blocking(move || read(&body).map(|(format, conversations)| (format, select(conversations, now, &known)))).await;
    let (format, chosen) = match read {
        Ok(Ok(found)) => found,
        Ok(Err(message)) => return refuse(StatusCode::UNPROCESSABLE_ENTITY, &message),
        Err(_) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, "Couldn't read that file."),
    };
    if chosen.said.is_empty() {
        let message = if chosen.already > 0 {
            "Everything in this file is already on your map."
        } else {
            "There are no messages of yours in this file, so there's nothing to import."
        };
        return refuse(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let (extract_model, merge_model) = models();
    let parts = pack(chosen.said);
    let preview = Preview {
        id: format!("im-{}", uuid::Uuid::new_v4().simple()),
        file: file.clone(),
        format,
        conversations: chosen.conversations,
        total: chosen.total,
        already: chosen.already,
        messages: parts.iter().map(Vec::len).sum(),
        words: chosen.words,
        from_ms: chosen.from_ms,
        to_ms: chosen.to_ms,
        parts: parts.len(),
        cost: estimate(chosen.chars, parts.len(), &extract_model, &merge_model),
        extract_model,
        merge_model,
    };
    *core.imports.prepared.lock().unwrap() = Some(Prepared { id: preview.id.clone(), file, parts });
    Json(preview).into_response()
}

/// In a room, the chats go out with this laptop's key and land as one person's points, so they're the host's.
const ONLY_HERE: &str = "In a room, only the laptop running E2A2O can import chats.";

/// Starts the file read under this id, as the speaker of the window that asked; one import at a time.
pub fn start(core: Arc<Core>, id: String, speaker: String, here: bool) {
    if !here {
        return core.send_to(&speaker, ServerMsg::Notice { message: ONLY_HERE.into() });
    }
    let mut job = core.imports.job.lock().unwrap();
    if job.as_ref().is_some_and(|j| !j.handle.is_finished()) {
        return core.send_to(&speaker, ServerMsg::Notice { message: "An import is already running.".into() });
    }
    let prepared = core.imports.prepared.lock().unwrap().take_if(|p| p.id == id);
    let Some(prepared) = prepared else {
        return core.send_to(&speaker, ServerMsg::Notice { message: "That file isn't ready any more. Choose it again to import.".into() });
    };
    let handle = tokio::spawn(run(core.clone(), prepared, speaker.clone())).abort_handle();
    *job = Some(Job { handle, speaker });
}

/// Stops the running import when it's this speaker's. Threads that already landed stay; nothing more is added.
pub fn cancel(core: &Core, speaker: &str) {
    let job = {
        let mut job = core.imports.job.lock().unwrap();
        if job.as_ref().is_none_or(|j| j.speaker != speaker) {
            return;
        }
        job.take()
    };
    let Some(job) = job.filter(|j| !j.handle.is_finished()) else { return };
    job.handle.abort();
    let mut status = core.imports.status.lock().unwrap().clone().unwrap_or_default();
    status.note = match status.state.as_str() {
        "adding" if status.points > 0 => "Stopped. What was already added stays on the map.".into(),
        _ => "Stopped. Nothing was added.".into(),
    };
    status.state = "stopped".into();
    publish(core, speaker, &status);
}

/// Models for each step. Never Contributor mode by default: these are someone's private chats,
/// and Contributor mode lets Meta keep data to improve its products.
fn models() -> (String, String) {
    let pick = |name: &str, fallback: &str| std::env::var(name).ok().filter(|m| !m.trim().is_empty()).unwrap_or_else(|| fallback.into());
    (pick("IMPORT_EXTRACT_MODEL", "muse-spark-1.2"), pick("IMPORT_MERGE_MODEL", "muse-spark-1.3"))
}

/// Only to the person importing: in a room, the others see the threads land, not the progress.
fn publish(core: &Core, speaker: &str, status: &Status) {
    *core.imports.status.lock().unwrap() = Some(status.clone());
    core.send_to(speaker, ServerMsg::Import { status: status.clone() });
}

async fn run(core: Arc<Core>, job: Prepared, speaker: String) {
    let (extract_model, merge_model) = models();
    let offset = local_offset();
    let mut status = Status { id: job.id.clone(), file: job.file.clone(), state: "reading".into(), parts: job.parts.len(), ..Status::default() };
    publish(&core, &speaker, &status);

    // A few parts at a time. A part that keeps failing is skipped; the others still count.
    let mut ideas: Vec<Idea> = Vec::new();
    let (mut failed, mut reason) = (0, String::new());
    let mut topics_seen = HashSet::new();
    let mut reads = futures_util::stream::iter(0..job.parts.len()).map(|i| extract(&core, &extract_model, &job.parts[i], offset)).buffer_unordered(PARALLEL);
    while let Some(result) = reads.next().await {
        match result {
            Ok(found) => {
                topics_seen.extend(found.iter().map(|idea| topic_key(&idea.topic)));
                ideas.extend(found);
            }
            Err(e) => {
                tracing::warn!("import: a part failed: {e:#}");
                (failed, reason) = (failed + 1, short(&e));
            }
        }
        (status.parts_done, status.ideas, status.threads) = (status.parts_done + 1, ideas.len(), topics_seen.len());
        publish(&core, &speaker, &status);
    }
    drop(reads);
    let mut notes = Vec::new();
    if ideas.is_empty() {
        status.state = "failed".into();
        status.note = if failed > 0 {
            format!("Couldn't read your chats ({reason}). Nothing was added.")
        } else {
            "Found no ideas in these messages, so nothing was added.".into()
        };
        return finish(&core, &speaker, &status);
    }
    if failed > 0 {
        notes.push(format!("{failed} of {} parts couldn't be read ({reason}); the rest were added.", job.parts.len()));
    }

    ideas.sort_by_key(|idea| idea.at_ms);
    let topics = topics(&ideas);
    status.state = "grouping".into();
    publish(&core, &speaker, &status);
    let world = core.snapshot();
    let groups = match group(&core, &merge_model, &topics, &ideas, &world, offset).await {
        Ok(groups) if groups.iter().any(|g| !g.ideas.is_empty()) => groups,
        // The ideas are already paid for: keep them, one thread per topic.
        result => {
            let why = result.err().map(|e| short(&e)).unwrap_or_else(|| "no threads came back".into());
            tracing::warn!("import: grouping failed: {why}");
            notes.push(format!("Couldn't group the ideas into threads ({why}), so each topic became its own thread."));
            by_topic(&topics, &ideas)
        }
    };

    (status.state, status.threads) = ("adding".into(), 0);
    publish(&core, &speaker, &status);
    land(&core, &speaker, &groups, &ideas, &mut status).await;
    status.state = "done".into();
    status.note = notes.join(" ");
    finish(&core, &speaker, &status);
}

/// The last status, and a short notice for a window where the panel is closed.
fn finish(core: &Core, speaker: &str, status: &Status) {
    publish(core, speaker, status);
    let count = |n: usize, word: &str| format!("{n} {word}{}", if n == 1 { "" } else { "s" });
    let message = match status.state.as_str() {
        "done" if status.threads > 0 => format!("Imported {} from {}.", count(status.threads, "thread"), status.file),
        "done" => format!("Imported {} from {}.", count(status.points, "point"), status.file),
        _ => format!("Import didn't finish: {}", status.note),
    };
    core.send_to(speaker, ServerMsg::Notice { message });
}

// ---- Reading exports ----

/// One chat: the person's messages and the AI's replies, in order.
struct Conversation {
    title: String,
    turns: Vec<Turn>,
}

struct Turn {
    mine: bool,
    text: String,
    at_ms: Option<u64>,
}

const NOT_CHATS: &str = "This doesn't look like a chat export. Choose conversations.json from a ChatGPT or Claude export, \
or a JSON list of messages with a role and content.";

/// Reads a ChatGPT or Claude export (conversations.json), or a plain list of messages (JSON or JSON Lines).
fn read(bytes: &[u8]) -> Result<(&'static str, Vec<Conversation>), String> {
    if bytes.starts_with(b"PK") {
        return Err("That's a zip file. Unzip it first, then choose conversations.json from inside.".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| NOT_CHATS.to_string())?;
    let text = text.trim_start_matches('\u{feff}').trim();
    if let Ok(list) = serde_json::from_str::<Vec<GptConversation>>(text) {
        if list.iter().any(|c| c.mapping.is_some()) {
            return Ok(("ChatGPT export", chatgpt(list)));
        }
    }
    if let Ok(list) = serde_json::from_str::<Vec<ClaudeConversation>>(text) {
        if list.iter().any(|c| c.chat_messages.is_some()) {
            return Ok(("Claude export", claude(list)));
        }
    }
    let values = match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(items)) => items,
        Ok(one) => vec![one],
        // JSON Lines: one message per line.
        Err(_) => text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()
            .map_err(|_| NOT_CHATS.to_string())?,
    };
    let conversations = plain(values);
    if !conversations.iter().any(|c| c.turns.iter().any(|t| t.mine)) {
        return Err(NOT_CHATS.into());
    }
    Ok(("list of messages", conversations))
}

/// Reads a field when it has the expected shape, else as missing, so one odd field can't sink a whole export.
fn lenient<'de, D: serde::Deserializer<'de>, T: serde::de::DeserializeOwned>(d: D) -> Result<Option<T>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

// ChatGPT: conversations.json is a list of conversations, each a tree of messages ("mapping").
#[derive(Deserialize)]
struct GptConversation {
    #[serde(default, deserialize_with = "lenient")]
    title: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    create_time: Option<f64>,
    #[serde(default)]
    mapping: Option<HashMap<String, GptNode>>,
    #[serde(default, deserialize_with = "lenient")]
    current_node: Option<String>,
}

#[derive(Deserialize)]
struct GptNode {
    #[serde(default)]
    message: Option<GptMessage>,
    #[serde(default, deserialize_with = "lenient")]
    parent: Option<String>,
}

#[derive(Deserialize)]
struct GptMessage {
    #[serde(default, deserialize_with = "lenient")]
    author: Option<GptAuthor>,
    #[serde(default, deserialize_with = "lenient")]
    create_time: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    content: Option<GptContent>,
    #[serde(default)]
    metadata: Option<GptMetadata>,
    #[serde(default, deserialize_with = "lenient")]
    recipient: Option<String>,
}

#[derive(Deserialize)]
struct GptAuthor {
    #[serde(default, deserialize_with = "lenient")]
    role: Option<String>,
}

#[derive(Deserialize)]
struct GptContent {
    #[serde(default, deserialize_with = "lenient")]
    content_type: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    parts: Option<Vec<Value>>,
}

#[derive(Deserialize)]
struct GptMetadata {
    #[serde(default, deserialize_with = "lenient")]
    is_visually_hidden_from_conversation: Option<bool>,
}

fn chatgpt(list: Vec<GptConversation>) -> Vec<Conversation> {
    list.into_iter()
        .filter_map(|c| {
            let mapping = c.mapping?;
            // The branch the person saw last, walked from its end back to the root. Editing a message
            // starts a new branch; the old one was replaced, so it's left out.
            let mut path = Vec::new();
            let mut node = c.current_node.clone();
            while let Some(id) = node.filter(|_| path.len() <= mapping.len()) {
                let Some(n) = mapping.get(&id) else { break };
                node = n.parent.clone();
                path.push(id);
            }
            path.reverse();
            if path.is_empty() {
                // No current node: every message, in time order.
                path = mapping.keys().cloned().collect();
                let time = |id: &String| mapping[id].message.as_ref().and_then(|m| m.create_time).unwrap_or(0.0);
                path.sort_by(|a, b| time(a).total_cmp(&time(b)));
            }
            let fallback = c.create_time.map(seconds);
            let turns = path
                .iter()
                .filter_map(|id| mapping.get(id)?.message.as_ref())
                .filter_map(|m| {
                    let role = m.author.as_ref()?.role.as_deref()?;
                    let content = m.content.as_ref()?;
                    // Custom instructions, tool calls and system notes aren't part of the talk.
                    let hidden = m.metadata.as_ref().and_then(|x| x.is_visually_hidden_from_conversation).unwrap_or(false);
                    let spoken = matches!(content.content_type.as_deref(), Some("text" | "multimodal_text"));
                    let to_person = m.recipient.as_deref().is_none_or(|r| r == "all");
                    let mine = match role {
                        "user" => true,
                        "assistant" if to_person => false,
                        _ => return None,
                    };
                    if hidden || !spoken {
                        return None;
                    }
                    // Parts are text, or pictures and files (left out).
                    let text = content.parts.iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join("\n");
                    Some(Turn { mine, text: text.trim().to_string(), at_ms: m.create_time.map(seconds).or(fallback) })
                })
                .filter(|t| !t.text.is_empty())
                .collect();
            Some(Conversation { title: c.title.unwrap_or_default(), turns })
        })
        .collect()
}

// Claude: conversations.json is a list of conversations, each with a flat list of chat_messages.
#[derive(Deserialize)]
struct ClaudeConversation {
    #[serde(default, deserialize_with = "lenient")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    created_at: Option<String>,
    #[serde(default)]
    chat_messages: Option<Vec<ClaudeMessage>>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    #[serde(default, deserialize_with = "lenient")]
    sender: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    text: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    content: Option<Vec<ClaudeBlock>>,
    #[serde(default, deserialize_with = "lenient")]
    created_at: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeBlock {
    #[serde(default, rename = "type", deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    text: Option<String>,
}

fn claude(list: Vec<ClaudeConversation>) -> Vec<Conversation> {
    list.into_iter()
        .filter_map(|c| {
            let fallback = c.created_at.as_deref().and_then(parse_time);
            let turns = c
                .chat_messages?
                .into_iter()
                .filter_map(|m| {
                    let mine = match m.sender.as_deref() {
                        Some("human") => true,
                        Some("assistant") => false,
                        _ => return None,
                    };
                    // Newer exports split a message into blocks; older ones only have text.
                    let blocks: Vec<String> =
                        m.content.unwrap_or_default().into_iter().filter(|b| b.kind.as_deref() == Some("text")).filter_map(|b| b.text).collect();
                    let text = if blocks.iter().any(|b| !b.trim().is_empty()) { blocks.join("\n") } else { m.text.unwrap_or_default() };
                    Some(Turn { mine, text: text.trim().to_string(), at_ms: m.created_at.as_deref().and_then(parse_time).or(fallback) })
                })
                .filter(|t| !t.text.is_empty())
                .collect();
            Some(Conversation { title: c.name.unwrap_or_default(), turns })
        })
        .collect()
}

/// A plain list of messages with a role and content, loose or grouped as {"title", "messages": [...]}.
fn plain(values: Vec<Value>) -> Vec<Conversation> {
    let mut out = Vec::new();
    let mut loose = Vec::new();
    for value in values {
        match value.get("messages").and_then(Value::as_array) {
            Some(messages) => {
                let title = ["title", "name"].iter().find_map(|k| value.get(*k)?.as_str()).unwrap_or_default();
                out.push(Conversation { title: title.into(), turns: messages.iter().filter_map(plain_turn).collect() });
            }
            None => loose.extend(plain_turn(&value)),
        }
    }
    if !loose.is_empty() {
        out.push(Conversation { title: String::new(), turns: loose });
    }
    out
}

fn plain_turn(value: &Value) -> Option<Turn> {
    let role = ["role", "sender", "author", "from", "speaker"].iter().find_map(|k| {
        let field = value.get(*k)?;
        field.as_str().or_else(|| field.get("role")?.as_str())
    })?;
    let mine = match role.to_lowercase().as_str() {
        "user" | "human" | "you" | "me" | "person" => true,
        "assistant" | "ai" | "bot" | "model" | "chatgpt" | "gpt" | "claude" | "gemini" | "llama" | "muse" => false,
        _ => return None,
    };
    let text = flatten(["content", "text", "message", "body"].iter().find_map(|k| value.get(*k))?);
    let at_ms = ["timestamp", "created_at", "create_time", "time", "date"].iter().find_map(|k| time_of(value.get(*k)?));
    Some(Turn { mine, text: text.trim().to_string(), at_ms }).filter(|t| !t.text.is_empty())
}

/// Text from a string, a list of parts, or an object holding either.
fn flatten(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().map(flatten).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n"),
        Value::Object(_) => ["text", "parts", "content"].iter().find_map(|k| value.get(*k)).map(flatten).unwrap_or_default(),
        _ => String::new(),
    }
}

/// A time as seconds or milliseconds since 1970, or an ISO 8601 string.
fn time_of(value: &Value) -> Option<u64> {
    let number = value.as_f64().or_else(|| value.as_str()?.trim().parse().ok());
    match number {
        Some(n) if n > 1e11 => Some(n as u64),
        Some(n) if n > 0.0 => Some(seconds(n)),
        _ => parse_time(value.as_str()?),
    }
}

fn seconds(s: f64) -> u64 {
    (s * 1000.0) as u64
}

/// Milliseconds since 1970 from ISO 8601: "2026-10-13T09:12:00.5Z", with an offset, or just a date.
fn parse_time(s: &str) -> Option<u64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let num = |from: usize, to: usize| s.get(from..to)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = if b.len() >= 19 { (num(11, 13)?, num(14, 16)?, num(17, 19)?) } else { (0, 0, 0) };
    let rest = s.get(19..).unwrap_or("");
    let digits = rest.strip_prefix('.').map(|r| r.chars().take_while(char::is_ascii_digit).collect::<String>()).unwrap_or_default();
    let ms = format!("{:0<3}", &digits[..digits.len().min(3)]).parse::<i64>().unwrap_or(0);
    let zone = &rest[rest.len().min(digits.len() + usize::from(!digits.is_empty()))..];
    let offset = match zone.as_bytes().first() {
        Some(sign @ (b'+' | b'-')) => {
            let hm: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
            let minutes = hm.get(0..2)?.parse::<i64>().ok()? * 60 + hm.get(2..4).and_then(|m| m.parse::<i64>().ok()).unwrap_or(0);
            if *sign == b'-' { -minutes } else { minutes }
        }
        _ => 0,
    };
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + sec - offset * 60;
    u64::try_from(secs * 1000 + ms).ok()
}

/// Days since 1970-01-01 for a calendar date (Howard Hinnant's algorithm).
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The calendar date of a day number from days_from_civil.
pub(crate) fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// "2026-10-13 (Tue)" in local time.
fn day(ms: u64, offset: i64) -> String {
    let days = (ms as i64 / 1000 + offset * 60).div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    const WEEK: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    format!("{y}-{m:02}-{d:02} ({})", WEEK[days.rem_euclid(7) as usize])
}

/// This machine's offset from UTC in minutes, from the system's `date` (no time zone crate).
fn local_offset() -> i64 {
    let out = std::process::Command::new("date").arg("+%z").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default();
    let t = out.trim();
    let digits = t.trim_start_matches(['+', '-']);
    match (digits.get(0..2).and_then(|h| h.parse::<i64>().ok()), digits.get(2..4).and_then(|m| m.parse::<i64>().ok())) {
        (Some(h), Some(m)) if t.starts_with('-') => -(h * 60 + m),
        (Some(h), Some(m)) => h * 60 + m,
        _ => 0,
    }
}

// ---- Choosing what to read ----

/// One of the person's messages as the fast model sees it, with the start of the AI's reply.
#[derive(Clone)]
struct Said {
    conversation: usize,
    title: String,
    at_ms: u64,
    text: String,
    reply: String,
}

struct Chosen {
    /// In reading order: conversation by conversation, oldest first.
    said: Vec<Said>,
    total: usize,
    already: usize,
    conversations: usize,
    words: usize,
    chars: usize,
    from_ms: u64,
    to_ms: u64,
}

/// The person's latest messages up to the size cap, each with a time: its own, else its neighbors'
/// in the same chat, else (a list without times) a second apart in file order, ending now. Messages
/// whose time is `known` are already on the map and are left out.
fn select(mut conversations: Vec<Conversation>, now: u64, known: &HashSet<u64>) -> Chosen {
    for c in &mut conversations {
        let first = c.turns.iter().find_map(|t| t.at_ms);
        let mut last = first;
        for t in &mut c.turns {
            last = t.at_ms.or(last);
            t.at_ms = last;
        }
    }
    let untimed = conversations.iter().flat_map(|c| &c.turns).filter(|t| t.at_ms.is_none()).count() as u64;
    let mut n = 0;
    for t in conversations.iter_mut().flat_map(|c| &mut c.turns).filter(|t| t.at_ms.is_none()) {
        n += 1;
        t.at_ms = Some(now.saturating_sub((untimed - n) * 1000));
    }

    let mut all = Vec::new();
    for (index, c) in conversations.iter().enumerate() {
        for (i, turn) in c.turns.iter().enumerate().filter(|(_, t)| t.mine) {
            let reply = c.turns[i + 1..].iter().take_while(|t| !t.mine).next().map(|t| clip(&t.text, REPLY_CONTEXT)).unwrap_or_default();
            all.push(Said { conversation: index, title: c.title.clone(), at_ms: turn.at_ms.unwrap_or(now), text: clip(&turn.text, MAX_MESSAGE), reply });
        }
    }
    let total = all.len();
    all.retain(|s| !known.contains(&s.at_ms));
    let already = total - all.len();
    // The newest first, until the cap.
    let mut newest: Vec<usize> = (0..all.len()).collect();
    newest.sort_by_key(|&i| std::cmp::Reverse(all[i].at_ms));
    let (mut keep, mut chars) = (vec![false; all.len()], 0);
    for i in newest {
        if chars > 0 && chars + all[i].text.len() > MAX_CHARS {
            break;
        }
        chars += all[i].text.len();
        keep[i] = true;
    }
    let mut said: Vec<Said> = all.into_iter().zip(keep).filter_map(|(s, k)| k.then_some(s)).collect();
    // Whole conversations together, in the order they started.
    let mut started: HashMap<usize, u64> = HashMap::new();
    for s in &said {
        started.entry(s.conversation).and_modify(|t| *t = (*t).min(s.at_ms)).or_insert(s.at_ms);
    }
    said.sort_by_key(|s| (started[&s.conversation], s.conversation));
    Chosen {
        total,
        already,
        conversations: started.len(),
        words: said.iter().map(|s| s.text.split_whitespace().count()).sum(),
        chars: said.iter().map(|s| s.text.len() + s.reply.len()).sum(),
        from_ms: said.iter().map(|s| s.at_ms).min().unwrap_or(0),
        to_ms: said.iter().map(|s| s.at_ms).max().unwrap_or(0),
        said,
    }
}

/// Splits the reading into parts for the fast model: whole conversations where they fit, and small
/// enough that even a short import reads in parallel (a long conversation splits between messages).
fn pack(said: Vec<Said>) -> Vec<Vec<Said>> {
    let size = |s: &Said| s.text.len() + s.reply.len() + 60;
    let budget = (said.iter().map(size).sum::<usize>() / 4).clamp(1_500, PART);
    let mut parts: Vec<Vec<Said>> = Vec::new();
    let (mut current, mut used): (Vec<Said>, usize) = (Vec::new(), 0);
    let mut i = 0;
    while i < said.len() {
        let conversation = said[i].conversation;
        let end = said[i..].iter().position(|s| s.conversation != conversation).map_or(said.len(), |n| i + n);
        // A conversation that won't fit starts a fresh part.
        if !current.is_empty() && used + said[i..end].iter().map(size).sum::<usize>() > budget {
            parts.push(std::mem::take(&mut current));
            used = 0;
        }
        for s in &said[i..end] {
            if !current.is_empty() && used + size(s) > PART {
                parts.push(std::mem::take(&mut current));
                used = 0;
            }
            used += size(s);
            current.push(s.clone());
        }
        i = end;
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

/// At most `max` characters, whitespace collapsed, with … where it was cut.
fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    format!("{}…", flat.chars().take(max).collect::<String>().trim_end())
}

/// A rough price in dollars: about 4 characters a token, one idea per 150 characters read, plus
/// instructions and reasoning; Meta's list prices per million tokens.
fn estimate(chars: usize, parts: usize, extract_model: &str, merge_model: &str) -> f64 {
    let price = |model: &str, input: usize, output: usize| {
        let (i, o) = if model.contains("contributor") {
            (0.10, 0.20)
        } else if model.contains("wonder") {
            (4.0, 20.0)
        } else {
            (1.25, 4.25)
        };
        (input as f64 * i + output as f64 * o) / 1e6
    };
    let ideas = chars / 150;
    price(extract_model, chars / 4 + parts * 700, ideas * 70 + parts * 700) + price(merge_model, ideas * 30 + 1_500, ideas * 8 + 3_000)
}

// ---- Model calls ----

/// One idea from the person's messages, with the time they said it.
#[derive(Clone, Debug)]
struct Idea {
    topic: String,
    point: String,
    quote: String,
    kind: String,
    open: bool,
    when: String,
    at_ms: u64,
}

#[derive(Deserialize)]
struct Extracted {
    #[serde(default)]
    items: Vec<Found>,
}

#[derive(Deserialize)]
struct Found {
    #[serde(default)]
    msg: usize,
    #[serde(default)]
    topic: String,
    #[serde(default)]
    point: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    open: bool,
    #[serde(default)]
    when: String,
}

/// One part through the fast model: the ideas in it, each tied to the message it came from.
async fn extract(core: &Core, model: &str, part: &[Said], offset: i64) -> anyhow::Result<Vec<Idea>> {
    let mut text = String::new();
    let mut conversation = usize::MAX;
    for (n, s) in part.iter().enumerate() {
        if s.conversation != conversation {
            conversation = s.conversation;
            let title = if s.title.trim().is_empty() { "untitled" } else { s.title.trim() };
            text += &format!("\nConversation: {title}\n");
        }
        text += &format!("[{}] {}\nPerson: {}\n", n + 1, day(s.at_ms, offset), s.text);
        if !s.reply.is_empty() {
            text += &format!("AI: {}\n", s.reply);
        }
    }
    let schema = json!({
        "type": "object",
        "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {
            "msg": {"type": "integer"},
            "topic": {"type": "string"},
            "point": {"type": "string"},
            "quote": {"type": "string"},
            "kind": {"type": "string", "enum": ["idea", "plan", "decision", "question", "worry", "task"]},
            "open": {"type": "boolean"},
            "when": {"type": "string"}
        }, "required": ["msg", "topic", "point", "quote", "kind", "open", "when"]}}},
        "required": ["items"]
    });
    let answer = retry(3, || ask(core, model, "minimal", 12_000, EXTRACT, &text, "Ideas", &schema, Duration::from_secs(120))).await?;
    let found: Extracted = serde_json::from_str(&answer).context("answer wasn't the expected JSON")?;
    Ok(found
        .items
        .into_iter()
        .filter_map(|item| {
            let said = part.get(item.msg.checked_sub(1)?)?;
            let point = item.point.trim();
            if point.is_empty() {
                return None;
            }
            let topic = if item.topic.trim().is_empty() { said.title.trim() } else { item.topic.trim() };
            Some(Idea {
                topic: if topic.is_empty() { point.into() } else { topic.into() },
                point: point.into(),
                quote: if item.quote.trim().is_empty() { clip(&said.text, 300) } else { item.quote.trim().into() },
                kind: item.kind,
                open: item.open,
                when: date(&item.when),
                at_ms: said.at_ms,
            })
        })
        .collect())
}

/// One structured call to the Meta Model API; returns the answer's JSON text.
#[allow(clippy::too_many_arguments)]
async fn ask(
    core: &Core,
    model: &str,
    effort: &str,
    max_tokens: u32,
    system: &str,
    user: &str,
    name: &str,
    schema: &Value,
    wait: Duration,
) -> anyhow::Result<String> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let body = json!({
        "model": model,
        "reasoning_effort": effort,
        "max_tokens": max_tokens,
        "prompt_cache_key": format!("e2a2o-import-{}", name.to_lowercase()),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema}},
    });
    let response = core.http.post(URL).bearer_auth(key).timeout(wait).json(&body).send().await?;
    let status = response.status();
    let value: Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    Ok(value["choices"][0]["message"]["content"].as_str().context("no answer")?.to_string())
}

/// A blip (a rate limit, a timeout) shouldn't cost a part: a few tries, a short pause between.
async fn retry<T, F, Fut>(tries: u64, mut call: F) -> anyhow::Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<T>>,
{
    let mut attempt = 1;
    loop {
        match call().await {
            Ok(value) => return Ok(value),
            Err(e) if attempt < tries => {
                tracing::warn!("import call failed (try {attempt}): {e:#}");
                tokio::time::sleep(Duration::from_millis(800 * attempt)).await;
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// An error short enough for the panel.
fn short(e: &anyhow::Error) -> String {
    clip(&e.to_string(), 120)
}

/// The date if it's YYYY-MM-DD, else empty.
fn date(text: &str) -> String {
    let t = text.trim();
    let ok = t.len() == 10 && t.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if ok { t.into() } else { String::new() }
}

// ---- Grouping ----

/// Ideas that share a topic name (ignoring case and punctuation).
struct Topic {
    label: String,
    ideas: Vec<usize>,
}

fn topic_key(label: &str) -> String {
    label.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

fn topics(ideas: &[Idea]) -> Vec<Topic> {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Topic> = Vec::new();
    for (i, idea) in ideas.iter().enumerate() {
        let n = *index.entry(topic_key(&idea.topic)).or_insert_with(|| {
            out.push(Topic { label: idea.topic.clone(), ideas: Vec::new() });
            out.len() - 1
        });
        out[n].ideas.push(i);
    }
    out
}

/// A thread to land: a new one, or one already on the map that gets more points.
#[derive(Debug, Default)]
struct Group {
    title: String,
    /// Another group this one branches from.
    parent: Option<usize>,
    /// A thread already on the map.
    existing: Option<String>,
    ideas: Vec<usize>,
    question: String,
    actions: Vec<Task>,
}

#[derive(Debug)]
struct Task {
    kind: String,
    title: String,
    when: String,
}

#[derive(Deserialize, Default)]
struct Merged {
    #[serde(default)]
    threads: Vec<MergedThread>,
    #[serde(default)]
    questions: Vec<MergedQuestion>,
    #[serde(default)]
    actions: Vec<MergedAction>,
}

#[derive(Deserialize)]
struct MergedThread {
    #[serde(default)]
    key: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    parent: String,
    #[serde(default)]
    existing: String,
    #[serde(default)]
    topics: Vec<usize>,
}

#[derive(Deserialize)]
struct MergedQuestion {
    #[serde(default)]
    thread: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct MergedAction {
    #[serde(default)]
    thread: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    when: String,
}

/// The stronger model groups the topics into threads and picks the open questions and tasks.
async fn group(core: &Core, model: &str, topics: &[Topic], ideas: &[Idea], world: &World, offset: i64) -> anyhow::Result<Vec<Group>> {
    let prompt = merge_prompt(topics, ideas, world, offset);
    let schema = json!({
        "type": "object",
        "properties": {
            "threads": {"type": "array", "items": {"type": "object", "properties": {
                "key": {"type": "string"}, "title": {"type": "string"}, "parent": {"type": "string"},
                "existing": {"type": "string"}, "topics": {"type": "array", "items": {"type": "integer"}}
            }, "required": ["key", "title", "parent", "existing", "topics"]}},
            "questions": {"type": "array", "items": {"type": "object", "properties": {
                "thread": {"type": "string"}, "text": {"type": "string"}
            }, "required": ["thread", "text"]}},
            "actions": {"type": "array", "items": {"type": "object", "properties": {
                "thread": {"type": "string"}, "kind": {"type": "string", "enum": ["reminder", "event"]},
                "title": {"type": "string"}, "when": {"type": "string"}
            }, "required": ["thread", "kind", "title", "when"]}}
        },
        "required": ["threads", "questions", "actions"]
    });
    let answer = retry(2, || ask(core, model, "low", 16_000, MERGE, &prompt, "Map", &schema, Duration::from_secs(240))).await?;
    let merged: Merged = serde_json::from_str(&answer).context("answer wasn't the expected JSON")?;
    Ok(plan(merged, topics, world))
}

/// What the stronger model sees: the map's threads, the topics with a few of their ideas, and the
/// open questions and tasks, each with the date it was said. Never the messages themselves.
fn merge_prompt(topics: &[Topic], ideas: &[Idea], world: &World, offset: i64) -> String {
    let mut existing: Vec<&Thread> = world.threads.iter().collect();
    existing.sort_by_key(|t| std::cmp::Reverse(t.touched_ms));
    let existing: Vec<String> = existing.iter().take(80).map(|t| format!("{}: {}", t.id, t.title)).collect();
    let short_day = |ms: u64| day(ms, offset)[..10].to_string();
    let listed: Vec<String> = topics
        .iter()
        .enumerate()
        .map(|(n, t)| {
            let (first, last) = (ideas[t.ideas[0]].at_ms, ideas[t.ideas[t.ideas.len() - 1]].at_ms);
            let latest: Vec<&str> = t.ideas.iter().rev().take(4).rev().map(|&i| ideas[i].point.as_str()).collect();
            format!("{}. {} · {} ideas · {} to {} · {}", n + 1, t.label, t.ideas.len(), short_day(first), short_day(last), latest.join(" | "))
        })
        .collect();
    let line = |i: &Idea| format!("{} · {} · {}{}", short_day(i.at_ms), i.topic, i.point, if i.when.is_empty() { String::new() } else { format!(" · {}", i.when) });
    let recent = |keep: &dyn Fn(&Idea) -> bool| -> Vec<String> {
        let all: Vec<String> = ideas.iter().filter(|i| keep(i)).map(line).collect();
        all[all.len().saturating_sub(150)..].to_vec()
    };
    let questions = recent(&|i| i.kind == "question" && i.open);
    let tasks = recent(&to_do);
    let or_none = |lines: Vec<String>| if lines.is_empty() { "(none)".to_string() } else { lines.join("\n") };
    format!(
        "Today is {}.\nThreads already on the map (id: title):\n{}\nTopics from the chats (number. topic · ideas · dates · the latest ideas):\n{}\n\
         Questions the person asked that were still open when asked (date · topic · question):\n{}\n\
         Tasks and dates (date said · topic · what · date due):\n{}",
        day(crate::now_ms(), offset),
        or_none(existing),
        listed.join("\n"),
        or_none(questions),
        or_none(tasks)
    )
}

/// Turns the model's answer into groups, trusting only topics and threads that exist. A topic the
/// model left out becomes its own thread, so no idea is lost.
fn plan(merged: Merged, topics: &[Topic], world: &World) -> Vec<Group> {
    let mut keys: HashMap<String, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();
    let mut taken = vec![false; topics.len()];
    let mut raw_parent: Vec<String> = Vec::new();
    for t in &merged.threads {
        let mut g = Group { title: t.title.trim().trim_end_matches('.').to_string(), ..Group::default() };
        if !t.existing.trim().is_empty() {
            let id = world.resolve(t.existing.trim());
            g.existing = world.thread(&id).map(|_| id);
        }
        for &n in &t.topics {
            if (1..=topics.len()).contains(&n) && !taken[n - 1] {
                taken[n - 1] = true;
                g.ideas.extend(&topics[n - 1].ideas);
            }
        }
        if g.title.is_empty() {
            g.title = t.topics.iter().find_map(|&n| topics.get(n.wrapping_sub(1))).map(|t| t.label.clone()).unwrap_or_else(|| "Untitled".into());
        }
        if !t.key.trim().is_empty() {
            keys.entry(t.key.trim().to_string()).or_insert(groups.len());
        }
        raw_parent.push(t.parent.trim().to_string());
        groups.push(g);
    }
    for (topic, _) in topics.iter().zip(&taken).filter(|(_, taken)| !**taken) {
        groups.push(Group { title: topic.label.clone(), ideas: topic.ideas.clone(), ..Group::default() });
    }

    // One level of branching: a branch hangs from the top of its chain; a chain that loops is cut.
    let up: Vec<Option<usize>> =
        (0..groups.len()).map(|i| raw_parent.get(i).filter(|p| !p.is_empty()).and_then(|p| keys.get(p)).copied().filter(|&p| p != i)).collect();
    for i in 0..groups.len() {
        let mut top = up[i];
        for _ in 0..groups.len() {
            match top.and_then(|p| up[p]) {
                Some(next) if next != i => top = Some(next),
                _ => break,
            }
        }
        groups[i].parent = top.filter(|&p| p != i && groups[i].existing.is_none());
    }
    for i in 0..groups.len() {
        if let Some(p) = groups[i].parent {
            if groups[p].parent.is_some() {
                groups[i].parent = None;
            }
        }
    }

    for q in merged.questions {
        let Some(&g) = keys.get(q.thread.trim()) else { continue };
        let open = |id: &String| world.suggestions.iter().any(|s| &s.thread_id == id && s.status != ItemStatus::Dismissed);
        if groups[g].question.is_empty() && !q.text.trim().is_empty() && !groups[g].existing.as_ref().is_some_and(open) {
            groups[g].question = q.text.trim().into();
        }
    }
    let mut seen: HashSet<String> = world.actions.iter().map(|a| a.title.to_lowercase()).collect();
    for a in merged.actions {
        let Some(&g) = keys.get(a.thread.trim()) else { continue };
        let title = a.title.trim();
        if title.is_empty() || !seen.insert(title.to_lowercase()) {
            continue;
        }
        let when = date(&a.when);
        // An event needs a date; without one it's a reminder rather than an invented day.
        let kind = if a.kind == "event" && !when.is_empty() { "event" } else { "reminder" };
        groups[g].actions.push(Task { kind: kind.into(), title: title.into(), when });
    }
    groups
}

/// An open task, or anything set on a date (a deadline, a launch, a birthday).
fn to_do(idea: &Idea) -> bool {
    if idea.kind == "task" { idea.open } else { !idea.when.is_empty() }
}

/// When grouping fails: one thread per topic, with its latest open question and its dated tasks.
fn by_topic(topics: &[Topic], ideas: &[Idea]) -> Vec<Group> {
    topics
        .iter()
        .map(|t| {
            let of = |keep: fn(&Idea) -> bool| t.ideas.iter().map(|&i| &ideas[i]).filter(move |i| keep(i));
            Group {
                title: t.label.clone(),
                ideas: t.ideas.clone(),
                question: of(|i| i.kind == "question" && i.open).last().map(|i| i.point.clone()).unwrap_or_default(),
                actions: of(|i| to_do(i) && !i.when.is_empty())
                    .take(2)
                    .map(|i| Task { kind: "reminder".into(), title: i.point.clone(), when: i.when.clone() })
                    .collect(),
                ..Group::default()
            }
        })
        .collect()
}

// ---- Landing ----

/// Parents before their branches; siblings in the order they were first talked about. Groups with
/// nothing in them, and no branch with anything, are left out.
fn order(groups: &[Group], ideas: &[Idea]) -> Vec<usize> {
    let branches = |i: usize| (0..groups.len()).filter(move |&b| groups[b].parent == Some(i));
    let all = |i: usize| groups[i].ideas.iter().chain(branches(i).flat_map(|b| groups[b].ideas.iter()));
    let first = |i: usize| all(i).map(|&n| ideas[n].at_ms).min();
    let mut roots: Vec<usize> = (0..groups.len()).filter(|&i| groups[i].parent.is_none() && first(i).is_some()).collect();
    roots.sort_by_key(|&i| first(i));
    let mut out = Vec::new();
    for root in roots {
        out.push(root);
        let mut under: Vec<usize> = branches(root).filter(|&b| first(b).is_some()).collect();
        under.sort_by_key(|&b| first(b));
        out.extend(under);
    }
    out
}

/// The changes for one group: its thread (when new), its points with their own times, its open
/// question and tasks. A repeat of the same point in one thread lands once. `touched` is the time
/// for a new thread with no points of its own (a parent whose branches hold them).
fn changes_for(group: &Group, id: &str, parent: Option<String>, ideas: &[Idea], world: &World, touched: u64, speaker: &str) -> Vec<Change> {
    let mut sorted: Vec<&Idea> = group.ideas.iter().map(|&i| &ideas[i]).collect();
    sorted.sort_by_key(|i| i.at_ms);
    let mut seen = HashSet::new();
    let points: Vec<&Idea> = sorted.into_iter().filter(|idea| seen.insert(topic_key(&idea.point))).collect();
    let new_id = |prefix: &str| format!("{prefix}-{}", uuid::Uuid::new_v4().simple());
    let mut changes = Vec::new();
    let existing = world.thread(id);
    if existing.is_none() {
        changes.push(Change::ThreadAdded {
            thread: Thread {
                id: id.into(),
                title: group.title.clone(),
                parent_id: parent,
                status: ThreadStatus::Open,
                last_point: points.last().map(|i| i.point.clone()).unwrap_or_default(),
                touched_ms: points.last().map_or(touched, |i| i.at_ms),
                tags: Vec::new(),
                picture: None,
                dropped_by: String::new(),
            },
        });
    }
    for idea in &points {
        changes.push(Change::ThoughtAdded {
            thought: Thought {
                id: new_id("th"),
                speaker: speaker.into(),
                text: idea.quote.clone(),
                point: idea.point.clone(),
                thread_id: Some(id.into()),
                placed: true,
                unclear: String::new(),
                guess: String::new(),
                heard: String::new(),
                fixed: String::new(),
                complete: true,
                at_ms: idea.at_ms,
                place_ms: None,
            },
        });
    }
    // A thread already on the map only moves forward in time.
    if let (Some(thread), Some(last)) = (existing, points.last()) {
        if last.at_ms > thread.touched_ms {
            changes.push(Change::ThreadTouched { thread_id: id.into(), last_point: last.point.clone(), at_ms: last.at_ms });
        }
    }
    if !group.question.is_empty() {
        changes.push(Change::SuggestionAdded {
            suggestion: Suggestion { id: new_id("sg"), thread_id: id.into(), text: group.question.clone(), status: ItemStatus::New },
        });
    }
    for task in &group.actions {
        changes.push(Change::ActionProposed {
            action: Action {
                id: new_id("ac"),
                thread_id: id.into(),
                kind: task.kind.clone(),
                title: task.title.clone(),
                when: task.when.clone(),
                status: ItemStatus::New,
                done_ms: None,
            },
        });
    }
    changes
}

/// Puts the groups on the map one thread at a time, so the map visibly fills in. New threads get
/// ids of their own (I1, I2, …): the placer names threads from a snapshot taken before its model
/// call, so sharing its T numbers could hand two threads one id.
async fn land(core: &Core, speaker: &str, groups: &[Group], ideas: &[Idea], status: &mut Status) {
    let world = core.snapshot();
    let base = world.threads.len() + world.merged.len();
    let mut ids: Vec<Option<String>> = vec![None; groups.len()];
    let (mut made, mut newest) = (0, None::<(u64, String)>);
    for i in order(groups, ideas) {
        let group = &groups[i];
        // A thread already on the map, followed through any merge since grouping; else a new one.
        let existing = group.existing.as_ref().map(|id| world.resolve(id)).filter(|id| world.thread(id).is_some());
        let id = match &existing {
            Some(id) => id.clone(),
            None => {
                made += 1;
                format!("I{}", base + made)
            }
        };
        ids[i] = Some(id.clone());
        let parent = group.parent.and_then(|p| ids[p].clone());
        let branch_time = groups.iter().filter(|g| g.parent == Some(i)).flat_map(|g| &g.ideas).map(|&n| ideas[n].at_ms).max();
        let changes = changes_for(group, &id, parent, ideas, &world, branch_time.unwrap_or_else(crate::now_ms), speaker);
        if changes.is_empty() {
            continue;
        }
        let points = status.points;
        for change in &changes {
            match change {
                Change::ThreadAdded { .. } => status.threads += 1,
                Change::ThoughtAdded { thought } => {
                    status.points += 1;
                    if existing.is_none() && newest.as_ref().is_none_or(|(at, _)| thought.at_ms >= *at) {
                        newest = Some((thought.at_ms, id.clone()));
                    }
                }
                Change::SuggestionAdded { .. } => status.questions += 1,
                Change::ActionProposed { .. } => status.actions += 1,
                _ => {}
            }
        }
        if existing.is_some() && status.points > points {
            status.extended += 1;
        }
        core.commit(changes);
        publish(core, speaker, status);
        tokio::time::sleep(Duration::from_millis(80)).await;
    }
    // With no thread of their own yet, open on the one they were on most recently.
    if let Some((_, id)) = newest.filter(|_| core.snapshot().active_for(speaker).is_none()) {
        core.commit(vec![Change::ActiveChanged { thread_id: id, speaker: speaker.into() }]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turns(c: &Conversation) -> Vec<(bool, &str)> {
        c.turns.iter().map(|t| (t.mine, t.text.as_str())).collect()
    }

    #[test]
    fn reads_a_chatgpt_export_along_the_branch_the_person_kept() {
        let file = r#"[{"title": "Lisbon", "create_time": 1791000000.0, "current_node": "d", "mapping": {
            "root": {"id": "root", "message": null, "parent": null, "children": ["ci"]},
            "ci": {"message": {"author": {"role": "user"}, "content": {"content_type": "user_editable_context", "user_profile": "I like tea"},
                   "metadata": {"is_visually_hidden_from_conversation": true}}, "parent": "root"},
            "a": {"message": {"author": {"role": "user"}, "create_time": 1791000100.5, "content": {"content_type": "text", "parts": ["Move in January?"]}}, "parent": "ci"},
            "old": {"message": {"author": {"role": "user"}, "create_time": 1791000150, "content": {"content_type": "text", "parts": ["an edit I replaced"]}}, "parent": "a"},
            "b": {"message": {"author": {"role": "assistant"}, "recipient": "all", "content": {"content_type": "text", "parts": ["Yes, January works."]}}, "parent": "a"},
            "tool": {"message": {"author": {"role": "assistant"}, "recipient": "web.run", "content": {"content_type": "code", "parts": ["search()"]}}, "parent": "b"},
            "c": {"message": {"author": {"role": "user"}, "create_time": 1791000200, "content": {"content_type": "multimodal_text",
                  "parts": [{"content_type": "image_asset_pointer"}, "Is this flat ok?"]}}, "parent": "tool"},
            "d": {"message": {"author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["Looks bright."]}}, "parent": "c"}
        }}]"#;
        let (format, conversations) = read(file.as_bytes()).unwrap();
        assert_eq!(format, "ChatGPT export");
        assert_eq!(turns(&conversations[0]), [(true, "Move in January?"), (false, "Yes, January works."), (true, "Is this flat ok?"), (false, "Looks bright.")]);
        assert_eq!(conversations[0].turns[0].at_ms, Some(1_791_000_100_500));
        // A reply without its own time takes the conversation's.
        assert_eq!(conversations[0].turns[1].at_ms, Some(1_791_000_000_000));
    }

    #[test]
    fn reads_a_claude_export() {
        let file = r#"[{"uuid": "x", "name": "Sleep", "created_at": "2026-10-13T08:00:00Z", "chat_messages": [
            {"sender": "human", "text": "", "content": [{"type": "text", "text": "I wake at 4am."}], "created_at": "2026-10-13T08:01:00.250000+00:00"},
            {"sender": "assistant", "text": "Try a fixed wake time.", "created_at": "2026-10-13T08:01:05Z"},
            {"sender": "human", "text": "Phone goes in the kitchen."}
        ]}]"#;
        let (format, conversations) = read(file.as_bytes()).unwrap();
        assert_eq!(format, "Claude export");
        assert_eq!(conversations[0].title, "Sleep");
        assert_eq!(turns(&conversations[0]), [(true, "I wake at 4am."), (false, "Try a fixed wake time."), (true, "Phone goes in the kitchen.")]);
        assert_eq!(conversations[0].turns[0].at_ms, parse_time("2026-10-13T08:01:00.25Z"));
        assert_eq!(conversations[0].turns[2].at_ms, parse_time("2026-10-13T08:00:00Z"));
    }

    #[test]
    fn reads_plain_lists_and_json_lines() {
        let list = r#"[{"role": "system", "content": "Be brief."}, {"role": "user", "content": [{"type": "text", "text": "Plan the offsite."}], "timestamp": 1791000000},
                       {"role": "assistant", "content": "Sure."}]"#;
        let (format, conversations) = read(list.as_bytes()).unwrap();
        assert_eq!(format, "list of messages");
        assert_eq!(turns(&conversations[0]), [(true, "Plan the offsite."), (false, "Sure.")]);
        assert_eq!(conversations[0].turns[0].at_ms, Some(1_791_000_000_000));
        let lines = "{\"role\": \"user\", \"content\": \"one\"}\n{\"sender\": \"human\", \"text\": \"two\", \"created_at\": \"2026-10-01\"}\n";
        let (_, conversations) = read(lines.as_bytes()).unwrap();
        assert_eq!(turns(&conversations[0]), [(true, "one"), (true, "two")]);
        let grouped = r#"{"messages": [{"role": "user", "content": "three"}]}"#;
        assert_eq!(turns(&read(grouped.as_bytes()).unwrap().1[0]), [(true, "three")]);
        assert!(read(b"PK\x03\x04zip").err().unwrap().contains("zip"));
        assert!(read(br#"[{"role": "assistant", "content": "only the AI"}]"#).is_err());
        assert!(read(b"not json at all").is_err());
    }

    #[test]
    fn reads_iso_times_and_formats_local_days() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-10-13T09:12:00.5Z"), Some(1_791_882_720_500));
        assert_eq!(parse_time("2026-10-13T11:12:00+02:00"), parse_time("2026-10-13T09:12:00Z"));
        assert_eq!(parse_time("2026-10-13T02:12:00-07:00"), parse_time("2026-10-13T09:12:00Z"));
        assert_eq!(parse_time("2026-10-13"), parse_time("2026-10-13T00:00:00Z"));
        assert_eq!(parse_time("1791000000"), None);
        assert_eq!(day(parse_time("2026-10-13T09:12:00Z").unwrap(), 0), "2026-10-13 (Tue)");
        // 2 AM UTC is still the evening before in California.
        assert_eq!(day(parse_time("2026-10-14T02:00:00Z").unwrap(), -7 * 60), "2026-10-13 (Tue)");
        assert_eq!(civil_from_days(days_from_civil(2028, 2, 29)), (2028, 2, 29));
        assert_eq!(date("2026-11-15"), "2026-11-15");
        assert_eq!(date("next Friday"), "");
    }

    #[test]
    fn a_big_export_reads_the_latest_messages_and_keeps_conversations_together() {
        let conversation = |n: u64| Conversation {
            title: format!("chat {n}"),
            turns: vec![
                Turn { mine: true, text: "x".repeat(3_000), at_ms: Some(n * 10_000) },
                Turn { mine: false, text: "a reply".into(), at_ms: None },
                Turn { mine: true, text: format!("follow-up {n}"), at_ms: None },
            ],
        };
        let chosen = select((1..=200).map(conversation).collect(), 5_000_000, &HashSet::new());
        assert_eq!(chosen.total, 400);
        assert!(chosen.said.len() < 400 && chosen.said.iter().map(|s| s.text.len()).sum::<usize>() <= MAX_CHARS);
        // The newest survive; the oldest go first.
        assert!(chosen.said.iter().any(|s| s.title == "chat 200") && !chosen.said.iter().any(|s| s.title == "chat 1"));
        assert_eq!(chosen.said[0].text.chars().count(), MAX_MESSAGE + 1, "long pastes are cut");
        assert_eq!(chosen.said[0].reply, "a reply");
        let parts = pack(chosen.said);
        assert!(parts.len() > 1);
        for part in &parts {
            assert!(part.iter().map(|s| s.text.len() + s.reply.len() + 60).sum::<usize>() <= PART);
        }
        // A small import still splits by conversation, so its parts read in parallel.
        let small = select((1..=3).map(|n| Conversation { title: format!("c{n}"), turns: vec![Turn { mine: true, text: "hello ".repeat(150), at_ms: Some(n) }] }).collect(), 0, &HashSet::new());
        assert_eq!(pack(small.said).len(), 3);
        // Importing the same chats again reads only what isn't on the map yet.
        let again = select((1..=3).map(|n| Conversation { title: format!("c{n}"), turns: vec![Turn { mine: true, text: "hello".into(), at_ms: Some(n) }] }).collect(), 0, &HashSet::from([1, 2]));
        assert_eq!((again.total, again.already, again.said.len()), (3, 2, 1));
    }

    #[test]
    fn untimed_messages_count_up_to_now_in_file_order() {
        let chosen = select(vec![Conversation { title: String::new(), turns: vec![
            Turn { mine: true, text: "first".into(), at_ms: None },
            Turn { mine: true, text: "second".into(), at_ms: None },
        ] }], 10_000, &HashSet::new());
        assert_eq!(chosen.said.iter().map(|s| (s.text.as_str(), s.at_ms)).collect::<Vec<_>>(), [("first", 9_000), ("second", 10_000)]);
    }

    fn idea(topic: &str, point: &str, at_ms: u64) -> Idea {
        Idea { topic: topic.into(), point: point.into(), quote: format!("I said: {point}"), kind: "idea".into(), open: false, when: String::new(), at_ms }
    }

    #[test]
    fn grouping_keeps_every_idea_and_one_level_of_branches() {
        let ideas = vec![idea("Lisbon move", "Move in January", 10), idea("lisbon move!", "Lease ends Nov 30", 20), idea("Flat hunt", "Ask about Arroios", 30), idea("Sleep", "Wake at 4am", 40), idea("Gift", "Photo book for mom", 50)];
        let topics = topics(&ideas);
        assert_eq!(topics.len(), 4, "topic names match ignoring case and punctuation");
        let mut world = World::default();
        world.threads.push(Thread {
            id: "T1".into(),
            title: "Sleep".into(),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 5,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        });
        let merged: Merged = serde_json::from_value(json!({
            "threads": [
                {"key": "flat", "title": "Flat hunt", "parent": "move", "existing": "", "topics": [2, 99]},
                {"key": "move", "title": "Moving to Lisbon.", "parent": "flat", "existing": "", "topics": [1]},
                {"key": "sleep", "title": "Sleep", "parent": "", "existing": "T1", "topics": [3, 1]}
            ],
            "questions": [{"thread": "move", "text": "Lisbon or Porto?"}, {"thread": "move", "text": "A second one"}, {"thread": "nope", "text": "?"}],
            "actions": [{"thread": "move", "kind": "event", "title": "Give notice", "when": ""}, {"thread": "move", "kind": "reminder", "title": "give notice", "when": "2026-11-15"}]
        }))
        .unwrap();
        let groups = plan(merged, &topics, &world);
        assert_eq!(groups.len(), 4, "the topic the model left out gets its own thread");
        assert_eq!(groups[3].title, "Gift");
        let mut all: Vec<usize> = groups.iter().flat_map(|g| g.ideas.clone()).collect();
        all.sort();
        assert_eq!(all, [0, 1, 2, 3, 4]);
        assert_eq!(groups[1].title, "Moving to Lisbon");
        // The loop flat → move → flat is cut to one level.
        assert_eq!((groups[0].parent, groups[1].parent), (None, Some(0)));
        assert_eq!(groups[2].existing.as_deref(), Some("T1"));
        assert_eq!(groups[1].question, "Lisbon or Porto?");
        assert_eq!(groups[1].actions.len(), 1);
        assert_eq!((groups[1].actions[0].kind.as_str(), groups[1].actions[0].when.as_str()), ("reminder", ""), "no date, no event");
        let landing = order(&groups, &ideas);
        assert_eq!(landing.len(), 4);
        assert!(landing.iter().position(|&i| i == 0) < landing.iter().position(|&i| i == 1), "parents land first");
    }

    /// A core with an empty map in a temporary journal, and no key.
    struct Fixture {
        path: std::path::PathBuf,
        core: Arc<Core>,
    }

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("e2a2o-import-{}.jsonl", uuid::Uuid::new_v4()));
            let (journal, world) = crate::world::Journal::open(&path).unwrap();
            let (updates, _) = tokio::sync::broadcast::channel(64);
            let (placer_queue, _) = tokio::sync::mpsc::unbounded_channel();
            let core = Arc::new(Core {
                find: crate::find::Runtime::default(),
                recap: crate::recap::Runtime::default(),
                apps: crate::apps::Runtime::default(),
                world: Mutex::new(world.into()),
                journal: Mutex::new(journal),
                updates,
                placer_queue,
                room: Some("k7m2x9qp".into()),
                key: None,
                placer_model: "test".into(),
                http: reqwest::Client::new(),
                last_activity: std::sync::atomic::AtomicU64::new(0),
                looked: std::sync::atomic::AtomicBool::new(false),
                wake: tokio::sync::Notify::new(),
                imports: Imports::default(),
            });
            Fixture { path, core }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[tokio::test]
    async fn in_a_room_only_the_host_imports_and_only_they_see_it() {
        let f = Fixture::new();
        let mut out = f.core.updates.subscribe();
        // Another laptop can't start one; it's told so, and no one else hears about it.
        start(f.core.clone(), "im-1".into(), "Sam".into(), false);
        let refused = out.recv().await.unwrap();
        assert_eq!(refused.to.as_deref(), Some("Sam"));
        assert!(matches!(refused.message, ServerMsg::Notice { ref message } if message == ONLY_HERE));
        assert!(!f.core.imports.running());

        // The host's import: its progress goes to the host only, also to a window that reconnects.
        let handle = tokio::spawn(std::future::pending::<()>()).abort_handle();
        *f.core.imports.job.lock().unwrap() = Some(Job { handle, speaker: "User".into() });
        publish(&f.core, "User", &Status { state: "reading".into(), ..Status::default() });
        let progress = out.recv().await.unwrap();
        assert_eq!(progress.to.as_deref(), Some("User"));
        assert!(matches!(progress.message, ServerMsg::Import { ref status } if status.state == "reading"));
        assert_eq!(f.core.imports.live_for("User").map(|s| s.state), Some("reading".into()));
        assert!(f.core.imports.live_for("Sam").is_none());

        // Only the host can stop it.
        cancel(&f.core, "Sam");
        assert!(f.core.imports.running());
        cancel(&f.core, "User");
        let stopped = out.recv().await.unwrap();
        assert_eq!(stopped.to.as_deref(), Some("User"));
        assert!(matches!(stopped.message, ServerMsg::Import { ref status } if status.state == "stopped" && status.note.contains("Nothing was added")));
    }

    #[test]
    fn imported_points_land_placed_with_their_own_times() {
        let ideas = vec![idea("Move", "Lease ends Nov 30", 2_000), idea("Move", "Move in January", 1_000), idea("Move", "move in january", 3_000)];
        let group = Group { title: "Moving".into(), ideas: vec![0, 1, 2], question: "Lisbon or Porto?".into(), actions: vec![Task { kind: "event".into(), title: "Give notice".into(), when: "2026-11-15".into() }], ..Group::default() };
        // In a room the host's name, alone "you": whoever imported.
        let changes = changes_for(&group, "I3", None, &ideas, &World::default(), 0, "User");
        let mut world = World::default();
        for change in &changes {
            world.apply(change);
        }
        let thread = world.thread("I3").unwrap();
        assert_eq!((thread.title.as_str(), thread.last_point.as_str(), thread.touched_ms), ("Moving", "Lease ends Nov 30", 2_000));
        let points: Vec<(&str, u64)> = world.thoughts.iter().map(|t| (t.point.as_str(), t.at_ms)).collect();
        assert_eq!(points, [("Move in January", 1_000), ("Lease ends Nov 30", 2_000)], "in time order; a repeat lands once");
        assert!(world.thoughts.iter().all(|t| t.placed && t.place_ms.is_none() && t.speaker == "User" && t.thread_id.as_deref() == Some("I3")));
        assert_eq!(world.suggestions[0].text, "Lisbon or Porto?");
        assert_eq!(world.actions[0].when, "2026-11-15");
        // Points added to a thread already on the map leave it as it is unless they're newer.
        let older = changes_for(&Group { ideas: vec![1], ..Group::default() }, "I3", None, &ideas, &world, 0, "User");
        assert!(older.iter().all(|c| matches!(c, Change::ThoughtAdded { .. })));
    }
}
