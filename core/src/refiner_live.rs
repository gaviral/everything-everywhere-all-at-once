//! Live checks of the refiner against the real model, on maps built to tempt it into what a person would
//! undo: merging unrelated threads, a bad rename, a past or mismatched date, an idea that only repeats a
//! point, tags that only split the title. Each run sends the request a pass sends and keeps what the
//! guards keep. The live runs are never part of `cargo test`:
//!   MODEL_API_KEY=… cargo test --release -- --ignored refiner_live --nocapture
//! RUNS sets the runs per case (default 3) and CASE keeps the cases whose name has it. Answers are saved
//! under _ref/refiner-live/LABEL (LABEL defaults to "live"); `refiner_replay` checks saved
//! answers again with the guards as they are now, without the model, so a guard is measured on the same answers.

use super::{changes_on, request, Pass, URL};
use crate::world::{Action, Change, ItemStatus, Tag, Thought, Thread, ThreadStatus, World};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const SUNDAY: &str = "2026-11-01 (Sunday)";
const TUESDAY: &str = "2026-11-03 (Tuesday)";
/// Day 0 (1970-01-01) was a Thursday.
const WEEK: [&str; 7] = ["thursday", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday"];

/// A crafted map and what would be wrong on it.
#[derive(Clone, Default)]
struct Case {
    name: &'static str,
    today: &'static str,
    /// The map before each pass: one for a crafted map; for a talk, the map as it grows (each pass's changes carry on).
    stages: Vec<World>,
    /// Merges that are right here (from, into); any other is wrong.
    merges: &'static [(&'static str, &'static str)],
    /// Threads the person named: a rename is wrong.
    named: &'static [&'static str],
    /// A rename of the thread must keep this word: (thread, word).
    keep: &'static [(&'static str, &'static str)],
    /// An action whose title has the word ("" for any): its date, if it has one, is in first..=last on the weekday ("" for any).
    dates: &'static [(&'static str, &'static str, &'static str, &'static str)],
    /// Tags that would be wrong on a thread: (thread, tag).
    wrong_tags: &'static [(&'static str, &'static str)],
    /// An action whose title has one of these words is wrong (it's done already).
    no_actions: &'static [&'static str],
    /// Threads whose latest point names a concern without saying what: an idea there must be one question.
    vague: &'static [&'static str],
}

fn thought(n: usize, thread: &str, text: &str, point: &str) -> Thought {
    Thought {
        id: format!("th-{n}"),
        speaker: "you".into(),
        text: text.into(),
        point: if point.is_empty() { text.into() } else { point.into() },
        thread_id: Some(thread.into()),
        placed: true,
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: true,
        at_ms: 1_000 * (n as u64 + 1),
        place_ms: Some(1_500),
    }
}

fn thread(id: &str, title: &str, parent: &str) -> Thread {
    Thread {
        id: id.into(),
        title: title.into(),
        parent_id: Some(parent.to_string()).filter(|p| !p.is_empty()),
        status: ThreadStatus::Open,
        last_point: String::new(),
        touched_ms: 0,
        tags: Vec::new(),
        picture: None,
        dropped_by: String::new(),
    }
}

/// A map from (id, title, parent, what was said) rows; the talk is on the last thread.
fn map(rows: &[(&str, &str, &str, &[&str])]) -> World {
    let mut world = World::default();
    for (id, title, parent, said) in rows {
        let mut t = thread(id, title, parent);
        for text in *said {
            let n = world.thoughts.len();
            world.thoughts.push(thought(n, id, text, ""));
            (t.last_point, t.touched_ms) = (text.to_string(), 1_000 * (n as u64 + 1));
        }
        world.threads.push(t);
        world.active = Some(id.to_string());
    }
    world
}

fn tags(mut world: World, id: &str, names: &[&str]) -> World {
    if let Some(t) = world.threads.iter_mut().find(|t| t.id == id) {
        t.tags = names.iter().map(|n| Tag { name: n.to_string(), kept: true }).collect();
    }
    world
}

