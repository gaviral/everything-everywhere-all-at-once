//! Refiner: every so often, looks at the whole map in the background and tidies it:
//! better titles, merges of threads that are really one, one suggestion per branch,
//! and the tasks or events the talk decided on. Results arrive as ordinary changes.

use crate::world::{Action, Change, ItemStatus, Suggestion, Thread, Thought, World};
use crate::Core;
use anyhow::{anyhow, bail, Context};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/chat/completions";
const SYSTEM: &str = "You tidy a live map of spoken thoughts, from one person or a few in a room (then each point says who said it). \
Given the threads and their points, return JSON with: \
titles: better thread titles (up to 5 words), only where clearly better; a thread several people spoke on keeps a title that fits all their points; \
merges: threads that are really the same topic, merging the later id into the earlier; \
suggestions: at most one per thread and only when genuinely useful: a next step, a connection to another thread, or a question to explore, under 14 words; \
actions: concrete tasks or events the speaker decided on or needs to do, kind \"reminder\" or \"event\", a short title, and when as YYYY-MM-DD if a date is stated or clearly implied, else empty; \
tags: short lowercase hashtags for the wider topic a thread belongs to, never a word already in its title (for example #money on \"Pay rent\", \
#hackathon on \"README draft\"), only for threads with fewer than 3 (each thread lists the ones it has), never one it has, reusing tags across threads when topics overlap. \
Never repeat an existing suggestion or action, including the cards apps leave (they start with the app's name). Use empty lists when nothing applies.";
/// Tags on one thread, counting the ones it has: a pass only fills the gap.
const TAGS: usize = 3;

#[derive(Deserialize, Default)]
struct Pass {
    #[serde(default)]
    titles: Vec<Title>,
    #[serde(default)]
    merges: Vec<Merge>,
    #[serde(default)]
    suggestions: Vec<Idea>,
    #[serde(default)]
    actions: Vec<Task>,
    #[serde(default)]
    tags: Vec<Tags>,
}

