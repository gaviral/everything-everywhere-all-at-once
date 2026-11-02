//! Decisions said out loud: "Decided: I'll study with Priya", "let's go with Thursday", "it's settled". Found by rule
//! in the words as said, with no model call, so a decision is recorded the moment it's placed, the same way every
//! time, and Recap can lead with it (recap.rs). The mark is the person's own word echoed back, never a guess: a
//! point is marked only when the words say they decided, and near misses ("I can't decide", "we'll decide later",
//! "should I go with the blue one?") stay plain points. A choice made without saying so ("booking it tonight") is
//! left to Recap's model, which reads every point.

use crate::world::{Change, Thought, World};

/// Words that, said before a marker in the same clause, make it not (yet) a decision: "I haven't decided", "if
/// we go with", "nothing's settled". Any word ending in "n't" counts too.
const NOT: [&str; 18] = [
    "not", "never", "no", "nothing", "nothing's", "if", "whether", "once", "until", "unless", "when", "cannot", "still", "yet",
    "undecided", "almost", "nearly", "who",
];

/// Before "go with" and its kin, words that make it a leaning, not a choice: "I'll probably go with", "should I go with".
const UNSURE: [&str; 12] =
    ["maybe", "might", "could", "should", "probably", "perhaps", "thinking", "leaning", "considering", "wondering", "possibly", "may"];

/// Before "decided" only: a decision still to come ("we'll have decided", "it will be decided").
const LATER: [&str; 3] = ["will", "gonna", "going"];

/// The markers, each as words in a row. `strict`: unsure words before it ("maybe", "should") undo it too.
const MARKERS: [(&[&str], bool); 28] = [
    (&["decided"], false),
    (&["decision", "made"], false),
    (&["made", "a", "decision"], false),
    (&["made", "the", "decision"], false),
    (&["made", "my", "decision"], false),
    (&["made", "our", "decision"], false),
    (&["my", "decision", "is"], false),
    (&["our", "decision", "is"], false),
    (&["final", "decision"], false),
    (&["final", "answer"], false),
    (&["made", "up", "my", "mind"], false),
    (&["made", "my", "mind", "up"], false),
    (&["mind", "is", "made", "up"], false),
    (&["mind's", "made", "up"], false),
    (&["it's", "settled"], false),
    (&["that's", "settled"], false),
    (&["settled", "on"], true),
    (&["let's", "go", "with"], true),
    (&["i'll", "go", "with"], true),
    (&["we'll", "go", "with"], true),
    (&["gonna", "go", "with"], true),
    (&["i'm", "going", "with"], true),
    (&["we're", "going", "with"], true),
    (&["i", "went", "with"], true),
    (&["i", "chose"], true),
    (&["we", "chose"], true),
    (&["we", "agreed"], true),
    (&["i", "picked"], true),
];

/// After a "go with" marker, a person to go along with, not a choice: "I'm going with you to the store".
const PEOPLE: [&str; 7] = ["you", "me", "him", "her", "them", "us", "everyone"];

/// A sentence opening like a question is one, even when the transcript left off its "?": "have you decided".
const ASKS: [&str; 16] =
    ["have", "has", "did", "do", "does", "what", "which", "who", "how", "why", "should", "shall", "can", "could", "would", "are"];

/// Words people open a sentence with before what they mean ("Okay, have you decided", "So did we settle on"): passed
/// over before asking whether the sentence opens like a question, and when finding who decided.
const LEADS: [&str; 20] = [
    "okay", "ok", "so", "well", "and", "but", "um", "uh", "hmm", "oh", "alright", "right", "yeah", "yes", "hey", "anyway",
    "actually", "wait", "like", "then",
];

/// Words that may stand between who decided and the marker: "I have finally decided", "we've all made a decision".
const BETWEEN: [&str; 16] = [
    "have", "has", "had", "finally", "just", "already", "also", "officially", "now", "really", "all", "both", "basically", "today",
    "tonight", "yesterday",
];

/// Who a marker without its own "I" or "we" may follow: the person ("I decided", "my final decision"), the matter
/// itself ("it's decided", "that is settled"), or nothing ("Decided: …"). Anyone else ("Mom decided", "he made the
/// decision") made someone else's choice, and Recap would say "You decided" about it.
const SELF: [&str; 16] =
    ["i", "we", "i've", "we've", "i'd", "we'd", "my", "our", "me", "us", "it", "it's", "that", "that's", "is", "was"];

