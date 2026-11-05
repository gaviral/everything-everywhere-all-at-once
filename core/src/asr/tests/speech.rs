//! The speech path as Voice Transcribe drives it: the demo's script, "stop listening", errors and drafts.
use super::*;
use crate::world::{Change, Thread, ThreadStatus};
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;

/// A core with no key on an empty map, and its windows' messages.
fn listening() -> (Arc<Core>, tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("e2a2o-asr-{}.jsonl", uuid::Uuid::new_v4()));
    let (journal, _) = Journal::open(&path).unwrap();
    let core = Arc::new(Core::test(journal, World::default()));
    let updates = core.updates.subscribe();
    (core, updates, path)
}

fn texts(core: &Core) -> Vec<String> {
    core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect()
}

/// What the windows were told since the last look: live words shown, and the requests answered, by kind.
fn told(updates: &mut tokio::sync::broadcast::Receiver<crate::protocol::Outgoing>) -> (Vec<String>, Vec<String>) {
    let (mut shown, mut did) = (Vec::new(), Vec::new());
    while let Ok(out) = updates.try_recv() {
        match out.message {
            ServerMsg::Partial { text } if !text.is_empty() => shown.push(text),
            ServerMsg::View { view } => did.push(format!("{view:?}").to_lowercase()),
            ServerMsg::RecapState { .. } => did.push("recap".into()),
            ServerMsg::AppsBuild { .. } => did.push("app".into()),
            ServerMsg::Found { message, .. } if message.starts_with("Back to ") => did.push(message),
            _ => {}
        }
    }
    did.dedup();
    (shown, did)
}

/// The placer's part, as its `decide` would land each line (no model here): the thread, a new one when it says
/// so, the line trailed off or not, the speaker moved there, and the thread they left dropped when their last
/// words there trailed off.
fn place(core: &Core, text: &str, thread: &str, complete: bool) {
    let world = core.snapshot();
    let id = world.thoughts.iter().find(|t| t.text == text).map(|t| t.id.clone()).expect(text);
    let mut changes = Vec::new();
    if world.thread(thread).is_none() {
        changes.push(Change::ThreadAdded { thread: Thread {
            id: thread.into(), title: thread.into(), parent_id: None, status: ThreadStatus::Open, last_point: String::new(),
            touched_ms: crate::now_ms(), tags: Vec::new(), picture: None, dropped_by: String::new(),
        } });
    }
    changes.push(Change::ThoughtPlaced {
        thought_id: id, thread_id: thread.into(), point: text.into(), unclear: String::new(), guess: String::new(),
        heard: String::new(), fixed: String::new(), complete, place_ms: 0, decided: false,
    });
    if let Some(left) = world.active_for("you").filter(|left| left.as_str() != thread) {
        let trailed = world.thoughts.iter().filter(|t| t.placed && t.thread_id.as_deref() == Some(left.as_str())).last().is_some_and(|t| !t.complete);
        if trailed {
            changes.push(Change::ThreadStatus { thread_id: left.clone(), status: ThreadStatus::Dropped, speaker: "you".into() });
        }
    }
    changes.push(Change::ActiveChanged { thread_id: thread.into(), speaker: "you".into() });
    core.commit(changes);
}