/// The demo talk (scripts/demo-talk-v3.jsonl) placed as the placer placed it in a real run, as the map
/// stood at each refiner pass. Lines that aren't thoughts (an app request, the questions) are left out.
fn demo() -> Vec<World> {
    let talk = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/demo-talk-v3.jsonl")).expect("demo talk");
    let lines: Vec<String> = talk.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap()["text"].as_str().unwrap().to_string()).collect();
    let threads = [
        thread("T1", "Hackathon Demo Planning", ""),
        thread("T2", "Demo Opening Hook", "T1"),
        thread("T3", "Recording Setup", "T1"),
        thread("T4", "Mom's Birthday Cooking Class", ""),
        thread("T5", "Refiner Runs After Quiet", "T1"),
        thread("T6", "README Before Recording", "T1"),
        thread("T7", "Landlord Lease Email", ""),
        thread("T8", "Electric Bill Autopay", ""),
        thread("T9", "Demo Palace View Finale", "T1"),
        thread("T10", "App Organizes Thoughts", ""),
    ];
    // (line, thread, the placer's point)
    let placed = [
        (0, "T1", "Need to plan hackathon demo deadline tomorrow"),
        (1, "T2", "We open with mic on, thought lands in two seconds"),
        (2, "T3", "We record in quiet room dark background map pops"),
        (3, "T4", "Mom's birthday Friday need to book cooking class"),
        (4, "T4", "Cooking class on Main Street sixty bucks"),
        (6, "T2", "Placement uses Muse Bark takes two seconds"),
        (7, "T5", "Refiner runs after quiet tidies titles proposes tags"),
        (8, "T6", "Need to write README before recording repo public"),
        (9, "T6", "README explains how to run and Muse Spark models"),
        (10, "T7", "Email landlord about lease due before November tenth"),
        (11, "T8", "Keep forgetting electric bill set up autopay"),
        (12, "T9", "Show Palace view at end with memory pictures"),
        (13, "T10", "you think out loud app organizes nothing lost"),
    ];
    // The passes of the real run came after 3, 11 and 13 thoughts; one more after 6 for a pass mid-talk.
    [3, 6, 11, 13]
        .iter()
        .map(|&upto| {
            let mut world = World::default();
            for (n, &(line, id, point)) in placed[..upto].iter().enumerate() {
                let mut th = thought(n, id, &lines[line], point);
                th.complete = line != 11;
                th.at_ms = 1_000 * (line as u64 + 1);
                world.thoughts.push(th);
                if world.thread(id).is_none() {
                    world.threads.push(threads.iter().find(|t| t.id == id).unwrap().clone());
                }
                let t = world.threads.iter_mut().find(|t| t.id == id).unwrap();
                (t.last_point, t.touched_ms) = (point.to_string(), 1_000 * (line as u64 + 1));
                world.active = Some(id.to_string());
            }
            // The electric bill trailed off and the talk moved on: it's dropped.
            if upto > 11 {
                let t = world.threads.iter_mut().find(|t| t.id == "T8").unwrap();
                (t.status, t.dropped_by) = (ThreadStatus::Dropped, "you".into());
            }
            world
        })
        .collect()
}

