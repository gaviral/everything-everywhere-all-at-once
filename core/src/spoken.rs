//! The spoken command pack: file a thought where you say ("add milk to the shopping list"), start a thread with its
//! first thought ("new thread about the garden"), get back to a lost thought ("what was I thinking?") or set it
//! aside ("forget it"), open or fold a thread with all its branches ("expand the garden"), stop listening, and the
//! demo's buttons by voice (add the proposed reminder, keep the app just built, Later on the unfinished card).
//! By rule, with no model call, and only as the whole turn, as every request is (decisions/commands.md): the same
//! words inside a longer sentence are a thought, and so is anything a rule here can't place for sure.

use crate::find;
use crate::protocol::{ServerMsg, View};
use crate::world::{Change, ItemStatus, Thought, Thread, ThreadStatus, World};
use crate::{now_ms, placer, Core};
use std::collections::HashSet;
use std::sync::Arc;

/// Acts on `text` when the whole turn is one of the pack's commands; false leaves it to the rest of `add_turn`.
pub fn act(core: &Arc<Core>, speaker: &str, text: &str) -> bool {
    if is_stop_listening(text) {
        core.send_to(speaker, ServerMsg::View { view: View::Pause });
        return true;
    }
    let world = core.snapshot();
    if is_lost_thought(text) {
        drop(world);
        core.run_command(speaker, placer::Job::Back);
        return true;
    }
    // The card's buttons go to the window: it knows which card it shows, and which it hid for now (Later) or for
    // good. "Where was I?" picks by the map alone, so "finish it" could open a card you snoozed instead of the one
    // in front of you.
    if is_finish(text) && has_dropped(&world, speaker) {
        core.send_to(speaker, ServerMsg::View { view: View::Finish });
        return true;
    }
    if is_forget(text) {
        core.send_to(speaker, ServerMsg::View { view: View::Forget });
        return true;
    }
    if is_later(text) && has_dropped(&world, speaker) {
        core.send_to(speaker, ServerMsg::View { view: View::Later });
        return true;
    }
    if is_approve(text) {
        approve(core, speaker, &world);
        return true;
    }
    if let Some(keep) = keep_app(text) {
        // "Keep it" with no app waiting is talk about something else.
        let Some(build) = crate::apps::waiting(core) else { return false };
        crate::apps::decide(core, &build, keep);
        return true;
    }
    if let Some(first) = new_thread_about(text) {
        let title = title_for(&first);
        land(core, speaker, &world, &first, &first, Landing::New(title.clone()));
        core.send_to(speaker, ServerMsg::Notice { message: format!("New thread: “{title}”") });
        return true;
    }
    if let Some(ask) = unfold(text) {
        if unfold_act(core, speaker, &world, &ask) {
            return true;
        }
    }
    match filing(text).map(|(what, place)| (what, destination(&world, place))) {
        Some((_, Destination::Unsure)) | None => false,
        Some((what, destination)) => {
            file(core, speaker, &world, text, what, destination);
            true
        }
    }
}

/// `text` after the words that lead into a request (`lead_in`), without the marks and "please" that may end it.
fn plain(text: &str) -> &str {
    let mut t = crate::lead_in(text).trim_start_matches(|c: char| !c.is_alphanumeric()).trim_end();
    loop {
        let before = t.len();
        t = t.trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | '…' | ',' | ';' | ':' | '—' | '–') || c.is_whitespace());
        for tail in [" please", " for me", " now"] {
            if let Some(head) = t.len().checked_sub(tail.len()).and_then(|i| Some((t.get(..i)?, t.get(i..)?))) {
                if head.1.eq_ignore_ascii_case(tail) {
                    t = head.0;
                }
            }
        }
        if t.len() == before {
            return t;
        }
    }
}

