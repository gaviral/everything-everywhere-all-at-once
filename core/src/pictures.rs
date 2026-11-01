//! Pictures: once a thread has stayed quiet, Muse Image draws one vivid picture
//! for it, a memory anchor in the spirit of a memory palace. A few at a time, in the background.
//! The map shows a small copy and the Palace a larger one; the full picture stays beside them on disk.

use crate::world::{Change, Thread, World};
use crate::Core;
use anyhow::{anyhow, Context};
use futures_util::{stream::FuturesUnordered, StreamExt};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/images/generations";

/// What a picture is: the one object anyone would name for the topic, so it reads at 38 px on a folded card.
/// In blind matching on the sample at map size, busy clay scenes got 12-16 of 32 thumbnails paired with the right
/// title; one recognizable object, distinct from the map's other topics, got 30-32.
const SUBJECT: &str = "A picture that stands for the topic at a glance: the single most recognizable everyday object for it \
(for example an umbrella for a worry about the weather, a passport for a trip), alone. A twist only in material or scale, \
never one that hides what the object is. If the topic is serious or painful, keep it gentle. \
Exactly one object: no second object, no props, no scene, no ground line. Its outline must be unmistakable as a tiny silhouette. \
Avoid cultural, ethnic or national stereotypes. Never a diagram, chart, collage, set of icons or screen. \
The object is centered and fills most of the square, on a plain flat background with nothing else on it. \
No text, letters, numbers, logos or borders.";

/// Each room's color, in the order rooms started: none near the blue, amber or purple the app keeps for where you
/// are, what needs you and what the AI added. Siblings share it (their objects tell them apart), so a room reads as
/// one group in the Palace; the UI tints the room's titles with the same family (`ui/src/rooms.ts`).
// Cool and warm take turns, so neighboring rooms never look alike; a calm green comes first, red only fourth.
const FAMILIES: [&str; 5] = ["emerald green", "orchid pink", "teal", "raspberry red", "lime green"];

/// The other topics a prompt names, newest first: a Palace screen shows 18 tiles side by side (3 rows of 6).
const OTHERS: usize = 18;

/// The map shows pictures at 52 px or less; 128 px stays sharp on 2x and 3x screens.
const SMALL: u32 = 128;
/// The Palace's widest tile is ≈ 200 CSS px (its grid at a 700 px window; 171 px at full width), 400 pixels on a
/// 2x screen, where the map's 128 px copy was stretched ≈ 3×. 512 px keeps that sharp with room for larger tiles.
const PALACE: u32 = 512;

/// Attempts per thread, so a passing failure (a timeout, a rate limit) doesn't cost it its picture.
const TRIES: u32 = 3;

// A short topic gets an anchor too, but give the person time to add its next thought first.
const SETTLE_MS: u64 = 12_000;
// Placement shares the key: admit no new image calls mid-sentence or while thoughts await placement.
const QUIET_MS: u64 = 2_000;
const CONCURRENT: usize = 3;
const POLL: Duration = Duration::from_secs(1);
// Ten seconds between failed attempts at one picture, without stalling the others.
const RETRY_MS: u64 = 10_000;
/// How long Muse Image gets, its whole answer included. The 7 normal draws in the 2026-11-01 log took 11–27 s (the
/// slowest with three drawing at once), so a request still out at twice that, 55 s, is hung: it fails then and the
/// picture is drawn again (`RETRY_MS`, `TRIES`), instead of holding one of the three slots for two minutes.
const PATIENCE: Duration = Duration::from_secs(55);

#[derive(Default)]
struct Attempt {
    count: u32,
    in_flight: bool,
    retry_after: u64,
}

