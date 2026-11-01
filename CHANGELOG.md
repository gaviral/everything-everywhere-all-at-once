# Changelog

Everything here was written during the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026). Before it, only the idea and design notes existed.

## 2026-10-31: first version

### The map
- Speak or type; each finished thought lands on a thread of a live map, usually 2 to 4 s later in our tests (hover a point for its time).
- A tangent, or a part of a topic with its own detail, can become a branch of its thread.
- At pauses, the refiner renames threads and merges duplicates (the app says so), adds at most one suggestion per thread, and proposes actions and up to three tags per thread.
- Approved actions go to Apple Reminders (a list named E2A2O) or Calendar (dated events, all-day, on a calendar named E2A2O), with Apple's time shown; the list and the calendar are made if missing.
- A thread you leave mid-sentence is marked "left off"; at the next pause a card offers to take you back (Finish it, Later).
- Voice commands include “where was I?” (“go back” or “take me back”) and “next one”; they work as a whole turn or after a pause at its end, with earlier words placed first.
- Take me there: "where did I talk about …?" jumps to the thread and highlights the point.
- Header line: "This session · N thoughts · M threads" (a session ends at a 30-minute gap).
- Search, Focus, Recent first, keys (`/`, `j`/`k`, Enter, Esc), a first-run tour, and an outbox for thoughts typed while disconnected.

### Corrections and Explain
- "Did you mean …?" with Yes and No when words look misheard.
- Confident auto-fix: when the context leaves no doubt, the words are swapped and the point says "✦ fixed"; hover shows what was heard, one click puts it back.
- Select words on the map, then Explain: one plain sentence on what they mean in that thread.

### Pictures and the Palace
- Muse Image draws one picture per thread once it has settled for 12 s, during pauses, up to 3 at a time and 3 tries each; its prompt asks it to avoid cultural stereotypes.
- The map shows 128 px copies; full pictures stay on disk.
- Palace view: threads as picture tiles grouped into rooms; arrow keys and Enter.

### Composer and apps
- "make an app that…" (at the start of what you say) or the Apps panel builds an app from blocks: a watcher (new thought, phrase, topic, volume, time), an optional prompt, publishers (card, tune, proposed reminder).
- It looks for an existing app first; a draft runs only once kept; unknown blocks, fields and out-of-range values are rejected, and a draft that doesn't check out gets one more try, told what was wrong.
- A timer app with a prompt runs only when something new was said since its last run.
- Three seed apps, on by default only in demo mode: Argument resolver, Volume watcher, Search-first.

### Recap
- "what did I decide today?", "recap this session", or the Recap button: a summary that names your threads, what you worked on, decisions, plans ("I want to…"), open questions, unfinished threads, actions.
- Only the period's thoughts go to the model (up to 24 threads, 16 thoughts each, 64 actions); saved in the journal and reused until something changes.

### Import your chats
- Import chats turns a ChatGPT or Claude export, or a JSON list of messages, into threads, open questions and dated tasks; Try with a sample uses a made-up export.
- Shows what goes to which model, and a rough cost, before sending anything; only your own messages are read; never Contributor mode by default; host only in a room.

### Rooms
- `./run.sh room`: a second laptop on the network joins the same map with the code and a name ("Guest" if it gives none, or asks for "you", the host's); each person keeps their own active thread, unfinished card and way back; only the host approves actions.

### Running, demo and samples
- `./run.sh` builds the UI and serves everything on localhost:4321; `./run.sh NAME` keeps a separate map in `data/NAME`; `./run.sh sample` opens a prepared map without a key or a mic.
- `./run.sh demo` plus `scripts/demo.mjs` replays a prepared talk at real speed, with real model calls; in a room, a second speaker too.
- Both sample maps come with a picture for every thread, drawn once by the app's own picture pipeline and kept in `samples/images/` (128 px copies, about 300 KB in all), so the Palace is full without a key.
- The sample maps are dated the week of Nov 3, 2026, and include a real “Did you mean” question: “BC Hydra” to “BC Hydro” and “CSB” to “CSP”.

### Recent changes
- Filler such as “um, so” is set aside before placement; “yeah, okay” is set aside unless the last turn was a question.
- A turn that moves to another topic is split at the change, with joining words removed; a short filler turn can be skipped, but turns over 8 words are placed.
- When your thoughts land during an absence of at least 30 seconds, “While you were away” lists those threads and their new proposals; each row opens its thread.
- If a window falls too far behind, it receives the current map and its unfinished app build and import status.
- With no AI key, the header says “No AI key”; you can browse the map, and typed thoughts wait with “Needs the AI key”.
- Pages are checked on each request; hashed app files and images can be cached for a year, so an update loads the current page.
- The `?` menu lists keyboard and spoken commands, and ✦ marks only items added or suggested by AI.
- Errors say what happened and what to do next; a failed placement stays saved and retries automatically.
- A composer draft that fails validation gets one retry with the invalid field explained.
- “Add to Reminders” and “Add to Calendar” claim an action before sending it to Apple, preventing a second add while it runs.
- A “yes” to “Did you mean?” applies the suggested words; a confident fix can be undone from the point.
- Points begin with a capital on screen when appropriate, while the stored words remain as placed.
- Speech errors release the audio channel so the next microphone tap can start a new session.
- An unnamed room guest, or one who asks to join as “you”, joins as “Guest”.
- Calendar events and reminders use the app's own E2A2O calendar and list; invalid dates are rejected, and an event without a real date becomes a reminder.
- Explain also reads what other threads say about the selected name or term (up to 8 thoughts), so “Jordan” on a to-do list is explained from the hiring thread; acronyms are spelled out.

### Security
- Alone, the core listens on 127.0.0.1; Origin and Host checks refuse other sites and DNS rebinding; in a room, the map and pictures need the code, compared in constant time.
- `scripts/precheck.sh`: static checks, `cargo test` and live probes; the merge gate runs it.
