//! Decisions said out loud: "Decided: I'll study with Priya", "let's go with Thursday", "it's settled". Found by rule
//! in the words as said, with no model call, so a decision is recorded the moment it's placed, the same way every
//! time, and Recap can lead with it (recap.rs). The mark is the person's own word echoed back, never a guess: a
//! point is marked only when the words say they decided, and near misses ("I can't decide", "we'll decide later",
//! "should I go with the blue one?") stay plain points. A choice made without saying so ("booking it tonight") is
//! left to Recap's model, which reads every point.

/// Words that, said before a marker in the same sentence, make it not (yet) a decision: "I haven't decided", "if
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
    let words: Vec<&str> = sentence
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '$'))
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
        .collect();
    if words.first().is_some_and(|w| ASKS.contains(w)) {
        return false;
    }
    (0..words.len()).any(|i| {
        MARKERS.iter().any(|(marker, strict)| {
            if !words[i..].starts_with(marker) {
                return false;
            }
            let before = &words[..i];
            let negated = before.iter().any(|w| NOT.contains(w) || w.ends_with("n't"));
            let unsure = *strict && before.iter().any(|w| UNSURE.contains(w));
            // "decided" only: one still to come ("we'll have decided", "to be decided") or not yet ("decided yet").
            let later = marker[0] == "decided"
                && (before.iter().any(|w| LATER.contains(w) || w.ends_with("'ll"))
                    || before.ends_with(&["to", "be"])
                    || words.get(i + 1) == Some(&"yet"));
            let along = marker.last() == Some(&"with") && words.get(i + marker.len()).is_some_and(|w| PEOPLE.contains(w));
            !(negated || unsure || later || along)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::said;

    /// Decisions as people say them, the demo's two lines first.
    const DECISIONS: [&str; 18] = [
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
    ];

    /// Near misses: about deciding, but nothing decided.
    const NOT_DECISIONS: [&str; 21] = [
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