/// Whether the words say a decision was made. Sentence by sentence: a question is never one ("did we decide?"), and
/// a sentence counts when a marker is in it with nothing before it, in that sentence, that takes it back.
pub fn said(text: &str) -> bool {
    let text = text.to_lowercase().replace(['’', '‘'], "'");
    let mut start = 0;
    for (i, c) in text.char_indices().chain([(text.len(), '.')]) {
        if !matches!(c, '.' | '!' | '?' | ';' | '\n') {
            continue;
        }
        let sentence = &text[start..i];
        start = i + c.len_utf8().min(text.len() - i);
        if c != '?' && decides(sentence) {
            return true;
        }
    }
    false
}

fn decides(sentence: &str) -> bool {
    // A clause at a time, so words before a comma don't reach a marker after it: in "Actually no wait, I decided:
    // Lisbon" the "no" was about something else.
    let clauses: Vec<Vec<&str>> = sentence.split([',', '—', '–', ':']).map(words).collect();
    // "Okay, have you decided" opens like a question once its lead-in is passed over.
    if clauses.iter().flatten().find(|w| !LEADS.contains(w)).is_some_and(|w| ASKS.contains(w)) {
        return false;
    }
    clauses.iter().any(|words| (0..words.len()).any(|i| MARKERS.iter().any(|(marker, strict)| marks(words, i, marker, *strict))))
}

fn words(clause: &str) -> Vec<&str> {
    clause
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '$'))
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
        .collect()
}

/// Whether `marker` starts at word `i` of a clause with nothing before it, in that clause, that takes it back.
fn marks(words: &[&str], i: usize, marker: &[&str], strict: bool) -> bool {
    if !words[i..].starts_with(marker) {
        return false;
    }
    let before = &words[..i];
    let negated = before.iter().any(|w| NOT.contains(w) || w.ends_with("n't"));
    let unsure = strict && before.iter().any(|w| UNSURE.contains(w));
    // "decided" only: one still to come ("we'll have decided", "to be decided") or not yet ("decided yet").
    let later = marker[0] == "decided"
        && (before.iter().any(|w| LATER.contains(w) || w.ends_with("'ll"))
            || before.ends_with(&["to", "be"])
            || words.get(i + 1) == Some(&"yet"));
    let along = marker.last() == Some(&"with") && words.get(i + marker.len()).is_some_and(|w| PEOPLE.contains(w));
    // "I picked the kids up", "I picked up milk": a pickup, not a pick.
    let pickup = marker.last() == Some(&"picked") && words[i + marker.len()..].iter().take(3).any(|w| *w == "up");
    // A marker with no "I" or "we" of its own counts only after the person, the matter or nothing (`SELF`).
    let someone_else = ["decided", "decision", "made", "final", "settled"].contains(&marker[0])
        && before.iter().rev().find(|w| !BETWEEN.contains(w) && !LEADS.contains(w)).is_some_and(|w| !SELF.contains(w));
    !(negated || unsure || later || along || pickup || someone_else)
}

/// The words a thought says, read on from the head it carries on across a pause (chunks.rs), so "Decided: I'll
/// study with" … "Priya on Wednesday night" is one decision, and so is "Okay, decided:" … "the red one".
pub fn said_after(head: Option<&str>, text: &str) -> bool {
    match head {
        Some(head) => said(&format!("{} {}", head.trim(), text.trim())),
        None => said(text),
    }
}

/// Whether a thought on the map says a decision, read on from the head its note says it carries on.
pub fn on_map(world: &World, thought: &Thought) -> bool {
    let head = world
        .notes
        .get(&thought.id)
        .map(|n| n.continues.as_str())
        .filter(|id| !id.is_empty())
        .and_then(|id| world.thoughts.iter().find(|t| t.id == id));
    said_after(head.map(|h| h.text.as_str()), &thought.text)
}

