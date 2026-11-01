//! What the core and the UI say to each other over the WebSocket.
//! Audio from the UI arrives separately, as binary frames of 24 kHz 16-bit PCM.

use crate::world::{Change, World};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    RecapState { period: crate::recap::Period, loading: bool, message: String, recap: Option<crate::recap::Recap> },
    AppsBuild { build: crate::apps::Build },
    AppsSound { name: String },
    Snapshot { world: std::sync::Arc<World> },
    Change { change: Change },
    /// Draft words of the turn being spoken; replaces the previous draft.
    Partial { text: String },
    Status { listening: bool, note: String },
    Error { message: String },
    /// A gentle note, e.g. "Back to Pay rent".
    Notice { message: String },
    /// A private jump to an existing answer; not replayed when a journal opens.
    Found { thread_id: String, thought_id: Option<String>, message: String },
    /// The answer to an Explain request; `failed` when there's none, so the UI can offer to try again.
    Explanation { id: String, text: String, failed: bool },
    /// How an import of past chats is going; only to the person importing, and again if they reconnect mid-import.
    Import { status: crate::import::Status },
}

/// A message on its way out: to every window, or only to one speaker's (in a room, each person's
/// own live words, mic and notices stay on their own laptop).
#[derive(Clone)]
pub struct Outgoing {
    pub to: Option<String>,
    pub message: ServerMsg,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Recap { #[serde(default)] period: crate::recap::Period },
    ComposeApp { request: String },
    DecideApp { build_id: String, keep: bool },
    ToggleApp { id: String, enabled: bool },
    RemoveApp { id: String },
    AppVolume { level: f64 },
    AppOutput { id: String, sound: bool },
    /// A typed thought.
    Text { text: String },
    /// Start or stop listening to the microphone.
    Listen { on: bool },
    /// Go back to a thread, e.g. from the unfinished-thought card.
    Focus { thread_id: String },
    /// Explain a selected phrase in the context it appears in, within its thread when it has one.
    Explain {
        id: String,
        text: String,
        context: String,
        #[serde(default)]
        thread_id: Option<String>,
    },
    /// Keep or dismiss a suggestion, or dismiss an action.
    Item { id: String, status: crate::world::ItemStatus },
    /// Approve an action: add it to Reminders or Calendar.
    Approve { id: String },
    /// Keep a suggested hashtag, or remove one.
    Tag { thread_id: String, tag: String, keep: bool },
    /// Answer a "Did you mean …?": take the guess, or keep the words as heard.
    Correct { thought_id: String, accept: bool },
    /// The person came back to the window: a good moment to tidy the map.
    Visible,
    /// Start importing a file the core has read (POST /import returned its id), as this window's speaker.
    ImportStart { id: String },
    /// Stop the running import; what already landed stays.
    ImportCancel,
}