#[derive(Deserialize)]
struct Tags {
    thread_id: String,
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct Title {
    thread_id: String,
    title: String,
}

#[derive(Deserialize)]
struct Merge {
    from: String,
    into: String,
}

#[derive(Deserialize)]
struct Idea {
    thread_id: String,
    text: String,
}

#[derive(Deserialize)]
struct Task {
    thread_id: String,
    kind: String,
    title: String,
    #[serde(default)]
    when: String,
}

/// When a pass runs, working back from what the person needs:
/// - never mid-sentence, so nothing moves while they talk;
/// - at a natural pause (4 s quiet) once two new thoughts landed, or one started a new thread;
/// - right away when they come back to the window, so the map is tidy when they look;
/// - at most every 10 s (longer after failed passes), and only when something changed;
/// - a pass that comes back while they talk lands at the next pause (2 s quiet), not mid-sentence.
pub async fn run(core: Arc<Core>) {
    // Start from what the journal already holds, so a restart doesn't re-tidy the whole map.
    let start = core.snapshot();
    let (mut seen_thoughts, mut seen_threads, mut last_pass) =
        (start.thoughts.iter().filter(|t| t.placed).count(), start.threads.len(), crate::now_ms());
    let mut failures = 0;
    // A finished pass that came back while they were talking: it lands at the next pause instead.
    let mut held: Option<Pass> = None;
    loop {
        tokio::select! {
            _ = core.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        let looked = core.take_looked();
        if let Some(waiting) = held.take() {
            if core.quiet_ms() < 2_000 {
                held = Some(waiting);
                continue;
            }
            land(&core, waiting, "held back until this pause");
        }
        let world = core.snapshot();
        let placed = world.thoughts.iter().filter(|t| t.placed).count();
        let new_thoughts = placed.saturating_sub(seen_thoughts);
        let new_threads = world.threads.len() > seen_threads;
        let quiet = core.quiet_ms() >= 4_000;
        let rested = crate::now_ms().saturating_sub(last_pass) >= rest_ms(failures);
        let due = new_thoughts > 0 && rested && ((quiet && (new_thoughts >= 2 || new_threads)) || looked);
        if !due || core.key.is_none() {
            continue;
        }
        let since = last_pass;
        (seen_thoughts, seen_threads, last_pass) = (placed, world.threads.len(), crate::now_ms());
        let result = pass(&core, &world, since).await;
        let took = crate::now_ms().saturating_sub(last_pass);
        failures = if result.is_ok() { 0 } else { failures + 1 };
        match result {
            // Talking resumed while the model worked: move nothing under them; it lands at the next pause, a few
            // seconds on, rather than being thrown away and asked again (which took 15–20 s more in rehearsals).
            Ok(answer) if core.quiet_ms() < 2_000 => {
                tracing::info!("refiner pass in {took} ms: held back, talk resumed");
                held = Some(answer);
            }
            Ok(answer) => land(&core, answer, &format!("in {took} ms")),
            // Redo it at the next pause rather than waiting for more talk.
            Err(e) => {
                tracing::warn!("refiner pass failed: {e:#}");
                seen_thoughts = 0;
            }
        }
    }
}

/// Puts a pass on the map. Checked against the map as it is now, not as it was sent: an app's card or reminder
/// may have landed while the model worked (a second idea on that thread would only repeat it), or a thread merged.
fn land(core: &Core, answer: Pass, when: &str) {
    let changes = changes(&core.snapshot(), answer);
    tracing::info!("refiner pass {when}: {} changes", changes.len());
    if !changes.is_empty() {
        core.commit(changes);
    }
}

/// The least time between passes: 10 s, doubling with each failed pass in a row up to about 5 min,
/// so a pass that keeps failing doesn't resend the whole map every 10 s for good.
fn rest_ms(failures: u32) -> u64 {
    10_000 << failures.min(5)
}

async fn pass(core: &Core, world: &World, since: u64) -> anyhow::Result<Pass> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let body = request(world, since, &chrono_today());
    let response = core.http.post(URL).bearer_auth(key).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    let content = value["choices"][0]["message"]["content"].as_str().context("no answer")?;
    serde_json::from_str(content).context("answer wasn't the expected JSON")
}

/// The suggestions and actions already on the map, so the model doesn't repeat them: the latest 30 of each
/// (dismissed ones too, which the person said no to), so the prompt doesn't grow with every idea ever shown.
fn existing(world: &World) -> Vec<String> {
    let suggestions = &world.suggestions[world.suggestions.len().saturating_sub(30)..];
    let actions = &world.actions[world.actions.len().saturating_sub(30)..];
    suggestions
        .iter()
        .map(|s| format!("suggestion on {}: {}", s.thread_id, s.text))
        .chain(actions.iter().map(|a| format!("action on {}: {} {}", a.thread_id, a.kind, a.title)))
        .collect()
}

/// What a pass sends: the rules, today's date ("YYYY-MM-DD (Weekday)"), the bounded map and what's already on it.
fn request(world: &World, since: u64, today: &str) -> serde_json::Value {
    let map = describe(world, since);
    let existing = existing(world);
    json!({
        "model": std::env::var("REFINER_MODEL").unwrap_or_else(|_| "muse-spark-1.3".into()),
        "reasoning_effort": "low",
        "max_tokens": 6000,
        "prompt_cache_key": "e2a2o-refiner",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": format!("Today is {today}.\n{map}\nAlready on the map:\n{}", existing.join("\n"))},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "Pass", "schema": {
            "type": "object",
            "properties": {
                "titles": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "title": {"type": "string"}}, "required": ["thread_id", "title"]}},
                "merges": {"type": "array", "items": {"type": "object", "properties": {"from": {"type": "string"}, "into": {"type": "string"}}, "required": ["from", "into"]}},
                "suggestions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "text": {"type": "string"}}, "required": ["thread_id", "text"]}},
                "actions": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "kind": {"type": "string", "enum": ["reminder", "event"]}, "title": {"type": "string"}, "when": {"type": "string"}}, "required": ["thread_id", "kind", "title", "when"]}},
                "tags": {"type": "array", "items": {"type": "object", "properties": {"thread_id": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["thread_id", "tags"]}}
            },
            "required": ["titles", "merges", "suggestions", "actions", "tags"]
        }}}
    })
}

/// The map as the refiner sees it, bounded however long the talk gets: threads that changed since
/// the last pass (and the active one) with their latest 8 thoughts; the rest as one line each, which
/// is enough for titles and merges. The quiet lines come first, so the cached prefix lasts longer.
/// Each thread shows its tags, and with more than one speaker (a room) each thought says who said it.
fn describe(world: &World, since: u64) -> String {
    let points = |t: &Thread| -> Vec<&Thought> {
        world.thoughts.iter().filter(|p| p.placed && p.thread_id.as_deref() == Some(t.id.as_str())).collect()
    };
    let recent = |t: &Thread| {
        world.active.as_deref() == Some(t.id.as_str()) || t.touched_ms > since || points(t).iter().any(|p| p.at_ms > since)
    };
    let parent = |t: &Thread| t.parent_id.clone().unwrap_or_else(|| "none".into());
    let tags = |t: &Thread| {
        if t.tags.is_empty() { String::new() } else { format!(" tags: {}", t.tags.iter().map(|g| g.name.as_str()).collect::<Vec<_>>().join(" ")) }
    };
    let named = world.thoughts.iter().map(|p| p.speaker.as_str()).collect::<HashSet<_>>().len() > 1;
    let line = |p: &Thought| if named { format!("  - {}: {}", p.speaker, p.text) } else { format!("  - {}", p.text) };
    let quiet: Vec<String> = world
        .threads
        .iter()
        .filter(|t| !recent(t))
        .map(|t| format!("{}: {} (parent: {}){} last: {}", t.id, t.title, parent(t), tags(t), t.last_point))
        .collect();
    let busy: Vec<String> = world
        .threads
        .iter()
        .filter(|t| recent(t))
        .map(|t| {
            let all = points(t);
            let latest: Vec<String> = all[all.len().saturating_sub(8)..].iter().map(|p| line(p)).collect();
            format!("{}: {} (parent: {}){}\n{}", t.id, t.title, parent(t), tags(t), latest.join("\n"))
        })
        .collect();
    format!(
        "Quiet threads (title, parent, last point):\n{}\nRecently active threads, with their latest points:\n{}",
        quiet.join("\n"),
        busy.join("\n")
    )
}