/// The first letter in capitals, as a point reads ("milk and eggs" → "Milk and eggs").
fn capital(text: &str) -> String {
    let text = text.trim();
    let mut chars = text.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// "Stop listening" and its kin: the mic closes and nothing more is heard until it's tapped again. Starting again
/// by voice would need the mic to keep listening for it, so that's a tap (or, later, an on-device wake word).
pub fn is_stop_listening(text: &str) -> bool {
    crate::is_command(
        text,
        &[
            "stop listening", "pause listening", "stop the mic", "stop the microphone", "turn off the mic", "turn off the microphone",
            "turn the mic off", "turn the microphone off", "mic off", "microphone off", "mute the mic", "mute the microphone",
            "pause the mic", "pause the microphone", "stop recording", "stop transcribing", "pause transcription", "stop transcription",
        ],
        &["for now", "for a bit", "for a moment", "for a minute", "for a second", "now"],
    )
}

/// "What was I thinking?" when you've lost your thought: as "where was I?". Only the whole turn: at the end of a
/// sentence it's often about a choice ("I bought a boat. What was I thinking?"). "Let me think" stays filler: it's
/// a pause to think, not a wish to be moved.
fn is_lost_thought(text: &str) -> bool {
    crate::is_command(
        text,
        &[
            "what was i thinking", "what was i thinking about", "what was i going to say", "what was i gonna say", "what was i about to say",
            "let me finish my thought", "let me finish that thought", "let me finish my sentence", "help me finish my thought",
        ],
        &["again"],
    )
}

/// "Finish it", the unfinished card's button by voice; only while there's a card (`has_dropped`).
fn is_finish(text: &str) -> bool {
    crate::is_command(text, &["finish it", "let s finish it", "finish that", "finish that one"], &[])
}

/// "Forget it" when a thought is lost for good: the unfinished card goes, as after a second Later, until that thread
/// changes. Its words stay on the map.
fn is_forget(text: &str) -> bool {
    crate::is_command(
        text,
        &[
            "forget it", "forget that", "forget about it", "never mind", "nevermind", "never mind that", "no forget it", "nah forget it",
            "no never mind", "nah never mind", "it s okay i forgot", "it s ok i forgot", "it s fine i forgot", "i forgot it s okay",
            "never mind i forgot", "forget it i forgot",
        ],
        &["then"],
    )
}

/// "Later", the unfinished card's other button; only while there's a card, since alone it's often an answer.
fn is_later(text: &str) -> bool {
    crate::is_command(text, &["later", "maybe later", "not now", "not right now"], &[])
}

/// Whether the speaker left a thread unfinished, so the card may be up.
fn has_dropped(world: &World, speaker: &str) -> bool {
    world.threads.iter().any(|t| t.status == ThreadStatus::Dropped && t.dropped_by == speaker)
}

/// Adding the proposed reminder or event by voice, as its Add button does.
fn is_approve(text: &str) -> bool {
    let mut asks: Vec<String> = Vec::new();
    for to in ["reminders", "my reminders", "the reminders", "calendar", "my calendar", "the calendar"] {
        asks.push(format!("add to {to}"));
        for it in ["it", "that", "this"] {
            asks.push(format!("add {it} to {to}"));
        }
    }
    asks.extend(["approve it", "approve that", "approve the reminder", "add the reminder", "yes add it"].map(String::from));
    let asks: Vec<&str> = asks.iter().map(String::as_str).collect();
    crate::is_command(text, &asks, &[])
}

/// The action an "add it to Reminders" adds: the newest one waiting on the speaker's thread, else the newest.
fn proposed<'a>(world: &'a World, speaker: &str) -> Option<&'a crate::world::Action> {
    let waiting = || world.actions.iter().rev().filter(|a| a.status == ItemStatus::New);
    let here = world.active_for(speaker);
    waiting().find(|a| Some(&a.thread_id) == here).or_else(|| waiting().next())
}

fn approve(core: &Arc<Core>, speaker: &str, world: &World) {
    let message = match proposed(world, speaker) {
        // As a click on Add: it goes into the host's apps, so it's the host's call.
        Some(_) if !core.is_host(speaker) => "Only the host can add this: it goes into their apps.".to_string(),
        Some(action) => {
            let (core, id) = (core.clone(), action.id.clone());
            tokio::spawn(crate::apple::approve(core, id));
            format!("Adding “{}”…", action.title)
        }
        None => "Nothing is waiting to be added yet.".into(),
    };
    core.send_to(speaker, ServerMsg::Notice { message });
}