fn cases() -> Vec<Case> {
    let one = |world: World| vec![world];
    let mut lease = map(&[("T1", "Rent", "", &["Pay rent by Friday."]), ("T2", "Apartment lease", "", &["I need to renew the lease before"])]);
    lease.threads[1].status = ThreadStatus::Dropped;
    lease.threads[1].dropped_by = "you".into();
    lease.thoughts[1].complete = false;
    lease.active = Some("T1".into());
    let mut paid = map(&[("T1", "Rent", "", &["Pay rent by Friday.", "The landlord wants an e-transfer this time."])]);
    paid.actions.push(Action {
        id: "ac-1".into(),
        thread_id: "T1".into(),
        kind: "reminder".into(),
        title: "Pay rent".into(),
        when: "2026-11-06".into(),
        status: ItemStatus::New,
        done_ms: None,
    });
    let demo_dates: &'static [(&str, &str, &str, &str)] =
        &[("cooking", "2026-11-01", "2026-11-06", ""), ("class", "2026-11-01", "2026-11-06", ""), ("birthday", "2026-11-06", "2026-11-06", "friday"), ("lease", "2026-11-01", "2026-11-10", ""), ("landlord", "2026-11-01", "2026-11-10", "")];
    vec![
        Case {
            name: "shared-word-electric",
            stages: one(tags(map(&[
                ("T1", "Electric bill", "", &["I need to set up autopay for the electric bill, it was late again."]),
                ("T2", "Electric guitar lessons", "", &["I should finally sign up for electric guitar lessons.", "There's a teacher on Main Street who does Thursday evenings."]),
            ]), "T1", &["#bills"])),
            ..Default::default()
        },
        Case {
            name: "shared-word-rent-car",
            stages: one(map(&[
                ("T1", "Rent", "", &["I need to pay rent by the fifth.", "The landlord wants it by e-transfer this time."]),
                ("T2", "Rent a car", "", &["For the Tahoe trip we should rent a car.", "Probably an SUV because of the snow."]),
            ])),
            ..Default::default()
        },
        Case {
            name: "dropped-lease-vs-rent",
            stages: one(lease),
            ..Default::default()
        },
        Case {
            name: "branch-into-parent",
            stages: one(map(&[
                ("T1", "Japan trip", "", &["We're going to Japan in April.", "Three days in Kyoto, then Tokyo."]),
                ("T2", "Japan trip budget", "T1", &["Flights are about twelve hundred each.", "Let's cap the whole trip at four grand."]),
            ])),
            ..Default::default()
        },
        Case {
            name: "true-duplicate",
            stages: one(map(&[
                ("T1", "Pay rent", "", &["I need to pay rent by the fifth."]),
                ("T2", "Groceries", "", &["Buy oat milk and eggs."]),
                ("T3", "Rent payment", "", &["For the rent, I'll send the landlord an e-transfer."]),
            ])),
            merges: &[("T3", "T1")],
            ..Default::default()
        },
        Case {
            name: "named-falcon",
            stages: one(map(&[(
                "T1",
                "Project Falcon",
                "",
                &["Okay, we're calling this Project Falcon.", "The Falcon prototype needs a test suite before the demo.", "And someone has to own the landing page."],
            )])),
            named: &["T1"],
            ..Default::default()
        },
        Case {
            name: "named-by-speaking",
            stages: one(map(&[(
                "T1",
                "Garden Project",
                "",
                &["New topic, call it Garden Project.", "The tomatoes need stakes this weekend.", "And the fence by the shed is falling apart."],
            )])),
            named: &["T1"],
            ..Default::default()
        },
        Case {
            name: "rename-narrows",
            stages: one(map(&[(
                "T1",
                "Hackathon demo",
                "",
                &[
                    "The submission deadline is Wednesday at six.",
                    "We open with the mic turning on.",
                    "We record in a quiet room with a dark background.",
                    "At the end I want to show the Palace view with all the pictures.",
                ],
            )])),
            keep: &[("T1", "demo")],
            ..Default::default()
        },
        Case {
            name: "long-title",
            stages: one(map(&[("T1", "Rent", "", &["I have to pay rent before Friday or there's a late fee."])])),
            ..Default::default()
        },
        Case {
            name: "lease-year",
            stages: one(map(&[("T1", "Lease renewal", "", &["The lease is due before November tenth.", "I should email the landlord about it this week."])])),
            dates: &[("", "2026-11-01", "2026-11-10", "")],
            ..Default::default()
        },
        Case {
            name: "next-tuesday",
            stages: one(map(&[("T1", "Dentist", "", &["I have to call the dentist next Tuesday to move my cleaning."])])),
            dates: &[("", "2026-11-03", "2026-11-10", "tuesday")],
            ..Default::default()
        },
        Case {
            name: "party-saturday",
            stages: one(map(&[("T1", "Party planning", "", &["The party is Saturday at Jen's place.", "I need to pick up balloons before then."])])),
            dates: &[("balloon", "2026-11-01", "2026-11-07", ""), ("party", "2026-11-07", "2026-11-07", "saturday")],
            ..Default::default()
        },
        Case {
            name: "idea-restates-rent",
            stages: one(map(&[("T1", "Rent", "", &["Pay rent by Friday.", "I'll transfer the money Thursday so it clears."])])),
            dates: &[("transfer", "2026-11-05", "2026-11-05", "thursday"), ("", "2026-11-01", "2026-11-06", "")],
            ..Default::default()
        },
        Case {
            name: "idea-restates-recording",
            stages: one(map(&[(
                "T1",
                "Demo recording",
                "",
                &["We record in a quiet room.", "With a dark background so the map pops.", "And I want to practice the flow twice before recording."],
            )])),
            ..Default::default()
        },
        Case {
            name: "duplicate-action",
            stages: one(paid),
            ..Default::default()
        },
        Case {
            name: "tags-split-title",
            stages: one(map(&[("T1", "Hackathon demo plan", "", &["I need to record the demo by Tuesday.", "The video can be three minutes at most."])])),
            ..Default::default()
        },
        Case {
            name: "tag-reuse-birthday",
            stages: one(tags(map(&[
                ("T1", "Mom's birthday", "", &["I need to buy Mom a present."]),
                ("T2", "Work anniversary", "", &["It's the company's tenth anniversary party next week."]),
            ]), "T1", &["#birthday"])),
            wrong_tags: &[("T2", "#birthday")],
            ..Default::default()
        },
        Case {
            name: "january-in-december",
            today: "2026-12-28 (Monday)",
            stages: one(map(&[("T1", "Quarterly taxes", "", &["I need to file the quarterly taxes by January fifteenth.", "And renew the car registration before the new year."])])),
            dates: &[("tax", "2027-01-01", "2027-01-15", ""), ("registration", "2026-12-28", "2026-12-31", "")],
            ..Default::default()
        },
        Case {
            name: "past-days",
            stages: one(map(&[
                ("T1", "Bills", "", &["I already paid the gas bill last Friday, so that's done.", "The water bill is due on the fifteenth."]),
                ("T2", "Mom", "", &["Mom's birthday was last Friday and I forgot.", "I should still send her a card."]),
            ])),
            dates: &[("water", "2026-11-15", "2026-11-15", "")],
            no_actions: &["gas"],
            ..Default::default()
        },
        Case {
            name: "vague-note",
            stages: one(map(&[
                ("T1", "Palace pictures", "", &["The pictures in the Palace need to be looked at."]),
                ("T2", "Recap sheet", "", &["The recap sheet should open faster, it takes four seconds right now."]),
                ("T3", "Onboarding", "", &["Something about the first screen feels off."]),
                ("T4", "Pricing page", "", &["We should revisit the pricing page at some point."]),
            ])),
            vague: &["T1", "T3", "T4"],
            ..Default::default()
        },
        Case { name: "demo-sunday", stages: demo(), dates: demo_dates, ..Default::default() },
        Case { name: "demo-tuesday", today: TUESDAY, stages: demo(), dates: &[("cooking", "2026-11-03", "2026-11-06", ""), ("class", "2026-11-03", "2026-11-06", ""), ("birthday", "2026-11-06", "2026-11-06", "friday"), ("lease", "2026-11-03", "2026-11-10", ""), ("landlord", "2026-11-03", "2026-11-10", "")], ..Default::default() },
    ]
    .into_iter()
    .map(|c| Case { today: if c.today.is_empty() { SUNDAY } else { c.today }, ..c })
    .collect()
}

