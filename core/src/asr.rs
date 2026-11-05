//! Listening: relays microphone audio from the UI to Muse Voice Transcribe in real time,
//! turns its draft words into live text and each finished turn into a thought.
//! One stream per window, so in a room each laptop transcribes its own mic under its own name.
//! The API key stays here, on the server; the browser never sees it.

use crate::{protocol::ServerMsg, Core};
use anyhow::{anyhow, Context};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;

mod sources;

const URL: &str = "wss://api.meta.ai/v1/asr/realtime";

/// The longest the service may say nothing before the stream counts as gone (connect, handshake, and every event
/// after). Why this long: a person who stops talking gets their finished turn back within about 3.8 s at the
/// slowest (a session's first line; later lines 0.3–0.8 s; voice probes, 2026-11-01). Any silence longer than
/// that is no pause and no turn being finished: the person is already waiting longer than ever, so the window
/// is told the mic stopped instead of showing "Listening" while the words go nowhere. A live stream is never that
/// quiet, even while nobody talks: with `emitAudioProgress` on it reports the audio it has heard after every
/// 80 ms frame, about 0.3 s behind; it connects in 0.25 s and answers the handshake 0.07–0.19 s later (2 runs of
/// 150 frames, 2026-11-01).
const QUIET_MAX: Duration = Duration::from_millis(3_800);

/// A refused handshake as the window shows it: the service's own message, else a plain line; never its raw JSON or
/// Rust's debug text (the raw answer goes to the log).
fn refused(answer: &Value) -> String {
    let message = answer["message"].as_str().map(str::trim).filter(|m| !m.is_empty() && !m.starts_with('{'));
    format!("Voice Transcribe refused the session: {}", message.unwrap_or("it didn't start"))
}

pub async fn run(core: Arc<Core>, speaker: String, audio: mpsc::Receiver<Vec<u8>>, window: u64, keywords: Vec<String>) -> anyhow::Result<()> {
    #[cfg(test)]
    if let Some(url) = core.asr_test_url.clone() {
        return run_with_keywords(&url, core, speaker, audio, Some(window), keywords).await;
    }
    run_with_keywords(URL, core, speaker, audio, Some(window), keywords).await
}

/// `run` against the service at `url` (a test's stand-in on this machine).
#[cfg(test)]
async fn run_at(url: &str, core: Arc<Core>, speaker: String, audio: mpsc::Receiver<Vec<u8>>, window: Option<u64>) -> anyhow::Result<()> {
    run_with_keywords(url, core, speaker, audio, window, vec![]).await
}

async fn run_with_keywords(url: &str, core: Arc<Core>, speaker: String, mut audio: mpsc::Receiver<Vec<u8>>, window: Option<u64>, keywords: Vec<String>) -> anyhow::Result<()> {
    let key = core.listening_key()?.to_string();
    let session = format!("e2a2o-{}", uuid::Uuid::new_v4().simple());
    let (socket, _) = tokio::time::timeout(QUIET_MAX, tokio_tungstenite::connect_async(format!("{url}?sessionId={session}")))
        .await
        .map_err(|_| anyhow!("Voice Transcribe didn't answer"))?
        .context("couldn't reach Voice Transcribe")?;
    let (mut sink, mut stream) = socket.split();

    sink.send(Message::Text(handshake_with_keywords(&key, &keywords).to_string().into())).await?;
    let first = match tokio::time::timeout(QUIET_MAX, stream.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(t.as_str())?,
        Ok(_) => {
            tracing::warn!("voice handshake did not return a session");
            return Err(anyhow!("{}", refused(&Value::Null)));
        }
        Err(_) => return Err(anyhow!("Voice Transcribe didn't answer")),
    };
    // A session starts with its id. A refusal carries one too, as an error event, and a wrong key there is
    // told like any model call's.
    if first["type"] == "error" || first.get("sessionId").is_none() {
        if let Some(status) = first["errorType"].as_str().and_then(crate::model::status_of) {
            core.check(status)?;
        }
        tracing::warn!("voice handshake refused");
        return Err(anyhow!("{}", crate::secrets::text(&refused(&first), core.key.as_deref())));
    }
    core.send_to(&speaker, ServerMsg::Status { listening: true, note: "Listening".into() });
    // Their mic is on for the call's windows until this stream ends, which ends their turn too (call.rs).
    let _mic = crate::call::mic_on(&core, &speaker);
    let step = crate::model::STEP_IDS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    core.listen_step(&speaker, step, MODEL, false);

    // Bound every outbound frame by what the service has processed. The 4.8 s primer plus microphone audio
    // queued during connection used to exceed the service's 5 s backlog cap before the first spoken word.
    let (progress, processed) = watch::channel(0);
    let writer = tokio::spawn(async move { relay(&mut sink, &mut audio, processed).await });

    // However the stream ends, the writer stops too: it holds the audio channel, and this window can
    // only start listening again once that closes. The caller says listening stopped.
    let ended = hear_with_progress(&core, &speaker, &mut stream, window, Some(progress)).await;
    writer.abort();
    core.send_to(&speaker, ServerMsg::Partial { text: String::new() });
    core.listen_step(&speaker, step, MODEL, true);
    ended
}

