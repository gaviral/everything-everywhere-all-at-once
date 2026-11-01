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
- “Find …” and “take me to …” search only when they point at the map (“find where I said …”), so “Find a dentist near the office” is a thought; a search that finds nothing keeps your words as a thought.
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
- A name is the host's or a guest's, never both, so notices, live words, the mic and an import stay with their person; the join form asks for another name.

### Running, demo and samples
- `./run.sh` builds the UI and serves everything on localhost:4321; `./run.sh NAME` keeps a separate map in `data/NAME`; `./run.sh sample` opens a prepared map without a key or a mic.
- `./run.sh demo` plus `scripts/demo.mjs` replays a prepared talk at real speed, with real model calls; in a room, a second speaker too.
- Both sample maps come with a picture for every thread, drawn once by the app's own picture pipeline and kept in `samples/images/` (128 px copies, about 300 KB in all), so the Palace is full without a key.
- The sample maps are dated the week of Nov 3, 2026, and include a real “Did you mean” question: “BC Hydra” to “BC Hydro” and “CSB” to “CSP”.

### Recent changes
- The first "Later" on the unfinished-thought card brings it back once, at a pause at least 5 minutes later; a second "Later" hides it until that thread changes.
- Suggested tags wait until a thread has 3 thoughts before they appear; kept tags always show.
- Importing the same file again skips messages an earlier import already read, so nothing is added twice; importing shows "Everything in this file was already imported" when there is nothing new.
- Import reads at most 12 messages per part (smaller parts), because the fast model skipped late messages in larger groups.
- The refiner resolves relative dates ("tomorrow", "Friday") from the day a point was said, not today, so an imported point from last Wednesday that says "by Friday" gets the right Friday; older points show their said date in the refiner's prompt.
- Notices that say "mic" in a thread title no longer stay on screen for good (the notice filter matched the word too broadly).
- An Explain answer stays on screen when the talk moves on and the thread folds away; it used to vanish.
- Reconnecting clears stale live words from the dock.
- Turning the mic off and quickly on again no longer switches it off (a late "Stopped listening" message arrived after the new session started).
- A refused key (wrong or expired) stops model calls after the first, says so plainly (“AI key refused”), and keeps waiting thoughts until a restart with a working key; a busy service backs off and says so once.
- A key that can't use Contributor mode no longer reads as refused: placing and Explain switch to `muse-spark-1.2` until a restart and say so once; a `PLACER_MODEL` you set is used as is.
- Time apps keep the local time you asked for on days the clocks change: “play a tune at 5 PM”, made early on Nov 1, started at 4 PM before (2 of 2 runs) and at 5 PM now (2 of 2), and an app repeating every day keeps its hour, even after a run that came late.
- Filler such as “um, so” is set aside before placement; “yeah, okay” is set aside unless the last turn was a question.
- A turn that moves to another topic is split at the change, with joining words removed; a short filler turn can be skipped, but turns over 8 words are placed.
- A question stays a question on the map, so it doesn't read as a decision (14 test questions, 6 runs: 28 of 84 points kept the “?” before, 84 of 84 now), and a quoted question keeps who asked; a bare “yes” or “no” is always placed; two sentences about one thing (“November 4th, that's the deadline. I need the video done by then.”) are cut in two less often.
- Spoken turns start with a capital letter, and speech recognition is told to expect “Llama” and “Muse Image”.
- When your thoughts land during an absence of at least 30 seconds, “While you were away” lists those threads and their new proposals; each row opens its thread.
- If a window falls too far behind, it receives the current map and its unfinished app build and import status.
- With no AI key, the header says “No AI key”; you can browse the map, and typed thoughts wait with “Needs the AI key”.
- Pages are checked on each request; hashed app files and images can be cached for a year, so an update loads the current page.
- The `?` menu lists keyboard and spoken commands, and ✦ marks only items added or suggested by AI.
- Errors say what happened and what to do next; a failed placement stays saved and retries automatically.
- A composer draft that fails validation gets one retry with the invalid field explained.
- A request apps can't do ("book me a flight", "send me an email when I mention rent") gets one short reason and the closest app, one click away, instead of a look-alike app; a request with no likely reading ("hi") gets a question and an example. Judge-style requests (30, 2 runs each): 30 of 60 did what was asked before, 58 of 60 after (`scripts/composer-check.mjs`).
- Phrase and topic apps match whole words, so "AI" no longer fires on "said" or "um" on "number"; a repeating timer shows a card or plays a tune rather than proposing the same reminder once; without the AI key, a failed build says so instead of "try again".
- The Volume watcher plays a short, silly tune with its card when voices stay loud (or the card alone, from its row); the first click, tap or key press on the page lets the tune play.
- “Add to Reminders” and “Add to Calendar” claim an action before sending it to Apple, preventing a second add while it runs.
- A “yes” to “Did you mean?” applies the suggested words; a confident fix can be undone from the point.
- Points begin with a capital on screen when appropriate, while the stored words remain as placed.
- Speech errors release the audio channel so the next microphone tap can start a new session.
- An unnamed room guest, or one who asks to join as “you”, joins as “Guest”.
- Calendar events and reminders use the app's own E2A2O calendar and list; invalid dates are rejected, and an event without a real date becomes a reminder.
- Explain also reads what other threads say about the selected name or term (up to 8 thoughts), so “Jordan” on a to-do list is explained from the hiring thread; acronyms are spelled out, and it is told never to give medical or health advice.
- “Where was I?” goes by when things were said, so imported chats don't count as your latest words, and it acts at once unless your own words are still being placed.
- “While you were away” stays up when your last turn is split in two or an import lands; the import panel no longer sticks on “Importing” after a restart.
- Your new thought scrolls into view when it lands under the composer (its thread's title showing above the composer used to count as in view), and “…, where was I?” brings the thread it goes back to into view; the other person's thoughts in a room don't move your view, and nothing moves while you scroll or read (typing in a field doesn't count as scrolling).
- A request typed into the Apps panel as “Make an app that…” keeps the panel open after Keep or Discard, as other typed requests do (it closed after 2 s, so a montage of typed requests had to reopen it); app times read “Fri, Nov 6, 7:00 PM”, not “11/6/2026, 7:00:00 PM”.
- More spoken commands, recognized by rule without a model call: “last one” (or “previous one”, “go back one”) goes to the thread before yours, the other way from “next one”; “go to the one about …” jumps there as “where did I talk about …?” does (“the one about …” alone stays a thought, since speech often splits it off the end of one); “new thread” (or “create a new one”) places nothing, and your next thought starts a thread; “palace”, “map”, “focus” and “show all” switch your own window's view. Only the whole command counts: “go to the last one of the meetings” and “let's go to the palace of Versailles” stay thoughts.
- A long turn gets more room to be placed: a turn over 1,000 characters is allowed two tokens a character (up to 12,000, with a time limit that grows with it) instead of 2,000, and an answer the model cut off at its limit is asked once more with twice the room, not again with the same. A 1,672-character part of a turn once ran out of 2,000.
- A picture that hangs gives up after 55 s and a refiner pass after 52 s, not 2 minutes (a picture: twice the slowest normal one in a log, 27 s; a pass: twice what filling its answer room takes), so the redraw or the next pass starts sooner.
- Every request takes the same words before it: “Can you recap?”, “Please focus.”, “Cool, go to the palace.” and “Well, what did I decide today?” act, and “Hey, where was I?” no longer files “Hey”. “I see”, “I mean”, “you know” and “like” lead in only before a pause mark (“I see. Go to the palace.”), since without one they make a sentence of what follows: “I see the palace” and “I mean the map” are thoughts. At the end of an unpunctuated turn nothing is skipped, so “The demo went well where was I” keeps “well”; asked of someone partway through a turn (“I loved Japan. Would you go back?”), it stays a thought. New whole-turn phrases: “let's recap”, “what did I decide?”, “what did we decide (today)?”, “build an app that …” and “make a new app that …”.
- “What can I say?”, “help” or “what can you do?”, said or typed as the whole turn, opens the `?` list, on an empty map too. The list starts with what you can say, sits above notices, and closes on your next turn, Esc or a click outside it, not on a timer; the tour's last step points at it.
- “Where was I?”, “next one” and “last one” always answer: on an empty map “Nothing on the map yet: say a thought first”; on the only thread “where was I?” shows where you are (“You're on Garden: “Plant the tomatoes””) and “next one” says it's the only thread; a guest who hasn't spoken hears “Nothing to go back to yet”.
- A search that finds nothing no longer files the question as a thought: “I couldn't find “the lease”. Try a few words you used.” (without a key: “… Searching by meaning needs the AI key.”). Words said after the question (“Where did I talk about the lease? It's due Friday.”) are kept, after the jump; a “take me back to …” with nothing pointing at the map (no “the thread about …”, no #tag) may be a saying (“Take me back to Paris”) and is still kept when nothing matches.
- Take me there's model check gets 8 s, not 4: about twice the slowest answer seen (muse-spark-1.3, minimal effort, 2026-11-01: 62 paraphrases that share no word with their target took median 1.1 s, p90 1.7 s, slowest 2.8 s, and 51 found their thread; an earlier 6 took up to 3.7 s). “Looking through your threads…” stays until the answer (it used to clear after 5 s) and comes down when newer words or a click stop the search; a second question in the same turn stops with it, so its answer can't undo the click.

### Security
- Alone, the core listens on 127.0.0.1; Origin and Host checks refuse other sites and DNS rebinding; in a room, the map and pictures need the code, compared in constant time.
- `scripts/precheck.sh`: static checks, `cargo test` and live probes; the merge gate runs it.