// The checks' own words, stems and stop words, simpler than the refiner's (`refiner::content`) on purpose:
// a check built from the guard's code would only ever agree with it.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// "bills" and "bill" are one word here; "class" stays.
fn stem(word: &str) -> String {
    match word.strip_suffix('s') {
        Some(w) if w.len() >= 3 && !w.ends_with('s') => w.into(),
        _ => word.into(),
    }
}

const STOP: [&str; 40] = [
    "a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at", "by", "with", "about", "is", "are", "be", "it", "its", "this",
    "that", "i", "you", "we", "my", "your", "our", "need", "should", "will", "can", "so", "if", "do", "get", "just", "also", "up", "s", "ll",
];

fn content(text: &str) -> HashSet<String> {
    words(text).iter().filter(|w| !STOP.contains(&w.as_str())).map(|w| stem(w)).collect()
}

/// Most of what `text` says is already in `said`: at least two of its words, and at least 60% of them.
fn restates(text: &str, said: &str) -> bool {
    let (mine, theirs) = (content(text), content(said));
    let shared = mine.intersection(&theirs).count();
    shared >= 2 && shared * 10 >= mine.len() * 6
}

/// The tag is a word of the title, or a few of them run together (#electricbill).
fn splits(tag: &str, title: &str) -> bool {
    let word = tag.trim_start_matches('#').to_lowercase();
    let title: Vec<String> = words(title).iter().map(|w| stem(w)).collect();
    let parts: Vec<String> = word.split('-').filter(|p| !p.is_empty()).map(stem).collect();
    let joined = stem(&word.replace('-', ""));
    (!parts.is_empty() && parts.iter().all(|p| title.contains(p))) || (2..=title.len()).any(|n| title.windows(n).any(|w| w.concat() == joined))
}

fn weekday(date: &str) -> &'static str {
    let n = |r: std::ops::Range<usize>| date.get(r).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    WEEK[crate::import::days_from_civil(n(0..4), n(5..7), n(8..10)).rem_euclid(7) as usize]
}

/// Names a thread by its id ("add this to T3").
fn names_an_id(world: &World, text: &str) -> bool {
    text.split(|c: char| !c.is_alphanumeric()).any(|w| !w.is_empty() && world.thread(&world.resolve(w)).is_some())
}

fn same(a: &str, b: &str) -> bool {
    words(a) == words(b)
}

/// What a person would undo in one pass's changes, on the map it was made for: (kind, detail).
fn problems(case: &Case, before: &World, out: &[Change]) -> Vec<(&'static str, String)> {
    let today = &case.today[..10];
    let mut found = Vec::new();
    let mut titles: HashMap<String, String> = before.threads.iter().map(|t| (t.id.clone(), t.title.clone())).collect();
    let mut actions: Vec<String> = before.actions.iter().map(|a| a.title.clone()).collect();
    for change in out {
        match change {
            Change::TidyProposed { proposal: p } if p.kind == crate::tidy::Kind::Merge && !case.merges.contains(&(p.thread_id.as_str(), p.into.as_str())) => {
                let (from, into) = (&p.thread_id, &p.into);
                found.push(("merge proposed", format!("{from}→{into} ({:?} into {:?})", titles.get(from).cloned().unwrap_or_default(), titles.get(into).cloned().unwrap_or_default())));
            }
            Change::ThreadRetitled { thread_id, title, .. } => {
                let old = titles.get(thread_id).cloned().unwrap_or_default();
                if case.named.contains(&thread_id.as_str()) {
                    found.push(("renamed a title the person gave", format!("{old:?} to {title:?}")));
                }
                if names_an_id(before, title) {
                    found.push(("names a thread id", format!("title {title:?}")));
                }
                if title.split_whitespace().count() > 5 {
                    found.push(("title over 5 words", format!("{title:?}")));
                }
                if same(&old, title) {
                    found.push(("rename that changes only case", format!("{old:?}→{title:?}")));
                }
                for (id, word) in case.keep {
                    if id == thread_id && !title.to_lowercase().contains(word) {
                        found.push(("rename narrows the thread", format!("{old:?}→{title:?}")));
                    }
                }
                titles.insert(thread_id.clone(), title.clone());
            }
            Change::SuggestionAdded { suggestion: s } => {
                if case.vague.contains(&s.thread_id.as_str()) && !s.text.trim_end().ends_with('?') {
                    found.push(("vague note not asked about", format!("{:?}", s.text)));
                }
                let said = before.thoughts.iter().filter(|p| p.thread_id.as_deref() == Some(s.thread_id.as_str())).map(|p| p.text.clone());
                if names_an_id(before, &s.text) {
                    found.push(("names a thread id", format!("idea {:?}", s.text)));
                }
                // On a vague point, the question asking what it meant reuses its words by nature.
                let asking = case.vague.contains(&s.thread_id.as_str()) && s.text.trim_end().ends_with('?');
                if let Some(p) = said.chain(actions.iter().cloned()).find(|p| !asking && restates(&s.text, p)) {
                    found.push(("idea repeats a point", format!("{:?} repeats {p:?}", s.text)));
                }
            }
            Change::ActionProposed { action: a } => {
                if names_an_id(before, &a.title) {
                    found.push(("names a thread id", format!("action {:?}", a.title)));
                }
                if let Some(x) = actions.iter().find(|x| restates(&a.title, x) && restates(x, &a.title)) {
                    found.push(("action repeats one", format!("{:?} repeats {x:?}", a.title)));
                }
                actions.push(a.title.clone());
                if case.no_actions.iter().any(|w| a.title.to_lowercase().contains(w)) {
                    found.push(("action for something done", a.title.clone()));
                }
                if a.when.is_empty() {
                    continue;
                }
                if a.when.as_str() < today {
                    found.push(("past date", format!("{} for {:?}", a.when, a.title)));
                }
                if let Some(day) = WEEK.iter().find(|d| words(&a.title).contains(&d.to_string())) {
                    if weekday(&a.when) != *day {
                        found.push(("weekday differs from the title", format!("{:?} on a {}: {}", a.title, weekday(&a.when), a.when)));
                    }
                }
                let title = a.title.to_lowercase();
                if let Some((_, first, last, day)) = case.dates.iter().find(|(word, ..)| title.contains(*word)) {
                    if a.when.as_str() < *first || a.when.as_str() > *last || (!day.is_empty() && weekday(&a.when) != *day) {
                        found.push(("wrong date", format!("{} ({}) for {:?}, want {first}..{last} {day}", a.when, weekday(&a.when), a.title)));
                    }
                }
            }
            Change::TagSuggested { thread_id, tag } => {
                let old = before.thread(thread_id).map(|t| t.title.clone()).unwrap_or_default();
                let new = titles.get(thread_id).cloned().unwrap_or_default();
                if splits(tag, &old) || splits(tag, &new) {
                    found.push(("tag only splits the title", format!("{tag} on {old:?}")));
                }
                if case.wrong_tags.contains(&(thread_id.as_str(), tag.as_str())) {
                    found.push(("wrong tag", format!("{tag} on {old:?}")));
                }
            }
            _ => {}
        }
    }
    found
}