pub async fn run(core: Arc<Core>, dir: PathBuf) {
    // `PICTURES=off` draws none, for a test that isn't about pictures or anyone who doesn't want them (pictures were
    // a third of the API spend in a night of tests); threads keep their letter tiles.
    if std::env::var("PICTURES").is_ok_and(|value| value.eq_ignore_ascii_case("off")) {
        tracing::info!("pictures are off (PICTURES=off)");
        return;
    }
    shrink_old(&core, &dir).await;
    let mut attempts: HashMap<String, Attempt> = HashMap::new();
    let mut drawing = FuturesUnordered::new();
    let mut poll = tokio::time::interval(POLL);
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = poll.tick() => {}
            Some(completed) = drawing.next(), if !drawing.is_empty() => {
                let (id, result): (String, anyhow::Result<String>) = completed;
                let attempt = attempts.get_mut(&id).expect("drawing has an attempt");
                attempt.in_flight = false;
                match result {
                    Ok(path) => {
                        // A merge or another completed draw mustn't have its picture overwritten.
                        let world = core.snapshot();
                        let id = world.resolve(&id);
                        if world.thread(&id).is_some_and(|t| t.picture.is_none()) {
                            core.commit(vec![Change::ThreadPicture { thread_id: id, path }]);
                        }
                    }
                    Err(e) => {
                        attempt.retry_after = crate::now_ms().saturating_add(RETRY_MS);
                        tracing::warn!("picture for {id} failed: {e:#}");
                    }
                }
            }
        }
        if core.key().is_err() {
            continue;
        }
        let world = core.snapshot();
        for thread in ready(&world, &attempts, crate::now_ms(), core.quiet_ms()) {
            let points: Vec<String> = world
                .thoughts
                .iter()
                .filter(|p| p.placed && p.thread_id.as_deref() == Some(thread.id.as_str()))
                .map(|p| p.point.clone())
                .collect();
            let prompt = prompt(&world, thread, &points);
            let attempt = attempts.entry(thread.id.clone()).or_default();
            attempt.count += 1;
            attempt.in_flight = true;
            let (core, dir, thread) = (core.clone(), dir.clone(), thread.clone());
            drawing.push(async move {
                let started = crate::now_ms();
                let result = draw(&core, &dir, &thread, &prompt).await;
                if result.is_ok() {
                    tracing::info!("picture for {} drawn in {} ms", thread.id, crate::now_ms().saturating_sub(started));
                }
                (thread.id, result)
            });
        }
    }
}

/// Fill free slots, oldest quiet threads first; first pictures take priority over retries.
/// Active threads use the same delay, so the last topic gets a picture after the talk ends too.
fn ready<'a>(world: &'a World, attempts: &HashMap<String, Attempt>, now: u64, quiet_ms: u64) -> Vec<&'a Thread> {
    // Only fresh ones: a thought still unplaced after a minute failed and waits for a retry (as recap.rs `placing`),
    // and one that keeps failing mustn't stop pictures for the whole map.
    if quiet_ms < QUIET_MS || world.thoughts.iter().any(|p| !p.placed && now.saturating_sub(p.at_ms) < 60_000) {
        return Vec::new();
    }
    let slots = CONCURRENT.saturating_sub(attempts.values().filter(|a| a.in_flight).count());
    let mut threads: Vec<_> = world
        .threads
        .iter()
        .filter(|t| {
            t.picture.is_none()
                && now.saturating_sub(t.touched_ms) >= SETTLE_MS
                && world.thoughts.iter().any(|p| p.placed && p.thread_id.as_deref() == Some(t.id.as_str()))
                && attempts.get(&t.id).is_none_or(|a| !a.in_flight && a.count < TRIES && now >= a.retry_after)
        })
        .collect();
    threads.sort_by_key(|t| (attempts.get(&t.id).map_or(0, |a| a.count), t.touched_ms));
    threads.truncate(slots);
    threads
}

#[cfg(test)]
pub(crate) fn perf(world: &World, now: u64) {
    crate::perf::measure("picture ready + prompts", || {
        ready(world, &HashMap::new(), now + SETTLE_MS, QUIET_MS).iter().map(|thread| {
            let points = world.thoughts.iter().filter(|p| p.placed && p.thread_id.as_deref() == Some(thread.id.as_str()))
                .map(|p| p.point.clone()).collect::<Vec<_>>();
            prompt(world, thread, &points)
        }).collect::<Vec<_>>()
    }, |prompts| prompts.iter().map(String::len).sum());
}

