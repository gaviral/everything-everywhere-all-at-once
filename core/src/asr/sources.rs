//! Session-local speech identity. Words never select an identity.
use crate::{world::SpeechDraft, Core};
use serde_json::Value;

#[derive(Default)]
pub(super) struct Sources(Vec<Source>);

struct Source {
    draft: SpeechDraft,
    aliases: Vec<Value>,
    start: Option<u64>,
    first: Option<u64>,
    latest: Option<u64>,
    finished: bool,
    final_at: Option<u64>,
}

impl Sources {
    /// Bind service IDs to a local source using a speech boundary or stream audio position.
    /// With neither, only a single anonymous pending source is safe to adopt a new final ID.
    fn source(&mut self, speaker: &str, event: &Value) -> usize {
        let at = event["audioProcessedMs"].as_u64();
        let alias = event.get("turnId").filter(|id| id.is_number() || id.is_string());
        let starting = event["type"] == "speechStart";
        let known = alias.and_then(|id| self.0.iter().rposition(|s| s.aliases.contains(id)));
        let selected = if starting {
            // Repeated boundary, or a delayed start for the same still-open source.
            at.and_then(|at| self.0.iter().rposition(|s| s.start == Some(at)
                && alias.is_none_or(|id| s.aliases.is_empty() || s.aliases.contains(id))))
                .or_else(|| known.filter(|&i| {
                    let s = &self.0[i];
                    at.is_none() || (s.start.is_none() && at <= s.first)
                }))
        } else {
            known.filter(|&i| {
                let s = &self.0[i];
                // Later audio outside a completed source may be a new utterance even if an ID is reused.
                !(s.finished && at.zip(s.final_at).is_some_and(|(a, end)| a > end))
            }).or_else(|| at.and_then(|at| {
                // A completion receipt's position also identifies ID-less / renamed duplicate events.
                self.0.iter().position(|s| s.final_at == Some(at)
                    && alias.is_none_or(|id| s.aliases.is_empty() || s.aliases.contains(id)))
                    .or_else(|| self.0.iter().enumerate()
                        .filter(|(_, s)| s.start.or(s.first).is_some_and(|begin| begin <= at)
                            && (!s.finished || (s.final_at.is_some_and(|end| at <= end)
                                && alias.is_none_or(|id| s.aliases.is_empty() || s.aliases.contains(id)))))
                        .max_by_key(|(_, s)| s.start.or(s.first)).map(|(i, _)| i))
            })).or_else(|| {
                let pending: Vec<_> = self.0.iter().enumerate().filter(|(_, s)| !s.finished).collect();
                if let [(i, s)] = pending.as_slice() {
                    // No jumping across an intervening turn. A changed ID without timing is ambiguous.
                    if *i + 1 == self.0.len() && (alias.is_none() || s.aliases.is_empty())
                        && at.zip(s.start).is_none_or(|(at, begin)| at >= begin) {
                        return Some(*i);
                    }
                }
                None
            })
        };
        let index = selected.unwrap_or_else(|| {
            self.0.push(Source {
                draft: SpeechDraft { id: uuid::Uuid::new_v4().to_string(), speaker: speaker.into(), text: String::new() },
                aliases: vec![], start: None, first: at, latest: None, finished: false, final_at: None,
            });
            self.0.len() - 1
        });
        let source = &mut self.0[index];
        if let Some(id) = alias {
            if !source.aliases.contains(id) { source.aliases.push(id.clone()); }
        }
        if starting { source.start = at.or(source.start); }
        index
    }

    pub(super) fn boundary(&mut self, speaker: &str, event: &Value) {
        self.source(speaker, event);
    }

    /// None means a late partial of an already completed source, or an older cumulative draft.
    pub(super) fn words(&mut self, speaker: &str, event: &Value, words: &str, complete: bool) -> Option<String> {
        let index = self.source(speaker, event);
        let source = &mut self.0[index];
        let at = event["audioProcessedMs"].as_u64();
        if source.finished { return if complete { Some(source.draft.id.clone()) } else { None }; }
        if !complete && at.zip(source.latest).is_some_and(|(at, latest)| at < latest) { return None; }
        source.draft.text = words.into();
        source.latest = at.or(source.latest);
        if complete { source.finished = true; source.final_at = at; }
        Some(source.draft.id.clone())
    }

    pub(super) fn partial(&self) -> &str {
        self.0.iter().rev().find(|s| !s.finished && !s.draft.text.is_empty())
            .map_or("", |s| s.draft.text.as_str())
    }

    pub(super) fn recover(&self, core: &Core) {
        for source in &self.0 {
            if !source.draft.text.trim().is_empty() { core.remember_speech(source.draft.clone()); }
        }
    }

    pub(super) fn checkpoint(&self, core: &Core) {
        for source in &self.0 {
            if !source.finished && !source.draft.text.trim().is_empty() {
                core.checkpoint_speech(source.draft.clone());
            }
        }
    }
}
