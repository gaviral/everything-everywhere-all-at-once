//! What the core and the UI say to each other over the WebSocket.
//! Audio from the UI arrives separately, as binary frames of 24 kHz 16-bit PCM.

use crate::world::{Change, World};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    RecapState { period: crate::recap::Period, loading: bool, message: String, recap: Option<crate::recap::Recap> },
    AppsBuild { build: crate::apps::Build },
    /// An app's tune: `playful` for loud voices, else the calm one; `why` is what set it off ("voices stayed loud
    /// for 3 s"), so the window can say which app played and why.
    AppsSound { name: String, playful: bool, why: String },
    /// Approving an action didn't add it; it is offered again, and the window shows `message` on its row.
    ActionFailed { id: String, message: String },
    Snapshot { world: std::sync::Arc<World> },
    Change { change: Change },
    /// Draft words of the turn being spoken; replaces the previous draft.
    Partial { text: String },
    Status { listening: bool, note: String },
    Error { message: String },
    /// A gentle note, e.g. "Back to Pay rent". An empty one takes down a search's "Looking through your threads…",
    /// which stays until its answer: something newer stopped the search.
    Notice { message: String },
    /// The notice just sent answers a request that can be taken back: the window shows Undo beside it, which sends
    /// this id back (catalog.rs).
    Undoable { id: u64 },
    /// The speaker's last turn can be corrected ("No, I meant …") for `for_ms` more (0: no longer), and undoing it,
    /// which a correction does first, moves them to `back_to` (none: they stay). The window's "this" mark previews a
    /// correction with it, so it marks the card the redo will act on, and none when nothing would (catalog.rs).
    Correctable { for_ms: u64, back_to: Option<String> },
    /// Undo of a view or a fold asked by voice: the window puts back what it showed before that ask (its view, Focus,
    /// and which threads were open), which only it knows (catalog.rs).
    Revert,
    /// A private jump to an existing answer; not replayed when a journal opens.
    Found { thread_id: String, thought_id: Option<String>, message: String },
    /// A view asked for by voice ("palace", "show the map", "let's focus", "what can I say?"); only to the speaker's windows.
    View { view: View },
    /// Open or fold a thread and every branch under it ("expand the garden", "collapse this"), or every thread when
    /// `thread_id` is none; only to the speaker's windows, and it stays so until changed (spoken.rs).
    Unfold { thread_id: Option<String>, open: bool },
    /// The answer to an Explain request; `failed` when there's none, so the UI can offer to try again.
    Explanation { id: String, text: String, failed: bool },
    /// How an import of past chats is going; only to the person importing, and again if they reconnect mid-import.
    Import { status: crate::import::Status },
    /// Where unplaced thoughts stand: the one being placed now, and each that failed a try, with the time until it
    /// tries again. Any other is waiting in line. Sent whenever it changes, and on connect.
    Placing { now: Option<String>, retries: Vec<crate::placer::Retry> },
    /// One step of the work, for the window's model line (ui/src/model-line.ts): the step (the trace's feature:
    /// "placer", "refiner", "picture", "recap", "app", "listen", …) and the model doing it, or none when a rule did
    /// it ("Where was I?", an app's tune). A model call is told twice, as it starts and as it ends (`done`, with
    /// `ms` and `ok`), sharing `id`. Sent from where every call goes through (model.rs), so the name shown is the
    /// name asked, never a label kept by hand.
    Step { id: u64, step: String, model: Option<String>, done: bool, ok: bool, ms: u64 },
}

/// What a window shows, as its buttons set it: the map or the Palace; the map with only the speaker's
/// thread and its branches (Focus), or with every thread again (Show all); or the "?" list of what you
/// can say (Help), which opens on any map, an empty one too. Also the window's own buttons: Later on the
/// unfinished card ("later"), setting it aside for good as a second Later does ("forget it"), its Finish it
/// ("finish"), and the mic, off ("stop listening").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum View {
    Map,
    Palace,
    Focus,
    All,
    Help,
    Later,
    Forget,
    Finish,
    Pause,
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
    /// Mark an AI answer as off, or take the mark back: `kind` is "explain" (the request's id) or "recap"
    /// (its period and when it was made, as "today-1793547629176").
    Mark { kind: String, id: String, off: bool },
    /// Keep or dismiss a suggestion, or dismiss an action.
    Item { id: String, status: crate::world::ItemStatus },
    /// Approve an action: add it to Reminders or Calendar.
    Approve { id: String },
    /// Keep a suggested hashtag, or remove one.
    Tag { thread_id: String, tag: String, keep: bool },
    /// Answer a "Did you mean …?": take the guess, or keep the words as heard.
    Correct { thought_id: String, accept: bool },
    /// "Not one idea": the thought stops carrying on the words before a pause (chunks.rs).
    Unlink { thought_id: String },
    /// What "this" means here: the thread the person selected (keyboard focus they moved there, or words selected
    /// in it) and the one under their pointer, sent when either changes (catalog.rs `this`).
    Attention {
        #[serde(default)]
        selected: Option<String>,
        #[serde(default)]
        pointed: Option<String>,
    },
    /// The Undo button on a notice: take back the request it was shown for (catalog.rs).
    Undo { id: u64 },
    /// A rename or merge the refiner proposed: Rename or Merge applies it, × (`apply` false) keeps things as they are.
    Tidy { id: String, apply: bool },
    /// The Undo on the note about a rename or merge: `thread_id` is the renamed thread, or the one merged away.
    Untidy { kind: crate::tidy::Kind, thread_id: String },
    /// The point's Move: the thought (and the words it carries on) to another thread, or none: a new thread of its own
    /// (moves.rs).
    Move {
        thought_id: String,
        #[serde(default)]
        thread_id: Option<String>,
    },
    /// A title typed on a thread's card (moves.rs).
    Rename { thread_id: String, title: String },
    /// The person came back to the window: a good moment to tidy the map.
    Visible,
    /// Start importing a file the core has read (POST /import returned its id), as this window's speaker.
    ImportStart { id: String },
    /// Stop the running import; what already landed stays.
    ImportCancel,
}
