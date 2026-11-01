//! Pictures: once a thread has a couple of thoughts, Muse Image draws one vivid picture
//! for it, a memory anchor in the spirit of a memory palace. One at a time, in the background.
//! The map shows a small copy; the full picture stays beside it on disk.

use crate::world::{Change, Thread};
use crate::Core;
use anyhow::{anyhow, bail, Context};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/images/generations";

/// The house style, so pictures read as one set and each still stands out: one concrete thing
/// with a twist (vivid, odd images are the ones a memory palace keeps), never a diagram,
/// drawn the same way every time, on a background color of its own.
const STYLE: &str = "A memory-palace picture: turn the topic into one concrete, physical thing (an object or a creature) \
doing something vivid and a little absurd, so it sticks in the mind: oversized, made of an unexpected material, \
or in an odd situation, yet clearly about the topic. If the topic is serious or painful, make it gentle instead of absurd. \
Never a diagram, chart, flowchart, collage, set of icons or screen. \
House style, the same for every picture: bold, simple 3D clay-style illustration, chunky rounded shapes, saturated colors, \
soft studio light, the subject centered and filling most of the square, on a plain flat background with nothing else on it. \
It must read at a glance as a tiny thumbnail. No text, letters, numbers, logos or borders.";

/// Background colors, warm and cool in turn, so threads started one after another never look alike.
const COLORS: [&str; 10] =
    ["coral", "teal", "mustard yellow", "cornflower blue", "tangerine", "mint green", "rose pink", "lavender", "lime green", "sky blue"];

/// The map shows pictures at 52 px or less; 128 px stays sharp on 2x and 3x screens.
const SMALL: u32 = 128;

/// Attempts per thread, so a passing failure (a timeout, a rate limit) doesn't cost it its picture.
const TRIES: u32 = 3;

pub async fn run(core: Arc<Core>, dir: PathBuf) {
    shrink_old(&core, &dir).await;
    let mut tries: HashMap<String, u32> = HashMap::new();
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        if core.key.is_none() {
            continue;
        }
        // Only while the person is quiet, and only for threads worth remembering:
        // three or more thoughts, or two once the talk has moved on for half a minute.
        if core.quiet_ms() < 4_000 {
            continue;
        }
        let world = core.snapshot();
        let now = crate::now_ms();
        let next = world.threads.iter().find(|t| {
            let thoughts = world.thoughts.iter().filter(|p| p.placed && p.thread_id.as_deref() == Some(t.id.as_str())).count();
            let moved_on = world.active.as_deref() != Some(t.id.as_str()) && now.saturating_sub(t.touched_ms) > 30_000;
            t.picture.is_none() && tries.get(&t.id).is_none_or(|n| *n < TRIES) && (thoughts >= 3 || (thoughts >= 2 && moved_on))
        });
        let Some(thread) = next.cloned() else { continue };
        *tries.entry(thread.id.clone()).or_default() += 1;
        let points: Vec<String> = world
            .thoughts
            .iter()
            .filter(|p| p.placed && p.thread_id.as_deref() == Some(thread.id.as_str()))
            .map(|p| p.point.clone())
            .collect();
        match draw(&core, &dir, &thread, &points).await {
            Ok(path) => core.commit(vec![Change::ThreadPicture { thread_id: thread.id, path }]),
            Err(e) => tracing::warn!("picture for {} failed: {e:#}", thread.id),
        }
    }
}

/// What Muse Image is asked for: the house style, the thread's own color, then what the thread is about.
fn prompt(thread: &Thread, points: &[String]) -> String {
    let number: usize = thread.id.trim_start_matches('T').parse().unwrap_or(0);
    let color = COLORS[number % COLORS.len()];
    // The first few points say what the thread is; more only makes the prompt longer.
    let details = points.iter().take(6).map(String::as_str).collect::<Vec<_>>().join("; ");
    format!("{STYLE} Background color: {color}. Topic: {}. Details: {details}.", thread.title)
}

async fn draw(core: &Core, dir: &Path, thread: &Thread, points: &[String]) -> anyhow::Result<String> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let body = serde_json::json!({
        "model": "muse-image-1.0",
        "prompt": prompt(thread, points),
        "n": 1,
        // Sets the shape only; Muse Image draws at its own size (1600 px).
        "size": "1024x1024",
        "output_format": "webp",
        // A picture needs no searching or code, and the person's thoughts stay out of web searches.
        "tool_enablement": {"enable_image_search": false, "enable_web_search": false, "enable_shell": false},
    });
    let response = core.http.post(URL).bearer_auth(key).json(&body).send().await?;
    let status = response.status();
    let value: serde_json::Value = response.json().await?;
    if !status.is_success() {
        bail!("{status}: {}", value["error"]["message"].as_str().unwrap_or("no message"));
    }
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

/// Pictures drawn before small copies existed get one now, so older maps load light too.
async fn shrink_old(core: &Core, dir: &Path) {
    for thread in core.snapshot().threads {
        let Some(name) = thread.picture.as_deref().and_then(|p| p.strip_prefix("/images/")) else { continue };
        if !name.ends_with(".webp") || name.ends_with("-small.webp") || name.contains(['/', '\\']) {
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

/// Writes the small copy of the full picture `name` next to it; returns the copy's path for the map.
async fn shrink(dir: &Path, name: &str, bytes: Vec<u8>) -> anyhow::Result<String> {
    let stem = name.strip_suffix(".webp").context("not a WebP picture")?;
    let small = tokio::task::spawn_blocking(move || small_copy(&bytes)).await??;
    let name = format!("{stem}-small.webp");
    tokio::fs::write(dir.join(&name), small).await?;
    Ok(format!("/images/{name}"))
}

/// A square copy at most `SMALL` pixels wide: the center, each new pixel the average of the ones it
/// covers, six bits a channel (no visible change this small, and half the bytes), lossless WebP.
fn small_copy(webp: &[u8]) -> anyhow::Result<Vec<u8>> {
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(webp))?;
    let (width, height) = decoder.dimensions();
    let channels = if decoder.has_alpha() { 4 } else { 3 };
    let mut pixels = vec![0u8; decoder.output_buffer_size().context("picture too large")?];
    decoder.read_image(&mut pixels)?;
    let side = width.min(height);
    let (left, top) = ((width - side) / 2, (height - side) / 2);
    let out = SMALL.min(side);
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
                small.push((value & !3) | (value >> 6));
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
        let small = small_copy(&full).unwrap();
        let mut decoder = image_webp::WebPDecoder::new(Cursor::new(&small)).unwrap();
        assert_eq!(decoder.dimensions(), (SMALL, SMALL));
        let mut out = vec![0u8; decoder.output_buffer_size().unwrap()];
        decoder.read_image(&mut out).unwrap();
        assert!(out.chunks(3).all(|p| p == [0, 0, 255]), "only the blue middle is kept");
    }

    #[test]
    fn neighboring_threads_get_different_colors() {
        let thread = |id: &str| Thread {
            id: id.into(),
            title: "Laundry".into(),
            parent_id: None,
            status: crate::world::ThreadStatus::Open,
            last_point: String::new(),
            touched_ms: 0,
            tags: vec![],
            picture: None,
        };
        let points = vec!["Fold it tonight".to_string()];
        assert_ne!(prompt(&thread("T3"), &points), prompt(&thread("T4"), &points));
        assert!(prompt(&thread("T3"), &points).ends_with("Topic: Laundry. Details: Fold it tonight."));
    }
}
