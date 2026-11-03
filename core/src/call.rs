//! Calls: two or more on one map at once (people in a room, an AI participant such as the Friend), each window showing
//! who is here, who has the floor, how far each person has read the turns, and how far the Friend may interrupt
//! (ui/src/talk/). What was said is the journal's (every turn is a thought); this is only the call around it, of the
//! moment and never journaled: a restarted core starts a new call, and each window tells it its read mark again as it
//! reconnects (ui/src/room.tsx). Alone, none of it is ever sent, so a map for one is as it was.
//!
//! A person's Remote (a phone's page for the AI helpers' work, joined with `?remote`: ui/src/remote/) is a window of the
//! room that isn't another person: it is listed, marked `remote`, so no one is ever hidden from the room, but it never
//! starts a call or counts toward one, and the pages show it as a device, not as someone who joined.

use crate::protocol::ServerMsg;
use crate::Core;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// How far the Friend may interrupt, least first: a glance (a mark on what it noticed), a raised hand (a question held
/// for your pause), a note beside your words, speaking at a pause, or stopping you mid-sentence. The meter at the foot
/// of Talk sets it; the Friend's side (guide.rs and its bridge) acts on it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Glance,
    Hand,
    Note,
    /// The call beat as designed: it speaks, but only at a pause, and talking over it stops it.
    #[default]
    Speak,
    Stop,
}

/// Someone in the call, as every window shows them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Person {
    /// The name their thoughts carry (a thought's `speaker`).
    pub name: String,
    /// An AI participant (joined with `?ai`, as the Friend's bridge does).
    pub ai: bool,
    /// A Remote (joined with `?remote`): every window of theirs that is open is one, or the last was. Not another person:
    /// it doesn't start a call or count toward one (`tell`), and the pages list it as a device (ui/src/talk/call-core.ts).
    pub remote: bool,
    /// When they first joined in this run, ms since 1970: a late joiner's "Joined 7:36".
    pub joined_ms: u64,
    /// A window of theirs is open now.
    pub here: bool,
    /// When their last window closed, while they're away.
    pub left_ms: Option<u64>,
    /// Their mic is on: a listening session in one of their windows.
    pub mic: bool,
    /// Their mic hears words and the turn isn't over: they have the floor. Never the words themselves, which stay on
    /// the speaker's own windows until the turn ends and comes as a thought.
    pub speaking: bool,
    /// The newest turn they've read (a thought's id), as their window last said; none until it says.
    pub read: Option<String>,
    #[serde(skip)]
    windows: usize,
    /// How many of `windows` are Remotes.
    #[serde(skip)]
    remotes: usize,
    #[serde(skip)]
    mics: usize,
}

/// The call's state, behind one lock: every change is told while it's held, so windows get them in order.
#[derive(Default)]
pub struct Runtime {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// In the order they first joined.
    people: Vec<Person>,
    /// When two were first here at once; none while it's only ever been one.
    started_ms: Option<u64>,
    level: Level,
    /// Who set the level last; "" for the default.
    level_by: String,
}

impl State {
    fn person(&mut self, name: &str) -> Option<&mut Person> {
        self.people.iter_mut().find(|p| p.name == name)
    }

    /// The call as windows get it, once it has started, or once a Remote has joined (with `started_ms` 0 until a call
    /// starts): a Remote is told to the room whether or not anyone is in a call with it.
    fn message(&self) -> Option<ServerMsg> {
        if self.started_ms.is_none() && !self.people.iter().any(|p| p.remote) {
            return None;
        }
        Some(ServerMsg::Call { started_ms: self.started_ms.unwrap_or(0), people: self.people.clone(), level: self.level, level_by: self.level_by.clone() })
    }

    /// Tells every window, once the call has started (a window that stays sees it shrink back to one, too). Two are in
    /// a call when two are here at once; a Remote is not one of them.
    fn tell(&mut self, core: &Core) {
        if self.started_ms.is_none() && self.people.iter().filter(|p| p.here && !p.remote).count() >= 2 {
            self.started_ms = Some(crate::now_ms());
        }
        if let Some(message) = self.message() {
            core.send(message);
        }
    }
}

/// The call as a window that just connected needs it, once it has started (main.rs `catch_up`).
pub fn message(core: &Core) -> Option<ServerMsg> {
    core.call.state.lock().unwrap().message()
}

/// A window of `speaker`'s is open: they're here until the last one closes (dropping what this returns).
pub fn join(core: &Arc<Core>, speaker: &str, ai: bool) -> Here {
    enter(core, speaker, ai, false)
}

/// A Remote of `speaker`'s is open (`?remote`): listed as here, as a device, until it closes. It is not another person.
pub fn join_remote(core: &Arc<Core>, speaker: &str) -> Here {
    enter(core, speaker, false, true)
}