fn show(change: &Change) -> Option<String> {
    Some(match change {
        Change::ThreadRetitled { thread_id, title, .. } => format!("rename {thread_id} {title:?}"),
        Change::TidyProposed { proposal: p } if p.kind == crate::tidy::Kind::Rename => format!("propose rename {} {:?}", p.thread_id, p.title),
        Change::TidyProposed { proposal: p } => format!("propose merge {}→{}", p.thread_id, p.into),
        Change::SuggestionAdded { suggestion: s } => format!("idea {} {:?}", s.thread_id, s.text),
        Change::ActionProposed { action: a } => format!("{} {} {:?} {}", a.kind, a.thread_id, a.title, a.when),
        Change::TagSuggested { thread_id, tag } => format!("tag {thread_id} {tag}"),
        _ => return None,
    })
}

/// Sends the request as a pass does; the answer is the model's JSON as text.
async fn ask(http: &reqwest::Client, key: &str, body: &serde_json::Value) -> anyhow::Result<String> {
    let value = crate::model::answer(http.post(URL).bearer_auth(key).json(body).send().await?).await?;
    Ok(value["choices"][0]["message"]["content"].as_str().ok_or_else(|| anyhow::anyhow!("no answer"))?.to_string())
}

fn folder(label: &str) -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../_ref/refiner-live")).join(label)
}

/// Where answers come from: the model (saving each), or a saved run.
#[derive(Clone)]
enum Source {
    Live { http: reqwest::Client, key: String, gate: Arc<tokio::sync::Semaphore>, save: PathBuf },
    Saved(PathBuf),
}

