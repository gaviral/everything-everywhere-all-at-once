# Guide: pointing, captions and held questions

Another participant (an AI that joined with a name, such as the AI helper over its bridge) can show one exact part of the screen, say a line as a caption, or hold a question for your next pause, instead of adding cards to the map. Of the moment: nothing is kept, and no model is asked.

## Messages

A window sends these over the WebSocket (`core/src/guide.rs` checks and relays them):
- `{"type":"point","target":"<name>","caption":"<140 characters at most>"}`: an arrow at that part, from the caption that shows these words. `{"type":"point","target":null}` takes your point down.
- `{"type":"caption","text":"<400 characters at most>"}`: a line in the caption, bottom center.
- `{"type":"hold","text":"<question, 140 characters at most>","target":"<name>"|null,"urgent":true|false}`: a question for the other windows to hold until you pause, then ask, with an arrow at `target` once asked if given; `urgent` (the Interrupt level) jumps the line. `{"type":"hold","text":""}` takes back the sender's held questions and captions, including their question being asked.

Every other window gets `{"type":"guide","kind":"point"|"caption"|"hold","target":…,"text":…,"by":"<sender's name>","at_ms":…}` (and `"urgent":true` on an urgent question); the window that sent it doesn't. Completed captions are journaled with speaker, stable `id`, time and server order, and restored in Talk after reload. Points, held questions and tours stay transient. A live completed caption also carries its record in `guide.caption` (`id`, `by`, `text`, `at_ms`, `order`, `ai`); catch-up supplies `world.captions`. One window may send 4 a second at most; past that, past a cap, or with a target that isn't a name, only the sender's windows hear why, in a notice.

These messages reach every human client on the shared map, including named HTTPS guests. A caption may include an `id` (retry with the same speaker and id saves and speaks it once) and `"speak":true`; an AI participant's `text` message may too. The live relay keeps this flag (on `guide` or `change`/`thought_added`), and each page speaks it with `speechSynthesis`. The playback flag never enters the journal or snapshots; restored caption IDs suppress duplicate live audio during catch-up. Human `call.people[].speaking` or local ASR partials cancel page speech immediately. Browser speech requires a prior interaction with that page.

### Tour relay

A window sends `{"type":"tour","steps":[{"target":"thread:T1","text":"Start here."},{"text":"Then look around."}]}`. A tour has 1–20 ordered steps. Each text is normalized to one line (control characters and runs of whitespace become spaces, with surrounding whitespace removed), then must contain 1–140 Unicode characters. Each supplied target must pass the same name check as a point: 1–100 ASCII letters, digits, `:`, `-`, `_` or `.`. An omitted or null target means a caption alone. The complete tour is validated before anything is relayed; an invalid later step refuses the whole tour.

Every other window, including another window belonging to the sender, receives `{"type":"tour","steps":[{"target":"thread:T1","text":"Start here."},{"target":null,"text":"Then look around."}],"by":"<sender's name>","at_ms":…}`. `at_ms` is the server's timestamp in Unix milliseconds. `{"type":"tour","steps":[]}` clears the sender's tour and is relayed with the same `by` and `at_ms` fields. The originating window receives no echo; the internal `from` window id is never serialized.

One whole tour, including an empty clear, counts as one message against the shared per-window guide budget of 4 messages per second. Refusals use the existing notice route to the sender's windows, begin `Not shown: `, and are limited to one notice per second; other participants receive nothing. Tours are never journaled, do not change the map or enqueue model work, and are not retained for reconnect. This job implements relay only; window playback is left for the next job.

## What the window shows

