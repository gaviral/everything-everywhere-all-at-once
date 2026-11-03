//! Stay here: one journaled destination for the map, for every speaker, with no model or splitting.

use crate::protocol::ServerMsg;
use crate::world::{Change, Thought, World};
use crate::Core;

/// Only a whole-turn request counts; the same words inside a thought stay words.
pub fn command(text: &str) -> Option<bool> {
    if crate::is_command(text, &["stay here"], &[]) {
        Some(true)
    } else if crate::is_command(text, &["let go"], &[]) {
        Some(false)
    } else {
        None
    }
}

/// A button or spoken request. Validate under the commit's lock, including a merge or removal meanwhile.
pub fn set(core: &Core, speaker: &str, thread_id: Option<&str>) -> bool {
    loop {
        let world = core.snapshot();
        let id = thread_id.map(|id| world.resolve(id));
        let title = match id.as_deref() {
            Some(id) => match world.thread(id) {
                Some(thread) => Some(thread.title.clone()),
                None => {
                    core.send_to(speaker, ServerMsg::Notice { message: "Choose a topic, then say “stay here”.".into() });
                    return false;
                }
            },
            None => None,
        };
        if core.commit_if(
            |w| id.as_deref().is_none_or(|id| w.thread(id).is_some()),
            vec![Change::StayChanged { thread_id: id.clone() }],
        ) {
            let message = title.map(|title| format!("Staying here: {title}. Everyone's new thoughts land here whole."))
                .unwrap_or_else(|| "Let go: new thoughts find their own topics again.".into());
            core.send_to(speaker, ServerMsg::Notice { message });
            return true;
        }
    }
}

/// A pinned thought keeps every word as its point, with no guess, summary, join, skip or split.
pub fn placement(world: &World, thought: &Thought) -> Option<Vec<Change>> {
    let id = world.stay_here.as_ref().filter(|id| world.thread(id).is_some())?;
    Some(vec![
        Change::ThoughtPlaced {
            thought_id: thought.id.clone(), thread_id: id.clone(), point: thought.text.clone(),
            unclear: String::new(), guess: String::new(), heard: String::new(), fixed: String::new(),
            complete: true, place_ms: crate::now_ms().saturating_sub(thought.at_ms),
            decided: crate::decided::said(&thought.text),
        },
        Change::ThreadTouched { thread_id: id.clone(), last_point: thought.text.clone(), at_ms: crate::now_ms() },
        Change::ActiveChanged { thread_id: id.clone(), speaker: thought.speaker.clone() },
        Change::ThoughtNoted { thought_id: thought.id.clone(), note: crate::chunks::Note { why: "kept whole by Stay here".into(), ..Default::default() } },
    ])
}

/// A queued thought (including one waiting when a pin was set or a journal reopened) lands without a model.
pub fn place_waiting(core: &Core, thought_id: &str) -> bool {
    loop {
        let world = core.snapshot();
        let Some(thought) = world.thoughts.iter().find(|t| t.id == thought_id && !t.placed) else { return false };
        let Some(changes) = placement(&world, thought) else { return false };
        if core.commit_if(
            |w| w.stay_here == world.stay_here && w.thoughts.iter().any(|t| t.id == thought_id && !t.placed),
            changes.clone(),
        ) {
            core.new_threads.cancel(&thought.speaker);
            core.new_threads.placed(thought_id, &changes, None);
            return true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_whole_turns_pin_and_release() {
        for text in ["Stay here", "Stay here!", "Please stay here.", "Can you stay here?"] {
            assert_eq!(command(text), Some(true), "{text}");
        }
        for text in ["Let go", "Let go, please.", "Hey, let go!"] {
            assert_eq!(command(text), Some(false), "{text}");
        }
        for text in ["We should stay here tonight", "I need to let go of that idea", "Let go of the rope", "Don't stay here"] {
            assert_eq!(command(text), None, "{text}");
        }
    }
}