fn changes(world: &World, pass: Pass) -> Vec<Change> {
    changes_on(world, pass, &chrono_today())
}

/// The answer as changes, keeping only what a person wouldn't undo; `today` is "YYYY-MM-DD (Weekday)".
fn changes_on(world: &World, pass: Pass, today: &str) -> Vec<Change> {
    let exists = |id: &str| world.thread(id).is_some();
    // Ids are the map's internals: an idea, task or title that names one ("before recording T3 setup") is left out.
    let names_an_id = |text: &str| text.split(|c: char| !c.is_alphanumeric()).any(|w| !w.is_empty() && world.thread(&world.resolve(w)).is_some());
    let mut out = Vec::new();
    for t in pass.titles {
        // A new title is short and more than a change of case, and a name the person gave stays theirs
        // ("we're calling this Project Falcon").
        let keep = |th: &Thread| words(&t.title) == words(&th.title) || said_in(world, &th.id).any(|text| named(&th.title, text));
        if t.title.split_whitespace().count() > 5 || world.thread(&t.thread_id).is_some_and(keep) {
            continue;
        }
        let current = world.thread(&t.thread_id).map(|th| th.title.as_str());
        if exists(&t.thread_id) && !t.title.trim().is_empty() && current != Some(t.title.trim()) && !names_an_id(&t.title) {
            out.push(Change::ThreadRenamed { thread_id: t.thread_id, title: t.title.trim().into() });
        }
    }
    // Each merge is checked against the map the earlier ones leave: a chain (T3 into T1, then T5 into T3)
    // lands on the thread that's left, and a thread never goes into its own branch, which would make the
    // branch its own parent and drop it from the map. Two threads with no word in common aren't one topic.
    let mut merged = world.clone();
    for m in pass.merges {
        let into = merged.resolve(&m.into);
        let shared = || !vocabulary(&merged, &m.from).is_disjoint(&vocabulary(&merged, &into));
        if m.from != into && merged.thread(&m.from).is_some() && merged.thread(&into).is_some() && !above(&merged, &m.from, &into) && shared() {
            let change = Change::ThreadMerged { from: m.from, into };
            merged.apply(&change);
            out.push(change);
        }
    }
    // One idea per thread, an app's card included, and one per thread in a pass too.
    let mut suggested = HashSet::new();
    for s in pass.suggestions {
        // Never an idea that only says again what the person said on that thread.
        if said_in(world, &s.thread_id).any(|text| repeats(&s.text, text)) {
            continue;
        }
        let repeated = world.suggestions.iter().any(|x| x.thread_id == s.thread_id && x.status != ItemStatus::Dismissed);
        if exists(&s.thread_id) && !s.text.trim().is_empty() && !repeated && !names_an_id(&s.text) && suggested.insert(s.thread_id.clone()) {
            out.push(Change::SuggestionAdded {
                suggestion: Suggestion { id: new_id("sg"), thread_id: s.thread_id, text: s.text.trim().into(), status: ItemStatus::New },
            });
        }
    }
    for mut a in pass.actions {
        // Never a past day, and the day they named for it; see `day`.
        a.when = day(a.when.trim(), &about(world, &a.thread_id, &a.title), today);
        let repeated = world.actions.iter().any(|x| x.title.eq_ignore_ascii_case(a.title.trim()));
        // A real day only: "Saturday" would show as an invalid date, and "2026-11-31" would become December 1.
        let when = Some(a.when.trim()).filter(|w| crate::apps::valid_date(w)).unwrap_or_default();
        if exists(&a.thread_id) && !a.title.trim().is_empty() && !repeated && !names_an_id(&a.title) {
            out.push(Change::ActionProposed {
                action: Action {
                    id: new_id("ac"),
                    thread_id: a.thread_id,
                    // An event needs a date; without one it's a reminder rather than an invented day.
                    kind: if a.kind == "event" && !when.is_empty() { "event".into() } else { "reminder".into() },
                    title: a.title.trim().into(),
                    when: when.into(),
                    status: ItemStatus::New,
                    done_ms: None,
                },
            });
        }
    }
    // Each thread's tags so far, the ones it has and the ones this pass adds, so it never passes `TAGS`.
    let mut tagged: HashMap<&str, Vec<String>> = HashMap::new();
    for group in pass.tags {
        let Some(thread) = world.thread(&group.thread_id) else { continue };
        let names = tagged.entry(thread.id.as_str()).or_insert_with(|| thread.tags.iter().map(|t| t.name.clone()).collect());
        // Its title and any this pass gives it: a tag of only their words (#demo on "Demo Opening Hook") adds nothing.
        let titles: Vec<String> = std::iter::once(thread.title.clone())
            .chain(out.iter().filter_map(|c| match c {
                Change::ThreadRenamed { thread_id, title } if *thread_id == thread.id => Some(title.clone()),
                _ => None,
            }))
            .collect();
        for raw in group.tags {
            let word: String = raw.trim().trim_start_matches('#').to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
            let tag = format!("#{word}");
            if names.len() >= TAGS || word.is_empty() || names.contains(&tag) || titles.iter().any(|t| in_title(&word, t)) {
                continue;
            }
            names.push(tag.clone());
            out.push(Change::TagSuggested { thread_id: thread.id.clone(), tag });
        }
    }
    out
}