impl Source {
    async fn answer(&self, body: &serde_json::Value, file: &str) -> Result<String, String> {
        match self {
            Source::Saved(dir) => std::fs::read_to_string(dir.join(file)).map_err(|e| format!("{file}: {e}")),
            Source::Live { http, key, gate, save } => {
                let _turn = gate.acquire().await.unwrap();
                let mut last = String::new();
                for attempt in 0..3 {
                    if attempt > 0 {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                    match ask(http, key, body).await {
                        Ok(answer) => {
                            let _ = std::fs::write(save.join(file), &answer);
                            return Ok(answer);
                        }
                        Err(e) => last = format!("{e:#}"),
                    }
                }
                Err(last)
            }
        }
    }
}

struct Outcome {
    case: usize,
    problems: Vec<(&'static str, String)>,
    log: String,
    /// Right merges made (true-duplicate).
    merged: usize,
}

/// One run of a case: a pass per stage, each on the map the earlier passes left.
async fn run(index: usize, case: Case, number: usize, source: Source) -> Outcome {
    let mut carried: Vec<Change> = Vec::new();
    let mut log = format!("[{} #{number}]\n", case.name);
    let (mut problems_found, mut merged) = (Vec::new(), 0);
    let mut renamed: BTreeMap<String, usize> = BTreeMap::new();
    let mut since = 0;
    for (stage, base) in case.stages.iter().enumerate() {
        let mut world = base.clone();
        carried.iter().for_each(|c| world.apply(c));
        let body = request(&world, since, case.today);
        since = world.thoughts.iter().map(|t| t.at_ms).max().unwrap_or(0);
        let answer = match source.answer(&body, &format!("{}-{number}-{stage}.json", case.name)).await {
            Ok(a) => a,
            Err(e) => {
                problems_found.push(("error", e));
                break;
            }
        };
        let out = match serde_json::from_str::<Pass>(&answer) {
            Ok(pass) => changes_on(&world, pass, case.today),
            Err(e) => {
                problems_found.push(("answer wasn't the JSON", e.to_string()));
                continue;
            }
        };
        for c in &out {
            match c {
                Change::ThreadRetitled { thread_id, .. } => *renamed.entry(thread_id.clone()).or_default() += 1,
                Change::TidyProposed { proposal: p } if p.kind == crate::tidy::Kind::Merge && case.merges.contains(&(p.thread_id.as_str(), p.into.as_str())) => merged += 1,
                _ => {}
            }
        }
        log += &format!("  pass {stage}: {}\n", out.iter().filter_map(show).collect::<Vec<_>>().join("; "));
        for (kind, detail) in problems(&case, &world, &out) {
            log += &format!("    FAIL {kind}: {detail}\n");
            problems_found.push((kind, detail));
        }
        carried.extend(out);
    }
    for (id, n) in renamed.into_iter().filter(|(_, n)| *n > 1) {
        log += &format!("    FAIL renamed more than once in one talk: {id} ×{n}\n");
        problems_found.push(("renamed more than once in one talk", id));
    }
    Outcome { case: index, problems: problems_found, log, merged }
}

async fn check_all(source: Source, runs: usize, label: &str) {
    let filter = std::env::var("CASE").unwrap_or_default();
    let cases: Vec<Case> = cases().into_iter().filter(|c| filter.split(',').any(|f| c.name.contains(f.trim()))).collect();
    let mut set = tokio::task::JoinSet::new();
    for (i, case) in cases.iter().enumerate() {
        for number in 1..=runs {
            set.spawn(run(i, case.clone(), number, source.clone()));
        }
    }
    let mut outcomes = Vec::new();
    while let Some(done) = set.join_next().await {
        outcomes.push(done.unwrap());
    }
    outcomes.sort_by(|a, b| (a.case, &a.log).cmp(&(b.case, &b.log)));
    let text: String = outcomes.iter().map(|o| o.log.as_str()).collect();
    let mut table = String::from("| case | passed | what went wrong (count) |\n|---|---|---|\n");
    for (i, case) in cases.iter().enumerate() {
        let mine: Vec<&Outcome> = outcomes.iter().filter(|o| o.case == i).collect();
        let passed = mine.iter().filter(|o| o.problems.is_empty()).count();
        let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
        for (kind, _) in mine.iter().flat_map(|o| o.problems.iter()) {
            *kinds.entry(kind).or_default() += 1;
        }
        let mut wrong = kinds.iter().map(|(k, n)| format!("{k} ({n})")).collect::<Vec<_>>().join(", ");
        if !case.vague.is_empty() {
            let asked: usize = mine.iter().map(|o| case.vague.iter().filter(|id| o.log.split("; ").any(|c| c.contains(&format!("idea {id} \"")) && c.trim_end().ends_with("?\""))).count()).sum();
            wrong += &format!("{}questions on vague points: {asked} of {}", if wrong.is_empty() { "" } else { "; " }, case.vague.len() * mine.len());
        }
        if !case.merges.is_empty() {
            wrong += &format!("{}right merge made in {}/{}", if wrong.is_empty() { "" } else { "; " }, mine.iter().map(|o| o.merged.min(1)).sum::<usize>(), mine.len());
        }
        table += &format!("| {} | {passed}/{} | {wrong} |\n", case.name, mine.len());
    }
    println!("{text}\n{table}");
    let dir = folder(label);
    let _ = std::fs::create_dir_all(&dir);
    let name = if matches!(source, Source::Saved(_)) { "replay.txt" } else { "runs.txt" };
    let _ = std::fs::write(dir.join(name), format!("{text}\n{table}"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "calls the real model; needs MODEL_API_KEY"]
async fn refiner_live() {
    let key = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty()).expect("MODEL_API_KEY");
    let runs = std::env::var("RUNS").ok().and_then(|r| r.parse().ok()).unwrap_or(3);
    let label = std::env::var("LABEL").unwrap_or_else(|_| "live".into());
    let save = folder(&label);
    std::fs::create_dir_all(&save).unwrap();
    let http = reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120)).build().unwrap();
    let gate = Arc::new(tokio::sync::Semaphore::new(6));
    check_all(Source::Live { http, key, gate, save }, runs, &label).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "reads answers saved by refiner_live"]
async fn refiner_replay() {
    let runs = std::env::var("RUNS").ok().and_then(|r| r.parse().ok()).unwrap_or(3);
    let label = std::env::var("LABEL").unwrap_or_else(|_| "live".into());
    check_all(Source::Saved(folder(&label)), runs, &label).await;
}

#[test]
fn the_live_checks_catch_what_they_should() {
    assert!(splits("#hackathon", "Hackathon Demo Planning") && splits("#bills", "Electric Bill Autopay") && splits("#electric-bill", "Electric bill"));
    assert!(splits("#momsbirthday", "Mom's birthday") && !splits("#family", "Mom's birthday") && !splits("#class", "Glass"));
    assert!(restates("Transfer the money by Thursday.", "I'll transfer the money Thursday so it clears."));
    assert!(!restates("Ask the landlord if e-transfer works", "Pay rent by Friday."));
    assert_eq!((weekday("2026-11-01"), weekday("2026-11-03"), weekday("2026-11-07")), ("sunday", "tuesday", "saturday"));
    let demo = demo();
    assert_eq!(demo.iter().map(|w| (w.threads.len(), w.thoughts.len())).collect::<Vec<_>>(), [(3, 3), (4, 6), (8, 11), (10, 13)]);
}

#[test]
#[ignore = "prints what the model sees for the demo's third pass"]
fn refiner_show_demo() {
    let stages = demo();
    let body = request(&stages[2], stages[1].thoughts.iter().map(|t| t.at_ms).max().unwrap(), SUNDAY);
    println!("{}", body["messages"][1]["content"].as_str().unwrap());
}

/// A journal read into a map without writing to it, with the refiner's own renames and merges left out, so a pass
/// meets the titles the placer gave (a map tidied already would hide what the refiner does to a fresh one). `upto`
/// keeps the map as it stood after that many thoughts were placed.
fn from_journal(path: &str, upto: Option<usize>) -> World {
    let mut world = World::default();
    let mut placed = 0;
    for line in std::fs::read_to_string(path).unwrap_or_default().lines().filter(|l| !l.trim().is_empty()) {
        let Ok(change) = serde_json::from_str::<Change>(line) else { continue };
        if matches!(change, Change::ThreadRenamed { .. } | Change::ThreadMerged { .. }) {
            continue;
        }
        let places = matches!(change, Change::ThoughtPlaced { .. }) || matches!(&change, Change::ThoughtAdded { thought } if thought.placed);
        if places && upto.is_some_and(|n| placed >= n) {
            break;
        }
        world.apply(&change);
        placed += places as usize;
    }
    world
}

/// The refiner's answers on real maps, to define "sure" from them: MAPS holds
/// `name=path[@n,n…]` items (the numbers cut the map after that many placed thoughts), RUNS the passes per map
/// (default 5), OUT the folder for each answer and the map it was given (never the repo: maps hold people's words).
///   MODEL_API_KEY=… MAPS=… OUT=… cargo test --release -- --ignored refiner_sure_live --nocapture
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "calls the real model; needs MODEL_API_KEY, MAPS and OUT"]
async fn refiner_sure_live() {
    let key = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty()).expect("MODEL_API_KEY");
    let runs: usize = std::env::var("RUNS").ok().and_then(|r| r.parse().ok()).unwrap_or(5);
    let out = PathBuf::from(std::env::var("OUT").expect("OUT"));
    std::fs::create_dir_all(&out).unwrap();
    let http = reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120)).build().unwrap();
    let gate = Arc::new(tokio::sync::Semaphore::new(6));
    let mut set = tokio::task::JoinSet::new();
    for item in std::env::var("MAPS").expect("MAPS").split(',').filter(|s| !s.trim().is_empty()) {
        let (name, rest) = item.split_once('=').expect("name=path");
        let (path, cuts) = rest.split_once('@').map(|(p, c)| (p, c.split('.').filter_map(|n| n.parse().ok()).map(Some).collect())).unwrap_or((rest, vec![None]));
        for upto in cuts {
            let world = from_journal(path, upto);
            let stage = format!("{name}-{}", upto.map(|n| n.to_string()).unwrap_or_else(|| "all".into()));
            std::fs::write(out.join(format!("{stage}.world.json")), serde_json::to_string(&world).unwrap()).unwrap();
            for run in 1..=runs {
                let source = Source::Live { http: http.clone(), key: key.clone(), gate: gate.clone(), save: out.clone() };
                let (world, stage) = (world.clone(), stage.clone());
                set.spawn(async move {
                    let body = request(&world, 0, SUNDAY);
                    let file = format!("{stage}.{run}.json");
                    let answer = source.answer(&body, &file).await;
                    (file, answer.map(|a| serde_json::from_str::<Pass>(&a).map(|p| changes_on(&world, p, SUNDAY).len())))
                });
            }
        }
    }
    while let Some(done) = set.join_next().await {
        let (file, result) = done.unwrap();
        println!("{file}: {}", match result { Ok(Ok(n)) => format!("{n} changes"), Ok(Err(e)) => format!("bad JSON: {e}"), Err(e) => format!("error: {e}") });
    }
}