/// Reads the service's events until the stream ends, a spoken "stop listening", or a silence past `QUIET_MAX`.
#[cfg(test)]
pub(crate) async fn hear<S>(core: &Arc<Core>, speaker: &str, stream: &mut S, window: Option<u64>) -> anyhow::Result<()>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    hear_with_progress(core, speaker, stream, window, None).await
}

async fn hear_with_progress<S>(core: &Arc<Core>, speaker: &str, stream: &mut S, window: Option<u64>, progress: Option<watch::Sender<u64>>) -> anyhow::Result<()>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let mut primer = Primer::default();
    let result = loop {
        let Ok(next) = tokio::time::timeout(QUIET_MAX, stream.next()).await else {
            break Err(anyhow!("Voice Transcribe stopped answering"));
        };
        match next {
            // A sign of life only (`QUIET_MAX`).
            Some(Ok(Message::Text(t))) if t.as_str().contains(r#""audioProgress""#) => {
                if let (Some(progress), Ok(event)) = (&progress, serde_json::from_str::<Value>(&t)) {
                    if let Some(ms) = event["audioProcessedMs"].as_u64() {
                        progress.send_modify(|latest| *latest = (*latest).max(ms));
                    }
                }
            }
            // "Stop listening": nothing after it is heard, kept or sent on, even words the service still had.
            Some(Ok(Message::Text(t))) => {
                if handle(core, speaker, &mut primer, t.as_str(), window) {
                    break Ok(());
                }
            }
            Some(Ok(Message::Close(_))) | None => break Ok(()),
            Some(Ok(_)) => {}
            Some(Err(e)) => break Err(e.into()),
        }
    };
    primer.recover(core);
    result
}

/// The service's audio: 16-bit mono PCM at 24 kHz, as the handshake says.
const RATE: usize = 24_000;
/// 80 ms, as the browser's worklet sends it (ui/public/pcm-worklet.js).
const FRAME_BYTES: usize = 2 * RATE * 80 / 1000;

/// How long the primer runs, in the stream's own time: everything the service reports up to here is the primer's.
/// Why this long: the service ends the primer's turn after about 3 s of quiet (it ended at 3.1–3.8 s in 7 runs), so
/// it closes before the mic's audio begins; and the endpointer is quick only once a few seconds have passed since
/// the first speech it heard (a first line ending 7.5 s after it: 0.4–0.7 s, n = 3). This is audio duration, not
/// permission to send it in one burst: `relay` bounds outstanding audio using processing acknowledgements.
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

/// Keep ample headroom below the provider's 5 s cap, including the primer and any queued microphone frames.
const BACKLOG_MS: u64 = 1_600;

