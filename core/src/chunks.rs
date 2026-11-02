//! Chunks: a thought said in two parts across a pause lands as one idea, the second part linked to the first; what
//! the placer read into a thought that changed where it went is kept with it, and so is a short "why here".
//! The placer asks (placer.rs `request`), this decides what counts and keeps it beside the thought (`World::notes`).

use crate::placer::JUST_BEFORE_MS;
use crate::world::{Change, Thought, World};
use crate::Core;
use serde::{Deserialize, Serialize};

/// The longest "why here" kept, in words: one glance (C225; the extract's "10 words or fewer").
pub const WHY_WORDS: usize = 10;

/// An assumption is kept up to this many words: the placer is asked for 8, and a reading longer than this is a
/// paragraph, not a glance.
pub const ASSUMED_WORDS: usize = 12;

/// What the placer read into a thought beyond its words, kept beside it on the map. Empty fields aren't written.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    /// The thought this one carries on, cut off from it by a pause: the map shows the two as one idea.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub continues: String,
    /// A reading the words left open ("'it' is the pottery class") that took the thought somewhere other than
    /// where its speaker was; only then, since otherwise it changed nothing.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub assumed: String,
    /// Why it went where it went, in at most `WHY_WORDS` words, naming the words that show it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub why: String,
}

impl Note {
    pub fn is_empty(&self) -> bool {
        self.continues.is_empty() && self.assumed.is_empty() && self.why.is_empty()
    }
}

/// The speaker's words a new thought may carry on: their turn just before (`before`), and an earlier turn of theirs
/// that trailed off (`left`), such as "I never finish my" before a tangent and "where was I?".
pub(crate) struct Heads<'a> {
    pub before: Option<&'a Thought>,
    pub left: Option<&'a Thought>,
}

/// What the new thought may carry on. `before`: the speaker's latest placed turn, said within `JUST_BEFORE_MS`
/// (a real session's turns came a median 31 s apart), unless it's the question `asked` (the prompt quotes that
/// already). `left`: their latest turn that trailed off and is still the last word on its thread, said within that
/// time too, or on the thread they're on now (they went back to it: "where was I?").
pub(crate) fn heads<'a>(world: &'a World, thought: &Thought, asked: Option<&Thought>) -> Heads<'a> {
    let theirs = || {
        world
            .thoughts
            .iter()
            .take_while(|t| t.id != thought.id)
            .filter(|t| t.placed && t.speaker == thought.speaker && t.at_ms <= thought.at_ms)
    };
    let recent = |t: &Thought| thought.at_ms.saturating_sub(t.at_ms) <= JUST_BEFORE_MS;
    let before = theirs().max_by_key(|t| t.at_ms).filter(|t| recent(t) && asked.is_none_or(|q| q.id != t.id));
    let last_on_its_thread = |t: &Thought| {
        !world.thoughts.iter().any(|o| o.placed && o.id != t.id && o.thread_id == t.thread_id && o.at_ms > t.at_ms)
    };
    let here = world.active_for(&thought.speaker);
    let left = theirs()
        .filter(|t| !t.complete)
        .max_by_key(|t| t.at_ms)
        .filter(|t| last_on_its_thread(t) && (recent(t) || t.thread_id.as_ref() == here))
        .filter(|t| before.is_none_or(|b| b.id != t.id));
    Heads { before, left }
}

impl Heads<'_> {
    /// The thought the placer said the new one carries on (`joins`: "before" or "unfinished"): only one said before
    /// it (a turn cut in two can't carry on its own first part), whose thread is still on the map. With one head in
    /// the prompt, either word means it: the turn just before that trailed off was read as "unfinished" in 3 of 3
    /// runs (2026-11-01).
    pub(crate) fn joined(&self, world: &World, thought: &Thought, joins: &str) -> Option<Thought> {
        let head = match joins.trim().to_lowercase().as_str() {
            "before" => self.before.or(self.left),
            "unfinished" => self.left.or(self.before),
            _ => None,
        }?;
        let thread = world.resolve(head.thread_id.as_deref()?);
        // Already carried on by another turn (one that failed to place, retried after another joined it): one idea
        // has one carrier, or the map could show neither the second link nor a way to take it apart.
        let free = carriers(world, &head.id).next().is_none();
        (free && head.at_ms < thought.at_ms && world.thread(&thread).is_some()).then(|| Thought { thread_id: Some(thread), ..head.clone() })
    }
}