/// The video's script, line by line, as Voice Transcribe sends it: the primer first, the opening half-sentence said right at
/// "Listening" (so the service runs it into the primer's turn), drafts as words come, then each finished turn. Each
/// line does its beat's job: the right words kept (never the primer's "Uh"), the right request, and none ends the
/// stream. The rules each line meets have their own tests; this one holds the video's script to them, so a rule
/// change that breaks a beat fails at merge, not in a take. Keep its lines in step with the video's script.
#[tokio::test]
async fn the_videos_script_as_the_transcriber_sends_it_does_every_beats_job() {
    let (core, mut updates, path) = listening();
    let mut primer = Primer::default();
    let mut send = |event: serde_json::Value| handle(&core, "you", &mut primer, &event.to_string(), None);
    for event in [
        serde_json::json!({"type": "speechStart", "audioProcessedMs": 0, "turnId": 0}),
        serde_json::json!({"type": "transcript", "transcript": "Uh", "final": false, "audioProcessedMs": 960}),
    ] {
        assert!(!send(event));
    }
    // (line, its drafts, the turn it's in, what's kept, what's done)
    let at = |s: u64| PRIMER_MS + s * 1000;
    let lines: [(&str, &[&str], u64, &[&str], &[&str]); 12] = [
        ("Uh, my biggest problem is that I never finish my", &["Uh, my biggest", "Uh, my biggest problem is that"], 0,
            &["My biggest problem is that I never finish my"], &[]),
        ("Oh, and rent is due Friday and I still haven't sent it.", &["Oh, and rent"], 1, &["Oh, and rent is due Friday and I still haven't sent it."], &[]),
        ("Wait, where was I?", &["Wait, where"], 2, &[], &["Back to Never finish: “My biggest problem is that I never finish my”"]),
        ("Sentences. I never finish my sentences.", &["Sentences."], 3, &["Sentences. I never finish my sentences."], &[]),
        ("Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.", &["Mom's birthday"], 4,
            &["Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street."], &[]),
        ("Okay, decided: if it's under eighty dollars, I'm booking it tonight.", &["Okay, decided"], 5,
            &["Okay, decided: if it's under eighty dollars, I'm booking it tonight."], &[]),
        ("My stats midterm is Thursday, chapters four to six.", &["My stats"], 6, &["My stats midterm is Thursday, chapters four to six."], &[]),
        ("Decided: I'll study with Partner on Wednesday night.", &["Decided"], 7, &["Decided: I'll study with Partner on Wednesday night."], &[]),
        ("Make an app that plays a silly tune if we get loud.", &["Make an app"], 8, &[], &["app"]),
        ("And Mom is going to love that pottery class, I'm so excited!", &["And Mom"], 9, &["And Mom is going to love that pottery class, I'm so excited!"], &[]),
        ("What did I decide today?", &["What did I"], 10, &[], &["recap"]),
        ("Palace.", &["Palace"], 11, &[], &["palace"]),
    ];
    // Where the placer puts each kept line in the takes: (thread, finished).
    let placed = [("Never finish", false), ("Rent", true), ("", true), ("Never finish", true), ("Birthday", true), ("Birthday", true),
        ("Midterm", true), ("Midterm", true), ("", true), ("Birthday", true), ("", true), ("", true)];
    for (i, (line, drafts, turn, kept, did)) in lines.into_iter().enumerate() {
        let start = at(8 * i as u64 + 1);
        if turn > 0 {
            assert!(!send(serde_json::json!({"type": "speechStart", "audioProcessedMs": start, "turnId": turn})));
        }
        for (n, draft) in drafts.iter().enumerate() {
            assert!(!send(serde_json::json!({"type": "transcript", "transcript": draft, "final": false, "audioProcessedMs": start + 300 * n as u64})));
        }
        let before = texts(&core).len();
        let end = serde_json::json!({"type": "speechComplete", "transcript": line, "audioProcessedMs": start + 4_000, "turnId": turn});
        assert!(!send(end), "{line}: no demo line ends the stream");
        // A recap answers from a task of its own.
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        let (shown, done) = told(&mut updates);
        assert!(shown.iter().all(|s| !s.starts_with("Uh")), "{line}: the primer's word shows: {shown:?}");
        assert_eq!(texts(&core)[before..], kept[..], "{line}");
        assert_eq!(done, did, "{line}");
        if let (Some(text), (thread, complete)) = (kept.first(), placed[i]) {
            place(&core, text, thread, complete);
        }
    }
    let _ = std::fs::remove_file(&path);
}

