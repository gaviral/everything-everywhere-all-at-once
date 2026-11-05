//! Hosted HTTP boundary. Optional local tools never become hosted capabilities.
use crate::{Core, Link};
use axum::{extract::DefaultBodyLimit, routing::{get, post}, Extension, Router};
use std::{path::Path, sync::Arc};
use tower_http::services::{ServeDir, ServeFile};

pub const JSON_BYTES: usize = 2 << 20;

#[derive(Clone, Copy, Default)]
pub struct Policy {
    pub hosted: bool,
    pub development: bool,
    pub canvas: bool,
}

impl Policy {
    pub fn from_env() -> Self {
        Self {
            hosted: crate::hosted(),
            development: enabled("E2A2O_DEV_TOOLS"),
            canvas: enabled("E2A2O_CODE_CANVAS"),
        }
    }

    pub fn allows(self, path: &str, link: Link) -> bool {
        let local = !self.hosted && link.from.ip().is_loopback() && link.to.ip().is_loopback();
        if path.starts_with("/code-canvas/") { return local && self.canvas; }
        if matches!(path, "/build-id" | "/build-activity" | "/bricks.html")
            || path.starts_with("/workshop/") || path.starts_with("/crew/")
        { return local && self.development; }
        // Vite's playground and component fixtures are never served by a hosted core.
        if path.starts_with("/src/") || path.starts_with("/__") { return false; }
        true
    }
}

fn enabled(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| crate::trace::on(&value))
}

pub fn development() -> bool {
    let policy = Policy::from_env();
    !policy.hosted && policy.development
}

/// Check the decoded path before either the API or the static-file fallback sees it.
pub fn request_path(path: &str) -> Option<String> {
    let mut decoded = Vec::with_capacity(path.len());
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        let byte = if byte == b'%' {
            let hex = |b: u8| (b as char).to_digit(16).map(|n| n as u8);
            let (Some(a), Some(b)) = (bytes.next().and_then(hex), bytes.next().and_then(hex)) else { return None; };
            a * 16 + b
        } else { byte };
        if byte == b'\\' || byte.is_ascii_control() { return None; }
        decoded.push(byte);
    }
    if decoded.split(|byte| *byte == b'/').any(|part| part.starts_with(b".")) { return None; }
    String::from_utf8(decoded).ok()
}

fn product_routes() -> Router<Arc<Core>> {
    Router::new()
        .route("/ws", get(crate::connect))
        .route("/ws/my-words", get(crate::glossary::connect))
        .route("/room", get(crate::room_info))
        .route("/memory/stats", get(crate::memory::read))
        .route("/terse", post(crate::terse::read))
        .route("/clarify", post(crate::clarify::ask))
        .route("/draw/read", post(crate::draw::read))
        .route("/draw/back", post(crate::draw::back))
        .route("/flow/plan", post(crate::flow::plan))
        .route("/flow/finish", post(crate::flow::finish))
        .route("/flow/send", post(crate::flow::send))
        .route("/flow/run", post(crate::flow::run))
        .route("/flow/turns", get(crate::flow::turns))
        .route("/flow/library", get(crate::flow::library).post(crate::flow::save))
        .route("/helper-result", post(crate::helper_result::read))
        .route("/evidence/{id}", get(crate::evidence::read))
}

fn local_routes() -> Router<Arc<Core>> {
    Router::new()
        .route("/code-canvas/snapshot", get(crate::code_canvas::read))
        .route("/code-canvas/events", get(crate::system_view::events))
        .route("/code-canvas/answer", post(crate::code_canvas::answer))
        .route("/build-id", get(crate::dev_build::status))
        .route("/build-activity", post(crate::dev_build::activity))
        .route("/workshop/turns", get(crate::workshop::turns))
        .route("/workshop/catalog", get(crate::workshop::catalog))
        .route("/workshop/run", post(crate::workshop::run))
        .route("/workshop/hackathon", get(crate::workshop::hackathon))
        .route("/crew/plan", post(crate::crew::plan))
        .route("/crew/build", post(crate::crew::build))
        .route("/crew/merge", post(crate::crew::merge))
        .route("/crew/promote", post(crate::crew::promote))
}

pub fn router(core: Arc<Core>, ui: &Path, images: &Path, policy: Policy) -> Router {
    product_routes().merge(local_routes())
        .layer(DefaultBodyLimit::max(JSON_BYTES))
        // Import reads a bounded raw body itself and is host-only (import::prepare).
        .route("/import", post(crate::import::prepare).layer(DefaultBodyLimit::max(crate::import::MAX_BYTES)))
        .nest_service("/images", ServeDir::new(images))
        .fallback_service(ServeDir::new(ui).fallback(ServeFile::new(ui.join("index.html"))))
        .layer(axum::middleware::from_fn_with_state(core.clone(), crate::gate))
        .layer(Extension(policy))
        .with_state(core)
}

#[cfg(test)]
mod tests;
