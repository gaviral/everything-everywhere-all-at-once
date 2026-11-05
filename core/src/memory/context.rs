use super::index::{hashtags, words, Index};
use crate::world::{Thought, World};
use std::{collections::HashSet, time::Instant};

const MAX_THOUGHTS: usize = 8;
const MAX_BYTES: usize = 12 * 1024;

#[derive(Clone, Default)]
pub(crate) struct Context {
    pub thought_ids: HashSet<String>,
    pub thread_ids: HashSet<String>,
    pub notes: String,
    pub bytes_saved: usize,
    pub lookup_us: u64,
}

impl Context {
    pub(super) fn prepare_placement(
        &mut self,
        world: &World,
        thought: &Thought,
        model: &str,
        room: u32,
        new_thread: bool,
    ) {
        self.keep_continuity(world, thought);
        let full =
            crate::placer::request_with_context(world, thought, model, room, new_thread, None);
        let selected = crate::placer::request_with_context(
            world,
            thought,
            model,
            room,
            new_thread,
            Some(self),
        );
        self.bytes_saved = full
            .to_string()
            .len()
            .saturating_sub(selected.to_string().len());
    }

    fn keep_continuity(&mut self, world: &World, thought: &Thought) {
        let mut pending: Vec<String> = crate::placer::candidates(world, thought)
            .into_iter()
            .map(|c| c.thread_id)
            .collect();
        pending.extend(self.thread_ids.iter().cloned());
        let mut seen = HashSet::new();
        while let Some(id) = pending.pop() {
            if !seen.insert(id.clone()) {
                continue;
            }
            self.thread_ids.insert(id.clone());
            pending.extend(world.thread(&id).and_then(|t| t.parent_id.clone()));
        }
    }
}

pub(super) fn normalized(query: &str) -> String {
    query
        .trim()
        .trim_end_matches(|c: char| c.is_ascii_punctuation())
        .to_lowercase()
}

/// Greedy term coverage: another thought earns space only for an uncovered word,
/// or to supply the current topic's newest context. Recency breaks score ties.
pub(super) fn select(
    index: &Index,
    query: &str,
    topic: Option<&str>,
    exclude: Option<&str>,
) -> Context {
    let started = Instant::now();
    let mut query_words = words(query);
    query_words.extend(hashtags(query));
    let ranked = index.lookup(query, topic, exclude);
    let mut context = Context::default();
    let mut covered = HashSet::new();
    let mut topic_seen = false;
    for slot in ranked {
        let doc = index.documents[slot].as_ref().unwrap();
        let coverage = index.coverage(slot, &query_words);
        let same_topic = topic.is_some() && doc.thought.thread_id.as_deref() == topic;
        let adds_words = coverage.iter().any(|word| !covered.contains(word));
        if !context.thought_ids.is_empty() && !adds_words && (!same_topic || topic_seen) {
            continue;
        }
        if context.notes.len() + doc.line.len() > MAX_BYTES {
            continue;
        }
        covered.extend(coverage);
        topic_seen |= same_topic;
        context.thought_ids.insert(doc.thought.id.clone());
        context.thread_ids.extend(doc.thought.thread_id.clone());
        context.notes.push_str(&doc.line);
        if context.thought_ids.len() == MAX_THOUGHTS {
            break;
        }
    }
    context.bytes_saved = index.bytes.saturating_sub(context.notes.len());
    context.lookup_us = started.elapsed().as_micros() as u64;
    context
}