fn enter(core: &Arc<Core>, speaker: &str, ai: bool, remote: bool) -> Here {
    let mut state = core.call.state.lock().unwrap();
    let now = crate::now_ms();
    match state.person(speaker) {
        Some(person) => {
            person.windows += 1;
            person.remotes += usize::from(remote);
            person.here = true;
            person.left_ms = None;
            person.ai |= ai;
            person.remote = person.remotes == person.windows;
        }
        None => state.people.push(Person {
            name: speaker.into(),
            ai,
            remote,
            joined_ms: now,
            here: true,
            left_ms: None,
            mic: false,
            speaking: false,
            read: None,
            windows: 1,
            remotes: usize::from(remote),
            mics: 0,
        }),
    }
    state.tell(core);
    Here { core: core.clone(), speaker: speaker.into(), remote }
}

/// A window's hold on its place in the call (`join`).
pub struct Here {
    core: Arc<Core>,
    speaker: String,
    remote: bool,
}

impl Drop for Here {
    fn drop(&mut self) {
        let mut state = self.core.call.state.lock().unwrap();
        let Some(person) = state.person(&self.speaker) else { return };
        person.windows = person.windows.saturating_sub(1);
        person.remotes = person.remotes.saturating_sub(usize::from(self.remote));
        if person.windows > 0 {
            // What's left decides what they are: a laptop closing leaves a Remote of the same name only a Remote.
            let remote = person.remotes == person.windows;
            if remote != person.remote {
                person.remote = remote;
                state.tell(&self.core);
            }
            return;
        }
        person.here = false;
        person.left_ms = Some(crate::now_ms());
        person.speaking = false;
        state.tell(&self.core);
    }
}

/// `speaker`'s mic is on, until what this returns is dropped (asr.rs, from "Listening" to the stream's end): their turn
/// is over then too.
pub fn mic_on(core: &Arc<Core>, speaker: &str) -> Mic {
    let mut state = core.call.state.lock().unwrap();
    if let Some(person) = state.person(speaker) {
        person.mics += 1;
        if !person.mic {
            person.mic = true;
            state.tell(core);
        }
    }
    Mic { core: core.clone(), speaker: speaker.into() }
}

/// A listening session's hold on its speaker's mic (`mic_on`).
pub struct Mic {
    core: Arc<Core>,
    speaker: String,
}

impl Drop for Mic {
    fn drop(&mut self) {
        let mut state = self.core.call.state.lock().unwrap();
        let Some(person) = state.person(&self.speaker) else { return };
        person.mics = person.mics.saturating_sub(1);
        let (mic, speaking) = (person.mics > 0, person.speaking && person.mics > 0);
        if (mic, speaking) != (person.mic, person.speaking) {
            (person.mic, person.speaking) = (mic, speaking);
            state.tell(&self.core);
        }
    }
}

/// `speaker` has the floor (their mic hears words) or no longer does (the turn ended). Told only when it changes, so a
/// turn's words, which come one at a time, make one message at its start and one at its end.
pub fn speaking(core: &Core, speaker: &str, on: bool) {
    let mut state = core.call.state.lock().unwrap();
    let Some(person) = state.person(speaker) else { return };
    if person.speaking == on {
        return;
    }
    person.speaking = on;
    state.tell(core);
}

/// What a window hears when its read mark names no thought on the map.
pub const NOT_A_TURN: &str = "That turn isn't on the map.";

/// `speaker` has read up to thought `thought_id`, the newest turn their window has shown them. Only a thought on the
/// map: a mark is one id per person, so a script can't make the core hold more than the map.
pub fn read(core: &Core, speaker: &str, thought_id: &str) -> Result<(), &'static str> {
    if !core.snapshot().thoughts.iter().any(|t| t.id == thought_id) {
        return Err(NOT_A_TURN);
    }
    let mut state = core.call.state.lock().unwrap();
    let Some(person) = state.person(speaker) else { return Ok(()) };
    if person.read.as_deref() == Some(thought_id) {
        return Ok(());
    }
    person.read = Some(thought_id.into());
    state.tell(core);
    Ok(())
}

/// How far the Friend may interrupt, for everyone in the call: anyone may change it, and every window says who did.
pub fn level(core: &Core, speaker: &str, level: Level) {
    let mut state = core.call.state.lock().unwrap();
    if state.level == level {
        return;
    }
    state.level = level;
    state.level_by = speaker.into();
    state.tell(core);
}

/// How far the Friend may interrupt now (for the Friend's side: guide.rs).
#[allow(dead_code)]
pub fn level_now(core: &Core) -> Level {
    core.call.state.lock().unwrap().level
}

#[cfg(test)]
mod tests;