/// The thoughts on the map that carry on `head` (`Note::continues`).
pub(crate) fn carriers<'a>(world: &'a World, head: &'a str) -> impl Iterator<Item = &'a Thought> + 'a {
    world.thoughts.iter().filter(move |t| world.notes.get(&t.id).is_some_and(|n| n.continues == head))
}

/// The note kept for a placement; `moved`: it took the thought away from where the speaker was (see `moved`). An
/// assumption is kept only then, since otherwise it changed nothing; a joined thought's link already says it.
pub(crate) fn note(head: Option<&Thought>, assumed: &str, why: &str, moved: bool) -> Note {
    // Models sometimes write nothing as "none" or "\"\"".
    let words = |text: &str, n: usize| match text.trim().to_lowercase().as_str() {
        "none" | "n/a" | "null" | "-" | "\"\"" => String::new(),
        _ => text.split_whitespace().take(n).collect::<Vec<_>>().join(" "),
    };
    Note {
        continues: head.map(|h| h.id.clone()).unwrap_or_default(),
        assumed: if head.is_none() && moved { words(assumed, ASSUMED_WORDS) } else { String::new() },
        why: words(why, WHY_WORDS),
    }
}

/// The "why here" worth showing: none for a new topic (its own thread is the answer; the model's reason there was
/// "new topic not rent birthday pottery"), and none that names a thread by id ("matches T9 landing", 4 of 30 on
/// 2026-11-01): ids mean nothing to the person.
pub(crate) fn why_here(why: &str, changes: &[Change]) -> String {
    let top = changes.iter().any(|c| matches!(c, Change::ThreadAdded { thread } if thread.parent_id.is_none()));
    let id = why.split(|c: char| !c.is_alphanumeric()).any(|w| {
        let mut chars = w.chars();
        matches!(chars.next(), Some('T' | 'S' | 'I')) && w.len() > 1 && chars.all(|c| c.is_ascii_digit())
    });
    if top || id { String::new() } else { why.to_string() }
}

/// Whether landing on `landed` takes the speaker away from `was`: another thread, or a new one that isn't a branch
/// of it (a branch of the thread you're on is where you were, a level down).
pub(crate) fn moved(world: &World, changes: &[Change], landed: &str, was: Option<&String>) -> bool {
    let Some(was) = was else { return true };
    let parent = changes.iter().find_map(|c| match c {
        Change::ThreadAdded { thread } if thread.id == landed => Some(thread.parent_id.as_ref()),
        _ => None,
    });
    landed != was && parent.flatten().is_none_or(|p| world.resolve(p) != world.resolve(was))
}

/// "Not one idea": the thought stops carrying on the words before it, and shows as a point of its own again where
/// it is. Its point said both parts ("I need to pay the electric bill"), the reading just taken back, so it becomes
/// its own words ("electric bill"); the rest of its note stays.
pub fn unlink(core: &Core, thought_id: &str) {
    let world = core.snapshot();
    let Some(note) = world.notes.get(thought_id).cloned().filter(|n| !n.continues.is_empty()) else { return };
    let own = world.thoughts.iter().find(|t| t.id == thought_id).map(|t| t.text.trim().to_string()).filter(|text| !text.is_empty());
    let mut changes = vec![Change::ThoughtNoted { thought_id: thought_id.into(), note: Note { continues: String::new(), ..note } }];
    changes.extend(own.map(|point| Change::ThoughtRepointed { thought_id: thought_id.into(), point }));
    // Its own words alone may no longer say a decision ("Priya on Wednesday night" without "Decided: I'll study with").
    let changes = crate::decided::remarked(&world, changes);
    drop(world);
    core.commit(changes);
}

#[cfg(test)]
mod tests {
    use super::{heads, moved, note, why_here, Note};
    use crate::world::{Change, Thought, Thread, ThreadStatus, World};

    fn thread(id: &str) -> Thread {
        Thread {
            id: id.into(),
            title: format!("Topic {id}"),
            parent_id: None,
            status: ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: Vec::new(),
            picture: None,
            dropped_by: String::new(),
        }
    }