/// "Keep it" (true) or "discard it" (false) for an app that was just built.
fn keep_app(text: &str) -> Option<bool> {
    if crate::is_command(text, &["keep it", "keep the app", "keep this app", "keep that app", "keep that", "yes keep it", "keep this one"], &[]) {
        Some(true)
    } else if crate::is_command(text, &["discard it", "discard the app", "discard this app", "discard that", "throw it away", "don t keep it"], &[]) {
        Some(false)
    } else {
        None
    }
}

/// "New thread" asks that end in "about …" ("on …" after "thread"); "a new thread about …" is how talk about one goes.
const NEW_THREAD: [&str; 13] = [
    "new thread", "new topic", "start a new one", "start a new thread", "start a new topic", "create a new one", "create a new thread",
    "make a new one", "make a new thread", "open a new thread", "let s start a new one", "let s start a new thread",
    "let s start a new topic",
];

/// "New thread about the garden" or "New thread. The tomatoes need stakes.": what starts it, as said. Only a whole
/// "new thread" before "about" or a pause mark, so "Create a new one for the kitchen" and "A new thread about the
/// budget came up on Slack" are thoughts.
fn new_thread_about(text: &str) -> Option<String> {
    let t = crate::lead_in(text).trim_start_matches(|c: char| !c.is_alphanumeric());
    let l = t.to_ascii_lowercase();
    // Only the marks between the ask and the words come off: "New thread about can you review the contract?" keeps
    // "Can you review the contract?" (review of 88ace4d), since nothing else keeps the turn.
    let first = |rest: &str| {
        let rest = rest.trim_start_matches(|c: char| !c.is_alphanumeric()).trim_end();
        rest.chars().any(char::is_alphanumeric).then(|| capital(rest))
    };
    for join in [" about ", " on "] {
        for (i, _) in l.match_indices(join) {
            let head = &t[..i];
            let thread_on = join == " on " && crate::words(head).last().is_some_and(|w| w == "thread");
            if (join == " about " || thread_on) && crate::is_ask(head, &NEW_THREAD, &[]) {
                return first(&t[i + join.len()..]);
            }
        }
    }
    // "New thread. …", "Different topic, …": the whole ask, then a pause mark.
    let (i, mark) = t.char_indices().find(|(_, c)| crate::PAUSE.contains(c))?;
    if crate::is_new_thread(&t[..i]) { first(&t[i + mark.len_utf8()..]) } else { None }
}

/// A thread to open or fold, with all its branches.
#[derive(Debug, PartialEq)]
enum Target {
    /// The speaker's own thread ("expand this").
    This,
    /// Every thread ("expand everything").
    All,
    /// A thread named by its words, as said.
    Named(String),
}

#[derive(Debug, PartialEq)]
struct Unfold {
    target: Target,
    open: bool,
    /// Plainly about the map ("expand everything in …", "collapse …"): a miss is answered, not kept as a thought.
    sure: bool,
    /// "Show …", "open …", "hide …": only a thread's own title counts, since these start errands too.
    title_only: bool,
}