/// `changes`, then a `ThoughtDecided` for each placed thought whose mark they change: a correction ("We divided" →
/// "We decided"), its undo, or a join taken apart changes the words the mark was read from. Only the thoughts the
/// changes name, and the ones carrying those on, are read again.
pub fn remarked(world: &World, mut changes: Vec<Change>) -> Vec<Change> {
    let mut after = world.clone();
    let mut named = Vec::new();
    for change in &changes {
        after.apply(change);
        if let Change::ThoughtCorrected { thought_id, .. } | Change::ThoughtNoted { thought_id, .. } | Change::ThoughtRepointed { thought_id, .. } =
            change
        {
            named.push(thought_id.clone());
        }
    }
    let carriers: Vec<String> = named.iter().flat_map(|id| crate::chunks::carriers(&after, id).map(|t| t.id.clone())).collect();
    named.extend(carriers);
    let marks: Vec<Change> = after
        .thoughts
        .iter()
        .filter(|t| t.placed && named.contains(&t.id))
        .filter_map(|t| {
            let decided = on_map(&after, t);
            (decided != t.decided).then(|| Change::ThoughtDecided { thought_id: t.id.clone(), decided })
        })
        .collect();
    changes.extend(marks);
    changes
}

#[cfg(test)]
mod tests {
    use super::said;

    /// Decisions as people say them, the demo's two lines first.
    const DECISIONS: [&str; 22] = [
        "Okay, decided: if it's under eighty dollars, I'm booking it tonight.",
        "Decided: I'll study with Priya on Wednesday night.",
        "I've decided to take the job in Toronto.",
        "We decided on the blue tiles for the bathroom.",
        "My decision is to skip the party this year.",
        "Final decision: we drive instead of flying.",
        "Let's go with the Thursday slot.",
        "I'm going with the cheaper flight.",
        "It's settled, we're doing Lisbon in May.",
        "I made up my mind, I'm quitting coffee.",
        "Final answer: pizza for the team lunch.",
        "We settled on Saturday for the move.",
        "I chose the morning class.",
        "Decision made, I'm selling the bike.",
        "I decided against the gym membership.",
        "I can't decide. Okay, decided: the red one.",
        "OK so I’ve decided — no more late-night email.",
        "We agreed to split the rent fifty-fifty.",
        "Actually no wait, I decided: Lisbon.",
        "Priya and I decided on Wednesday nights.",
        "I have finally decided to sell the car.",
        "Okay so today, decided: no phone after ten.",
    ];

    /// Near misses: about deciding, but nothing decided.
    const NOT_DECISIONS: [&str; 29] = [
        "I can't decide between the two classes.",
        "We'll decide later.",
        "I haven't decided yet.",
        "Still undecided about the venue.",
        "I need to decide by Friday.",
        "Help me decide which laptop to buy.",
        "What did I decide today?",
        "If we decide to go, I'll book it.",
        "It's a big decision.",
        "Did we settle on a date?",
        "Should I go with the blue one?",
        "I'll probably go with the blue one.",
        "I'm trying to make up my mind.",
        "Nothing's decided yet.",
        "The decision can wait until Monday.",
        "We're settled in the new place now.",
        "Have you decided",
        "It's to be decided at the meeting.",
        "We'll have decided by then.",
        "I'm not sure if I've decided.",
        "I'm going with you to the store.",
        "Okay, have you decided",
        "So, has she decided on a venue",
        "I picked the kids up at five.",
        "I picked up milk on the way home.",
        "Mom decided to host it at home.",
        "He made the decision without asking me.",
        "The team settled on Friday.",
        "Her final decision was to stay.",
    ];

    #[test]
    fn decisions_said_out_loud_are_found() {
        let missed: Vec<_> = DECISIONS.iter().filter(|t| !said(t)).collect();
        assert!(missed.is_empty(), "missed: {missed:?}");
    }

    #[test]
    fn talk_about_deciding_is_not_a_decision() {
        let wrong: Vec<_> = NOT_DECISIONS.iter().filter(|t| said(t)).collect();
        assert!(wrong.is_empty(), "taken for decisions: {wrong:?}");
    }

    #[test]
    fn the_demo_talks_other_lines_are_not_decisions() {
        for line in [
            "Okay. Rent is due Friday and I still haven't sent it.",
            "Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.",
            "My stats midterm is Thursday, chapters four to six.",
            "My biggest problem is that I never finish my",
            "Oh, and the bike needs new brakes before the weekend.",
            "And Mom is going to love that pottery class, I'm so excited!",
            "Sentences. I never finish my sentences.",
        ] {
            assert!(!said(line), "{line}");
        }
    }
}
