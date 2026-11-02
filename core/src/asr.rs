//! Listening: relays microphone audio from the UI to Muse Voice Transcribe in real time,
//! turns its draft words into live text and each finished turn into a thought.
//! One stream per window, so in a room each laptop transcribes its own mic under its own name.
//! The API key stays here, on the server; the browser never sees it.

use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, Context};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const URL: &str = "wss://api.meta.ai/v1/asr/realtime";

pub async fn run(core: Arc<Core>, speaker: String, mut audio: mpsc::Receiver<Vec<u8>>) -> anyhow::Result<()> {
    let key = core.listening_key()?.to_string();
    let session = format!("e2a2o-{}", uuid::Uuid::new_v4().simple());
    let (socket, _) = tokio_tungstenite::connect_async(format!("{URL}?sessionId={session}"))
        .await
        .context("couldn't reach Voice Transcribe")?;
    let (mut sink, mut stream) = socket.split();

    sink.send(Message::Text(handshake(&key).to_string().into())).await?;
    let first = match stream.next().await {
        Some(Ok(Message::Text(t))) => serde_json::from_str::<Value>(t.as_str())?,
        other => return Err(anyhow!("Voice Transcribe refused the session: {other:?}")),
    };
    // A session starts with its id. A refusal carries one too, as an error event, and a wrong key there is
    // told like any model call's.
    if first["type"] == "error" || first.get("sessionId").is_none() {
        if let Some(status) = first["errorType"].as_str().and_then(crate::model::status_of) {
            core.check(status)?;
        }
        return Err(anyhow!("Voice Transcribe refused the session: {first}"));
    }
    core.send_to(&speaker, ServerMsg::Status { listening: true, note: "Listening".into() });

    // Audio out: first the primer (see `primer`), all at once, then the microphone, paced by itself; when the UI
    // stops, end the stream. Words said meanwhile wait in the channel, behind the primer, so nothing is lost.
    let writer = tokio::spawn(async move { relay(&mut sink, &mut audio).await });

    // However the stream ends, the writer stops too: it holds the audio channel, and this window can
    // only start listening again once that closes. The caller says listening stopped.
    let mut primer = Primer::default();
    let ended = loop {
        match stream.next().await {
            // "Stop listening": nothing after it is heard, kept or sent on, even words the service still had.
            Some(Ok(Message::Text(t))) => {
                if handle(&core, &speaker, &mut primer, t.as_str()) {
                    break Ok(());
                }
            }
            Some(Ok(Message::Close(_))) | None => break Ok(()),
            Some(Ok(_)) => {}
            Some(Err(e)) => break Err(e),
        }
    };
    writer.abort();
    core.send_to(&speaker, ServerMsg::Partial { text: String::new() });
    Ok(ended?)
}

/// The service's audio: 16-bit mono PCM at 24 kHz, as the handshake says.
const RATE: usize = 24_000;
/// 80 ms, as the browser's worklet sends it (ui/public/pcm-worklet.js).
const FRAME_BYTES: usize = 2 * RATE * 80 / 1000;

/// How long the primer runs, in the stream's own time: everything the service reports up to here is the primer's.
/// Why this long: the service ends the primer's turn after about 3 s of quiet (it ended at 3.1–3.8 s in 7 runs), so
/// it closes before the mic's audio begins; and the endpointer is quick only once a few seconds have passed since
/// the first speech it heard (a first line ending 7.5 s after it: 0.4–0.7 s, n = 3). Under 5 s, the most the
/// service accepts ahead of what it has processed (dev.meta.ai/docs/speech-to-text; 8.8 s ahead left every later
/// line about 5 s late, n = 6); it processes the primer in about 0.5 s, and later lines came back as fast as before.
pub(crate) const PRIMER_MS: u64 = 4_800;
/// The sound at its start: a vowel just long enough for the service to hear speech (a noise burst wasn't heard).
const PRIMER_VOWEL_MS: usize = 500;
/// Its loudness (RMS): normal speech as the browser sends it, the level it was measured at (scripts/voice.mjs LEVEL).
const PRIMER_LEVEL: f64 = 0.075;