/// "Stop listening" ends the stream where it's said: the words before it are kept, the window pauses, and nothing
/// the service sends after it is read or kept (docs/COMMANDS.md: "nothing after it is heard, sent or kept"). Words
/// finished before the window stops the mic itself still land: the service sends them, then closes.
#[tokio::test(start_paused = true)]
async fn after_stop_listening_nothing_more_is_read_or_kept() {
    let (core, mut updates, path) = listening();
    let event = |v: serde_json::Value| Ok::<_, tokio_tungstenite::tungstenite::Error>(Message::Text(v.to_string().into()));
    let said = [
        event(serde_json::json!({"type": "transcript", "transcript": "Rent is", "audioProcessedMs": PRIMER_MS + 900})),
        event(serde_json::json!({"type": "speechComplete", "transcript": "Rent is due Friday.", "audioProcessedMs": PRIMER_MS + 2_000, "turnId": 1})),
        event(serde_json::json!({"type": "speechComplete", "transcript": "Okay, stop listening.", "audioProcessedMs": PRIMER_MS + 5_000, "turnId": 2})),
        event(serde_json::json!({"type": "speechComplete", "transcript": "Buy milk.", "audioProcessedMs": PRIMER_MS + 8_000, "turnId": 3})),
    ];
    let mut stream = Box::pin(futures_util::stream::iter(said).chain(futures_util::stream::pending()));
    let started = tokio::time::Instant::now();
    assert!(hear(&core, "you", &mut stream, None).await.is_ok());
    assert_eq!(started.elapsed(), std::time::Duration::ZERO, "it ends at the stop, not at a timeout");
    assert!(matches!(stream.next().await, Some(Ok(_))), "the turn after it is never read");
    assert_eq!(texts(&core), ["Rent is due Friday."]);
    assert_eq!(told(&mut updates).1, ["pause"]);

    // The window tapped the mic off: the relay ends the stream, the service finishes the turn said, then closes.
    let (core, _, path2) = listening();
    let said = [
        event(serde_json::json!({"type": "transcript", "transcript": "Call the", "audioProcessedMs": PRIMER_MS + 600})),
        event(serde_json::json!({"type": "speechComplete", "transcript": "Call the landlord.", "audioProcessedMs": PRIMER_MS + 1_400, "turnId": 1})),
        Ok(Message::Close(None)),
    ];
    assert!(hear(&core, "you", &mut Box::pin(futures_util::stream::iter(said)), None).await.is_ok());
    assert_eq!(texts(&core), ["Call the landlord."]);
    for p in [path, path2] {
        let _ = std::fs::remove_file(&p);
    }
}

