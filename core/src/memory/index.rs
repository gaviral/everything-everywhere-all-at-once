use crate::world::{Change, Thought, World};
use std::collections::{BTreeSet, HashMap, HashSet};

pub(super) fn words(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
        .collect()
}

pub(super) fn hashtags(text: &str) -> HashSet<String> {
    text.split('#')
        .skip(1)
        .filter_map(|part| {
            let tag: String = part
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            (!tag.is_empty()).then(|| tag.to_lowercase())
        })
        .collect()
}

pub(super) struct Document {
    pub thought: Thought,
    pub line: String,
    terms: HashSet<String>,
    tags: HashSet<String>,
}

#[derive(Default)]
pub(super) struct Index {
    pub documents: Vec<Option<Document>>,
    ids: HashMap<String, usize>,
    words: HashMap<String, HashSet<usize>>,
    tags: HashMap<String, HashSet<usize>>,
    topics: HashMap<String, HashSet<usize>>,
    recent: BTreeSet<(u64, usize)>,
    pub bytes: usize,
}

impl Index {
    pub fn from_world(world: &World) -> Self {
        let mut index = Self::default();
        for thought in &world.thoughts {
            index.upsert(thought, world);
        }
        index
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    fn upsert(&mut self, thought: &Thought, world: &World) {
        let slot = self
            .ids
            .get(&thought.id)
            .copied()
            .unwrap_or(self.documents.len());
        self.remove(&thought.id);
        let topic = thought.thread_id.as_deref().and_then(|id| world.thread(id));
        let mut terms = words(&thought.text);
        terms.extend(words(&thought.point));
        let mut tags = hashtags(&thought.text);
        if let Some(topic) = topic {
            terms.extend(words(&topic.title));
            tags.extend(
                topic
                    .tags
                    .iter()
                    .map(|tag| tag.name.trim_start_matches('#').to_lowercase()),
            );
        }
        let line = format!(
            "{} [{}]: {}\n",
            thought.id,
            thought.thread_id.as_deref().unwrap_or("pending"),
            thought.text
        );
        for term in &terms {
            self.words.entry(term.clone()).or_default().insert(slot);
        }
        for tag in &tags {
            self.tags.entry(tag.clone()).or_default().insert(slot);
        }
        if let Some(topic) = &thought.thread_id {
            self.topics.entry(topic.clone()).or_default().insert(slot);
        }
        self.recent.insert((thought.at_ms, slot));
        self.bytes += line.len();
        self.ids.insert(thought.id.clone(), slot);
        let document = Some(Document {
            thought: thought.clone(),
            line,
            terms,
            tags,
        });
        if slot == self.documents.len() {
            self.documents.push(document);
        } else {
            self.documents[slot] = document;
        }
    }

    fn remove(&mut self, id: &str) {
        let Some(slot) = self.ids.remove(id) else {
            return;
        };
        let Some(document) = self.documents[slot].take() else {
            return;
        };
        for term in document.terms {
            remove_posting(&mut self.words, &term, slot);
        }
        for tag in document.tags {
            remove_posting(&mut self.tags, &tag, slot);
        }
        if let Some(topic) = document.thought.thread_id {
            remove_posting(&mut self.topics, &topic, slot);
        }
        self.recent.remove(&(document.thought.at_ms, slot));
        self.bytes -= document.line.len();
    }

    fn refresh(&mut self, id: &str, world: &World) {
        match world.thoughts.iter().rev().find(|t| t.id == id) {
            Some(thought) => self.upsert(thought, world),
            None => self.remove(id),
        }
    }

    fn refresh_thread(&mut self, thread: &str, world: &World) {
        for thought in world
            .thoughts
            .iter()
            .filter(|t| t.thread_id.as_deref() == Some(thread))
        {
            self.upsert(thought, world);
        }
    }

    pub fn changed(&mut self, change: &Change, world: &World) -> bool {
        match change {
            Change::ThoughtAdded { thought } => self.refresh(&thought.id, world),
            Change::ThoughtSplit {
                thought_id, rest, ..
            } => {
                self.refresh(thought_id, world);
                self.refresh(&rest.id, world);
            }
            Change::ThoughtPlaced { thought_id, .. }
            | Change::ThoughtMoved { thought_id, .. }
            | Change::ThoughtCorrected { thought_id, .. }
            | Change::ThoughtRepointed { thought_id, .. }
            | Change::ThoughtSkipped { thought_id } => self.refresh(thought_id, world),
            Change::ThreadAdded { thread } => self.refresh_thread(&thread.id, world),
            Change::ThreadRenamed { thread_id, .. }
            | Change::ThreadRetitled { thread_id, .. }
            | Change::TitleChosen { thread_id, .. }
            | Change::TagSuggested { thread_id, .. }
            | Change::TagKept { thread_id, .. }
            | Change::TagRemoved { thread_id, .. } => self.refresh_thread(thread_id, world),
            Change::ThreadRemoved { .. }
            | Change::ThreadMerged { .. }
            | Change::ThreadUnmerged { .. } => *self = Self::from_world(world),
            _ => return false,
        }
        true
    }

    /// Inverted postings, with a dense score array: common words still touch only
    /// matching documents. Ranking uses integer weights and deterministic recency.
    pub fn lookup(&self, query: &str, topic: Option<&str>, exclude: Option<&str>) -> Vec<usize> {
        let mut scores = vec![0u32; self.documents.len()];
        let terms = words(query);
        for word in &terms {
            if let Some(posting) = self.words.get(word) {
                let weight = 10 + (self.len() / posting.len().max(1)).min(100) as u32;
                for &slot in posting {
                    scores[slot] += weight;
                }
            }
        }
        for tag in hashtags(query) {
            if let Some(posting) = self.tags.get(&tag) {
                for &slot in posting {
                    scores[slot] += 200;
                }
            }
        }
        if let Some(posting) = topic.and_then(|topic| self.topics.get(topic)) {
            for &slot in posting {
                scores[slot] += 8;
            }
        }
        for &(_, slot) in self.recent.iter().rev().take(2) {
            scores[slot] += 1;
        }
        let mut ranked: Vec<usize> = scores
            .iter()
            .enumerate()
            .filter_map(|(slot, &score)| {
                let doc = self.documents[slot].as_ref()?;
                (score > 0 && Some(doc.thought.id.as_str()) != exclude && doc.thought.placed)
                    .then_some(slot)
            })
            .collect();
        ranked.sort_unstable_by_key(|&slot| {
            let doc = self.documents[slot].as_ref().unwrap();
            std::cmp::Reverse((scores[slot], doc.thought.at_ms, slot))
        });
        ranked.truncate(64);
        ranked
    }

    pub fn coverage(&self, slot: usize, query: &HashSet<String>) -> HashSet<String> {
        let document = self.documents[slot].as_ref().unwrap();
        document
            .terms
            .intersection(query)
            .chain(document.tags.intersection(query))
            .cloned()
            .collect()
    }
}

fn remove_posting(postings: &mut HashMap<String, HashSet<usize>>, term: &str, slot: usize) {
    if let Some(posting) = postings.get_mut(term) {
        posting.remove(&slot);
        if posting.is_empty() {
            postings.remove(term);
        }
    }
}