/// True when `id` is `of`'s parent, or its parent's, and so on up.
fn above(world: &World, id: &str, of: &str) -> bool {
    let mut parent = world.thread(of).and_then(|t| t.parent_id.clone());
    // At most one step per thread, so a corrupt journal with a cycle can't loop forever.
    for _ in 0..world.threads.len() {
        match parent {
            Some(p) if p == id => return true,
            Some(p) => parent = world.thread(&p).and_then(|t| t.parent_id.clone()),
            None => return false,
        }
    }
    false
}

/// What the person said on a thread, in order.
fn said_in<'a>(world: &'a World, id: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    world.thoughts.iter().filter(move |p| p.placed && p.thread_id.as_deref() == Some(id)).map(|p| p.text.as_str())
}

/// The title is a name they gave in so many words: "we're calling this Project Falcon", "call it Garden Project",
/// "it's called Falcon"; not just words they used ("I need to file the quarterly taxes").
fn named(title: &str, text: &str) -> bool {
    const CUES: [&str; 7] = ["call", "calling", "called", "name", "named", "title", "titled"];
    let (title, text) = (words(title), words(text));
    !title.is_empty()
        && text.windows(title.len()).enumerate().any(|(i, w)| w == title.as_slice() && text[i.saturating_sub(2)..i].iter().any(|c| CUES.contains(&c.as_str())))
}

/// Every word of a thread, its title's and what was said on it.
fn vocabulary(world: &World, id: &str) -> HashSet<String> {
    world.thread(id).map(|t| t.title.as_str()).into_iter().chain(said_in(world, id)).flat_map(content).collect()
}

/// What was said about an action: its title, and the sentences on its thread with the most of its words
/// ("the water bill is due on the fifteenth", not "I paid the gas bill last Friday").
fn about<'a>(world: &'a World, thread: &'a str, title: &'a str) -> Vec<&'a str> {
    let words = content(title);
    let sentences: Vec<(&str, usize)> =
        said_in(world, thread).flat_map(|text| text.split(['.', '!', '?', ';'])).map(|s| (s, content(s).intersection(&words).count())).collect();
    let most = sentences.iter().map(|(_, n)| *n).max().unwrap_or(0);
    std::iter::once(title).chain(sentences.into_iter().filter(|(_, n)| most > 0 && *n == most).map(|(s, _)| s)).collect()
}

/// Lowercase words without punctuation: "Mom's birthday!" is mom, s, birthday.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// A word without its ending, so "bills", "recording" and "organizes" meet "bill", "record" and "organizing".
fn stem(word: &str) -> String {
    let mut w = word.to_string();
    if let Some(end) = ["ing", "ed", "es", "s"].iter().find(|end| w.len() >= end.len() + 3 && w.ends_with(*end) && !w.ends_with("ss")) {
        w.truncate(w.len() - end.len());
    }
    // planning → plann → plan, organize → organiz
    let b = w.as_bytes();
    if b.len() >= 4 && b[b.len() - 1] == b[b.len() - 2] {
        w.pop();
    }
    if w.len() >= 4 && w.ends_with('e') {
        w.pop();
    }
    w
}

/// Words too common to tell two things apart.
const COMMON: [&str; 44] = [
    "a", "an", "the", "to", "of", "for", "and", "or", "but", "in", "on", "at", "by", "with", "about", "from", "is", "are", "be", "it",
    "its", "this", "that", "i", "you", "we", "my", "your", "our", "me", "need", "should", "will", "can", "so", "if", "do", "get", "just",
    "also", "up", "s", "ll", "oh",
];

/// The words of a text that carry its meaning, stemmed.
fn content(text: &str) -> HashSet<String> {
    words(text).iter().filter(|w| !COMMON.contains(&w.as_str())).map(|w| stem(w)).collect()
}

/// An idea that mostly says again what was said: at least two of its words, and 60% of them, in one point.
fn repeats(idea: &str, said: &str) -> bool {
    let (idea, said) = (content(idea), content(said));
    let shared = idea.intersection(&said).count();
    shared >= 2 && shared * 10 >= idea.len() * 6
}

/// A tag word that's a word of the title, or a few of them run together (#electricbill on "Electric bill").
fn in_title(tag: &str, title: &str) -> bool {
    let title: Vec<String> = words(title).iter().map(|w| stem(w)).collect();
    let parts: Vec<String> = tag.split('-').filter(|p| !p.is_empty()).map(stem).collect();
    let joined = stem(&tag.replace('-', ""));
    (!parts.is_empty() && parts.iter().all(|p| title.contains(p))) || (2..=title.len()).any(|n| title.windows(n).any(|w| stem(&w.concat()) == joined))
}