/// Prints each rename and merge the guards keep from the answers `refiner_sure_live` saved in OUT, one per line
/// (tab-separated: stage, run, kind, thread, from, to), to be labeled and measured.
#[test]
#[ignore = "reads answers saved by refiner_sure_live"]
fn refiner_sure_rows() {
    let out = PathBuf::from(std::env::var("OUT").expect("OUT"));
    let mut files: Vec<_> = std::fs::read_dir(&out).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect();
    files.sort();
    for file in files.iter().filter(|f| f.ends_with(".json") && !f.ends_with(".world.json")) {
        let (stage, run) = file.trim_end_matches(".json").rsplit_once('.').unwrap();
        let world: World = serde_json::from_str(&std::fs::read_to_string(out.join(format!("{stage}.world.json"))).unwrap()).unwrap();
        let Ok(pass) = serde_json::from_str::<Pass>(&std::fs::read_to_string(out.join(file)).unwrap()) else { continue };
        for change in changes_on(&world, pass, SUNDAY) {
            match change {
                Change::ThreadRetitled { thread_id, title, was } => println!("ROW\t{stage}\t{run}\trename\t{thread_id}\t{was}\t{title}"),
                Change::TidyProposed { proposal: p } => {
                    let name = |id: &str| world.thread(id).map(|t| t.title.clone()).unwrap_or_default();
                    let to = if p.into.is_empty() { p.title.clone() } else { name(&p.into) };
                    println!("ROW\t{stage}\t{run}\tpropose {:?}\t{}\t{}\t{to}", p.kind, p.thread_id, name(&p.thread_id));
                }
                _ => {}
            }
        }
    }
}