/// A short synthetic "ah", then quiet, sent before the microphone so the session's first line ends about as fast as
/// any other. Why: Voice Transcribe holds a session's first turn about 3 s after speech ends, whatever is said and
/// however quiet or noisy the room (first lines 3.3–3.8 s in 17 of 20 probes, later lines 0.3–0.8 s), which made
/// the demo's opening line its slowest (3.6 s in every cut take). It is quick only once a few seconds have passed
/// since the first speech it heard, counted in the stream's own time, so the primer lends it those seconds. With the
/// primer, a first line of a few seconds (the demo's) came back in 0.6–1.6 s (n = 6, median 0.7 s). A short or
/// trailed-off first line ("Mom's birthday is Saturday.", "…I never finish my") still waits about 3.4 s (n = 6).
/// Made here, from a pulse train at 120 Hz through three formants of "ah" (700, 1220 and 2600 Hz): no recording
/// ships, and nobody's voice is in it. What the service hears in it is never kept (`handle` drops anything up to
/// PRIMER_MS).
fn primer() -> Vec<u8> {
    let vowel = RATE * PRIMER_VOWEL_MS / 1000;
    let mut wave: Vec<f64> = (0..vowel).map(|i| if i % (RATE / 120) == 0 { 1.0 } else { 0.0 }).collect();
    for (formant, bandwidth) in [(700.0, 110.0), (1220.0, 120.0), (2600.0, 160.0)] {
        let r = (-std::f64::consts::PI * bandwidth / RATE as f64).exp();
        let c = 2.0 * r * (2.0 * std::f64::consts::PI * formant / RATE as f64).cos();
        let (mut y1, mut y2) = (0.0, 0.0);
        for x in wave.iter_mut() {
            let y = *x + c * y1 - r * r * y2;
            (y2, y1) = (y1, y);
            *x = y;
        }
    }
    // 50 ms in and out, so it starts and stops without a click.
    let fade = RATE / 20;
    for (i, x) in wave.iter_mut().enumerate() {
        *x *= (i.min(vowel - 1 - i) as f64 / fade as f64).min(1.0);
    }
    let rms = (wave.iter().map(|x| x * x).sum::<f64>() / vowel as f64).sqrt();
    let gain = PRIMER_LEVEL / rms;
    let total = RATE * PRIMER_MS as usize / 1000;
    let mut pcm = Vec::with_capacity(total * 2);
    for i in 0..total {
        let sample = wave.get(i).map_or(0.0, |x| x * gain);
        pcm.extend_from_slice(&((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    pcm
}

/// Everything the service hears: the primer, then the microphone's frames until the UI stops, then the end.
async fn relay<S: futures_util::Sink<Message> + Unpin>(sink: &mut S, audio: &mut mpsc::Receiver<Vec<u8>>) {
    for frame in primer().chunks(FRAME_BYTES) {
        if sink.send(Message::Binary(frame.to_vec().into())).await.is_err() {
            return;
        }
    }
    while let Some(frame) = audio.recv().await {
        if sink.send(Message::Binary(frame.into())).await.is_err() {
            return;
        }
    }
    let _ = sink.send(Message::Text(r#"{"type":"endStream"}"#.into())).await;
}

/// The session's first message: how to listen, and the words to expect.
fn handshake(key: &str) -> Value {
    json!({
        "authorization": {"accessToken": format!("Bearer {key}")},
        "audioEncoding": "PCM_24KHZ",
        "model": "muse-voice-transcribe-1.0",
        "mode": "ENDPOINTING",
        "partialMode": "CUMULATIVE",
        "emitAudioProgress": false,
        "languageBias": ["English"],
        // Product names, and the spoken commands most often misheard alone: "Palace." came back as "Palis",
        // "Palice" or "Alice" for 5 of 6 synthesized voices without it, 0 of 6 with it (2026-11-01).
        "keywords": ["E2A2O", "Muse", "Spark", "Meta", "Wonder", "Glimmer", "Llama", "Muse Image", "Palace", "Recap"]
    })
}

/// What the service made of the primer, so none of it is ever shown or kept.
#[derive(Default)]
struct Primer {
    /// The primer's turn, from its speechStart (in the primer's stretch of the stream).
    turn: Option<u64>,
    /// Its turn has not ended yet: the service may run the primer and the first line together into one turn.
    open: bool,
    /// The words it heard in the primer ("Uh"), to take off the front of that joined turn.
    words: String,
}

impl Primer {
    /// `text` without the primer's words at its front, compared without case or punctuation.
    fn strip<'a>(&self, text: &'a str) -> &'a str {
        let key = |s: &str| s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>();
        let want = key(&self.words);
        if want.is_empty() {
            return text;
        }
        let mut seen = String::new();
        for (i, c) in text.char_indices() {
            if c.is_alphanumeric() {
                seen.extend(c.to_lowercase());
            }
            if seen == want {
                let rest = &text[i + c.len_utf8()..];
                // "Uh, okay" → "okay"; but "Uhh" or "Uhuh" are someone's own word.
                if rest.chars().next().is_none_or(|n| !n.is_alphanumeric()) {
                    return rest.trim_start_matches(|n: char| !n.is_alphanumeric());
                }
                return text;
            }
            if !want.starts_with(seen.as_str()) {
                return text;
            }
        }
        text
    }
}

/// One event from the service; true when it was a spoken "stop listening", which ends the stream.
fn handle(core: &Arc<Core>, speaker: &str, primer: &mut Primer, text: &str) -> bool {
    let Ok(mut event) = serde_json::from_str::<Value>(text) else { return false };
    // The primer's words ("Uh", or nothing) and its turn: never shown or kept. Mostly that is everything up to
    // PRIMER_MS; but its turn can end late (seen at 3.1–3.8 s) and then its end, or the first line joined to it
    // ("Uh, okay rent…"), comes after, so its turn is followed by id and its words come off the front.
    let at = event["audioProcessedMs"].as_u64();
    let turn = event["turnId"].as_u64();
    if event["type"] != "error" && at.is_some_and(|at| at <= PRIMER_MS) {
        match event["type"].as_str() {
            Some("speechStart") => (primer.turn, primer.open) = (turn, true),
            Some("transcript") if primer.open => primer.words = event["transcript"].as_str().unwrap_or_default().to_string(),
            Some("speechComplete") if turn.is_some() && turn == primer.turn => primer.open = false,
            _ => {}
        }
        return false;
    }
    let primer_turn = primer.turn.is_some() && turn == primer.turn;
    if primer.open && (event["type"] == "transcript" || primer_turn) {
        let rest = primer.strip(event["transcript"].as_str().unwrap_or_default()).to_string();
        if event["type"] == "speechComplete" {
            primer.open = false;
        }
        if rest.is_empty() && event["type"] == "transcript" {
            return false;
        }
        if event.get("transcript").is_some() {
            event["transcript"] = Value::String(rest);
        }
    }
    // Turn boundaries with their audio position, to see how long endpointing takes (scripts/voice.mjs):
    // RUST_LOG=info,e2a2o_core::asr=debug. Drafts are left out, one per word.
    if event["type"] != "transcript" {
        tracing::debug!("voice event: {text}");
    }
    match event["type"].as_str() {
        Some("transcript") => {
            core.touch();
            let words = event["transcript"].as_str().unwrap_or_default().to_string();
            core.send_to(speaker, ServerMsg::Partial { text: words });
        }
        Some("speechComplete") => {
            let raw = event["transcript"].as_str().unwrap_or_default();
            let words = sentence_case(raw.trim());
            // As heard and as kept, to tell the transcriber's punctuation from ours.
            core.trace.write(|| json!({"kind": "heard", "speaker": speaker, "raw": raw, "kept": words}));
            core.send_to(speaker, ServerMsg::Partial { text: String::new() });
            if !words.is_empty() {
                core.add_thought(speaker, &words);
                return crate::spoken::is_stop_listening(&words);
            }
        }
        Some("error") => {
            if let Some(status) = event["errorType"].as_str().and_then(crate::model::status_of) {
                let _ = core.check(status);
            }
            let message = event["message"].as_str().unwrap_or("unknown error").to_string();
            core.send_to(speaker, ServerMsg::Error { message: format!("Voice Transcribe: {message}") });
        }
        _ => {}
    }
    false
}

/// A finished turn reads as a sentence: the transcriber sometimes starts one in lowercase ("oh and the
/// dentist…"). A first word with capitals of its own ("iPhone", "eBay") stays as said.
fn sentence_case(text: &str) -> String {
    let first = text.split_whitespace().next().unwrap_or_default();
    let mut chars = text.chars();
    match chars.next() {
        Some(c) if c.is_lowercase() && !first.chars().any(char::is_uppercase) => c.to_uppercase().chain(chars).collect(),
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{handle, handshake, primer, relay, sentence_case, Primer, FRAME_BYTES, PRIMER_MS, PRIMER_VOWEL_MS, RATE};
    use crate::protocol::{ServerMsg, View};
    use crate::world::{Journal, World};
    use crate::Core;
    use std::sync::Arc;

    /// A spoken "stop listening" pauses the window's mic and ends the stream (the caller stops reading it), so words
    /// the service still sends after it are never kept; a turn that only mentions it is a thought, and the stream goes on.
    #[test]
    fn stop_listening_ends_the_stream_and_keeps_nothing_after_it() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let turn = |words: &str| serde_json::json!({"type": "speechComplete", "transcript": words}).to_string();
        let mut primer = Primer::default();
        assert!(!handle(&core, "you", &mut primer, &turn("i should stop listening to podcasts at night")));
        assert!(handle(&core, "you", &mut primer, &turn("okay stop listening")));
        let paused = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Pause }));
        assert!(paused);
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["I should stop listening to podcasts at night"]);
        let _ = std::fs::remove_file(&path);
    }

    /// "Palace." and "Recap." said alone act only if the transcriber hears them: without its keywords they came back
    /// as "Palis" or "Alice" (the handshake's comment).
    #[test]
    fn the_transcriber_is_told_to_expect_palace_and_recap() {
        let sent = handshake("k");
        let keywords: Vec<&str> = sent["keywords"].as_array().expect("keywords").iter().filter_map(|w| w.as_str()).collect();
        for word in ["Palace", "Recap"] {
            assert!(keywords.contains(&word), "{word} isn't among the keywords {keywords:?}");
        }
    }

    /// The primer: a vowel at speech's level, then quiet, all of it under the 5 s the service takes ahead, and long
    /// enough that its turn (ended 3.1–3.8 s in) closes before the mic's audio starts.
    #[test]
    fn the_primer_is_a_short_vowel_then_quiet() {
        let pcm = primer();
        let samples: Vec<f64> = pcm.chunks(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0).collect();
        assert_eq!(samples.len(), RATE * PRIMER_MS as usize / 1000);
        assert!((4_000..5_000).contains(&PRIMER_MS), "{PRIMER_MS} ms");
        assert_eq!(pcm.len() % FRAME_BYTES, 0, "whole 80 ms frames, as the mic sends");
        let vowel = RATE * PRIMER_VOWEL_MS / 1000;
        let rms = (samples[..vowel].iter().map(|x| x * x).sum::<f64>() / vowel as f64).sqrt();
        assert!((0.07..0.08).contains(&rms), "vowel level {rms}");
        assert!(samples[..vowel].iter().all(|x| x.abs() < 0.99), "no clipping");
        assert!(samples[vowel..].iter().all(|&x| x == 0.0), "quiet after the vowel");
        assert!(samples[0].abs() < 0.001 && samples[vowel - 1].abs() < 0.001, "fades in and out");
    }

    /// The primer goes out before the first word from the mic, even one said at once, and the mic's frames follow
    /// it unchanged and in order.
    #[tokio::test]
    async fn the_primer_goes_first_then_the_mic() {
        use tokio_tungstenite::tungstenite::Message;
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        tx.send(vec![1u8; FRAME_BYTES]).await.unwrap();
        tx.send(vec![2u8; FRAME_BYTES]).await.unwrap();
        drop(tx);
        let mut sent: Vec<Message> = Vec::new();
        relay(&mut sent, &mut rx).await;
        let binary: Vec<Vec<u8>> = sent.iter().filter_map(|m| match m { Message::Binary(b) => Some(b.to_vec()), _ => None }).collect();
        let primed: Vec<u8> = binary[..binary.len() - 2].concat();
        assert_eq!(primed, primer());
        assert_eq!(binary[binary.len() - 2..], [vec![1u8; FRAME_BYTES], vec![2u8; FRAME_BYTES]]);
        assert!(matches!(sent.last(), Some(Message::Text(t)) if t.as_str().contains("endStream")));
    }

    /// What the service hears in the primer ("Uh", as it often writes it) is never shown or kept; the first real line is.
    #[test]
    fn the_primer_is_never_heard() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let primer = [
            serde_json::json!({"type": "speechStart", "audioProcessedMs": 0, "turnId": 0}),
            serde_json::json!({"type": "transcript", "transcript": "Uh", "final": false, "audioProcessedMs": 960}),
            serde_json::json!({"type": "speechEnd", "audioProcessedMs": 3820, "turnId": 0}),
            serde_json::json!({"type": "speechComplete", "audioProcessedMs": 3820, "turnId": 0, "transcript": "Uh,"}),
        ];
        let mut state = Primer::default();
        for event in &primer {
            assert!(!handle(&core, "you", &mut state, &event.to_string()));
        }
        assert!(std::iter::from_fn(|| updates.try_recv().ok()).all(|out| !matches!(out.message, ServerMsg::Partial { .. })));
        assert!(core.snapshot().thoughts.is_empty());
        let words = serde_json::json!({"type": "transcript", "transcript": "Okay, rent", "final": false, "audioProcessedMs": PRIMER_MS + 1_100});
        handle(&core, "you", &mut state, &words.to_string());
        let shown = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(&out.message, ServerMsg::Partial { text } if text == "Okay, rent"));
        assert!(shown, "the first line's words show as they come");
        let line = serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 4_900, "turnId": 1, "transcript": "Okay, rent is due Friday."});
        handle(&core, "you", &mut state, &line.to_string());
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["Okay, rent is due Friday."]);
        let _ = std::fs::remove_file(&path);
    }

    /// Feeds the service's events and returns the live words shown and the thoughts kept.
    fn heard(events: &[serde_json::Value]) -> (Vec<String>, Vec<String>) {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let mut state = Primer::default();
        for event in events {
            handle(&core, "you", &mut state, &event.to_string());
        }
        let shown = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                ServerMsg::Partial { text } if !text.is_empty() => Some(text),
                _ => None,
            })
            .collect();
        let kept = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        let _ = std::fs::remove_file(&path);
        (shown, kept)
    }

    fn primer_start() -> [serde_json::Value; 2] {
        [
            serde_json::json!({"type": "speechStart", "audioProcessedMs": 0, "turnId": 0}),
            serde_json::json!({"type": "transcript", "transcript": "Uh", "final": false, "audioProcessedMs": 960}),
        ]
    }

    /// The primer's turn usually ends by 3.8 s; one that ends after PRIMER_MS (no one speaking yet) is still the
    /// primer's: "Uh," never lands on the map on camera.
    #[test]
    fn a_primer_turn_that_ends_late_is_still_never_kept() {
        let mut events = primer_start().to_vec();
        events.push(serde_json::json!({"type": "speechEnd", "audioProcessedMs": PRIMER_MS + 400, "turnId": 0}));
        events.push(serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 400, "turnId": 0, "transcript": "Uh,"}));
        events.push(serde_json::json!({"type": "speechStart", "audioProcessedMs": PRIMER_MS + 900, "turnId": 1}));
        events.push(serde_json::json!({"type": "transcript", "transcript": "Uh, I mean rent", "final": false, "audioProcessedMs": PRIMER_MS + 1_500}));
        events.push(serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 3_000, "turnId": 1, "transcript": "Uh, I mean rent is due."}));
        let (shown, kept) = heard(&events);
        // After the primer's turn, a line of one's own that starts with "Uh" stays as said.
        assert_eq!(shown, ["Uh, I mean rent"]);
        assert_eq!(kept, ["Uh, I mean rent is due."]);
    }

    /// Someone speaking right at "Listening", while the primer's turn is still open: the service runs the two into
    /// one turn; the line shows and lands without the primer's "Uh".
    #[test]
    fn a_first_line_joined_to_the_primer_loses_only_the_primers_words() {
        let mut events = primer_start().to_vec();
        for (words, at) in [("Uh, okay", 1_000), ("Uh, okay, rent", 1_400)] {
            events.push(serde_json::json!({"type": "transcript", "transcript": words, "final": false, "audioProcessedMs": PRIMER_MS + at}));
        }
        events.push(serde_json::json!({"type": "speechEnd", "audioProcessedMs": PRIMER_MS + 3_000, "turnId": 0}));
        events.push(serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 3_000, "turnId": 0, "transcript": "Uh, okay, rent is due Friday."}));
        let (shown, kept) = heard(&events);
        assert_eq!(shown, ["okay", "okay, rent"]);
        assert_eq!(kept, ["Okay, rent is due Friday."]);
    }

    /// Only the primer's own word comes off: "Uhh" or "Uhuh" are someone's own, and an empty primer takes nothing.
    #[test]
    fn only_the_primers_own_words_come_off() {
        let uh = Primer { turn: Some(0), open: true, words: "Uh".into() };
        assert_eq!(uh.strip("Uh, okay"), "okay");
        assert_eq!(uh.strip("uh okay"), "okay");
        assert_eq!(uh.strip("Uh."), "");
        assert_eq!(uh.strip("Uhh, okay"), "Uhh, okay");
        assert_eq!(uh.strip("Uhuh"), "Uhuh");
        assert_eq!(uh.strip("Okay"), "Okay");
        assert_eq!(Primer::default().strip("Uh, okay"), "Uh, okay");
    }

    #[test]
    fn a_finished_turn_starts_with_a_capital() {
        assert_eq!(sentence_case("oh and the dentist moved my cleaning"), "Oh and the dentist moved my cleaning");
        assert_eq!(sentence_case("éclair or cake"), "Éclair or cake");
        for same in ["Muse Spark places it", "iPhone battery is low", "eBay listing", "3 things to do", "", "\"quoted\" words"] {
            assert_eq!(sentence_case(same), same);
        }
    }
}
