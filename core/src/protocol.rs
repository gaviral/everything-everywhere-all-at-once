//! What the core and the UI say to each other over the WebSocket.
//! Audio from the UI arrives separately, as binary frames of 24 kHz 16-bit PCM.

use crate::world::{Change, World};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Snapshot { world: World },
    Change { change: Change },
    /// Draft words of the turn being spoken; replaces the previous draft.
    Partial { text: String },
    Status { listening: bool, note: String },
    Error { message: String },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    /// A typed thought.
    Text { text: String },
    /// Start or stop listening to the microphone.
    Listen { on: bool },
    /// Go back to a thread, e.g. from a pull-back card.
    Focus { thread_id: String },
}