/// What Muse Image is asked for: the object rule, the room's look, the topic, and the topics to keep it apart from.
fn prompt(world: &World, thread: &Thread, points: &[String]) -> String {
    let family = family(world, thread);
    // stand-in: E2A2O_LOOK=ink draws option 2 (house black ink) for side-by-side screenshots; one look ships.
    let look = if std::env::var("E2A2O_LOOK").as_deref() == Ok("ink") {
        "House style: bold flat illustration, simple shapes, no gradients. Colors: a near-black ink object with one \
mid-gray tone, on a plain light neutral gray background with no warm or cool tint; no other colors."
            .to_string()
    } else {
        format!(
            "House style: bold, simple 3D clay-style illustration, chunky rounded shapes, soft studio light. Colors: the \
object is made entirely of {family} clay in a few shades of {family}, on a pale, light {family} background; nothing in any other color."
        )
    };
    let mut prompt = format!("{SUBJECT} {look} Topic: {}.", thread.title);
    // The first point says what the thread is; more details invite props.
    if let Some(point) = points.first() {
        prompt += &format!(" Detail: {point}.");
    }
    let mut others: Vec<&Thread> = world.threads.iter().filter(|t| t.id != thread.id).collect();
    others.sort_by_key(|t| std::cmp::Reverse(t.touched_ms));
    let others = others.iter().take(OTHERS).map(|t| t.title.as_str()).collect::<Vec<_>>();
    if !others.is_empty() {
        prompt += &format!(
            " Other topics on this map: {}. Pick an object clearly different from what any of them would get.",
            others.join("; ")
        );
    }
    prompt
}

/// The color family of a thread's room: rooms take turns through `FAMILIES` in the order their first thread started.
fn family(world: &World, thread: &Thread) -> &'static str {
    let mut root = thread;
    // A parent chain can't be longer than the map; the bound keeps a broken one from looping.
    for _ in 0..world.threads.len() {
        match root.parent_id.as_deref().and_then(|id| world.thread(id)) {
            Some(parent) => root = parent,
            None => break,
        }
    }
    let index = world.threads.iter().filter(|t| t.parent_id.is_none()).position(|t| t.id == root.id).unwrap_or(0);
    FAMILIES[index % FAMILIES.len()]
}

async fn draw(core: &Core, dir: &Path, thread: &Thread, prompt: &str) -> anyhow::Result<String> {
    let body = serde_json::json!({
        "model": "muse-image-1.0",
        "prompt": prompt,
        "n": 1,
        // Sets the shape only; Muse Image draws at its own size (1600 px).
        "size": "1024x1024",
        "output_format": "webp",
        // A picture needs no searching or code, and the person's thoughts stay out of web searches.
        "tool_enablement": {"enable_image_search": false, "enable_web_search": false, "enable_shell": false},
    });
    let value = core.call_model(URL, &body, PATIENCE).await?;
    let encoded = value["data"][0]["b64_json"].as_str().context("no image in the answer")?;
    let bytes = decode(encoded)?;
    // Muse Image returns WebP ("RIFF" header); fall back to PNG's extension otherwise.
    let ext = if bytes.starts_with(b"RIFF") { "webp" } else { "png" };
    let name = format!("{}-{}.{ext}", thread.id, uuid::Uuid::new_v4().simple());
    tokio::fs::create_dir_all(dir).await?;
    tokio::fs::write(dir.join(&name), &bytes).await?;
    match shrink(dir, &name, bytes).await {
        Ok(path) => Ok(path),
        Err(e) => {
            tracing::warn!("no small copy of {name}, showing the full picture: {e:#}");
            Ok(format!("/images/{name}"))
        }
    }
}

/// Pictures drawn before the copies existed get them now, so older maps load light and their Palace stays sharp.
async fn shrink_old(core: &Core, dir: &Path) {
    for thread in core.snapshot().threads.clone() {
        let Some(name) = thread.picture.as_deref().and_then(|p| p.strip_prefix("/images/")) else { continue };
        if !name.ends_with(".webp") || name.contains(['/', '\\']) {
            continue;
        }
        if let Some(stem) = name.strip_suffix("-small.webp") {
            // A map copy from before Palace copies: make one if the full picture is still there (a shipped
            // sample keeps only its copies, and the Palace shows the map copy instead).
            let palace = dir.join(format!("{stem}-palace.webp"));
            if !tokio::fs::try_exists(&palace).await.unwrap_or(true) {
                if let Ok(bytes) = tokio::fs::read(dir.join(format!("{stem}.webp"))).await {
                    let copy = tokio::task::spawn_blocking(move || square_copy(&bytes, PALACE, 8)).await;
                    match copy.map_err(anyhow::Error::from).and_then(|copy| copy) {
                        Ok(copy) => {
                            if let Err(e) = tokio::fs::write(&palace, copy).await {
                                tracing::warn!("no Palace copy of {name}: {e:#}");
                            }
                        }
                        Err(e) => tracing::warn!("no Palace copy of {name}: {e:#}"),
                    }
                }
            }
            continue;
        }
        let small = match tokio::fs::read(dir.join(name)).await {
            Ok(bytes) => shrink(dir, name, bytes).await,
            Err(e) => Err(e.into()),
        };
        match small {
            Ok(path) => core.commit(vec![Change::ThreadPicture { thread_id: thread.id, path }]),
            Err(e) => tracing::warn!("no small copy of {name}: {e:#}"),
        }
    }
}

