//! Host-owned, transient routing policy. No listener, model call or automatic replay.
//! The host supplies authenticated session IDs and registers this module separately.
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug, PartialEq)]
pub struct Drawing(pub Vec<Vec<[u16; 2]>>);
impl Drawing {
    fn valid(&self) -> bool {
        !self.0.is_empty() && self.0.len() <= 128
            && self.0.iter().map(Vec::len).sum::<usize>() <= 2048
            && self.0.iter().all(|s| !s.is_empty() && s.iter().all(|p| p[0] <= 1000 && p[1] <= 1000))
    }
}
#[derive(Clone, Debug, PartialEq)]
pub enum Content { Sketch(Drawing), Receipt, Reply(Drawing) }
#[derive(Clone, Debug, PartialEq)]
pub struct Message { pub exchange_id: String, pub from: String, pub to: String, pub content: Content }
struct Exchange { source: String, target: String, received: bool, replied: bool }
#[derive(Default)]
pub struct Relay { enabled: HashSet<String>, exchanges: HashMap<String, Exchange> }
impl Relay {
    pub fn set_enabled(&mut self, session: &str, enabled: bool) {
        if enabled { self.enabled.insert(session.into()); } else { self.enabled.remove(session); }
    }
    /// Returns one destination only. A queued sketch is not a receipt.
    pub fn route(&mut self, authenticated: &str, message: Message) -> Result<Message, &'static str> {
        if authenticated != message.from || message.from == message.to
            || [&message.from, &message.to, &message.exchange_id].iter().any(|s| s.is_empty() || s.len() > 128)
            || !self.enabled.contains(&message.from) || !self.enabled.contains(&message.to) {
            return Err("Session unavailable or exchange disabled");
        }
        match &message.content {
            Content::Sketch(drawing) => {
                if !drawing.valid() || self.exchanges.contains_key(&message.exchange_id)
                    || self.exchanges.values().filter(|e| e.source == authenticated || e.target == authenticated).count() >= 32
                    || self.exchanges.values().filter(|e| e.source == message.to || e.target == message.to).count() >= 32 {
                    return Err("Drawing invalid, exchange repeated or session full");
                }
                self.exchanges.insert(message.exchange_id.clone(), Exchange {
                    source: message.from.clone(), target: message.to.clone(), received: false, replied: false,
                });
            }
            Content::Receipt => {
                let e = self.exchanges.get_mut(&message.exchange_id).ok_or("Unknown exchange")?;
                if message.from == e.target && message.to == e.source { e.received = true; }
                else if !(message.from == e.source && message.to == e.target && e.replied) { return Err("Receipt has wrong session"); }
            }
            Content::Reply(drawing) => {
                let e = self.exchanges.get_mut(&message.exchange_id).ok_or("Unknown exchange")?;
                if !drawing.valid() || message.from != e.target || message.to != e.source || !e.received || e.replied {
                    return Err("Reply has no received source or wrong session");
                }
                e.replied = true;
            }
        }
        Ok(message)
    }
    /// Host calls when a session closes. No queued traffic survives reconnection.
    pub fn disconnect(&mut self, session: &str) {
        self.enabled.remove(session);
        self.exchanges.retain(|_, e| e.source != session && e.target != session);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn drawing() -> Drawing { Drawing(vec![vec![[20,30],[70,90]]]) }
    fn message(from: &str, to: &str, content: Content) -> Message {
        Message { exchange_id: "synthetic-1".into(), from: from.into(), to: to.into(), content }
    }
    #[test]
    fn selected_session_receives_then_returns_one_visual_reply() {
        let mut relay = Relay::default();
        let original = message("tablet", "tv", Content::Sketch(drawing()));
        assert!(relay.route("tablet", original.clone()).is_err());
        for id in ["tablet", "tv", "other"] { relay.set_enabled(id, true); }
        assert!(relay.route("other", original.clone()).is_err());
        assert_eq!(relay.route("tablet", original.clone()).unwrap(), original);
        assert!(relay.route("tv", message("tv", "tablet", Content::Reply(drawing()))).is_err());
        assert!(relay.route("other", message("other", "tablet", Content::Receipt)).is_err());
        assert!(relay.route("tv", message("tv", "tablet", Content::Receipt)).is_ok());
        assert!(relay.route("other", message("other", "tablet", Content::Reply(drawing()))).is_err());
        assert!(relay.route("tv", message("tv", "tablet", Content::Reply(drawing()))).is_ok());
        assert!(relay.route("tablet", message("tablet", "tv", Content::Receipt)).is_ok());
        assert!(relay.route("tv", message("tv", "tablet", Content::Reply(drawing()))).is_err());
        relay.disconnect("tv");
        assert!(relay.route("tv", message("tv", "tablet", Content::Receipt)).is_err());
        assert!(relay.exchanges.is_empty());
    }
    #[test]
    fn bounds_and_switch_are_enforced() {
        let mut relay = Relay::default();
        for id in ["tablet", "tv"] { relay.set_enabled(id, true); }
        for bad in [Drawing(vec![]), Drawing(vec![vec![]]), Drawing(vec![vec![[1001,0]]]), Drawing(vec![vec![[0,0];2049]])] {
            assert!(relay.route("tablet", message("tablet", "tv", Content::Sketch(bad))).is_err());
        }
        relay.set_enabled("tv", false);
        assert!(relay.route("tablet", message("tablet", "tv", Content::Sketch(drawing()))).is_err());
    }
}