- **The caption:** bottom center, just above where you type (the stage; on today's layout, above the bottom bar). The speaker's name first, ✦ and purple for an AI participant's. Markdown as on the map: bold, italics, code. At most two lines at a time. A longer caption shows page by page, whole sentences where they fit. Each page stays for a slow reader's time for its words, 4 s at least, which also outlasts it being spoken. Time counts only while the page shows. The pointer on it holds it. The next caption replaces it.
- **Said while you talk or type:** a caption that arrives while your words are being heard, or within a natural pause (2.5 s, the app's `NATURAL_PAUSE_MS`) of your last words or keys, waits in the held stack. It is said at your pause.
- **Talked over:** your words while a caption is up, apart from its own voice coming back through the mic, make it step back at once. What you didn't get to read waits in the held stack with Continue. That includes the page showing if you spoke before you could have read it.
- **A point:** a ring round the named part and a short arrow into it. The part scrolls into view and is followed as it moves. The arrow is never a sweep across the screen and never crosses a button or a line of text: it comes in from the nearest side that has room, the side facing the caption first, then the others, as long as the room allows (72 px, then 52, then 36). The buttons, lines of text and cards near the part are measured, a quarter second apart, and a side with any of them in the way is passed over; a control's arrow may land a fifth in from its end to clear a neighbour (the Talk pill under Features). A part with no room on any side (Features on a phone, between Find and the Talk pill) gets the ring alone, as does a part level with the caption or under it, right there (the input box). Purple for an AI participant's arrow, the accent's blue for anyone else's or a feature's hint. Nothing else is shaded. A view that dims (the Canvas) dims the rest itself. A new point replaces it. Esc or a click takes it down; a held question's arrow goes with its caption and buttons. <!-- names-ok: ordinary word -->
- **A part not on screen:** never guessed at. The arrow shows what reveals it (Show on the card a thought is in, the Cards button, Apps, search, Focus) and the caption says where it is; a click there moves the arrow on to the part itself. With no such way, there's no arrow, and the caption says it isn't on screen.
- **A held question:** waits in the held stack while you talk or type. One thing at a time: the stack shows the next in line, the rest as a count (“2 more held”) that opens them; the urgent (marked Interrupt, in red) jump the line, the rest come in the order they came, and nothing is dropped. Bottom right, above the shelf, or in the page's `data-slot="held"` region once it has one. On a phone, the floating stack is a “Held N” chip. The sender can mark its main words in bold. For text without Markdown, a short question or opening sentence is made bold when there is more than one sentence.
- **At your next pause:** 2.5 s with no words or keys, nothing half-typed in the box, no sheet open, the page in view, no caption up, and a beat as long since the last one went. The next in line is asked, one per pause: its caption with **Go ahead ↵ · Later L · Drop it esc**, and an arrow at its target if given. While the mic is on it adds “or talk over me to stop” (“or talk over me” on a phone). Go ahead: it stays its reading time, then goes. Later, or no answer in the time to read it, look and decide: back to the stack, where it waits for you (Answer). Drop it: gone. Talking over it before you could have read it puts it back, marked “Talked over”. Talking after that answers it, and it's done.
- **A question that reads "A, or B?":** Go ahead fits an AI helper's own offer ("Want me to move the study block?"), not a choice, so a question like “Mention the pottery class in Mom's card, or keep it a surprise?” offers its answers instead: **A 1** and **B 2** as buttons, then **Answer ↵** (a box for words of your own), **Later L** and **Drop it esc**. A click sends the answer to whoever asked (`{"type":"answer","to":…,"text":…}`, which the core routes to their windows); 1, 2 and the arrows move to an answer and Enter sends the one moved to; Enter on the page opens the box and never sends (an answer goes only on a press of what you have seen). What counts as "A, or B?" is the Remote's reading of it (`options`, `ui/src/remote/ask.ts`): not one that begins like a question ("Do you want tea, or coffee?"), names three things or holds a colon. An answer goes once, and the caption then says “You sent “…” to …”. With the connection down it says “Not sent” and keeps the question. Held by `scripts/held-choices-check.mjs`.
- **On a held card:** a question that reads "A, or B?" shows its two answers above Answer and Later, before it is asked: a press sends that answer to whoever asked (the same `answer` message), the card leaves the stack and the stage says “You sent “…” to …” (“Not sent” and the card stays with the connection down); they carry no keys (1 and 2 zoom the canvas until a question is asked). Answer asks a question now. Go ahead says a waiting caption; Continue says what you talked over. Later stops it asking or speaking by itself. Once set aside or talked over, Drop it removes it. After a failed send, reconnecting keeps the question for an explicit retry. Covered by `scripts/held-card-choices-check.mjs`.
- **Drawing:** both draw over an open sheet and keep still under Reduce Motion. `ui/src/Guide.tsx` draws them; the rules are in `ui/src/guide-core.ts`, held by `scripts/guide-check.mjs`.
- **A feature's hint** (`actions.hint`, `docs/bricks.md`) shows the same way, with the feature's name: an arrow at the named part from the caption, or a caption alone. It's this window's only: never sent, nor relayed.
- **What a view hears:** features get `on("pointing")` with the part the arrow points at (a thought's or a topic's id with it), and null once it's down, so a view dims the rest once.
- **What the guide hears:** the window's `on("words")`, the same events features get (`ui/src/bricks/contract.ts`), handed over by the feature host (`ui/src/BrickSlot.tsx`).

## Names

Each part carries its name as `data-guide`.

| Name | The part | On screen |
|---|---|---|
| `composer` | the Input box, where you type or talk | always |
| `mic` | the mic | always |
| `help` | Help, the list of what you can say (the “?” button) | always |
| `recap` | Recap | always |
| `import` | Import chats | on the laptop running the map |
| `export` | Export | once the map has a thought |
| `status` | the status line | always |
| `room` | the Share menu (Join code, Leave) | on a shared map |
| `apps` | the Apps panel | always |
| `make-app` | the field that asks for an app | while Apps is open |
| `catalog` | the Features button | while Apps is open |
| `notice` | the notice under the header | while one is up |
| `undo` | Undo on a notice | while a notice can be taken back |
| `views` | the view switch | once the map has a topic |
| `view:map` | the switch's Cards button | once the map has a topic |
| `view:palace` | the switch's Pictures button | once the map has a topic |
| `search` | search | in the Cards view |
| `focus` | Focus | in the Cards view, with two topics |
| `back-to-active` | Back to active | in the Cards view, with two topics |
| `map` | the map | in the Cards view |
| `palace` | the Pictures view | in the Pictures view |
| `unfinished` | the Unfinished thought card | while it's up |
| `away` | Since you left | while it's up |
| `pending` | the thoughts finding their place, each a placing pill | while any is |
| `send-card` | the message about to send | while it counts down |
| `thread:<id>` | a topic: its card in the Cards view, its picture in the Pictures view, in a view feature its topmost `data-thread` mark | when its card, picture or mark is |
| `point:<id>` | a thought: its point in its card (while it finds its place, `pending` is shown instead) | while its card is open |
| `view:<id>` | a view feature's button in the view switch | while that feature is on |