/// Writes the map's and the Palace's copies of the full picture `name` next to it; returns the map copy's path.
/// The Palace finds its copy by name ("-palace" for "-small").
async fn shrink(dir: &Path, name: &str, bytes: Vec<u8>) -> anyhow::Result<String> {
    let stem = name.strip_suffix(".webp").context("not a WebP picture")?;
    let (small, palace) =
        tokio::task::spawn_blocking(move || anyhow::Ok((square_copy(&bytes, SMALL, 6)?, square_copy(&bytes, PALACE, 8)?))).await??;
    tokio::fs::write(dir.join(format!("{stem}-palace.webp")), palace).await?;
    let name = format!("{stem}-small.webp");
    tokio::fs::write(dir.join(&name), small).await?;
    Ok(format!("/images/{name}"))
}

/// A square copy at most `side` pixels wide: the center, each new pixel the average of the ones it covers,
/// lossless WebP with `bits` a channel (six halve the bytes with no visible change at map size; the Palace's
/// larger copy keeps eight, so soft shading doesn't band).
fn square_copy(webp: &[u8], side: u32, bits: u32) -> anyhow::Result<Vec<u8>> {
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(webp))?;
    let (width, height) = decoder.dimensions();
    let channels = if decoder.has_alpha() { 4 } else { 3 };
    let mut pixels = vec![0u8; decoder.output_buffer_size().context("picture too large")?];
    decoder.read_image(&mut pixels)?;
    let (out, side) = (side.min(width.min(height)), width.min(height));
    let (left, top) = ((width - side) / 2, (height - side) / 2);
    let drop = 8 - bits.min(8);
    let mut small = Vec::with_capacity((out * out * channels) as usize);
    for y in 0..out {
        let (y0, y1) = (top + y * side / out, top + (y + 1) * side / out);
        for x in 0..out {
            let (x0, x1) = (left + x * side / out, left + (x + 1) * side / out);
            let mut sum = [0u32; 4];
            for row in y0..y1 {
                for column in x0..x1 {
                    let i = ((row * width + column) * channels) as usize;
                    for c in 0..channels as usize {
                        sum[c] += pixels[i + c] as u32;
                    }
                }
            }
            let count = (x1 - x0) * (y1 - y0);
            for total in &sum[..channels as usize] {
                let value = ((total + count / 2) / count) as u8;
                // Dropped low bits repeat the high ones, so white stays white.
                small.push(if drop == 0 { value } else { (value >> drop << drop) | (value >> (8 - drop)) });
            }
        }
    }
    let mut file = Vec::new();
    let mut encoder = image_webp::WebPEncoder::new(&mut file);
    // Keep the note Muse Image writes into each picture that says an AI made it.
    if let Some(xmp) = decoder.xmp_metadata()? {
        encoder.set_xmp_metadata(xmp);
    }
    let color = if channels == 4 { image_webp::ColorType::Rgba8 } else { image_webp::ColorType::Rgb8 };
    encoder.encode(&small, out, out, color)?;
    Ok(file)
}