/// Everything the service hears, in order. Waiting for progress never drops or reorders captured words.
/// Chunks are bounded even when the browser delivers a larger frame or accumulated audio after a stall.
async fn relay<S: futures_util::Sink<Message> + Unpin>(sink: &mut S, audio: &mut mpsc::Receiver<Vec<u8>>, mut processed: watch::Receiver<u64>) {
    let mut sent = 0u64;
    let mut send = async |bytes: &[u8]| {
        for frame in bytes.chunks(FRAME_BYTES) {
            let next = sent + frame.len() as u64;
            while next > (processed.borrow().saturating_add(BACKLOG_MS)).saturating_mul(2 * RATE as u64) / 1000 {
                // The reader also times out, but a closed/stalled progress channel must never strand a writer.
                if !matches!(tokio::time::timeout(QUIET_MAX, processed.changed()).await, Ok(Ok(()))) {
                    return false;
                }
            }
            if sink.send(Message::Binary(frame.to_vec().into())).await.is_err() { return false; }
            sent = next;
        }
        true
    };
    if !send(&primer()).await { return; }
    while let Some(frame) = audio.recv().await {
        if !send(&frame).await { return; }
    }
    let _ = sink.send(Message::Text(r#"{"type":"endStream"}"#.into())).await;
}

/// The model that hears the words, named on screen while listening (`Core::listen_step`).
const MODEL: &str = "muse-voice-transcribe-1.0";

/// The session's first message: how to listen, and the words to expect.
#[cfg(test)]
fn handshake(key: &str) -> Value { handshake_with_keywords(key, &[]) }

pub(crate) fn handshake_with_keywords(key: &str, terms: &[String]) -> Value {
    let mut message = json!({
        "authorization": {"accessToken": format!("Bearer {key}")},
        "audioEncoding": "PCM_24KHZ",
        "model": MODEL,
        "mode": "ENDPOINTING",
        "partialMode": "CUMULATIVE",
        // Every frame heard is reported, so a quiet room still shows the stream is alive (`QUIET_MAX`).
        "emitAudioProgress": true,
        "languageBias": ["English"],
        // Product names, and the spoken commands most often misheard alone: "Palace." came back as "Palis",
        // unrelated spellings for 5 of 6 synthesized voices without it, 0 of 6 with it (2026-11-01).
        "keywords": ["E2A2O", "Muse", "Spark", "Meta", "Wonder", "Glimmer", "Llama", "Muse Image", "Palace", "Recap"]
    });
    let keywords = message["keywords"].as_array_mut().unwrap();
    for term in terms {
        if !keywords.iter().any(|word| word.as_str().is_some_and(|word| crate::glossary::key(word) == crate::glossary::key(term))) {
            keywords.push(json!(term));
        }
    }
    message
}

/// What the service made of the primer, so none of it is ever shown or kept.
#[derive(Default)]
struct Primer {
    sources: sources::Sources,
    /// The primer's turn, from its speechStart (in the primer's stretch of the stream).
    turn: Option<u64>,
    /// Its turn has not ended yet: the service may run the primer and the first line together into one turn.
    open: bool,
    /// The words it heard in the primer ("Uh"), to take off the front of that joined turn.
    words: String,
}

impl Primer {
    fn recover(&self, core: &Core) {
        self.sources.recover(core);
    }

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
fn handle(core: &Arc<Core>, speaker: &str, primer: &mut Primer, text: &str, window: Option<u64>) -> bool {
    let Ok(mut event) = serde_json::from_str::<Value>(text) else { return false };
    crate::secrets::value(&mut event, core.key.as_deref());
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
    // A new turn means the primer's is over, even if its end never came: later words are left as said. A later
    // turn's end says so too, for a service that skipped that turn's start.
    if !primer_turn && (event["type"] == "speechStart" || (event["type"] == "speechComplete" && turn.is_some())) {
        primer.open = false;
    }
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
        tracing::debug!("voice event: {event}");
    }
    match event["type"].as_str() {
        Some("speechStart") => {
            primer.sources.boundary(speaker, &event);
            crate::messages::speech_end(core, speaker, false);
        },
        Some("speechEnd") => {
            primer.sources.boundary(speaker, &event);
            crate::messages::speech_end(core, speaker, true);
            crate::helpers::speech_end(core, speaker);
        }
        Some("transcript") => {
            core.touch();
            let words = event["transcript"].as_str().unwrap_or_default().to_string();
            if !words.trim().is_empty() && primer.sources.words(speaker, &event, &words, false).is_none() {
                return false;
            }
            primer.sources.checkpoint(core);
            // "Stop" stops a message counting down as it's said, not a turn's end later (messages.rs).
            crate::messages::heard(core, speaker, &words);
            crate::helpers::heard(core, speaker, &words);
            // The call's other windows learn that they have the floor, never the words (call.rs `speaking`).
            if !words.trim().is_empty() {
                crate::call::speaking(core, speaker, true);
            }
            core.send_to(speaker, ServerMsg::Partial { text: words });
        }
        Some("speechComplete") => {
            let raw = event["transcript"].as_str().unwrap_or_default();
            let words = sentence_case(raw.trim());
            // As heard and as kept, to tell the transcriber's punctuation from ours.
            core.trace.write(|| json!({"kind": "heard", "speaker": speaker, "raw": raw, "kept": words}));
            let id = if words.is_empty() { None } else { primer.sources.words(speaker, &event, &words, true) };
            // A late final for an older source must not erase the next source's live words.
            let pending = primer.sources.partial().to_string();
            core.send_to(speaker, ServerMsg::Partial { text: pending.clone() });
            if let Some(id) = id {
                core.finish_speech(speaker, &id, &words, window);
            }
            // After the turn's thought, so the other windows see its words come as "Speaking now…" goes (call.rs).
            if pending.is_empty() { crate::call::speaking(core, speaker, false); }
            if !words.is_empty() {
                return crate::spoken::stops_listening(&words);
            }
        }
        Some("error") => {
            primer.recover(core);
            if let Some(status) = event["errorType"].as_str().and_then(crate::model::status_of) {
                let _ = core.check(status);
            }
            let message = crate::secrets::text(event["message"].as_str().unwrap_or("unknown error"), core.key.as_deref());
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
    use super::{handle, handshake, hear, primer, refused, relay, sentence_case, Primer, BACKLOG_MS, FRAME_BYTES, PRIMER_MS, PRIMER_VOWEL_MS, QUIET_MAX, RATE};
    use crate::protocol::{ServerMsg, View};
    use crate::world::{Journal, World};
    use crate::Core;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{mpsc, watch};

    mod session;
    mod speech;
    mod identity;

    #[tokio::test(start_paused = true)]
    async fn email_and_helpers_share_speech_end_timing_and_draft_stop() {
        use crate::messages::{self, Channel, Preset, SendState, Settings};
        let dir = std::env::temp_dir().join(format!("e2a2o-email-asr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let (journal, _) = Journal::open(&dir.join("journal.jsonl")).unwrap();
        let sender: messages::Sender = Arc::new(|_, _| Box::pin(async { panic!("ASR test must not send") }));
        let core = Arc::new(Core {
            messages: messages::Runtime::with(Settings { preset: Preset::Full,
                email_contacts: messages::contacts("Recipient=recipient@example.com"), ..Settings::default() }, sender),
            trace: crate::trace::Trace::to(&dir), ..Core::test(journal, World::default())
        });
        let _window = messages::window(&core, "you");
        let mut primer = Primer::default();
        let event = |turn: u64, kind: &str, transcript: &str| serde_json::json!({"type": kind, "turnId": turn,
            "audioProcessedMs": PRIMER_MS + 2000, "transcript": transcript}).to_string();
        handle(&core, "you", &mut primer, &event(1, "speechStart", ""), None);
        handle(&core, "you", &mut primer, &event(1, "speechEnd", ""), None);
        tokio::time::advance(std::time::Duration::from_millis(75)).await;
        handle(&core, "you", &mut primer, &event(1, "speechComplete", "email Recipient that the cut is ready"), None);
        assert!(matches!(messages::card_for(&core, "you"), Some(ServerMsg::SendCard {
            channel: Channel::Email, state: SendState::Counting, subject, .. }) if subject == "the cut is ready"));
        let trace = std::fs::read_to_string(dir.join("trace.jsonl")).unwrap();
        let card = trace.lines().map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .find(|line| line["kind"] == "delivery" && line["event"] == "card").unwrap();
        assert_eq!(card["speech_end_to_event_ms"], 75);
        handle(&core, "you", &mut primer, &event(2, "transcript", "Stop"), None);
        assert!(matches!(messages::card_for(&core, "you"), Some(ServerMsg::SendCard { state: SendState::Stopped, .. })));

        handle(&core, "you", &mut primer, &event(3, "speechStart", ""), None);
        handle(&core, "you", &mut primer, &event(3, "speechEnd", ""), None);
        tokio::time::advance(std::time::Duration::from_millis(125)).await;
        handle(&core, "you", &mut primer, &event(3, "speechComplete", "put three helpers on the README"), None);
        let trace = std::fs::read_to_string(dir.join("trace.jsonl")).unwrap();
        let row = trace.lines().map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .find(|line| line["kind"] == "helpers_first_row").unwrap();
        assert_eq!(row["speech_end_to_first_row_ms"], 125);
        handle(&core, "you", &mut primer, &event(4, "transcript", "Stop"), None);
        assert!(matches!(messages::card_for(&core, "you"), Some(ServerMsg::SendCard {
            purpose: Some(purpose), state: SendState::Stopped, .. }) if purpose == "helpers"));
        std::fs::remove_dir_all(dir).unwrap();
    }

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
        assert!(!handle(&core, "you", &mut primer, &turn("i should stop listening to podcasts at night"), None));
        assert!(handle(&core, "you", &mut primer, &turn("okay stop listening"), None));
        let paused = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Pause }));
        assert!(paused);
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["I should stop listening to podcasts at night"]);
        let _ = std::fs::remove_file(&path);
    }

    /// "Palace." and "Recap." said alone act only if the transcriber hears them: without its keywords they came back
    /// as unrelated words (the handshake's comment).
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
        let (_progress, processed) = watch::channel(PRIMER_MS);
        relay(&mut sent, &mut rx, processed).await;
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
            assert!(!handle(&core, "you", &mut state, &event.to_string(), None));
        }
        assert!(std::iter::from_fn(|| updates.try_recv().ok()).all(|out| !matches!(out.message, ServerMsg::Partial { .. })));
        assert!(core.snapshot().thoughts.is_empty());
        let words = serde_json::json!({"type": "transcript", "transcript": "Okay, rent", "final": false, "audioProcessedMs": PRIMER_MS + 1_100});
        handle(&core, "you", &mut state, &words.to_string(), None);
        let shown = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(&out.message, ServerMsg::Partial { text } if text == "Okay, rent"));
        assert!(shown, "the first line's words show as they come");
        let line = serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 4_900, "turnId": 1, "transcript": "Okay, rent is due Friday."});
        handle(&core, "you", &mut state, &line.to_string(), None);
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["Okay, rent is due Friday."]);
        let _ = std::fs::remove_file(&path);
    }

    /// In a call, a turn's first words give its speaker the floor in every window, once however many words come (never
    /// the words: those stay with the speaker's own windows), and its end gives the floor back right after its thought,
    /// so the other windows see its words come as "Speaking now…" goes (call.rs).
    #[test]
    fn a_turn_takes_the_floor_once_and_gives_it_back_after_its_thought() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let (_you, _designer) = (crate::call::join(&core, "you", false), crate::call::join(&core, "Designer", false));
        let mut updates = core.updates.subscribe();
        let mut state = Primer::default();
        for (at, words) in [(PRIMER_MS + 600, "Okay"), (PRIMER_MS + 900, "Okay, rent"), (PRIMER_MS + 1_200, "Okay, rent is due")] {
            let event = serde_json::json!({"type": "transcript", "transcript": words, "final": false, "audioProcessedMs": at});
            handle(&core, "you", &mut state, &event.to_string(), None);
        }
        let end = serde_json::json!({"type": "speechComplete", "audioProcessedMs": PRIMER_MS + 2_000, "turnId": 1, "transcript": "Okay, rent is due Friday."});
        handle(&core, "you", &mut state, &end.to_string(), None);
        let told: Vec<String> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message {
                ServerMsg::Call { people, .. } => {
                    assert_eq!(out.to, None, "the floor is every window's");
                    Some(format!("floor {}", people[0].speaking))
                }
                ServerMsg::Change { change: crate::world::Change::ThoughtAdded { .. } } => Some("thought".into()),
                ServerMsg::Partial { text } => {
                    assert_eq!(out.to.as_deref(), Some("you"), "{text:?}: the words go only to the speaker's windows");
                    None
                }
                _ => None,
            })
            .collect();
        assert_eq!(told, ["floor true", "thought", "floor false"]);
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
            handle(&core, "you", &mut state, &event.to_string(), None);
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
        let uh = Primer { turn: Some(0), open: true, words: "Uh".into(), ..Primer::default() };
        assert_eq!(uh.strip("Uh, okay"), "okay");
        assert_eq!(uh.strip("uh okay"), "okay");
        assert_eq!(uh.strip("Uh."), "");
        assert_eq!(uh.strip("Uhh, okay"), "Uhh, okay");
        assert_eq!(uh.strip("Uhuh"), "Uhuh");
        assert_eq!(uh.strip("Okay"), "Okay");
        assert_eq!(Primer::default().strip("Uh, okay"), "Uh, okay");
    }

    /// A primer turn whose end never comes: the next turn closes it, so that turn's words stay as said.
    #[test]
    fn a_new_turn_closes_the_primers() {
        let mut events = primer_start().to_vec();
        events.push(serde_json::json!({"type": "speechStart", "audioProcessedMs": PRIMER_MS + 900, "turnId": 1}));
        events.push(serde_json::json!({"type": "transcript", "transcript": "Uh, I mean rent", "final": false, "audioProcessedMs": PRIMER_MS + 1_500}));
        let (shown, _) = heard(&events);
        assert_eq!(shown, ["Uh, I mean rent"]);
    }

    #[test]
    fn a_finished_turn_starts_with_a_capital() {
        assert_eq!(sentence_case("oh and the dentist moved my cleaning"), "Oh and the dentist moved my cleaning");
        assert_eq!(sentence_case("éclair or cake"), "Éclair or cake");
        for same in ["Muse Spark places it", "iPhone battery is low", "eBay listing", "3 things to do", "", "\"quoted\" words"] {
            assert_eq!(sentence_case(same), same);
        }
    }

    #[test]
    fn a_refused_handshake_says_the_services_words_never_raw_json() {
        assert_eq!(refused(&serde_json::json!({"type": "error", "message": "Session limit reached"})), "Voice Transcribe refused the session: Session limit reached");
        for answer in [serde_json::json!({"type": "hello"}), serde_json::Value::Null, serde_json::json!({"message": "{\"a\":1}"})] {
            let shown = refused(&answer);
            assert!(!shown.contains('{') && !shown.contains("Some(") && shown.ends_with("it didn't start"), "{shown}");
        }
    }

    /// "Stop listening" after other words in one turn (the transcriber joins them when the pause is short): the words
    /// before it are a thought, the mic pauses and the stream ends, so nothing after it is heard.
    #[test]
    fn stop_listening_at_the_end_of_a_turn_keeps_the_words_before_it_and_ends_the_stream() {
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        let mut updates = core.updates.subscribe();
        let turn = |words: &str| serde_json::json!({"type": "speechComplete", "transcript": words}).to_string();
        let mut primer = Primer::default();
        assert!(handle(&core, "you", &mut primer, &turn("call mom tomorrow about the flight. Stop listening."), None));
        let paused = std::iter::from_fn(|| updates.try_recv().ok()).any(|out| matches!(out.message, ServerMsg::View { view: View::Pause }));
        assert!(paused, "the mic pauses");
        let texts: Vec<String> = core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect();
        assert_eq!(texts, ["Call mom tomorrow about the flight."]);
        assert!(handle(&core, "you", &mut primer, &turn("That's all for today, okay, stop listening, thanks."), None));
        // Only courtesy before it: no thought.
        let before = core.snapshot().thoughts.len();
        for said in ["Thanks, stop listening.", "Okay thank you. Stop listening.", "Hey Muse, mic off."] {
            assert!(handle(&core, "you", &mut primer, &turn(said), None), "{said}");
        }
        assert_eq!(core.snapshot().thoughts.len(), before, "{:?}", core.snapshot().thoughts.iter().map(|t| &t.text).collect::<Vec<_>>());
        let _ = std::fs::remove_file(&path);
    }

    /// A stream that goes quiet (a dropped connection the socket never notices) ends with an error once it has been
    /// quiet longer than any turn takes to come back, so the window stops showing "Listening"; one that keeps
    /// reporting its progress through a long silence in the room goes on, and its reports never show as words.
    #[tokio::test(start_paused = true)]
    async fn a_stream_gone_quiet_ends_but_a_quiet_room_does_not() {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::Message;
        let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let core = Arc::new(Core::test(journal, World::default()));
        assert_eq!(handshake("k")["emitAudioProgress"], true);
        let progress = |ms: u64| Ok(Message::Text(serde_json::json!({"type": "audioProgress", "audioProcessedMs": ms}).to_string().into()));

        // 30 s of nobody talking, reported every 80 ms, then the service closes: no error, nothing shown.
        let mut updates = core.updates.subscribe();
        let quiet_room = futures_util::stream::iter((1..=375u64).map(|n| n * 80)).then(|ms| async move {
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            progress(ms)
        });
        let mut quiet_room = Box::pin(quiet_room.chain(futures_util::stream::once(async { Ok(Message::Close(None)) })));
        assert!(hear(&core, "you", &mut quiet_room, None).await.is_ok());
        assert!(updates.try_recv().is_err(), "progress reports never reach the window");

        // One report, then nothing at all: an error just past QUIET_MAX, not a wait forever.
        let started = tokio::time::Instant::now();
        let mut gone = Box::pin(futures_util::stream::iter([progress(80)]).chain(futures_util::stream::pending()));
        let ended = hear(&core, "you", &mut gone, None).await;
        assert!(ended.is_err());
        let waited = started.elapsed();
        assert!(waited >= QUIET_MAX && waited < QUIET_MAX + std::time::Duration::from_millis(100), "{waited:?}");
        let _ = std::fs::remove_file(&path);
    }
}