/// "Expand the garden", "Expand all the sub cards inside app feedback", "Show everything under the trip", "Collapse
/// this", "Fold everything": what to open or fold. "Expand the business into Europe" is a thought unless the map
/// has a thread with all those words; "Show Dana the photos" and "Hide the presents" are thoughts unless a thread
/// is titled so; "Fold the laundry" too.
fn unfold(text: &str) -> Option<Unfold> {
    let t = plain(text);
    let mut l = t.to_ascii_lowercase().replace(['’', '\''], " ").replace("sub-cards", "sub cards").replace("sub-card", "sub card");
    for lead in ["can we ", "could we ", "let s ", "lets ", "let us "] {
        if let Some(rest) = l.strip_prefix(lead) {
            l = rest.to_string();
        }
    }
    // Longest first, so "open up" isn't "open" with "up" to find.
    const OPEN: [&str; 6] = ["expand", "unfold", "open up", "show me", "open", "show"];
    const FOLD: [&str; 5] = ["collapse", "fold up", "fold", "close", "hide"];
    let (verb, open) = OPEN.iter().map(|v| (*v, true)).chain(FOLD.iter().map(|v| (*v, false)))
        .find(|(v, _)| l == *v || l.starts_with(&format!("{v} ")))?;
    let strong = matches!(verb, "expand" | "unfold" | "collapse");
    let rest = l[verb.len()..].trim();
    const THIS: [&str; 10] = ["this", "this one", "this thread", "this card", "it", "that", "that one", "that thread", "here", "it all"];
    if rest.is_empty() || THIS.contains(&rest) {
        return strong.then_some(Unfold { target: Target::This, open, sure: true, title_only: false });
    }
    const ALL: [&str; 19] = [
        "everything", "all of the sub cards", "all the sub cards", "all the subcards", "all sub cards", "all the cards", "all the branches",
        "all the threads", "all threads", "all cards", "all branches", "every card", "every thread", "the sub cards", "the subcards",
        "the branches", "all of it", "all of", "all",
    ];
    const IN: [&str; 7] = ["inside of", "inside", "under", "within", "in", "of", "on"];
    if let Some(all) = ALL.iter().find(|a| rest == **a || rest.starts_with(&format!("{a} "))) {
        let after = rest[all.len()..].trim();
        if after.is_empty() || after == "on the map" {
            // "Close everything" and "hide everything" are said of windows and tabs too.
            return matches!(verb, "expand" | "unfold" | "open" | "open up" | "show" | "show me" | "collapse" | "fold" | "fold up")
                .then_some(Unfold { target: Target::All, open, sure: true, title_only: false });
        }
        let named = IN.iter().find_map(|p| after.strip_prefix(&format!("{p} "))).or((*all == "all of").then_some(after))?;
        return Some(Unfold { target: Target::Named(as_said(t, named)), open, sure: true, title_only: false });
    }
    Some(Unfold { target: Target::Named(as_said(t, rest)), open, sure: false, title_only: !strong })
}

/// `part` (lowercase, from `text`'s end) as `text` has it, with its capitals.
fn as_said(text: &str, part: &str) -> String {
    let start = text.len().saturating_sub(part.len());
    text.get(start..).filter(|s| s.eq_ignore_ascii_case(part)).unwrap_or(part).to_string()
}

/// Words that name a kind of place rather than which one ("the shopping list", "the garden thread").
const CONTAINERS: [&str; 12] = ["list", "thread", "topic", "card", "notes", "page", "board", "folder", "one", "branch", "stuff", "section"];

fn kinds() -> HashSet<String> {
    CONTAINERS.iter().map(|c| find::stem(c)).collect()
}

/// A name's words, without the small words and the kind of place: "the shopping list" → "shop".
fn name_words(name: &str) -> HashSet<String> {
    let kinds = kinds();
    find::words(name).into_iter().filter(|w| !kinds.contains(w)).collect()
}

/// The thread a spoken name means: every word of it in the title, the closest title first (same words), then the
/// most recently touched. With `title_only` ("show", "open", "hide"), only a title with exactly those words: "Show
/// Dana the photos" is talk though a thread is titled "Dana photos from Japan". Otherwise a thread whose title, tags
/// or points hold all the words counts too (find.rs).
fn named_thread(world: &World, name: &str, title_only: bool) -> Option<String> {
    let wanted = name_words(name);
    if wanted.is_empty() {
        return None;
    }
    let titled = world.threads.iter()
        .filter_map(|t| {
            let words = name_words(&t.title);
            let same = words == wanted;
            (same || (!title_only && wanted.is_subset(&words))).then_some((t, same))
        })
        .max_by_key(|(t, same)| (*same, t.touched_ms))
        .map(|(t, _)| t.id.clone());
    if titled.is_some() || title_only { titled } else { find::thread_for(world, name) }
}