    fn said(id: &str, thread: &str, at_s: u64, complete: bool) -> Thought {
        Thought {
            id: id.into(),
            speaker: "you".into(),
            text: format!("words {id}"),
            point: format!("point {id}"),
            thread_id: Some(thread.into()),
            placed: true,
            unclear: String::new(),
            guess: String::new(),
            heard: String::new(),
            fixed: String::new(),
            complete,
            at_ms: at_s * 1000,
            place_ms: Some(1),
            decided: false,
        }
    }

    fn new_turn(at_s: u64) -> Thought {
        Thought { placed: false, thread_id: None, ..said("now", "", at_s, true) }
    }

    fn world(thoughts: Vec<Thought>, here: &str) -> World {
        let mut w = World { threads: vec![thread("T1"), thread("T2"), thread("T3")], thoughts, ..World::default() };
        w.apply(&Change::ActiveChanged { thread_id: here.into(), speaker: "you".into() });
        w
    }

    #[test]
    fn the_turn_just_before_is_a_head_only_while_recent() {
        let w = world(vec![said("a", "T1", 100, true)], "T1");
        assert_eq!(heads(&w, &new_turn(110), None).before.map(|t| t.id.as_str()), Some("a"));
        assert!(heads(&w, &new_turn(100 + 121), None).before.is_none(), "over two minutes: the map's points say it");
        // The question just asked is quoted as that already.
        let asked = w.thoughts[0].clone();
        assert!(heads(&w, &new_turn(110), Some(&asked)).before.is_none());
    }

    /// "I never finish my", a tangent on the bike, "where was I?", then "Sentences.": the words left unfinished are a
    /// head, even with the tangent said just before.
    #[test]
    fn words_left_unfinished_are_a_head_across_a_tangent() {
        let w = world(vec![said("a", "T1", 37, false), said("b", "T2", 43, true)], "T1");
        let h = heads(&w, &new_turn(60), None);
        assert_eq!((h.before.map(|t| t.id.as_str()), h.left.map(|t| t.id.as_str())), (Some("b"), Some("a")));
        // Long ago, it's still a head while the speaker is back on its thread; not from elsewhere.
        assert_eq!(heads(&w, &new_turn(600), None).left.map(|t| t.id.as_str()), Some("a"));
        let away = world(w.thoughts.clone(), "T2");
        assert!(heads(&away, &new_turn(600), None).left.is_none());
        // Someone said more on that thread since: those words aren't the end of it any more.
        let more = world(vec![said("a", "T1", 37, false), said("c", "T1", 50, true), said("b", "T2", 55, true)], "T1");
        assert!(heads(&more, &new_turn(60), None).left.is_none());
        // Left unfinished just before: one head, `before`.
        let last = world(vec![said("a", "T1", 37, false)], "T1");
        let h = heads(&last, &new_turn(40), None);
        assert_eq!((h.before.map(|t| t.id.as_str()), h.left.is_none()), (Some("a"), true));
    }

    #[test]
    fn a_join_names_a_head_that_was_said_before_and_still_has_a_thread() {
        let w = world(vec![said("a", "T1", 37, false), said("b", "T2", 43, true)], "T1");
        let turn = new_turn(60);
        let h = heads(&w, &turn, None);
        assert_eq!(h.joined(&w, &turn, "unfinished").and_then(|t| t.thread_id), Some("T1".into()));
        assert_eq!(h.joined(&w, &turn, "before").map(|t| t.id), Some("b".into()));
        assert!(h.joined(&w, &turn, "none").is_none() && h.joined(&w, &turn, "").is_none());
        // One head: either word means it.
        let last = world(vec![said("a", "T1", 37, false)], "T1");
        assert_eq!(heads(&last, &turn, None).joined(&last, &turn, "unfinished").map(|t| t.id), Some("a".into()));
        // The rest of a turn cut in two shares its time: it can't carry on its own first part.
        let rest = Thought { at_ms: 43_000, ..new_turn(0) };
        assert!(heads(&w, &rest, None).joined(&w, &rest, "before").is_none());
        // Already carried on by another turn (this one failed to place, and its retry still sees `a` as just before):
        // one idea has one carrier.
        let mut carried = w.clone();
        carried.thoughts.push(said("c", "T1", 50, true));
        carried.apply(&Change::ThoughtNoted { thought_id: "c".into(), note: Note { continues: "a".into(), ..Note::default() } });
        let retry = super::Heads { before: Some(&carried.thoughts[0]), left: None };
        assert!(retry.joined(&carried, &turn, "before").is_none());
        assert_eq!(super::Heads { before: Some(&w.thoughts[0]), left: None }.joined(&w, &turn, "before").map(|t| t.id), Some("a".into()));
        // Merged meanwhile: it follows the merge.
        let mut merged = w.clone();
        merged.apply(&Change::ThreadMerged { from: "T1".into(), into: "T3".into() });
        assert_eq!(heads(&merged, &turn, None).joined(&merged, &turn, "unfinished").and_then(|t| t.thread_id), Some("T3".into()));
    }

