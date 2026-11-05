//! Deterministic, bounded anchors and command speech. No model calls or saved replies.
use crate::world::World;

/// Keep complete words where possible, and always respect a Unicode character limit.
pub fn brief(text: &str, words: usize, chars: usize) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>();
    let mut out = String::new();
    for word in clean.iter().take(words) {
        let extra = usize::from(!out.is_empty());
        if out.chars().count() + extra + word.chars().count() > chars {
            if out.is_empty() { out = word.chars().take(chars.saturating_sub(1)).collect(); }
            break;
        }
        if extra > 0 { out.push(' '); }
        out.push_str(word);
    }
    if out != clean.join(" ") && chars > 0 {
        if out.chars().count() == chars { out.pop(); }
        out.push('…');
    }
    out
}

/// Prefer this person's unfinished words, then their latest words, then the topic's latest point.
/// A placed continuation supersedes its head; only the last part can still be unfinished.
/// Original text is the anchor; the compressed point is only a fallback for older records.
pub fn anchor(world: &World, speaker: &str, id: &str, lead: &str, now: u64) -> (Option<String>, String) {
    let id = world.resolve(id);
    let on_topic = |t: &&crate::world::Thought| t.placed
        && t.thread_id.as_deref().is_some_and(|thread| world.resolve(thread) == id);
    let continued: std::collections::HashSet<&str> = world.thoughts.iter().filter(on_topic)
        .filter_map(|t| world.notes.get(&t.id)).map(|n| n.continues.as_str()).collect();
    let latest = |own: bool, unfinished: bool| world.thoughts.iter().filter(on_topic)
        .filter(|t| !continued.contains(t.id.as_str()))
        .filter(|t| (!own || t.speaker == speaker) && (!unfinished || !t.complete))
        .max_by_key(|t| t.said_at(now));
    let thought = latest(true, true).or_else(|| latest(true, false)).or_else(|| latest(false, false));
    let title = world.thread(&id).map(|t| t.title.as_str()).unwrap_or("this topic");
    let mut message = format!("{lead} {}", brief(title, 12, 100));
    if let Some(t) = thought {
        let words = if t.text.trim().is_empty() { &t.point } else { &t.text };
        let quote = brief(words, 40, 240);
        if !quote.is_empty() { message.push_str(&format!(": “{quote}”")); }
    }
    (thought.map(|t| t.id.clone()), message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunks::Note;
    use crate::world::{Thought, Thread, ThreadStatus};

    fn demo() -> World {
        let said = |id: &str, text: &str, at_ms, complete| Thought {
            id: id.into(), speaker: "you".into(), text: text.into(), point: "Demo script".into(),
            thread_id: Some("demo".into()), placed: true, unclear: String::new(),
            guess: String::new(), heard: String::new(), fixed: String::new(), complete,
            at_ms, place_ms: None, decided: false,
        };
        World {
            threads: vec![Thread {
                id: "demo".into(), title: "Demo".into(), parent_id: None, status: ThreadStatus::Open,
                last_point: String::new(), touched_ms: 0, tags: vec![], picture: None, dropped_by: String::new(),
            }],
            thoughts: vec![said("head", "Before the demo I need to", 1, false),
                said("tail", "finish the script.", 2, true)],
            notes: [("tail".into(), Note { continues: "head".into(), ..Note::default() })].into(),
            ..World::default()
        }
    }

    #[test]
    fn completed_continuation_replaces_the_obsolete_unfinished_anchor() {
        let mut world = demo();
        assert_eq!(anchor(&world, "you", "demo", "You're on", 10),
            (Some("tail".into()), "You're on Demo: “finish the script.”".into()));
        let mut latest = world.thoughts[1].clone();
        latest.id = "latest".into();
        latest.at_ms = 3;
        latest.text = "Then rehearse the demo.".into();
        world.thoughts.push(latest);
        assert_eq!(anchor(&world, "you", "demo", "Back to", 10),
            (Some("latest".into()), "Back to Demo: “Then rehearse the demo.”".into()));
    }

    #[test]
    fn unfinished_continuation_uses_its_tail_and_unlink_restores_the_head() {
        let mut world = demo();
        world.thoughts[1].complete = false;
        world.thoughts[1].text = "finish the script before".into();
        // A newer complete turn must not hide the remaining unfinished words.
        let mut newer = world.thoughts[1].clone();
        newer.id = "newer".into();
        newer.at_ms = 3;
        newer.complete = true;
        world.thoughts.push(newer);
        assert_eq!(anchor(&world, "you", "demo", "Back to", 10),
            (Some("tail".into()), "Back to Demo: “finish the script before”".into()));
        world.notes.clear();
        world.thoughts[1].complete = true;
        assert_eq!(anchor(&world, "you", "demo", "Back to", 10).0.as_deref(), Some("head"));
    }

    #[test]
    fn completed_chain_supersedes_all_its_heads_but_pending_words_do_not() {
        let mut world = demo();
        world.thoughts[1].complete = false;
        let mut end = world.thoughts[1].clone();
        end.id = "end".into();
        end.at_ms = 3;
        end.complete = true;
        world.thoughts.push(end);
        world.notes.insert("end".into(), Note { continues: "tail".into(), ..Note::default() });
        assert_eq!(anchor(&world, "you", "demo", "Back to", 10).0.as_deref(), Some("end"));
        world.thoughts[2].placed = false;
        assert_eq!(anchor(&world, "you", "demo", "Back to", 10).0.as_deref(), Some("tail"));
    }

    #[test]
    fn completed_chain_does_not_hide_another_speakers_unfinished_words() {
        let mut world = demo();
        let mut own = world.thoughts[0].clone();
        own.id = "own".into();
        own.speaker = "Colleague".into();
        own.text = "The lighting still needs".into();
        world.thoughts.push(own);
        assert_eq!(anchor(&world, "Colleague", "demo", "Back to", 10),
            (Some("own".into()), "Back to Demo: “The lighting still needs”".into()));
    }

    #[test]
    fn bounds_words_characters_and_unicode_without_empty_speech() {
        assert_eq!(brief("  a\n b  ", 60, 400), "a b");
        assert_eq!(brief("a b c d", 2, 400), "a b…");
        assert_eq!(brief("abcdefgh", 60, 5), "abcd…");
        assert_eq!(brief("界".repeat(500).as_str(), 60, 400).chars().count(), 400);
        assert_eq!(brief("  ", 60, 400), "");
        assert!(brief(&"word ".repeat(100), 60, 400).split_whitespace().count() <= 60);
    }
}
