//! What the core and the UI say to each other over the WebSocket.
//! Audio from the UI arrives separately, as binary frames of 24 kHz 16-bit PCM.

use crate::world::{Change, World};
use serde::{Deserialize, Serialize};

// Bounds on what a window sends (ui/src/limits.ts holds the same numbers; scripts/limits-check.mjs keeps them equal).
// Each is the longest real use plus a wide margin, so no one meets it by talking or typing; past it, one paste or a
// guest's script would ride along in every later model call (each placement lists every title).

/// A typed thought, in characters: the placer's answer room grows with a turn to its ceiling at 6,000 bytes
/// (placer.rs `room_for`, `MAX_ROOM`), so a longer one could lose its answer. Longest real thoughts: dictated turns of
/// 1,444, 1,405 and 1,266 characters (2026-11-02, 46 turns on one map, median 241); a 1,513-character routing case
/// is placed in one round (no answer cut off at its room).
pub const THOUGHT_MAX: usize = 6_000;
/// What a window hears past `THOUGHT_MAX` (the page says it first and keeps the draft: ui/src/limits.ts).
pub const THOUGHT_TOO_LONG: &str = "Too long for one thought: 6,000 characters at most. Send it in parts.";
/// A typed or said title, in characters: the prompts ask for 5 words; longest real title 49; search already
/// clips one to 100 (find.rs).
pub const TITLE_MAX: usize = 100;
/// A hashtag, in characters with its #: the refiner asks for short ones; longest real one 13.
pub const TAG_MAX: usize = 40;
/// A topic's name as a person types it, in characters (topics.rs): the AI names one in two or three words (≈ 20
/// characters); twice that leaves room for a person's own, and keeps a Spine header on one line.
pub const TOPIC_MAX: usize = 40;
/// One WebSocket message, in bytes: the biggest the window sends is Explain with a phrase and its context, at most
/// two thoughts (2 × 6,000 characters × up to 4 bytes ≈ 48 KB with its JSON); a mic frame is 3,840. The default
/// was 64 MiB, so a room guest could make the core hold gigabytes (256 queued audio frames).
pub const FRAME_MAX: usize = 64 << 10;
/// How far from the canvas's origin a place may be, on either axis, in canvas pixels: 260 widths of a 4K screen, far
/// past where anyone drags, so only a script meets it. Within it an f64 (JavaScript's number) holds a coordinate to
/// better than a billionth of a pixel, and a script's 1e308 can't turn the canvas's sums (its bounds, a zoom to fit)
/// into infinity (positions.rs).
pub const POSITION_MAX: f64 = 1_000_000.0;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    TextReceived { id: String },
    RecapState { period: crate::recap::Period, loading: bool, message: String, recap: Option<crate::recap::Recap> },
    AppsBuild { build: crate::apps::Build },
    /// An app's tune: `playful` for loud voices, else the calm one; `why` is what set it off ("voices stayed loud
    /// for 3 s"), so the window can say which app played and why.
    AppsSound { name: String, playful: bool, why: String },
    /// Approving an action didn't add it; it is offered again, and the window shows `message` on its row.
    ActionFailed { id: String, message: String },
    Snapshot { world: std::sync::Arc<World> },
    /// USAGE_FILE's allowances and this core's hourly calls, or no data. Replayed on joining, refreshed every minute.
    Usage { data: Option<crate::usage::Snapshot> },
    Change { change: Change },
    /// The ready-to-send message card (messages.rs), to the asker's windows: `counting` with `in_ms` left (it sends
    /// when the count ends unless stopped), then `stopped`, `sent`, `dry_run` or `failed`, with `message` saying so.
    /// `live`: the end of the count really sends (else a dry run).
    SendCard { id: u64, to: String, text: String, state: crate::messages::SendState, in_ms: u64, live: bool, message: String },
    /// The GitHub card (github.rs), to the asker's windows: `loading` as soon as it's asked, then `ready` with the pull
    /// requests (at most `ROWS`, `more` when GitHub has others) or `failed` with `message` saying why in one line.
    PullsCard { id: u64, title: String, repo: String, state: crate::github::CardState, pulls: Vec<crate::github::Pull>, more: bool, message: String },
    /// The note card (notes.rs), to the asker's windows: the note's title and sections as Notes gets them, `saving`
    /// then `saved` (Open in Notes) or `failed`, or at once `dry_run`, with `message` saying so. `live`: it really writes.
    NoteCard { id: u64, title: String, sections: Vec<crate::notes::NoteSection>, state: crate::notes::NoteState, live: bool, message: String },
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
    /// The answer to a "Why here?" (whyhere.rs): why the thought is on its thread; `failed` when there's none, so the
    /// window can offer to ask again. Only to the asker's windows; a model's answer also lands as the thought's note.
    WhyHere { thought_id: String, text: String, failed: bool },
    /// How an import of past chats is going; only to the person importing, and again if they reconnect mid-import.
    Import { status: crate::import::Status },
    /// Where unplaced thoughts stand: the one being placed now, and each that failed a try, with the time until it
    /// tries again. Any other is waiting in line. Sent whenever it changes, and on connect.
    Placing { now: Option<String>, retries: Vec<crate::placer::Retry> },
    /// A placement deciding, for the map to show it (ui/src/route.ts): the threads the prompt names while the calls
    /// race, then where the thought went, the model's pick, and the rule that changed it, if any (placer.rs `Route`).
    Route { route: crate::placer::Route },
    /// One step of the work, for the window's model line (ui/src/model-line.ts): the step (the trace's feature:
    /// "placer", "refiner", "picture", "recap", "app", "listen", …) and the model doing it, or none when a rule did
    /// it ("Where was I?", an app's tune). A model call is told twice, as it starts and as it ends (`done`, with
    /// `ms` and `ok`), sharing `id`. Sent from where every call goes through (model.rs), so the name shown is the
    /// name asked, never a label kept by hand. `dropped`: an end that is no failure, the call cut off unanswered on
    /// purpose (the slower of a placement's racing calls, a search past its patience); omitted when false.
    Step {
        id: u64,
        step: String,
        model: Option<String>,
        done: bool,
        ok: bool,
        ms: u64,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        dropped: bool,
    },
    /// Someone pointing at a part of the screen, saying a line as a caption, or holding a question for the person's next
    /// pause (guide.rs): to every window but the one it came from, as it comes; never journaled. `target`: the part's
    /// name (docs/guide.md), none for a caption or to take `by`'s point down; for a held question, what it points at
    /// once asked, if anything. `text`: the point's caption, the caption, or the question (none takes back `by`'s
    /// questions still held).
    Guide {
        kind: crate::guide::Kind,
        target: Option<String>,
        text: String,
        by: String,
        at_ms: u64,
        /// A held question that may jump the line (the Interrupt level): asked first at the next pause. Omitted when
        /// false.
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        urgent: bool,
        /// The window it came from (guide.rs `window`), which doesn't get it back; not sent.
        #[serde(skip)]
        from: u64,
    },
    /// An ordered tour, or no steps to clear the sender's tour; ephemeral, to every other window (guide.rs).
    Tour {
        steps: Vec<crate::guide::Step>,
        by: String,
        at_ms: u64,
        #[serde(skip)]
        from: u64,
    },
    /// A live job update, retained in memory for replay and sent to every window except its origin (guide.rs).
    Job {
        #[serde(flatten)]
        job: crate::guide::Job,
        by: String,
        at_ms: u64,
        #[serde(skip)]
        from: u64,
    },
    /// An answer delivered only to its recipient's windows (guide.rs).
    Answer { by: String, text: String, at_ms: u64 },
    /// The call (call.rs): who is on the map now and since when, who has the floor (never their words), how far each
    /// person has read the turns, and how far the Friend may interrupt. To every window once two are here at once,
    /// whenever any of it changes, and first in a window's catch-up from then on; never journaled. A Remote (a phone's
    /// page for the AI helpers' work) is listed among the people, marked `remote`, and is never one of the two: once one
    /// has joined this is told too, with `started_ms` 0 until a call starts.
    Call { started_ms: u64, people: Vec<crate::call::Person>, level: crate::call::Level, level_by: String },
}