fn unfold_act(core: &Arc<Core>, speaker: &str, world: &World, ask: &Unfold) -> bool {
    let notice = |message: String| core.send_to(speaker, ServerMsg::Notice { message });
    if world.threads.is_empty() {
        if ask.sure {
            notice("Nothing on the map yet: say a thought first".into());
        }
        return ask.sure;
    }
    let id = match &ask.target {
        Target::All => {
            core.send_to(speaker, ServerMsg::Unfold { thread_id: None, open: ask.open });
            notice(if ask.open { "Every thread is open" } else { "Every thread is folded" }.into());
            return true;
        }
        Target::This => world.active_for(speaker).cloned(),
        Target::Named(name) => named_thread(world, name, ask.title_only),
    };
    let Some(thread) = id.and_then(|id| world.thread(&id)) else {
        if ask.sure {
            notice(match &ask.target {
                Target::Named(name) => format!("I couldn't find “{name}”. Try words from its title."),
                _ => "Say which thread: “expand” and its title".into(),
            });
        }
        return ask.sure;
    };
    let branches = descendants(world, &thread.id).len();
    core.send_to(speaker, ServerMsg::Unfold { thread_id: Some(thread.id.clone()), open: ask.open });
    notice(match (ask.open, branches) {
        (false, _) => format!("Folded {}", thread.title),
        (true, 0) => format!("Opened {}", thread.title),
        (true, 1) => format!("Opened {} and its branch", thread.title),
        (true, n) => format!("Opened {} and its {n} branches", thread.title),
    });
    true
}

/// Every thread under `id`, however deep.
fn descendants(world: &World, id: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut at = 0;
    let mut parents = vec![id.to_string()];
    while at < parents.len() {
        let parent = parents[at].clone();
        at += 1;
        for child in world.threads.iter().filter(|t| t.parent_id.as_deref() == Some(parent.as_str())) {
            if child.id != id && !out.contains(&child.id) {
                out.push(child.id.clone());
                parents.push(child.id.clone());
            }
        }
    }
    out
}

/// Words that say to add something somewhere ("add milk to …", "put the receipt in …"). Not "save", "file" or
/// "throw", which mostly start errands ("Save money on groceries", "File taxes in April").
const VERBS: [&str; 5] = ["add", "put", "jot down", "write down", "note down"];
const INTO: [&str; 6] = ["to", "in", "into", "on", "onto", "under"];
/// A thought these name is on the map already: moving one is the catalog's job (plan step 15), so they stay thoughts.
const POINTING: [&str; 14] =
    ["this", "that", "it", "these", "those", "them", "this one", "that one", "this thought", "that thought", "everything", "all that", "all of this", "all of that"];

/// "Add … to X" as (what, where), cut at the last "to" (or "in", "on", …): "Add a note about the trip to Japan to
/// the travel list" files "a note about the trip to Japan". Also "Add to the shopping list: milk". "Put this in
/// perspective" names no new words, so it's a thought.
fn filing(text: &str) -> Option<(&str, &str)> {
    let t = plain(text);
    let l = t.to_ascii_lowercase();
    let verb = VERBS.iter().find(|v| l.starts_with(&format!("{v} ")))?;
    let (body, lower) = (&t[verb.len() + 1..], &l[verb.len() + 1..]);
    let named = |what: &str| {
        let words = crate::words(what).join(" ");
        !words.is_empty() && !POINTING.contains(&words.as_str())
    };
    if let Some(into) = INTO.iter().find(|p| lower.starts_with(&format!("{p} "))) {
        let rest = &body[into.len() + 1..];
        let (i, mark) = rest.char_indices().find(|(_, c)| matches!(c, ',' | ':' | ';' | '—' | '–' | '.'))?;
        let what = rest[i + mark.len_utf8()..].trim();
        return named(what).then(|| (what, rest[..i].trim()));
    }
    let (i, n) = INTO.iter().filter_map(|p| { let join = format!(" {p} "); lower.rfind(&join).map(|i| (i, join.len())) }).max()?;
    let (what, place) = (body[..i].trim().trim_end_matches(','), body[i + n..].trim());
    (named(what) && !place.is_empty()).then_some((what, place))
}