/// Standard base64 decoding, kept here to avoid another dependency.
fn decode(text: &str) -> anyhow::Result<Vec<u8>> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in text.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        buffer = (buffer << 6) | value(c).ok_or_else(|| anyhow!("bad base64"))?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn topic(thoughts: usize) -> World {
        World {
            threads: vec![Thread {
                id: "T1".into(),
                title: "Laundry".into(),
                parent_id: None,
                status: crate::world::ThreadStatus::Open,
                last_point: String::new(),
                touched_ms: 1_000,
                tags: vec![],
                picture: None,
                dropped_by: String::new(),
            }],
            thoughts: (0..thoughts)
                .map(|i| crate::world::Thought {
                    id: format!("p{i}"),
                    speaker: "you".into(),
                    text: "Fold it tonight".into(),
                    point: "Fold it tonight".into(),
                    thread_id: Some("T1".into()),
                    placed: true,
                    unclear: String::new(),
                    guess: String::new(),
                    heard: String::new(),
                    fixed: String::new(),
                    complete: true,
                    at_ms: 1_000,
                    place_ms: Some(0),
                })
                .collect(),
            ..World::default()
        }
    }

    #[test]
    fn every_topic_settles_even_with_one_thought_or_still_active() {
        for count in [1, 2, 3, 10] {
            for active in [None, Some("T1".into()), Some("T2".into())] {
                let mut world = topic(count);
                world.active = active;
                let due = world.threads[0].touched_ms + SETTLE_MS;
                assert!(ready(&world, &HashMap::new(), due - 1, QUIET_MS).is_empty());
                assert_eq!(ready(&world, &HashMap::new(), due, QUIET_MS).len(), 1);
            }
        }
    }

    #[test]
    fn a_new_touch_restarts_the_settling_delay() {
        let mut world = topic(1);
        let now = 50_000;
        assert_eq!(ready(&world, &HashMap::new(), now, QUIET_MS).len(), 1);
        world.apply(&Change::ThreadTouched { thread_id: "T1".into(), last_point: "Hang it up".into(), at_ms: now });
        assert!(ready(&world, &HashMap::new(), now + SETTLE_MS - 1, QUIET_MS).is_empty());
        assert_eq!(ready(&world, &HashMap::new(), now + SETTLE_MS, QUIET_MS).len(), 1);
        assert!(ready(&world, &HashMap::new(), now - 1, QUIET_MS).is_empty(), "a future timestamp is not settled");
    }

    #[test]
    fn placement_and_the_persons_sentence_come_first() {
        let mut world = topic(1);
        let now = 50_000;
        assert!(ready(&world, &HashMap::new(), now, QUIET_MS - 1).is_empty());
        assert_eq!(ready(&world, &HashMap::new(), now, QUIET_MS).len(), 1);
        // A pending thought may be about any thread, so leave the shared key to the placer.
        let mut pending = world.thoughts[0].clone();
        pending.id = "pending".into();
        pending.thread_id = None;
        pending.placed = false;
        world.thoughts.push(pending);
        assert!(ready(&world, &HashMap::new(), now, QUIET_MS).is_empty());
        // Still unplaced a minute after it was said: it failed and waits for a retry, so pictures go on.
        assert_eq!(ready(&world, &HashMap::new(), world.thoughts[1].at_ms + 60_000, QUIET_MS).len(), 1);
        world.thoughts[1].placed = true;
        assert_eq!(ready(&world, &HashMap::new(), now, QUIET_MS).len(), 1);
    }

    #[test]
    fn empty_threads_and_existing_pictures_are_skipped() {
        let mut world = topic(0);
        assert!(ready(&world, &HashMap::new(), 50_000, QUIET_MS).is_empty());
        world = topic(1);
        world.threads[0].picture = Some("/images/kept-small.webp".into());
        assert!(ready(&world, &HashMap::new(), 50_000, QUIET_MS).is_empty());
    }

    #[test]
    fn no_duplicate_draws_and_retries_wait_then_stop_at_three() {
        let world = topic(1);
        let mut attempts = HashMap::new();
        attempts.insert("T1".into(), Attempt { count: 1, in_flight: true, retry_after: 0 });
        assert!(ready(&world, &attempts, 50_000, QUIET_MS).is_empty());
        let attempt = attempts.get_mut("T1").unwrap();
        attempt.in_flight = false;
        attempt.retry_after = 50_000 + RETRY_MS;
        assert!(ready(&world, &attempts, 50_000 + RETRY_MS - 1, QUIET_MS).is_empty());
        for count in [1, 2, TRIES] {
            attempts.get_mut("T1").unwrap().count = count;
            assert_eq!(ready(&world, &attempts, 50_000 + RETRY_MS, QUIET_MS).len(), usize::from(count < TRIES));
        }
    }

    #[test]
    fn free_slots_go_to_first_pictures_then_oldest_threads() {
        let mut world = World::default();
        for i in 1..=6 {
            let mut one = topic(1);
            let id = format!("T{i}");
            one.threads[0].id = id.clone();
            one.threads[0].touched_ms = 10_000 - i * 1_000;
            one.thoughts[0].id = format!("p{i}");
            one.thoughts[0].thread_id = Some(id);
            world.threads.extend(one.threads);
            world.thoughts.extend(one.thoughts);
        }
        let mut attempts = HashMap::new();
        let ids = |attempts: &HashMap<String, Attempt>| {
            ready(&world, attempts, 50_000, QUIET_MS).iter().map(|t| t.id.as_str()).collect::<Vec<_>>()
        };
        assert_eq!(ids(&attempts), ["T6", "T5", "T4"]);
        attempts.insert("T6".into(), Attempt { count: 1, in_flight: true, retry_after: 0 });
        attempts.insert("T5".into(), Attempt { count: 1, in_flight: false, retry_after: 0 });
        assert_eq!(ids(&attempts), ["T4", "T3"], "one in flight leaves two slots; retries wait behind new pictures");
        for id in ["T4", "T3"] {
            attempts.insert(id.into(), Attempt { count: 1, in_flight: true, retry_after: 0 });
        }
        assert!(ids(&attempts).is_empty(), "three requests already in flight");
    }

    #[test]
    fn small_copy_is_a_square_from_the_middle() {
        // 300 x 200: red on the left and right 50 px, blue in the middle 200 x 200.
        let (width, height) = (300u32, 200u32);
        let mut pixels = Vec::new();
        for _ in 0..height {
            for x in 0..width {
                pixels.extend_from_slice(if (50..250).contains(&x) { &[0, 0, 255] } else { &[255, 0, 0] });
            }
        }
        let mut full = Vec::new();
        image_webp::WebPEncoder::new(&mut full).encode(&pixels, width, height, image_webp::ColorType::Rgb8).unwrap();
        for (side, bits, expect) in [(SMALL, 6, SMALL), (PALACE, 8, 200)] {
            let copy = square_copy(&full, side, bits).unwrap();
            let mut decoder = image_webp::WebPDecoder::new(Cursor::new(&copy)).unwrap();
            assert_eq!(decoder.dimensions(), (expect, expect), "never larger than the picture's square");
            let mut out = vec![0u8; decoder.output_buffer_size().unwrap()];
            decoder.read_image(&mut out).unwrap();
            assert!(out.chunks(3).all(|p| p == [0, 0, 255]), "only the blue middle is kept");
        }
    }

    #[test]
    fn rooms_take_turns_through_the_colors_and_branches_share_their_room() {
        let thread = |id: &str, parent: Option<&str>, title: &str, touched_ms: u64| Thread {
            id: id.into(),
            title: title.into(),
            parent_id: parent.map(Into::into),
            status: crate::world::ThreadStatus::Open,
            last_point: String::new(),
            touched_ms,
            tags: vec![],
            picture: None,
            dropped_by: String::new(),
        };
        let mut world = World::default();
        world.threads = vec![thread("T1", None, "Laundry", 1), thread("T2", None, "Rent", 2), thread("T3", Some("T1"), "Socks", 3)];
        assert_eq!(family(&world, &world.threads[0]), FAMILIES[0]);
        assert_eq!(family(&world, &world.threads[1]), FAMILIES[1]);
        assert_eq!(family(&world, &world.threads[2]), FAMILIES[0], "a branch has its room's color");
        let points = vec!["Fold it tonight".to_string(), "Buy softener".to_string()];
        let laundry = prompt(&world, &world.threads[0], &points);
        assert!(laundry.contains("of emerald green clay"), "{laundry}");
        assert!(laundry.contains("Topic: Laundry. Detail: Fold it tonight. Other topics on this map: Socks; Rent."), "{laundry}");
        assert!(!laundry.contains("Buy softener"), "one point says what it is");
        assert!(laundry.contains("Avoid cultural, ethnic or national stereotypes."));
    }
}