    #[test]
    fn an_assumption_is_kept_only_when_it_moved_the_thought() {
        assert_eq!(note(None, "'it' is the pottery class", "", true).assumed, "'it' is the pottery class");
        assert_eq!(note(None, "'it' is the pottery class", "", false).assumed, "", "stayed where you were");
        let head = said("a", "T2", 1, false);
        let joined = note(Some(&head), "it finishes the sentence", "", true);
        assert_eq!((joined.continues.as_str(), joined.assumed.as_str()), ("a", ""), "the link says it");
    }

    #[test]
    fn why_is_cut_to_ten_words_and_empty_notes_are_nothing() {
        let n = note(None, "", "one two three four five six seven eight nine ten eleven twelve", true);
        assert_eq!(n.why, "one two three four five six seven eight nine ten");
        assert!(note(None, "", "  ", true).is_empty());
        assert!(note(None, "none", "\"\"", true).is_empty());
        assert_eq!(serde_json::to_value(Note { why: "names the lease".into(), ..Note::default() }).unwrap(), serde_json::json!({"why": "names the lease"}));
    }

    #[test]
    fn a_branch_of_where_you_were_is_not_a_move() {
        let w = world(Vec::new(), "T1");
        let here = Some("T1".to_string());
        let branch = |parent: Option<&str>| {
            vec![Change::ThreadAdded { thread: crate::world::Thread { id: "T4".into(), parent_id: parent.map(Into::into), ..thread("T4") } }]
        };
        assert!(!moved(&w, &[], "T1", here.as_ref()), "same thread");
        assert!(moved(&w, &[], "T2", here.as_ref()), "another thread");
        assert!(!moved(&w, &branch(Some("T1")), "T4", here.as_ref()), "a branch of it");
        assert!(moved(&w, &branch(Some("T2")), "T4", here.as_ref()) && moved(&w, &branch(None), "T4", here.as_ref()));
        assert!(moved(&w, &[], "T1", None), "nowhere before");
    }

    #[test]
    fn why_here_is_left_out_for_a_new_topic_and_for_thread_ids() {
        let added = |parent: Option<&str>| {
            vec![Change::ThreadAdded { thread: crate::world::Thread { parent_id: parent.map(Into::into), ..thread("T4") } }]
        };
        assert_eq!(why_here("names the lease", &[]), "names the lease");
        assert_eq!(why_here("the budget part of the trip", &added(Some("T1"))), "the budget part of the trip", "a branch says why");
        assert_eq!(why_here("new topic not rent", &added(None)), "");
        assert_eq!(why_here("\"takes three seconds\" matches T9 landing", &[]), "");
        assert_eq!(why_here("finishes 'never finish my' from S2", &[]), "");
        assert_eq!(why_here("names Thursday and I-95 traffic", &[]), "names Thursday and I-95 traffic");
    }