/// Days since 1970-01-01 for a real YYYY-MM-DD day.
fn day_number(date: &str) -> Option<i64> {
    if !crate::apps::valid_date(date) {
        return None;
    }
    let n = |r: std::ops::Range<usize>| date[r].parse::<i64>().ok();
    Some(crate::import::days_from_civil(n(0..4)?, n(5..7)?, n(8..10)?))
}

/// Day 0, 1970-01-01, was a Thursday.
const WEEK: [&str; 7] = ["thursday", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday"];

/// An action's day as the person would keep it, else none (`said`: the action's title and what they said about it):
/// - a real day: "Saturday" would show as an invalid date, and "2026-11-31" would become December 1;
/// - never past: a past day is the model slipping the year (2025-11-10 when it's 2026), so it's the same day at its
///   nearest occurrence, unless that's the one that just went by, which is no day to remind anyone of;
/// - the day they named: when their words name one ("Friday", "next Tuesday", "tomorrow"), the date is that day,
///   a weekday within the next two weeks; a different date is dropped rather than shown wrong.
fn day(when: &str, said: &[&str], today: &str) -> String {
    let Some(mut date) = day_number(when) else { return String::new() };
    // Without today's date (no `date` command) there's nothing to check against.
    let Some(now) = today.get(..10).and_then(day_number) else { return when.into() };
    if date < now {
        let year = |days: i64| crate::import::civil_from_days(days).0;
        let nearest = (-1..=1).filter_map(|y| day_number(&format!("{:04}{}", year(now) + y, &when[4..]))).min_by_key(|d| (d - now).abs());
        match nearest {
            Some(d) if d >= now => date = d,
            _ => return String::new(),
        }
    }
    let (mut days, mut weekdays) = (Vec::new(), Vec::new());
    for text in said {
        let words = words(text);
        for (i, word) in words.iter().enumerate() {
            match word.as_str() {
                "today" | "tonight" => days.push(now),
                "tomorrow" => days.push(now + 1),
                // "last Friday" is gone; it names no day ahead.
                w if i == 0 || words[i - 1] != "last" => weekdays.extend(WEEK.iter().position(|d| *d == w)),
                _ => {}
            }
        }
    }
    let named = days.contains(&date) || (weekdays.contains(&(date.rem_euclid(7) as usize)) && date - now < 14);
    if (days.is_empty() && weekdays.is_empty()) || named {
        let (y, m, d) = crate::import::civil_from_days(date);
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        String::new()
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

/// Today's date as YYYY-MM-DD in local time, from the system's `date` (no extra crate).
fn chrono_today() -> String {
    std::process::Command::new("date")
        .arg("+%Y-%m-%d (%A)")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{changes, changes_on, day, describe, existing, rest_ms, Pass};
    use crate::world::{Action, Change, ItemStatus, Suggestion, Tag, Thought, Thread, ThreadStatus, World};

    /// A Sunday, as `chrono_today` writes it.
    const TODAY: &str = "2026-11-01 (Sunday)";

    #[test]
    fn a_failing_pass_waits_longer_each_time_and_the_prompt_stays_bounded() {
        let rests: Vec<u64> = (0..8).map(|failures| rest_ms(failures) / 1000).collect();
        assert_eq!(rests, [10, 20, 40, 80, 160, 320, 320, 320]);
        let mut world = World::default();
        for n in 0..100 {
            let status = if n % 2 == 0 { ItemStatus::Dismissed } else { ItemStatus::New };
            world.suggestions.push(Suggestion { id: format!("s{n}"), thread_id: "T1".into(), text: format!("idea {n}"), status });
            world.actions.push(Action {
                id: format!("a{n}"),
                thread_id: "T1".into(),
                kind: "reminder".into(),
                title: format!("task {n}"),
                when: String::new(),
                status,
                done_ms: None,
            });
        }
        let lines = existing(&world);
        assert_eq!(lines.len(), 60);
        assert!(lines.contains(&"suggestion on T1: idea 70".to_string()) && lines.contains(&"action on T1: reminder task 99".to_string()));
        assert!(!lines.iter().any(|l| l.ends_with(" 69")), "only the latest");
    }

    fn thread(id: &str, parent: Option<&str>) -> Thread {
        Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: parent.map(Into::into),
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    #[test]
    fn actions_keep_only_real_dates() {
        let world = World { threads: vec![thread("T1", None)], ..World::default() };
        let pass: Pass = serde_json::from_value(serde_json::json!({ "actions": [
            {"thread_id": "T1", "kind": "event", "title": "Demo day", "when": "2026-11-04"},
            {"thread_id": "T1", "kind": "event", "title": "Picnic", "when": "Saturday"},
            {"thread_id": "T1", "kind": "reminder", "title": "Pay rent", "when": "2026-11-31"},
        ]}))
        .unwrap();
        let actions: Vec<[String; 3]> = changes_on(&world, pass, TODAY)
            .into_iter()
            .filter_map(|c| match c {
                Change::ActionProposed { action } => Some([action.title, action.kind, action.when]),
                _ => None,
            })
            .collect();
        let expected = [["Demo day", "event", "2026-11-04"], ["Picnic", "reminder", ""], ["Pay rent", "reminder", ""]];
        assert_eq!(actions, expected.map(|a| a.map(String::from)), "an event without a real day is a reminder");
    }

    #[test]
    fn merges_follow_the_ones_before_and_never_fold_a_thread_into_its_own_branch() {
        let thought = |id: &str, thread: &str| Thought {
            id: id.into(),
            speaker: "you".into(),
            text: id.into(),
            point: id.into(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        // T7 branches from T5, and T9 from T7.
        let world = World {
            threads: vec![thread("T1", None), thread("T3", None), thread("T5", None), thread("T7", Some("T5")), thread("T9", Some("T7"))],
            thoughts: ["T1", "T3", "T5", "T7", "T9"].iter().map(|t| thought(&format!("on {t}"), t)).collect(),
            ..World::default()
        };
        let merges = |pairs: &[(&str, &str)]| {
            let pairs: Vec<_> = pairs.iter().map(|(from, into)| serde_json::json!({"from": from, "into": into})).collect();
            let pass: Pass = serde_json::from_value(serde_json::json!({ "merges": pairs })).unwrap();
            changes(&world, pass)
        };
        let pairs = |changes: &[Change]| -> Vec<(String, String)> {
            changes
                .iter()
                .filter_map(|c| match c {
                    Change::ThreadMerged { from, into } => Some((from.clone(), into.clone())),
                    _ => None,
                })
                .collect()
        };
        let to = |from: &str, into: &str| (from.to_string(), into.to_string());

        // A chain lands on the thread that's left, and every thought stays on the map.
        let chain = merges(&[("T3", "T1"), ("T5", "T3")]);
        assert_eq!(pairs(&chain), [to("T3", "T1"), to("T5", "T1")]);
        let mut after = world.clone();
        chain.iter().for_each(|c| after.apply(c));
        assert!(after.thoughts.iter().all(|t| after.thread(t.thread_id.as_deref().unwrap()).is_some()));
        assert_eq!(after.thread("T7").unwrap().parent_id.as_deref(), Some("T1"));
        // Never into its own branch, however far down.
        assert!(pairs(&merges(&[("T5", "T7"), ("T5", "T9")])).is_empty());
        // Nor into itself, nor from a thread that isn't there or was just merged away.
        assert_eq!(pairs(&merges(&[("T1", "T1"), ("T2", "T1"), ("T3", "T1"), ("T3", "T5")])), [to("T3", "T1")]);
        // A branch into a thread above it is fine.
        assert_eq!(pairs(&merges(&[("T9", "T5")])), [to("T9", "T5")]);
    }

    #[test]
    fn one_idea_per_thread_counting_an_apps_card_and_no_more_than_three_tags() {
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None), thread("T3", None)], ..World::default() };
        world.threads[0].tags = vec![Tag { name: "#demo".into(), kept: true }, Tag { name: "#hackathon".into(), kept: false }];
        // An app's card that landed while the model worked: the pass is checked against the map as it is now.
        let card = "Argument resolver · This repeats an earlier point.";
        world.suggestions.push(Suggestion { id: "sg-app".into(), thread_id: "T3".into(), text: card.into(), status: ItemStatus::New });
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "suggestions": [
                {"thread_id": "T2", "text": "Ask Sam about the budget"},
                {"thread_id": "T2", "text": "A second idea for the same thread"},
                {"thread_id": "T3", "text": "The same point as the app's card"},
            ],
            "tags": [
                {"thread_id": "T1", "tags": ["#demo", "#Recording", "#video"]},
                {"thread_id": "T1", "tags": ["#more"]},
                {"thread_id": "T2", "tags": ["budget", "#money", "#plans", "#extra"]},
            ],
        }))
        .unwrap();
        let out = changes(&world, pass);
        let ideas: Vec<&str> = out
            .iter()
            .filter_map(|c| match c {
                Change::SuggestionAdded { suggestion } => Some(suggestion.text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(ideas, ["Ask Sam about the budget"]);
        let tags: Vec<(&str, &str)> = out
            .iter()
            .filter_map(|c| match c {
                Change::TagSuggested { thread_id, tag } => Some((thread_id.as_str(), tag.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(tags, [("T1", "#recording"), ("T2", "#budget"), ("T2", "#money"), ("T2", "#plans")]);
    }

    #[test]
    fn ideas_tasks_and_titles_that_name_a_thread_id_are_left_out() {
        let world = World { threads: vec![thread("T2", None), thread("T3", None)], ..World::default() };
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "titles": [{"thread_id": "T2", "title": "Notes for T3"}, {"thread_id": "T3", "title": "Recording setup"}],
            "suggestions": [
                {"thread_id": "T2", "text": "Draft README before recording T3 setup?"},
                {"thread_id": "T3", "text": "Test the dark background before recording"},
            ],
            "actions": [
                {"thread_id": "T2", "kind": "reminder", "title": "Finish T2", "when": ""},
                {"thread_id": "T2", "kind": "reminder", "title": "Write the README", "when": ""},
            ],
        }))
        .unwrap();
        let texts: Vec<String> = changes(&world, pass)
            .into_iter()
            .map(|c| match c {
                Change::ThreadRenamed { title, .. } => title,
                Change::SuggestionAdded { suggestion } => suggestion.text,
                Change::ActionProposed { action } => action.title,
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(texts, ["Recording setup", "Test the dark background before recording", "Write the README"]);
    }

    #[test]
    fn the_model_sees_each_threads_tags_and_in_a_room_who_said_what() {
        let mut world = World { threads: vec![thread("T1", None), thread("T2", None)], active: Some("T1".into()), ..World::default() };
        world.threads[0].tags = vec![Tag { name: "#demo".into(), kept: true }];
        world.threads[1].tags = vec![Tag { name: "#rent".into(), kept: false }, Tag { name: "#home".into(), kept: true }];
        let said = |id: &str, speaker: &str| Thought {
            id: id.into(),
            speaker: speaker.into(),
            text: format!("{id} said"),
            point: String::new(),
            thread_id: Some("T1".into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: 0,
            place_ms: None,
        };
        world.thoughts.push(said("a", "you"));
        let alone = describe(&world, 0);
        assert!(alone.contains("T2: Topic T2 (parent: none) tags: #rent #home last: "), "{alone}");
        assert!(alone.contains("T1: Topic T1 (parent: none) tags: #demo\n  - a said"), "{alone}");
        world.thoughts.push(said("b", "Sam"));
        let room = describe(&world, 0);
        assert!(room.contains("  - you: a said\n  - Sam: b said"), "{room}");
    }

    #[test]
    fn quiet_threads_shrink_to_one_line() {
        let thread = |id: &str, touched_ms| Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: format!("last on {id}"),
            touched_ms,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        };
        let thought = |n: u64, thread: &str| Thought {
            id: format!("th-{n}"),
            speaker: "you".into(),
            text: format!("thought {n}"),
            point: String::new(),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete: true,
            at_ms: n,
            place_ms: None,
        };
        let world = World {
            threads: vec![thread("T1", 5), thread("T2", 100)],
            thoughts: (1..=12).map(|n| thought(n, "T1")).chain([thought(101, "T2")]).collect(),
            ..World::default()
        };
        let text = describe(&world, 50);
        assert!(text.contains("T1: Topic T1 (parent: none) last: last on T1"));
        assert!(!text.contains("thought 12\n") && text.contains("thought 101"));
        let all = describe(&world, 0);
        assert!(all.contains("thought 12") && !all.contains("thought 4\n"), "keeps only the latest 8");
    }

    /// A map of (id, title, what was said) rows.
    fn map(rows: &[(&str, &str, &[&str])]) -> World {
        let mut world = World::default();
        for (id, title, said) in rows {
            world.threads.push(Thread { title: title.to_string(), ..thread(id, None) });
            for text in *said {
                let n = world.thoughts.len();
                world.thoughts.push(Thought {
                    id: format!("th-{n}"),
                    speaker: "you".into(),
                    text: text.to_string(),
                    point: String::new(),
                    thread_id: Some(id.to_string()),
                    placed: true,
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    at_ms: n as u64,
                    place_ms: None,
                });
            }
        }
        world
    }

    fn shown(out: &[Change]) -> Vec<String> {
        out.iter()
            .filter_map(|c| match c {
                Change::ThreadRenamed { thread_id, title } => Some(format!("{thread_id} title {title}")),
                Change::ThreadMerged { from, into } => Some(format!("{from} into {into}")),
                Change::SuggestionAdded { suggestion: s } => Some(format!("{} idea {}", s.thread_id, s.text)),
                Change::ActionProposed { action: a } => Some(format!("{} {} {} {}", a.thread_id, a.kind, a.title, a.when)),
                Change::TagSuggested { thread_id, tag } => Some(format!("{thread_id} {tag}")),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn nothing_a_person_would_undo_titles_tags_ideas_and_merges() {
        let world = map(&[
            ("T1", "Project Falcon", &["Okay, we're calling this Project Falcon.", "And someone has to own the landing page."]),
            ("T2", "Demo Opening Hook", &["We open with the mic turning on."]),
            ("T3", "Electric Bill Autopay", &["I keep forgetting about the electric bill."]),
            ("T4", "Landlord Lease Email", &["I should email the landlord about the lease."]),
            ("T5", "Money stuff", &["Oh wait, Mom's birthday is Friday. I need to book that cooking class.", "The one on Main Street."]),
            ("T8", "Quarterly taxes", &["I need to file the quarterly taxes by January.", "And renew the car registration."]),
            ("T6", "Pay rent", &["I need to pay rent by the fifth."]),
            ("T7", "Rent payment", &["For the rent, I'll send the landlord an e-transfer."]),
        ]);
        let pass: Pass = serde_json::from_value(serde_json::json!({
            "titles": [
                {"thread_id": "T1", "title": "Falcon prototype tests"},
                {"thread_id": "T2", "title": "Demo opening hook"},
                {"thread_id": "T3", "title": "Electric bill autopay before the due date"},
                {"thread_id": "T5", "title": "Mom's birthday class"},
                {"thread_id": "T8", "title": "Taxes and car registration"},
            ],
            "merges": [{"from": "T4", "into": "T3"}, {"from": "T7", "into": "T6"}],
            "suggestions": [
                {"thread_id": "T1", "text": "Who will own the landing page?"},
                {"thread_id": "T2", "text": "Open with the mic turning on"},
                {"thread_id": "T5", "text": "Check Main Street class availability for Friday?"},
            ],
            "tags": [
                {"thread_id": "T2", "tags": ["#demo", "#hooks", "#hackathon"]},
                {"thread_id": "T3", "tags": ["#bills", "#electricbill", "#electric-bill", "#money"]},
                {"thread_id": "T5", "tags": ["#birthday", "#moms-birthday", "#family"]},
            ],
        }))
        .unwrap();
        assert_eq!(
            shown(&changes_on(&world, pass, TODAY)),
            [
                // Not the name the person gave, a change of case, or six words; words they only used are fine.
                "T5 title Mom's birthday class",
                "T8 title Taxes and car registration",
                // Lease and electric bill share no word; the rent threads do.
                "T7 into T6",
                // Not a point said again; a next step that reuses some words is fine.
                "T5 idea Check Main Street class availability for Friday?",
                // Not the title's words, nor those of the title this pass gives it.
                "T2 #hackathon",
                "T3 #money",
                "T5 #family",
            ]
        );
    }

    #[test]
    fn action_dates_are_never_past_and_fall_on_the_day_said() {
        // Sunday 1 November; the 3rd and the 10th are Tuesdays.
        let tuesday = ["I have to call the dentist next Tuesday."];
        assert_eq!(day("2026-11-03", &tuesday, TODAY), "2026-11-03");
        assert_eq!(day("2026-11-10", &tuesday, TODAY), "2026-11-10");
        assert_eq!(day("2026-11-04", &tuesday, TODAY), "", "a Wednesday isn't Tuesday");
        assert_eq!(day("2026-11-17", &tuesday, TODAY), "", "nor is a Tuesday two weeks out");
        let tomorrow = ["The submission deadline is tomorrow at nine PM."];
        assert_eq!((day("2026-11-02", &tomorrow, TODAY), day("2026-11-03", &tomorrow, TODAY)), ("2026-11-02".into(), String::new()));
        // A slipped year moves to the nearest such day; a day that just went by is no day to remind anyone of.
        assert_eq!(day("2025-11-10", &[], TODAY), "2026-11-10");
        assert_eq!(day("2026-10-30", &[], TODAY), "");
        assert_eq!(day("2026-01-05", &[], "2026-12-20 (Sunday)"), "2027-01-05");
        // Not a real day; and without today's date, a real one stays as it is.
        assert_eq!((day("Saturday", &[], TODAY), day("2026-11-31", &[], TODAY)), (String::new(), String::new()));
        assert_eq!(day("2025-11-10", &[], ""), "2025-11-10");

        // The day said for an action is in the sentences most about it, not anywhere on its thread.
        let world = map(&[
            ("T1", "Hackathon demo", &["I need to plan the hackathon demo. The deadline is tomorrow."]),
            ("T2", "Rent", &["Pay rent by Friday.", "I'll transfer the money Thursday."]),
            ("T3", "Bills", &["I already paid the gas bill last Friday, so that's done.", "The water bill is due on the fifteenth."]),
        ]);
        let pass: Pass = serde_json::from_value(serde_json::json!({ "actions": [
            {"thread_id": "T1", "kind": "event", "title": "Demo deadline", "when": "2026-11-02"},
            {"thread_id": "T1", "kind": "reminder", "title": "Plan the hackathon demo", "when": "2026-11-03"},
            {"thread_id": "T2", "kind": "reminder", "title": "Transfer the money", "when": "2026-11-06"},
            {"thread_id": "T2", "kind": "event", "title": "Rent due", "when": "2026-11-06"},
            {"thread_id": "T3", "kind": "reminder", "title": "Pay water bill", "when": "2026-11-15"},
        ]}))
        .unwrap();
        assert_eq!(
            shown(&changes_on(&world, pass, TODAY)),
            [
                "T1 event Demo deadline 2026-11-02",
                "T1 reminder Plan the hackathon demo 2026-11-03",
                "T2 reminder Transfer the money ",
                "T2 event Rent due 2026-11-06",
                "T3 reminder Pay water bill 2026-11-15",
            ]
        );
        assert_eq!(day("2026-11-06", &["I paid it last Friday, the next one is Friday"], TODAY), "2026-11-06");
        assert_eq!(day("2026-11-07", &["I paid it last Friday"], TODAY), "2026-11-07", "a day gone names nothing ahead");
    }
}

/// Live checks against the real model (ignored unless asked for; see the file).
#[cfg(test)]
#[path = "refiner_live.rs"]
mod live;