/// Every rename the refiner gave in the saved answers and journals, with what `sure_title` makes of it, to label
/// and count: OUT folders of `refiner_sure_live` (DIRS, comma-separated), the crafted
/// cases' saved answers (LABEL, default "final"), and the renames journals hold (JOURNALS, a file listing paths).
#[test]
#[ignore = "reads saved answers and journals"]
fn refiner_sure_eval() {
    let row = |source: &str, world: &World, id: &str, title: &str| {
        let Some(thread) = world.thread(id) else { return };
        let verdict = if super::sure_title(world, id, title) { "act" } else { "propose" };
        let points = world.thoughts.iter().filter(|p| p.placed && p.thread_id.as_deref() == Some(id)).count();
        println!("EVAL\t{source}\t{id}\t{}\t{title}\t{verdict}\t{points}", thread.title);
    };
    for dir in std::env::var("DIRS").unwrap_or_default().split(',').filter(|d| !d.is_empty()) {
        let out = PathBuf::from(dir);
        let mut files: Vec<_> = std::fs::read_dir(&out).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect();
        files.sort();
        for file in files.iter().filter(|f| f.ends_with(".json") && !f.ends_with(".world.json")) {
            let (stage, _) = file.trim_end_matches(".json").rsplit_once('.').unwrap();
            let world: World = serde_json::from_str(&std::fs::read_to_string(out.join(format!("{stage}.world.json"))).unwrap()).unwrap();
            let Ok(pass) = serde_json::from_str::<Pass>(&std::fs::read_to_string(out.join(file)).unwrap()) else { continue };
            for t in pass.titles {
                // Only those the guards before `sure_title` keep.
                let kept = changes_on(&world, Pass { titles: vec![super::Title { thread_id: t.thread_id.clone(), title: t.title.clone() }], ..Pass::default() }, SUNDAY);
                if !kept.is_empty() {
                    row(file, &world, &t.thread_id, t.title.trim());
                }
            }
        }
    }
    let label = std::env::var("LABEL").unwrap_or_else(|_| "final".into());
    for case in cases() {
        for number in 1..=5 {
            let mut world = World::default();
            for (stage, base) in case.stages.iter().enumerate() {
                world = { let mut w = base.clone(); w.proposals = world.proposals.clone(); w };
                let file = format!("{}-{number}-{stage}.json", case.name);
                let Ok(text) = std::fs::read_to_string(folder(&label).join(&file)) else { continue };
                let Ok(pass) = serde_json::from_str::<Pass>(&text) else { continue };
                for t in &pass.titles {
                    let kept = changes_on(&world, Pass { titles: vec![super::Title { thread_id: t.thread_id.clone(), title: t.title.clone() }], ..Pass::default() }, case.today);
                    if !kept.is_empty() {
                        row(&file, &world, &t.thread_id, t.title.trim());
                    }
                }
            }
        }
    }
    let Ok(list) = std::env::var("JOURNALS") else { return };
    for path in std::fs::read_to_string(list).unwrap().lines().filter(|l| !l.trim().is_empty()) {
        let mut world = World::default();
        for line in std::fs::read_to_string(path).unwrap_or_default().lines().filter(|l| !l.trim().is_empty()) {
            let Ok(change) = serde_json::from_str::<Change>(line) else { continue };
            if let Change::ThreadRenamed { thread_id, title } = &change {
                row(path, &world, thread_id, title);
            }
            world.apply(&change);
        }
    }
}