    /// Taken back ("not one idea"): the link goes, the why stays; a note with nothing left goes entirely.
    #[test]
    fn unlinking_keeps_the_rest_of_the_note() {
        let path = std::env::temp_dir().join(format!("e2a2o-chunks-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::world::Journal::open(&path).unwrap();
        let core = crate::Core::test(journal, world(vec![said("a", "T1", 1, false), said("b", "T1", 2, true)], "T1"));
        let noted = |continues: &str, why: &str| Change::ThoughtNoted {
            thought_id: "b".into(),
            note: Note { continues: continues.into(), assumed: String::new(), why: why.into() },
        };
        core.commit(vec![noted("a", "finishes the sentence")]);
        super::unlink(&core, "b");
        assert_eq!(core.snapshot().notes["b"], Note { why: "finishes the sentence".into(), ..Note::default() });
        core.commit(vec![noted("a", "")]);
        super::unlink(&core, "b");
        assert!(!core.snapshot().notes.contains_key("b"));
        // On replay too.
        let (_, replayed) = crate::world::Journal::open(&path).unwrap();
        assert!(!replayed.notes.contains_key("b"));
        let _ = std::fs::remove_file(&path);
    }

    /// "I need to pay the" + "electric bill" read as one point, "I need to pay the electric bill"; kept apart, that
    /// reading goes: the second part says its own words, here and as the card's last point (review, 2026-11-01).
    #[test]
    fn kept_apart_the_second_part_says_only_its_own_words() {
        let path = std::env::temp_dir().join(format!("e2a2o-chunks-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = crate::world::Journal::open(&path).unwrap();
        let mut w = world(vec![said("a", "T1", 1, false), said("b", "T1", 2, true)], "T1");
        w.thoughts[0].text = "I need to pay the".into();
        w.thoughts[1].text = "electric bill.".into();
        w.thoughts[1].point = "I need to pay the electric bill".into();
        w.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "I need to pay the electric bill".into(), at_ms: 2 });
        let core = crate::Core::test(journal, w);
        core.commit(vec![Change::ThoughtNoted { thought_id: "b".into(), note: Note { continues: "a".into(), ..Note::default() } }]);
        super::unlink(&core, "b");
        let after = core.snapshot();
        assert_eq!(after.thoughts[1].point, "electric bill.");
        assert_eq!(after.thread("T1").unwrap().last_point, "electric bill.");
        assert!(!after.notes.contains_key("b"));
        // Nothing joined: nothing changes.
        super::unlink(&core, "a");
        assert_eq!(core.snapshot().thoughts[0].point, "point a");
        let _ = std::fs::remove_file(&path);
    }

    /// "Scratch that" takes a joined part off the map; Undo brings it back joined, as the window still shows it
    /// (review, 2026-11-01).
    #[test]
    fn a_joined_part_scratched_and_brought_back_is_joined_again() {
        let mut w = world(vec![said("a", "T1", 1, false), said("b", "T1", 2, true)], "T1");
        w.apply(&Change::ThoughtNoted { thought_id: "b".into(), note: Note { continues: "a".into(), ..Note::default() } });
        let b = w.thoughts[1].clone();
        w.apply(&Change::ThoughtSkipped { thought_id: "b".into() });
        assert!(super::carriers(&w, "a").next().is_none(), "off the map, it carries nothing on");
        w.apply(&Change::ThoughtAdded { thought: b });
        assert_eq!(w.notes["b"].continues, "a");
    }

    /// A yes to "Did you mean Muse Spark?" on the first part also fixes the point that says both parts.
    #[test]
    fn a_fix_to_a_part_reaches_the_point_that_carries_it() {
        let mut w = world(vec![said("a", "T1", 1, false), said("b", "T1", 2, true)], "T1");
        w.thoughts[0].text = "ask muse bark about".into();
        w.thoughts[0].unclear = "muse bark".into();
        w.thoughts[0].guess = "Muse Spark".into();
        w.thoughts[1].point = "Ask muse bark about the lease".into();
        w.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "Ask muse bark about the lease".into(), at_ms: 2 });
        w.apply(&Change::ThoughtNoted { thought_id: "b".into(), note: Note { continues: "a".into(), ..Note::default() } });
        w.apply(&Change::ThoughtCorrected { thought_id: "a".into(), accept: true, with: String::new() });
        assert_eq!(w.thoughts[1].point, "Ask Muse Spark about the lease");
        assert_eq!(w.thread("T1").unwrap().last_point, "Ask Muse Spark about the lease");
        // A fix made without asking, taken back: the words as heard there too.
        w.thoughts[0].heard = "muse bark".into();
        w.thoughts[0].fixed = "Muse Spark".into();
        w.apply(&Change::ThoughtCorrected { thought_id: "a".into(), accept: false, with: String::new() });
        assert_eq!(w.thoughts[1].point, "Ask muse bark about the lease");
    }
}