#[derive(Debug, PartialEq)]
enum Destination {
    Thread(String),
    /// No thread by that name, said as a kind of place ("the packing list"): a new thread with that title.
    New(String),
    /// Not plainly a place on the map: the turn is a thought, and the placer reads where it said to put it.
    Unsure,
}

/// Where "… to X" files: the thread X names (`named_thread`, by title only), or with "list", "thread" and the like
/// and no thread sharing a word with it, a new thread titled X. "The list" alone is the latest thread with "list" in
/// its title. Anything less sure is the placer's to judge, as a thought: "Put the kids in the car" stays one unless
/// a thread is titled "Car".
fn destination(world: &World, place: &str) -> Destination {
    let mut place = place.trim();
    for article in ["the ", "my ", "our ", "a ", "an "] {
        // `get`: "日本語" has no char boundary at 4, where "the " would end.
        if place.len() > article.len() && place.get(..article.len()).is_some_and(|p| p.eq_ignore_ascii_case(article)) {
            place = place[article.len()..].trim_start();
            break;
        }
    }
    let kinds = kinds();
    let kind = find::words(place).last().filter(|w| kinds.contains(*w)).cloned();
    let wanted = name_words(place);
    if wanted.is_empty() {
        let Some(kind) = kind.filter(|k| k != "one") else { return Destination::Unsure };
        return world.threads.iter().filter(|t| find::words(&t.title).contains(&kind)).max_by_key(|t| t.touched_ms)
            .map_or(Destination::Unsure, |t| Destination::Thread(t.id.clone()));
    }
    // By title alone; "the shopping list" also fits "Shopping and errands" when it said what kind of place it is.
    let fits = |t: &Thread| { let words = name_words(&t.title); wanted == words || (kind.is_some() && wanted.is_subset(&words)) };
    if let Some(t) = world.threads.iter().filter(|t| fits(t)).max_by_key(|t| (name_words(&t.title) == wanted, t.touched_ms)) {
        return Destination::Thread(t.id.clone());
    }
    let near = world.threads.iter().any(|t| !name_words(&t.title).is_disjoint(&wanted));
    match kind {
        Some(kind) if kind != "one" && !near => Destination::New(capital(place)),
        _ => Destination::Unsure,
    }
}

/// Files the words at once, with no model call: the turn as said is kept as the thought's words, and what to add is
/// its point. The speaker moves there, as any landing moves them (placer.rs `decide`), so the map shows it.
fn file(core: &Arc<Core>, speaker: &str, world: &World, said: &str, what: &str, destination: Destination) {
    let (landing, message) = match destination {
        Destination::Thread(id) => {
            let title = world.thread(&id).map(|t| t.title.clone()).unwrap_or_default();
            (Landing::Thread(id), format!("Added to {title}"))
        }
        Destination::New(title) => {
            let message = format!("Added to a new thread: {title}");
            (Landing::New(title), message)
        }
        Destination::Unsure => return,
    };
    land(core, speaker, world, said, what, landing);
    core.send_to(speaker, ServerMsg::Notice { message });
}

/// Where a thought the pack places lands: a thread on the map, or a new one with this title.
enum Landing {
    Thread(String),
    New(String),
}

/// A title for a thread "new thread about …" starts, until the refiner finds a better one: its words without the
/// sounds that lead in and a leading "the", at most 5, as the placer's own fallback ("The garden shed" → "Garden
/// shed").
fn title_for(first: &str) -> String {
    let words = crate::lead(first, false).trim_matches(|c: char| !c.is_alphanumeric());
    let mut words: Vec<&str> = words.split_whitespace().collect();
    if words.len() > 1 && ["the", "my", "our", "a", "an"].contains(&words[0].to_ascii_lowercase().as_str()) {
        words.remove(0);
    }
    let title = words.into_iter().take(5).collect::<Vec<_>>().join(" ");
    match title.trim_end_matches(|c: char| !c.is_alphanumeric()) {
        // Only sounds ("New thread about, um, okay"): the words as said.
        "" => capital(first.trim_end_matches(|c: char| !c.is_alphanumeric())),
        title => capital(title),
    }
}

