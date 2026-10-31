//! Pictures: once a thread has a couple of thoughts, Muse Image draws one calm picture
//! for it, a memory anchor in the spirit of a memory palace. One at a time, in the background.

use crate::world::Change;
use crate::Core;
use anyhow::{anyhow, bail, Context};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const URL: &str = "https://api.meta.ai/v1/images/generations";

/// The house style, so pictures read as one set of memory cards: one clear object
/// that stands for the topic, recognizable even as a small thumbnail.
const STYLE: &str = "A memory card: one clear central object or scene that stands for the topic, \
recognizable at thumbnail size. Flat illustration, soft pastel palette, simple shapes, generous empty space. \
No text, no letters, no logos.";

pub async fn run(core: Arc<Core>, dir: PathBuf) {
    let mut tried: HashSet<String> = HashSet::new();
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
            t.picture.is_none() && !tried.contains(&t.id) && (thoughts >= 3 || (thoughts >= 2 && moved_on))
        });
        let Some(thread) = next.cloned() else { continue };
        tried.insert(thread.id.clone());
        let points: Vec<String> = world
            .thoughts
            .iter()
            .filter(|p| p.placed && p.thread_id.as_deref() == Some(thread.id.as_str()))
            .map(|p| p.point.clone())
            .collect();
        match draw(&core, &dir, &thread.id, &thread.title, &points.join("; ")).await {
            Ok(path) => core.commit(vec![Change::ThreadPicture { thread_id: thread.id, path }]),
            Err(e) => tracing::warn!("picture for {} failed: {e:#}", thread.id),
        }
    }
}

async fn draw(core: &Core, dir: &PathBuf, thread_id: &str, title: &str, details: &str) -> anyhow::Result<String> {
    let key = core.key.as_deref().ok_or_else(|| anyhow!("MODEL_API_KEY is not set"))?;
    let prompt = format!("{STYLE} Topic: {title}. Details: {details}.");
    let body = serde_json::json!({"model": "muse-image-1.0", "prompt": prompt, "n": 1, "size": "1024x1024"});
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
    let name = format!("{thread_id}-{}.{ext}", uuid::Uuid::new_v4().simple());
    tokio::fs::create_dir_all(dir).await?;
    tokio::fs::write(dir.join(&name), &bytes).await?;
    Ok(format!("/images/{name}"))
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
