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
tags: short lowercase hashtags naming a thread's topic (for example #rent, #hackathon), only for threads with fewer than 3 (each thread lists the ones it has), \
never one it has, reusing tags across threads when topics overlap. \
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
/// - at most every 10 s (longer after failed passes), and only when something changed.
pub async fn run(core: Arc<Core>) {
    // Start from what the journal already holds, so a restart doesn't re-tidy the whole map.
    let start = core.snapshot();
    let (mut seen_thoughts, mut seen_threads, mut last_pass) =
        (start.thoughts.iter().filter(|t| t.placed).count(), start.threads.len(), crate::now_ms());
    let mut failures = 0;
    loop {
        tokio::select! {
            _ = core.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        let looked = core.take_looked();
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
        failures = if result.is_ok() { 0 } else { failures + 1 };
        match result {
            // Talking resumed while the model worked: move nothing under them; redo the pass at the next pause.
            Ok(changes) if !changes.is_empty() && core.quiet_ms() < 2_000 => seen_thoughts = 0,
            Ok(changes) if !changes.is_empty() => core.commit(changes),
            Ok(_) => {}
            // Redo it at the next pause rather than waiting for more talk.
            Err(e) => {
                tracing::warn!("refiner pass failed: {e:#}");
                seen_thoughts = 0;
            }
        }
    }
}

/// The least time between passes: 10 s, doubling with each failed pass in a row up to about 5 min,
/// so a pass that keeps failing doesn't resend the whole map every 10 s for good.
fn rest_ms(failures: u32) -> u64 {
    10_000 << failures.min(5)
}

async fn pass(core: &Core, world: &World, since: u64) -> anyhow::Result<Vec<Change>> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let map = describe(world, since);
    let existing = existing(world);
    let today = chrono_today();
    let body = json!({
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
    });
    let response = core.http.post(URL).bearer_auth(key).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
    let content = value["choices"][0]["message"]["content"].as_str().context("no answer")?;
    let pass: Pass = serde_json::from_str(content).context("answer wasn't the expected JSON")?;
    // Checked against the map as it is now, not as it was sent: an app's card or reminder may have landed
    // while the model worked, and a second idea on that thread would only repeat it.
    Ok(changes(&core.snapshot(), pass))
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
    let exists = |id: &str| world.thread(id).is_some();
    let mut out = Vec::new();
    for t in pass.titles {
        let current = world.thread(&t.thread_id).map(|th| th.title.as_str());
        if exists(&t.thread_id) && !t.title.trim().is_empty() && current != Some(t.title.trim()) {
            out.push(Change::ThreadRenamed { thread_id: t.thread_id, title: t.title.trim().into() });
        }
    }
    // Each merge is checked against the map the earlier ones leave: a chain (T3 into T1, then T5 into T3)
    // lands on the thread that's left, and a thread never goes into its own branch, which would make the
    // branch its own parent and drop it from the map.
    let mut merged = world.clone();
    for m in pass.merges {
        let into = merged.resolve(&m.into);
        if m.from != into && merged.thread(&m.from).is_some() && merged.thread(&into).is_some() && !above(&merged, &m.from, &into) {
            let change = Change::ThreadMerged { from: m.from, into };
            merged.apply(&change);
            out.push(change);
        }
    }
    // One idea per thread, an app's card included, and one per thread in a pass too.
    let mut suggested = HashSet::new();
    for s in pass.suggestions {
        let repeated = world.suggestions.iter().any(|x| x.thread_id == s.thread_id && x.status != ItemStatus::Dismissed);
        if exists(&s.thread_id) && !s.text.trim().is_empty() && !repeated && suggested.insert(s.thread_id.clone()) {
            out.push(Change::SuggestionAdded {
                suggestion: Suggestion { id: new_id("sg"), thread_id: s.thread_id, text: s.text.trim().into(), status: ItemStatus::New },
            });
        }
    }
    for a in pass.actions {
        let repeated = world.actions.iter().any(|x| x.title.eq_ignore_ascii_case(a.title.trim()));
        // A real day only: "Saturday" would show as an invalid date, and "2026-11-31" would become December 1.
        let when = Some(a.when.trim()).filter(|w| crate::apps::valid_date(w)).unwrap_or_default();
        if exists(&a.thread_id) && !a.title.trim().is_empty() && !repeated {
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
        for raw in group.tags {
            let word: String = raw.trim().trim_start_matches('#').to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
            let tag = format!("#{word}");
            if names.len() >= TAGS || word.is_empty() || names.contains(&tag) {
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
    use super::{changes, describe, existing, rest_ms, Pass};
    use crate::world::{Action, Change, ItemStatus, Suggestion, Tag, Thought, Thread, ThreadStatus, World};

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
        let actions: Vec<[String; 3]> = changes(&world, pass)
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
}