/// An id for a thread the pack starts, apart from the placer's "T…": a placement still waiting on the model counts
/// from the map it was asked with, so "T" + the next number could be the one it's about to make, and the thought it
/// places would land in this thread (review of 88ace4d). Imports keep "I…" apart the same way.
fn fresh_id(world: &World) -> String {
    let mut n = world.threads.len() + world.merged.len() + 1;
    loop {
        let id = format!("S{n}");
        if world.thread(&id).is_none() && !world.merged.contains_key(&id) {
            return id;
        }
        n += 1;
    }
}

/// Lands `said` with `point` at once, with no model call, as the placer's `decide` would: a new thread made, a
/// dropped one picked up again, the thread touched, and the speaker moved there. Leaving a thread whose last words of
/// theirs trailed off marks it unfinished, so the card can offer it, as any landing does.
fn land(core: &Arc<Core>, speaker: &str, world: &World, said: &str, point: &str, landing: Landing) {
    // Somewhere chosen now: a "new thread" asked for before this ends here.
    core.new_threads.cancel(speaker);
    let now = now_ms();
    let mut changes = Vec::new();
    let id = match landing {
        Landing::Thread(id) => {
            if world.thread(&id).is_some_and(|t| t.status == ThreadStatus::Dropped) {
                changes.push(Change::ThreadStatus { thread_id: id.clone(), status: ThreadStatus::Open, speaker: speaker.into() });
            }
            id
        }
        Landing::New(title) => {
            let id = fresh_id(world);
            changes.push(Change::ThreadAdded {
                thread: Thread {
                    id: id.clone(),
                    title,
                    parent_id: None,
                    status: ThreadStatus::Open,
                    last_point: String::new(),
                    touched_ms: now,
                    tags: Vec::new(),
                    picture: None,
                    dropped_by: String::new(),
                },
            });
            id
        }
    };
    let point = capital(point);
    let thought = Thought {
        id: format!("th-{}", uuid::Uuid::new_v4().simple()),
        speaker: speaker.into(),
        text: said.trim().into(),
        point: String::new(),
        thread_id: Some(id.clone()),
        placed: false,
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: true,
        at_ms: now,
        place_ms: None,
    };
    let thought_id = thought.id.clone();
    changes.push(Change::ThoughtAdded { thought });
    changes.push(Change::ThoughtPlaced {
        thought_id,
        thread_id: id.clone(),
        point: point.clone(),
        unclear: String::new(),
        guess: String::new(),
        heard: String::new(),
        fixed: String::new(),
        complete: true,
        place_ms: 0,
    });
    changes.push(Change::ThreadTouched { thread_id: id.clone(), last_point: point, at_ms: now });
    // As placer.rs `decide`: only the speaker's own words, last by when they were said.
    if let Some(previous) = world.active_by.get(speaker).filter(|a| **a != id) {
        let trailed_off = world.thoughts.iter()
            .filter(|t| t.placed && t.speaker == speaker && t.thread_id.as_deref() == Some(previous.as_str()))
            .max_by_key(|t| t.said_at(now))
            .is_some_and(|t| !t.complete);
        if trailed_off && world.thread(previous).is_some_and(|t| t.status == ThreadStatus::Open) {
            changes.push(Change::ThreadStatus { thread_id: previous.clone(), status: ThreadStatus::Dropped, speaker: speaker.into() });
        }
    }
    if world.active.as_deref() != Some(id.as_str()) || world.active_by.get(speaker) != Some(&id) {
        changes.push(Change::ActiveChanged { thread_id: id, speaker: speaker.into() });
    }
    core.commit(changes);
}

/// What "new thread about …" keeps as its first thought, for main.rs's table.
#[cfg(test)]
pub fn tests_first(said: &str) -> String {
    new_thread_about(said).unwrap_or_default()
}

#[cfg(test)]
mod tests;