/// Every way to say "stop listening" that the pack reads both ends the stream (`stops_listening`, here) and pauses
/// the window (`act`, through `add_thought`): alone, after a lead-in, and after a thought and a pause. A phrase
/// only one of them reads would leave the window "Listening" to a closed stream, or paused while words still land.
#[test]
fn every_stop_phrase_ends_the_stream_and_pauses_the_window() {
    for ask in crate::spoken::STOP_ASKS {
        for tail in [""].iter().chain(&crate::spoken::STOP_TAILS) {
            let phrase = format!("{ask} {tail}").trim().to_string();
            for (said, kept) in [
                (format!("{phrase}."), vec![]),
                (format!("Okay, {phrase}."), vec![]),
                (format!("Rent is due Friday. {phrase}."), vec!["Rent is due Friday.".to_string()]),
            ] {
                let (core, mut updates, path) = listening();
                let turn = serde_json::json!({"type": "speechComplete", "transcript": said}).to_string();
                assert!(handle(&core, "you", &mut Primer::default(), &turn, None), "{said}: the stream goes on");
                assert_eq!(told(&mut updates).1, ["pause"], "{said}");
                assert_eq!(texts(&core), kept, "{said}");
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// A service error reaches the speaker's window with the words the window stops its mic on (ui/src/core.ts reads
/// "Voice Transcribe:" and "Speech service error:"), even inside the primer's stretch; a refused key is told as
/// any model call's, and the busy service once to everyone.
#[test]
fn a_voice_error_reaches_the_window_with_the_words_it_stops_on() {
    let window = include_str!("../../../../ui/src/core.ts");
    for prefix in ["Voice Transcribe:", "Speech service error:"] {
        assert!(window.contains(&format!("msg.message.startsWith(\"{prefix}\")")), "the window no longer stops its mic on {prefix}");
    }
    assert!(include_str!("../../main.rs").contains("ServerMsg::Error { message: format!(\"Speech service error: {e}\") }"));
    for (event, refused) in [
        (serde_json::json!({"type": "error", "errorType": "rate_limit_error", "message": "Too many requests", "audioProcessedMs": 120}), false),
        (serde_json::json!({"type": "error", "errorType": "authentication_error", "message": "Invalid key"}), true),
    ] {
        let (core, mut updates, path) = listening();
        assert!(!handle(&core, "you", &mut Primer::default(), &event.to_string(), None));
        let errors: Vec<(Option<String>, String)> = std::iter::from_fn(|| updates.try_recv().ok())
            .filter_map(|out| match out.message { ServerMsg::Error { message } => Some((out.to, message)), _ => None })
            .collect();
        assert_eq!(errors, [(Some("you".to_string()), format!("Voice Transcribe: {}", event["message"].as_str().unwrap()))]);
        assert_eq!(core.key_refused(), refused, "{event}");
        let _ = std::fs::remove_file(&path);
    }
}

/// Words still coming count as talk, so the refiner and the pictures hold off until a pause (refiner.rs: nothing
/// moves under someone mid-sentence); a progress report alone does not.
#[tokio::test(start_paused = true)]
async fn a_draft_counts_as_talk_and_progress_does_not() {
    let (core, _, path) = listening();
    let quiet_room = futures_util::stream::iter([
        Ok(Message::Text(serde_json::json!({"type": "audioProgress", "audioProcessedMs": PRIMER_MS + 80}).to_string().into())),
        Ok(Message::Close(None)),
    ]);
    assert!(hear(&core, "you", &mut Box::pin(quiet_room), None).await.is_ok());
    assert!(core.quiet_ms() > 60_000, "progress isn't talk");
    let draft = serde_json::json!({"type": "transcript", "transcript": "My biggest problem", "audioProcessedMs": PRIMER_MS + 900});
    handle(&core, "you", &mut Primer::default(), &draft.to_string(), None);
    assert!(core.quiet_ms() < 1_000, "a draft is talk");
    let _ = std::fs::remove_file(&path);
}

/// The primer's turn closes at the next turn's end too, not only at its start: a service that skips a speechStart
/// mustn't keep stripping "Uh" off every later draft, so the live words always match what's kept.
#[test]
fn a_later_turns_end_closes_the_primers_too() {
    let events = [
        serde_json::json!({"type": "speechStart", "audioProcessedMs": 0, "turnId": 0}),
        serde_json::json!({"type": "transcript", "transcript": "Uh", "audioProcessedMs": 960}),
        serde_json::json!({"type": "speechComplete", "transcript": "My biggest problem is that I never finish my", "audioProcessedMs": PRIMER_MS + 4_000, "turnId": 1}),
        serde_json::json!({"type": "transcript", "transcript": "Uh, oh and rent", "audioProcessedMs": PRIMER_MS + 7_000}),
        serde_json::json!({"type": "speechComplete", "transcript": "Uh, oh and rent is due Friday.", "audioProcessedMs": PRIMER_MS + 9_000, "turnId": 2}),
    ];
    let (core, mut updates, path) = listening();
    let mut state = Primer::default();
    for event in &events {
        handle(&core, "you", &mut state, &event.to_string(), None);
    }
    assert!(!state.open);
    assert_eq!(told(&mut updates).0, ["Uh, oh and rent"], "the draft shows as it will be kept");
    assert_eq!(texts(&core), ["My biggest problem is that I never finish my", "Uh, oh and rent is due Friday."]);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn recognized_notice_commands_reach_the_window() {
    let (core, mut updates, path) = listening();
    for (turn, words, expected) in [(1, "Stop showing this.", false), (2, "Show those again.", true)] {
        let event = serde_json::json!({"type":"speechComplete", "transcript":words,
            "audioProcessedMs": PRIMER_MS + turn * 4000, "turnId":turn});
        assert!(!handle(&core, "you", &mut Primer::default(), &event.to_string(), None));
        assert!(std::iter::from_fn(|| updates.try_recv().ok()).any(|out|
            matches!(out.message, ServerMsg::NoticeControl { show } if show == expected)));
        assert!(core.snapshot().thoughts.is_empty());
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn delivery_late_final_reconciles_the_same_recovery_once() {
    for choice in [None, Some(true), Some(false)] {
        let (core, _updates, path) = listening();
        let mut primer = Primer::default();
        let draft = serde_json::json!({"type":"transcript", "transcript":"Keep these unfinished", "turnId":71, "audioProcessedMs":PRIMER_MS + 700});
        handle(&core, "you", &mut primer, &draft.to_string(), None);
        primer.recover(&core);
        let id = core.snapshot().speech_drafts.values().next().unwrap().id.clone();
        if let Some(keep) = choice { core.recover_speech("you", &id, keep); }
        let final_words = serde_json::json!({"type":"speechComplete", "transcript":"Keep these unfinished words.", "turnId":71, "audioProcessedMs":PRIMER_MS + 900});
        for _ in 0..2 { handle(&core, "you", &mut primer, &final_words.to_string(), None); }
        assert!(core.snapshot().speech_drafts.is_empty());
        assert_eq!(core.snapshot().thoughts.len(), if choice == Some(false) { 0 } else { 1 });
        if choice == Some(true) { assert_eq!(core.snapshot().thoughts[0].text, "Keep these unfinished"); }
        std::fs::remove_file(path).unwrap();
    }
}