/// What a window shows, as its buttons set it: the map or the Palace; the map with only the speaker's
/// thread and its branches (Focus), or with every thread again (Show all); or the "?" list of what you
/// can say (Help), which opens on any map, an empty one too. Also the window's own buttons: Later on the
/// unfinished card ("later"), setting it aside for good as a second Later does ("forget it"), its Finish it
/// ("finish"), and the mic, off ("stop listening"). Export: the window saves the map as Markdown ("export my map"),
/// made from the map it already holds, so nothing but the file the person saves leaves it. Notices: the notices this
/// window showed, newest first ("what just happened?"), which only the window keeps (the Notice timeline).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum View {
    Map,
    /// The cards view by its name on screen ("cards"): a window that has a home view apart from its cards list
    /// (the shell's canvas) opens the list; "map" is still the home view.
    Cards,
    Palace,
    Focus,
    All,
    Help,
    Later,
    Forget,
    Finish,
    Pause,
    Export,
    Notices,
    Talk,
    Features,
}

/// A message on its way out: to every window, or only to one speaker's (in a room, each person's
/// own live words, mic and notices stay on their own laptop).
#[derive(Clone, Serialize)]
pub struct Outgoing {
    #[serde(skip)]
    pub to: Option<String>,
    #[serde(flatten)]
    pub message: ServerMsg,
    /// Live playback only: never part of the world or journal, so catch-up cannot speak old replies.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub speak: bool,
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
    Text { text: String, #[serde(default)] speak: bool, #[serde(default)] id: Option<String> },
    /// Start or stop listening to the microphone.
    Listen { on: bool },
    /// Go back to a thread, e.g. from the unfinished-thought card.
    Focus { thread_id: String },
    /// Pin this map's new thoughts to one topic; null releases it, for every speaker.
    Stay { thread_id: Option<String> },
    /// Explain a selected phrase in the context it appears in, within its thread when it has one.
    Explain {
        id: String,
        text: String,
        context: String,
        #[serde(default)]
        thread_id: Option<String>,
    },
    /// Why a thought is on its thread, asked from its point or a "While you were away" row (whyhere.rs).
    WhyHere { thought_id: String },
    /// Mark an AI answer as off, or take the mark back: `kind` is "explain" (the request's id) or "recap"
    /// (its period and when it was made, as "today-1793547629176").
    Mark { kind: String, id: String, off: bool },
    /// Keep or dismiss a suggestion, or dismiss an action.
    Item { id: String, status: crate::world::ItemStatus },
    /// Approve an action: add it to Reminders or Calendar, or, where they can't be reached, say the window saved it
    /// as a calendar file (apple.rs `saved`).
    Approve { id: String },
    /// The message card's Stop, or Esc while it counts down: it goes down unsent (messages.rs).
    StopSend { id: u64 },
    /// The note card's Open in Notes: Notes shows the note that card saved (notes.rs). It never changes the note.
    OpenNote { id: u64 },
    /// "Try a sample map" on an empty map: fill it with the sample (sample.rs); `name` picks one of the offered
    /// others (`sample::SAMPLES`), none the default.
    Sample {
        #[serde(default)]
        name: Option<String>,
    },
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
        /// The point (thought id) focused, else under the pointer: what "delete this" means (moves.rs).
        #[serde(default)]
        point: Option<String>,
    },
    /// The Undo button on a notice: take back the request it was shown for (catalog.rs).
    Undo { id: u64 },
    /// ⌘Z / Ctrl+Z: "undo that" without words, the speaker's last turn, after its notice and Undo have gone too.
    UndoLast,
    /// A rename or merge the refiner proposed: Rename or Merge applies it, × (`apply` false) keeps things as they are.
    Tidy { id: String, apply: bool },
    /// The Undo on the note about a rename or merge: `thread_id` is the renamed thread, or the one merged away.
    Untidy { kind: crate::tidy::Kind, thread_id: String },
    /// The Undo on the note about an idea or task the refiner withdrew or corrected: it is as it was (refiner.rs).
    Restore { id: String },
    /// The point's Move: the thought (and the words it carries on) to another thread, or none: a new thread of its own
    /// (moves.rs).
    Move {
        thought_id: String,
        #[serde(default)]
        thread_id: Option<String>,
    },
    /// A title typed on a thread's card (moves.rs).
    Rename { thread_id: String, title: String },
    /// The point's Delete: the thought (with the words it carries on) off the map, with Undo (moves.rs).
    Delete { thought_id: String },
    /// Put a thread's card or a thought's point (`id`) at `x`, `y` on the canvas, absolute canvas coordinates of its
    /// top-left within ±`POSITION_MAX`; both null: back to the automatic layout (positions.rs). A person's window or an
    /// AI participant's alike; never a model call.
    Position {
        id: String,
        #[serde(default)]
        x: Option<f64>,
        #[serde(default)]
        y: Option<f64>,
    },
    /// The person came back to the window: a good moment to tidy the map.
    Visible,
    /// Start importing a file the core has read (POST /import returned its id), as this window's speaker.
    ImportStart { id: String },
    /// Stop the running import; what already landed stays.
    ImportCancel,
    /// Show the other windows one part of the screen by its name (docs/guide.md), with a short caption beside the
    /// arrow; no `target` takes this speaker's point down (guide.rs).
    Point {
        #[serde(default)]
        target: Option<String>,
        #[serde(default)]
        caption: Option<String>,
    },
    /// A line for every other window, optionally spoken by the page; never a thought on the map.
    Caption { text: String, #[serde(default)] speak: bool },
    /// A question for the other windows to hold until the person pauses, then ask, with an arrow at `target` if given
    /// (guide.rs): never a thought on the map. `urgent` (the Interrupt level) jumps the line of held questions. No words
    /// take back this speaker's questions still held.
    Hold {
        text: String,
        #[serde(default)]
        target: Option<String>,
        #[serde(default)]
        urgent: bool,
    },
    /// An ordered tour of 1–20 steps, or no steps to clear this speaker's tour (guide.rs).
    Tour { steps: Vec<crate::guide::Step> },
    /// Relay a live job update to the other windows (guide.rs).
    Job { #[serde(flatten)] job: crate::guide::Job },
    /// Answer a speaker in their windows (guide.rs).
    Answer { to: String, text: String },
    /// A margin note: `text` beside `quote`, words picked in thought `thought_id`'s point, for every window. The first
    /// on those words starts their tangent, a later one answers in it (annotate.rs); a person's window or an AI
    /// participant's alike, never a model call.
    Annotate { thought_id: String, quote: String, text: String },
    /// A topic's new name, typed on its header (topics.rs `rename`): a name already there makes the two one.
    TopicRename { from: String, to: String },
    /// A thread moved under a topic, dragged there (topics.rs `set`): its top thread's, with its branches.
    TopicSet { thread_id: String, topic: String },
    /// How far this person has read the call's turns: the newest one their window has shown them (call.rs).
    Read { thought_id: String },
    /// How far the Friend may interrupt, as the meter at the foot of Talk sets it, for everyone in the call (call.rs).
    Level { level: crate::call::Level },
}
