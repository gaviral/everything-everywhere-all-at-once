// Every action in the window, and what it shows at each step: pressed (the instant it's touched), working (while it
// waits on something slower than a frame), done and failed. scripts/feedback-check.mjs holds the catalog to the code,
// at the source level: a click, key, pointer, blur, input, drag or form handler in ui/src with no entry here fails, as
// does an entry whose `says` words aren't in the code, and every spoken command in core/src/catalog.rs must answer
// with words the core really sends. It doesn't prove a state renders: the e2e run in the card and each feature's own
// check do. Nothing here ships: the app doesn't import it.

/** The shared press (styles.css, "Pressed"): every enabled button, summary and link dims at once, and a button also
 *  sinks 3%; under Reduce Motion it only dims. */
export const PRESS = "press";
/** Done within the frame it's pressed in, so the done state is the press's own answer (a card opening, focus moving). */
export const INSTANT = "instant";

/** What an action waits on. `core`: one message to this laptop's core, answered in milliseconds, so no working state;
 *  its failure is being offline (the button is disabled, or "Not connected — try again when connected."). The others
 *  take long enough to need a working state and can fail on their own: a model call, Apple's apps, a file, the network. */
export type Waits = "core" | "model" | "apple" | "file" | "network";

export type Action = {
  id: string;
  how: "click" | "key" | "drag" | "form" | "pick";
  /** Where its handler is: a file in ui/src, and words on the handler's line. */
  at: [file: string, marker: string][];
  pressed: string;
  working?: string;
  done: string;
  failed?: string;
  waits?: Waits;
  /** Words it shows that must be in ui/src as written (the check looks), so this list can't claim feedback that isn't there. */
  says?: string[];
};

const OFFLINE = "disabled while the core is away";
const NOT_CONNECTED = "notice: “Not connected — try again when connected.”";

export const ACTIONS: Action[] = [
  { id: "partner-cancel", how: "click", at: [["PartnerStatus.tsx", "onClick={() => {"]], pressed: PRESS, waits: "core",
    done: "browser speech stops immediately; the core cancels a pending answer and shows Reply cancelled", failed: "a disconnected socket clears the thinking state" },
  { id: "partner-retry-audio", how: "click", at: [["PartnerStatus.tsx", "onClick={retryPageReply}"]], pressed: PRESS,
    working: "Preparing reply audio… changes to Reply playing when browser speech starts", done: "the reply is read aloud and its playback status clears at the end",
    failed: "the audio error returns with Retry audio available", says: ["Preparing reply audio…", "Reply playing", "Retry audio"] },
  { id: "partner-stop-conversation", how: "click", at: [["PartnerStatus.tsx", "onClick={onStopConversation}"]], pressed: PRESS,
    done: "reply audio and microphone capture stop; the conversation feature switches off and listening pauses", says: ["Stop conversation"] },
  // The new shell: corners, Find, held questions and the rail.
  { id: "catalog-corner", how: "click", at: [["App.tsx", `toggleTab("catalog")`], ["shell/Shell.tsx", "onClick={onClick} data-guide={guide}"]], pressed: PRESS,
    done: "the rail opens at the Features tab, or closes; the button stays pressed while it's open" },
  { id: "see-an-example", how: "click", at: [["App.tsx", "onClick={() => loadSample()}"], ["App.tsx", "onClick={() => loadSample(\"debug-break\")}"], ["App.tsx", "onClick={() => loadSample(choice.id)}"]], pressed: PRESS, waits: "core",
    done: "the chosen example map fills the window, stamped SAMPLE", failed: OFFLINE },
  { id: "find-type", how: "key", at: [["shell/Shell.tsx", "onChange={(event) => setQuery(event.target.value)}"], ["shell/Shell.tsx", "onKeyDown={key}"]], pressed: INSTANT,
    done: "the topics found list under the field, best first; ↑↓ move, Enter goes, Esc clears" },
  { id: "find-go", how: "click", at: [["shell/Shell.tsx", "onClick={() => { go(thread)"]], pressed: PRESS,
    done: "the list closes and your place moves to the topic; the canvas follows" },
  { id: "status-history", how: "click", at: [["shell/Shell.tsx", "onClick={openHistory}"]], pressed: PRESS,
    done: "the rail opens at History, or closes" },
  { id: "held-open", how: "click", at: [["shell/Shell.tsx", "onClick={() => setOpen(true)}"]], pressed: PRESS,
    done: "the held question's card opens above the input box" },
  { id: "held-close", how: "click", at: [["shell/Shell.tsx", "onClick={() => setOpen(false)}"]], pressed: PRESS,
    done: "on a phone, the held cards fold back into the chip with their full count" },
  { id: "held-more", how: "click", at: [["shell/Shell.tsx", "onClick={() => setAll(!all)}"]], pressed: PRESS,
    done: "the remaining held cards open under the next in line, or fold back to it", says: ["more held", "Just the next"] },
  { id: "held-keys", how: "key", at: [["shell/Shell.tsx", 'document.addEventListener("keydown", key, true)']], pressed: INSTANT,
    done: "Enter asks the next supplied card once; L uses its Later action and preserves its state" },
  { id: "held-answer", how: "click", at: [["shell/Shell.tsx", "onClick={answer}"]], pressed: PRESS,
    done: "the question leaves the stack and the asker asks it now (else the input box takes focus)" },
  { id: "held-later", how: "click", at: [["shell/Shell.tsx", "onClick={later}"]], pressed: PRESS,
    done: "the question leaves the stack until the next pause" },
  { id: "rail-tab", how: "click", at: [["shell/Shell.tsx", "onClick={() => setTab(t)}"]], pressed: INSTANT,
    done: "the tab's panel shows and the tab is underlined" },
  { id: "rail-close", how: "click", at: [["shell/Shell.tsx", "onClick={close}"]], pressed: PRESS, done: "the rail closes" },
  { id: "history-recap", how: "click", at: [["shell/Shell.tsx", "onClick={recap}"]], pressed: PRESS, waits: "model",
    working: "the sheet opens at once; “Gathering your thoughts…” after 400 ms if the answer isn't there yet",
    done: "the Recap sheet opens with the answer", failed: "the sheet says why, with Try again" },
  { id: "history-show", how: "click", at: [["shell/Shell.tsx", "onClick={() => onShow(entry.threadId!)}"]], pressed: PRESS,
    done: "your place moves to the topic; the canvas follows" },
  { id: "history-undo", how: "click", at: [["shell/Shell.tsx", "onClick={() => onUndo(entry)}"]], pressed: PRESS, waits: "core",
    done: "the line greys and says Undone; the map takes it back and a notice answers", failed: NOT_CONNECTED, says: ["Undone"] },
  { id: "catalog-show", how: "click", at: [["shell/Shell.tsx", "onClick={row.show}"]], pressed: PRESS, done: "the view shows in the map's place; Back to the Canvas (M) returns" },
  { id: "catalog-switch", how: "click", at: [["shell/Shell.tsx", "onClick={() => row.toggle?.(!row.on)}"]], pressed: PRESS,
    done: "the switch slides and the feature appears or goes at once (your apps' switches wait on the core: disabled while it's away)" },

  // The dock: what you say or type.
  { id: "copy-recognized-draft", how: "click", at: [["App.tsx", "setDraft(text => text ?"]], pressed: PRESS,
    done: "recognized words append to the input box, the voice draft clears and the input takes focus", says: ["Copy to editor"] },
  { id: "recovery-send-online", how: "click", at: [["RecoveryPanel.tsx", "onClick={() => {"]], pressed: PRESS, waits: "network",
    working: "the button says Waiting for receipt… and is disabled; the draft stays until every part is received",
    done: "the exact sent draft clears after the core's receipt", failed: "the draft stays and Send online becomes available again after reconnecting",
    says: ["Waiting for receipt…", "Send online"] },
  { id: "recovery-keep", how: "click", at: [["RecoveryPanel.tsx", "onClick={() => recover(entry.id)}"]], pressed: PRESS, waits: "core",
    done: "the saved words leave recovery and queue for this map; unfinished speech leaves when the core confirms the choice",
    failed: "the words stay in recovery if storage or the connection is unavailable", says: ["Keep in this map"] },
  { id: "recovery-discard", how: "click", at: [["RecoveryPanel.tsx", "onClick={() => discardRecovery(entry.id)}"]], pressed: PRESS, waits: "core",
    done: "the saved words leave recovery; unfinished speech leaves when the core confirms the choice",
    failed: "the words stay in recovery if storage or the connection is unavailable", says: ["Discard"] },
  { id: "retry-capture", how: "click", at: [["App.tsx", "onClick={() => core.retryCapture(capture.id)}"]], pressed: PRESS, waits: "model",
    working: "the words stay in the pending row, marked sending until saved, then Finding its place during placement",
    done: "the pending row leaves and Placed in names the topic, with Show",
    failed: "the words stay in the pending row; a failed placement says Saved · placement failed, and a missing key shows a notice",
    says: ["Kept on this device · sending", "Finding its place", "Saved · placement failed", "Placed in"] },
  { id: "show-placed-capture", how: "click", at: [["App.tsx", "onClick={() => { const thought = world.thoughts.find(thought => thought.id === placedCapture.thought_ids[0])"]], pressed: PRESS,
    done: "the map reveals the placed thought and focuses its topic", says: ["Placed in"] },
  { id: "type-a-thought", how: "form", at: [["App.tsx", `<form className="composer" onSubmit={submit}`]], pressed: INSTANT, waits: "model",
    done: "the field clears and the thought shows at once in the bottom bar, then lands on the map with the landing highlight",
    working: "the pending thought: “Finding a place for your thought…”, then where it stands", failed: NOT_CONNECTED + "; a thought that can't be placed yet says why in the bottom bar",
    says: ["Finding a place for your thought…", "Not connected — try again when connected."] },
  { id: "mic", how: "click", at: [["MicButton.tsx", "onClick={onClick}"], ["App.tsx", "onClick={toggleMic}"]], pressed: PRESS + " (the mic's own: it sinks 5%)", waits: "network",
    working: "“Starting the microphone…” in the empty map and the live line", done: "the mic turns on, its ring follows your voice, the header says Listening",
    failed: "the mic shows blocked and says how to allow it (mic.ts)", says: ["Starting the microphone…"] },
  { id: "skip-to-composer", how: "click", at: [["App.tsx", "Skip to Type a thought"]], pressed: PRESS, done: "focus lands in the input box, its ring lights" },
  { id: "dismiss-notice", how: "click", at: [["App.tsx", `aria-label="Dismiss notice"`]], pressed: PRESS, done: "the notice fades out" },
  { id: "undo-notice", how: "click", at: [["Undo.tsx", "onClick={() => onUndo(id)}"]], pressed: PRESS, waits: "core",
    done: "the change is taken back on the map and the core says what: “Undone: …” or “Put back”", failed: OFFLINE + "; a click racing the drop: " + NOT_CONNECTED },
  { id: "undo-map-change", how: "click", at: [["App.tsx", "core.untidy(core.mapChange!.undo"]], pressed: PRESS, waits: "core",
    done: "the old title or merge comes back and the note goes", failed: NOT_CONNECTED },
  { id: "dismiss-map-change", how: "click", at: [["App.tsx", `aria-label="Dismiss map update"`]], pressed: PRESS, done: "the note goes" },
  // Someone else's pointing (Guide.tsx): a click anywhere takes it down too (a document click, which the catalog's net
  // doesn't list), except one on the way the arrow shows (a folded card's Show, Map), which moves it on to the part.
  { id: "dismiss-guide", how: "key", at: [["Guide.tsx", `window.addEventListener("keydown", key, true)`]], pressed: INSTANT,
    done: "Esc: the arrow, its ring and the words it brought go (a question asked: Drop it); ↵ and L answer a question asked (one with answers: ↵ opens a box for your own words, 1, 2 and the arrows move to an answer, which ↵ then sends); a click elsewhere takes a point down" },
  // The Friend's question asked at your pause (Guide.tsx), and the held stack's cards: each answered in this window at once.
  { id: "guide-go-ahead", how: "click", at: [["Guide.tsx", "onClick={() => goAhead(said.n)}"]], pressed: PRESS, done: "its buttons go; the question stays its reading time with its arrow, then goes" },
  { id: "guide-later", how: "click", at: [["Guide.tsx", "onClick={() => later(said.n)}"], ["Guide.tsx", "onClick={() => laterHeld(item.n)}"]], pressed: PRESS,
    done: "the question goes back to the held stack, marked “Later”: it waits for you, not your next pause", says: ["Later"] },
  { id: "guide-drop", how: "click", at: [["Guide.tsx", "onClick={() => dropIt(said.n)}"], ["Guide.tsx", "onClick={() => dropGuideHeld(item.n)}"]], pressed: PRESS,
    done: "the question (or line) is gone, its arrow too", says: ["Drop it"] },
  // A question that reads "A, or B?" (Guide.tsx `Answers`): each answer a button that sends it to whoever asked; or your own words.
  { id: "guide-choice", how: "click", at: [["Guide.tsx", "onClick={() => send(choice)}"]], pressed: PRESS, waits: "core",
    done: "the answer goes to whoever asked, once; its buttons go and a line says what went and to whom: “You sent … to …”", failed: "the question stays, with “Not sent: the connection is down. Try again in a moment.”",
    says: ["Not sent: the connection is down. Try again in a moment."] },
  { id: "guide-answer-open", how: "click", at: [["Guide.tsx", "onClick={() => openAnswer(said.n)}"]], pressed: INSTANT,
    done: "a box for your own words opens in its place, with Send, and you're in it; Esc closes it, a second Esc drops the question" },
  { id: "guide-answer-type", how: "form", at: [["Guide.tsx", "<form className=\"guide-answer\" onSubmit={submit}>"], ["Guide.tsx", "onChange={(event) => { setWords(event.target.value); setProblem(\"\"); }}"],
    ["Guide.tsx", "onKeyDown={(event) => { if (event.key === \"Escape\")"]], pressed: INSTANT, waits: "core",
    done: "Enter or Send sends the words as typed (spaces tidied) to whoever asked, once, and a line says what went; Send waits for words", failed: "the question stays, with “Not sent: the connection is down. Try again in a moment.”" },
  { id: "guide-answer", how: "click", at: [["Guide.tsx", "onClick={() => askNow(item.n)}"]], pressed: PRESS,
    done: "the held card leaves the stack and is asked (said) at once: its caption at the stage, its arrow if it has one", says: ["Answer", "Continue"] },
  { id: "guide-held-more", how: "click", at: [["Guide.tsx", "onClick={() => setAll(!all)}"]], pressed: PRESS, done: "the rest of the held stack opens under the next in line, or folds back to it", says: ["more held", "Just the next"] },
  { id: "guide-held-chip", how: "click", at: [["Guide.tsx", "onClick={() => setOpen(!open)}"]], pressed: PRESS, done: "on a phone, the held cards open above the chip, or fold back into it", says: ["Held"] },
  { id: "new-landing-note", how: "click", at: [["Attention.tsx", "onClick={onGo}"]], pressed: PRESS, done: "the map scrolls to the new thought, which takes the landing highlight" },
  { id: "exit-talk", how: "click", at: [["App.tsx", "onClick={() => {\n    switchTalk(false);"]], pressed: PRESS, done: "all features return and focus moves to the input box" },
  { id: "forget-unfinished", how: "click", at: [["App.tsx", "forget(pullBack)"]], pressed: PRESS, done: "the unfinished card closes and this thought is no longer offered" },
  { id: "expand-unfinished", how: "click", at: [["App.tsx", "onClick={() => setExpanded(!expanded)}"]], pressed: PRESS, done: "the original words expand or fold; the button changes between Show more and Show less" },
  { id: "stay-here", how: "click", at: [["StayHere.tsx", "event.stopPropagation(); state.stay("]], pressed: PRESS, waits: "core", done: "the topic shows Staying here or releases it, preserving focus on the control", failed: OFFLINE },
  { id: "stop-reply-speech", how: "key", at: [["page-speech.ts", 'window.addEventListener("keydown", key, true)']], pressed: INSTANT, done: "Space or Escape stops the spoken reply and returns microphone capture" },
  { id: "finish-it", how: "click", at: [["App.tsx", "finishThread(pullBack,"], ["App.tsx", "finishPause(pause.id,"]], pressed: PRESS, waits: "core", done: "the map reveals the exact interruption source; keyboard activation can focus the empty input box, and existing drafts are kept", failed: NOT_CONNECTED },
  { id: "close-return-details", how: "click", at: [["App.tsx", "onClick={core.clearReturn}"]], pressed: PRESS, done: "the return details close" },
  { id: "later", how: "click", at: [["App.tsx", "later(pullBack)"]], pressed: PRESS, done: "the card fades out" },
  { id: "install", how: "click", at: [["Install.tsx", "onClick={leave(() => { hint.install?.();"], ["Install.tsx", "onClick={leave(notice.close)}"]], pressed: PRESS, done: "the hint goes; Install opens the browser's own install sheet" },
  { id: "tune", how: "click", at: [["Apps.tsx", "onClick={play}"]], pressed: PRESS, done: "the tune plays and the bottom bar names it: “♪ …”",
    failed: "notice: “Sound isn't available in this browser right now.”", says: ["Sound isn't available in this browser right now."] },
  { id: "dismiss-tune", how: "click", at: [["Apps.tsx", `aria-label="Dismiss tune"`]], pressed: PRESS, done: "the tune's line goes" },

  // The header and map tools.
  { id: "recap", how: "click", at: [["App.tsx", "core.requestRecap()"]], pressed: PRESS, waits: "model", done: "the Recap sheet slides up with the answer",
    working: "the sheet opens at once; “Gathering your thoughts…” after 400 ms if the answer isn't there yet", failed: "the sheet says why, with Try again",
    says: ["Gathering your thoughts…", "Try again"] },
  { id: "export", how: "click", at: [["App.tsx", "exportMap()"]], pressed: PRESS, waits: "file", done: "the file downloads: “Exported … as …”",
    working: "none needed: the file is written in the page, in one frame", failed: "notice: “Nothing on the map yet to export.”",
    says: ["Nothing on the map yet to export."] },
  { id: "map-or-palace", how: "click", at: [["App.tsx", `showView("map")`], ["App.tsx", `showView("palace")`], ["App.tsx", "showView(brick.info.id)"]], pressed: PRESS, done: "the view changes and its button stays pressed" },
  { id: "search", how: "key", at: [["App.tsx", "searchRef}"]], pressed: INSTANT, done: "matching topics stay, “N topics found” with Clear; Esc clears", says: ["found"] },
  { id: "clear-search", how: "click", at: [["App.tsx", `onClick={() => setQuery("")}`]], pressed: PRESS, done: "the whole map is back" },
  { id: "focus-mode", how: "click", at: [["App.tsx", "setFocusMode((value) => !value)"]], pressed: PRESS, done: "the map shows one topic; Focus stays pressed while on" },
  { id: "back-to-active", how: "click", at: [["App.tsx", "onClick={jumpToActive}"]], pressed: PRESS, done: "the map scrolls your topic to the top" },
  { id: "sample-map", how: "click", at: [["App.tsx", "onClick={() => core.sample()}"], ["App.tsx", "onClick={() => core.sample(choice.id)}"]], pressed: PRESS, waits: "core",
    done: "the chosen sample map (the student's week, or a shorter one) fills the window", failed: OFFLINE },
  { id: "reload-after-crash", how: "click", at: [["Crash.tsx", "location.reload()"]], pressed: PRESS, done: "the page reloads" },

  // A card.
  { id: "card-head", how: "click", at: [["App.tsx", `<div className="thread-head" onClick`]], pressed: INSTANT, done: "the card opens or folds, its body fading" },
  { id: "card-show-hide", how: "click", at: [["App.tsx", "onClick={toggle}>{collapsed"]], pressed: PRESS, done: "the card opens or folds; the button says Show or Hide" },
  { id: "title", how: "click", at: [["Moves.tsx", "titleTap(press.current.type"], ["Moves.tsx", "onDoubleClick={rename}"], ["Moves.tsx", "onContextMenu="]], pressed: PRESS,
    done: "the title becomes a field with its words selected (a tap on touch opens the card instead)" },
  { id: "rename", how: "key", at: [["Moves.tsx", "onKeyDown={(event) => {"], ["Moves.tsx", "onBlur={(event) => finish(event.currentTarget.value)}"]], pressed: INSTANT, waits: "core", done: "Enter or leaving keeps the new title on the card; Esc keeps the old one", failed: NOT_CONNECTED },
  { id: "tag", how: "click", at: [["App.tsx", "on.tag(thread.id"]], pressed: PRESS, waits: "core", done: "the tag turns kept (solid), or goes", failed: NOT_CONNECTED },
  { id: "keep-suggestion", how: "click", at: [["App.tsx", `on.setItem(s.id, "kept")`]], pressed: PRESS, waits: "core", done: "its buttons go and the row settles as kept", failed: NOT_CONNECTED },
  { id: "dismiss-suggestion", how: "click", at: [["App.tsx", `on.setItem(s.id, "dismissed")`]], pressed: PRESS, waits: "core", done: "the row fades out and the rows below close the gap", failed: NOT_CONNECTED },
  { id: "add-to-reminders", how: "click", at: [["App.tsx", "onClick={approve}"]], pressed: PRESS, waits: "apple",
    working: "“Adding to Reminders…” (or Calendar) on the row", done: "“Added to Reminders · 1.2 s” with ✓, or “Saved as .ics” off a Mac",
    failed: "the row says why under the title and offers Try again", says: ["Adding to ", "Added to ", "Saved as .ics", "Try again"] },
  { id: "dismiss-action", how: "click", at: [["App.tsx", `on.setItem(action.id, "dismissed")`]], pressed: PRESS, waits: "core", done: "the row fades out and the rows below close the gap", failed: NOT_CONNECTED },
  { id: "tidy", how: "click", at: [["Tidy.tsx", "tidy.decide(p.id, true)"], ["Tidy.tsx", "tidy.decide(p.id, false)"]], pressed: PRESS, waits: "core",
    done: "Rename or Merge applies it, with Undo; × keeps yours and the proposal goes", failed: NOT_CONNECTED },

  // A point.
  { id: "point", how: "click", at: [["App.tsx", `<motion.li id={\`point-`]], pressed: INSTANT, done: "the words said and why here open under it, or close" },
  { id: "point-keys", how: "key", at: [["App.tsx", "togglesPoint({ key: event.key"]], pressed: INSTANT, done: "Enter or Space opens or closes its words, as a click" },
  { id: "words-said", how: "click", at: [["App.tsx", "className=\"said-toggle\""]], pressed: PRESS, done: "the words open under the point; the button is expanded" },
  { id: "why-here", how: "click", at: [["whyhere.tsx", "onClick={asking}>Why here?"], ["whyhere.tsx", "onClick={asking}>Try again"]], pressed: PRESS, waits: "model",
    working: "“Why here: …”, breathing quietly until the answer", done: "“Why here: …” with the reason, read out politely", failed: "the reason it couldn't, with Try again",
    says: ["Why here: …", "Try again", "why-wait"] },
  { id: "undo-fix", how: "click", at: [["App.tsx", "on.correct(thought.id, false)} aria-label={`Undo fix"]], pressed: PRESS, waits: "core", done: "the heard words come back and the mark goes", failed: NOT_CONNECTED },
  { id: "did-you-mean", how: "click", at: [["App.tsx", "on.correct(thought.id, true)"], ["App.tsx", "on.correct(thought.id, false)} aria-label={`No, keep"]], pressed: PRESS, waits: "core",
    done: "the question goes: the guess swapped in, or the heard words kept", failed: NOT_CONNECTED },
  { id: "keep-apart", how: "click", at: [["chunks.tsx", "unlink(thought.id)"]], pressed: PRESS, waits: "core", done: "the joined words split into two points; focus stays on the point", failed: NOT_CONNECTED },
  { id: "delete-point", how: "click", at: [["Moves.tsx", "remove(thought.id)"]], pressed: PRESS, waits: "core", done: "the point goes: “Deleted “…”” with Undo", failed: NOT_CONNECTED },
  { id: "move-menu", how: "click", at: [["Moves.tsx", "setOpen((was) => !was)"]], pressed: PRESS, done: "the list of topics opens under it, filter focused" },
  { id: "move-pick", how: "click", at: [["Moves.tsx", "onClick={() => pick(t.id)}"], ["Moves.tsx", "onClick={() => pick(null)}"]], pressed: PRESS, waits: "core",
    done: "the point glides to its new topic: “Moved “…” to …” with Undo", failed: NOT_CONNECTED },
  { id: "move-keys", how: "key", at: [["Moves.tsx", `if (event.key === "Enter") { event.preventDefault(); pick(targets[0]`], ["Moves.tsx", `document.addEventListener("keydown", key)`]], pressed: INSTANT,
    done: "Enter moves to the first match; Esc closes the list, focus back on Move" },
  { id: "move-list-keys", how: "key", at: [["Moves.tsx", "onKeyDown={(event) => {"]], pressed: INSTANT, done: "arrow keys walk the list, focus ring on each" },
  { id: "drag-point", how: "drag", at: [["Moves.tsx", "onDragStart="]], pressed: "the cursor grabs; every card gets a dashed edge it can drop on", done: "see drop-on-card" },
  { id: "drop-on-card", how: "drag", at: [["Moves.tsx", "onDrop: (event: React.DragEvent)"], ["Moves.tsx", `document.addEventListener("drop", end, true)`]], pressed: "the card under it lights while it's over", waits: "core",
    done: "the point glides into that card: “Moved “…” to …” with Undo", failed: NOT_CONNECTED },

  // The Palace.
  { id: "palace-tile", how: "click", at: [["Palace.tsx", "onClick={() => onOpen(thread)}"]], pressed: PRESS, done: "the map opens on that topic with the landing highlight" },

  // Keys anywhere (App.tsx, keys.ts; the ? list says them).
  { id: "keys", how: "key", at: [["App.tsx", `document.addEventListener("keydown", onKey)`]], pressed: INSTANT,
    done: "⌘Z: the core's “Undone: …” or “Nothing to undo: …”; ?: the list opens; /: search focused; j/k: focus moves card to card; Esc: cards fold or the open sheet closes" },

  // Explain.
  { id: "explain", how: "click", at: [["Explain.tsx", "onClick={() => ask(picked)} title="], ["Explain.tsx", "{failed && <button onClick={() => ask(picked)}>Try again"], ["Explain.tsx", `window.addEventListener("keydown", onKeyDown, true)`]], pressed: PRESS, waits: "model",
    working: "“Explaining…”, breathing", done: "one sentence under the words", failed: "“Couldn't explain that just now.” with Try again", says: ["Explaining…", "Couldn't explain that just now."] },
  { id: "explain-off", how: "click", at: [["Explain.tsx", "toggleOff(picked.id)"]], pressed: PRESS, done: "Off? stays pressed while marked" },
  { id: "explain-dismiss", how: "click", at: [["Explain.tsx", "setPicked(null)"]], pressed: PRESS, done: "the answer goes and focus goes back to where it was" },

  // Recap sheet.
  { id: "recap-link", how: "click", at: [["Recap.tsx", "follow(id)"]], pressed: PRESS, done: "the sheet closes and the map shows that topic with the landing highlight" },
  { id: "recap-backdrop", how: "click", at: [["Recap.tsx", "if (event.target === event.currentTarget)"]], pressed: INSTANT, done: "a click outside the sheet closes it" },
  { id: "recap-close", how: "click", at: [["Recap.tsx", "onClick={onClose}"]], pressed: PRESS, done: "the sheet closes" },
  { id: "recap-period", how: "click", at: [["Recap.tsx", `onRequest("session")`], ["Recap.tsx", `onRequest("today")`], ["Recap.tsx", "onRequest(view.period)"]], pressed: PRESS, waits: "model",
    working: "the buttons wait (disabled) and “Bringing this up to date…” shows", done: "the period's button stays pressed over its recap", failed: "the sheet says why, with Try again",
    says: ["Bringing this up to date…"] },
  { id: "recap-off", how: "click", at: [["Recap.tsx", "onClick={() => {"]], pressed: PRESS, done: "Off? stays pressed while marked" },

  // While you were away.
  { id: "away", how: "click", at: [["Away.tsx", "onClick={close}"], ["Away.tsx", "onFollow(item)"], ["Away.tsx", "flip(item.key)"], ["Away.tsx", `onKeyDown={(event) => {`]], pressed: PRESS,
    done: "× folds the card away; a row scrolls the map to it with the landing highlight; Why? opens its reason; Esc dismisses" },

  // Apps.
  { id: "apps-panel", how: "click", at: [["Apps.tsx", "onClick={() => setOpen(!open)}"], ["Apps.tsx", `getElementById("app-request")?.focus()`]], pressed: PRESS, done: "the panel opens or closes; Make an app focuses its field" },
  { id: "make-app", how: "form", at: [["Apps.tsx", `<form className="apps-form" onSubmit={submit}`], ["Apps.tsx", "compose(build.instead)"], ["Apps.tsx", "core.composeApp(build.instead)"]], pressed: PRESS, waits: "model",
    working: "the build card rises in the bottom bar, one ✓ step at a time, a spinner on the step in progress", done: "Keep app or Discard", failed: "the step shows × and says why" },
  { id: "keep-app", how: "click", at: [["Apps.tsx", "onClick={() => decide(true)}"], ["Apps.tsx", "onClick={() => decide(false)}"]], pressed: PRESS, waits: "core",
    done: "the card says what happened (“Your app is on.”) and goes", failed: OFFLINE },
  { id: "dismiss-build", how: "click", at: [["Apps.tsx", "leave(build.id)"]], pressed: PRESS, done: "the build card fades out" },
  { id: "build-keys", how: "key", at: [["Apps.tsx", "onKeyDown={(event) => {"]], pressed: INSTANT, done: "Esc leaves the build card" },
  { id: "app-on-off", how: "click", at: [["Apps.tsx", "core.toggleApp(app.id, !app.enabled)"]], pressed: PRESS, waits: "core", done: "the switch says On or Off", failed: OFFLINE },
  { id: "app-remove", how: "click", at: [["Apps.tsx", "core.removeApp(app.id)"]], pressed: PRESS, waits: "core", done: "the app's row goes", failed: OFFLINE },
  { id: "app-output", how: "pick", at: [["Apps.tsx", "core.appOutput(app.id"]], pressed: INSTANT, waits: "core", done: "the menu shows the choice", failed: OFFLINE },

  // Bricks (docs/bricks.md): the Catalog, opened from the Apps panel, and the switches in it. A switch is this
  // browser's own, so it waits on nothing.
  { id: "catalog-open", how: "click", at: [["Apps.tsx", "onClick={openCatalog}"]], pressed: PRESS, done: "the Features page opens: every feature with its line and its switch" },
  { id: "catalog-close", how: "click", at: [["Catalog.tsx", "onClick={closeCatalog}"]], pressed: PRESS, done: "the sheet closes and focus goes back to Features" },
  { id: "catalog-backdrop", how: "click", at: [["Catalog.tsx", "if (event.target === event.currentTarget) closeCatalog()"]], pressed: INSTANT, done: "a click outside the sheet closes it" },
  { id: "brick-switch", how: "click", at: [["Catalog.tsx", "switchBrick(info.id, !shown)"], ["BrickSlot.tsx", "switchBrick(info.id, false)"]], pressed: PRESS,
    done: "the switch says On or Off and the feature shows or goes at once (a view's name joins or leaves Cards and Pictures); a broken feature's line goes" },

  // Import.
  { id: "import-open", how: "click", at: [["Import.tsx", "setOpen(true)"], ["Import.tsx", "import-close"], ["Import.tsx", "onClick={(event) => {"]], pressed: PRESS, done: "the import dialog opens or closes" },
  { id: "import-file", how: "click", at: [["Import.tsx", "picker.current?.click()"], ["Import.tsx", "onChange={(event) => {"], ["Import.tsx", `window.addEventListener("drop", drop)`], ["Import.tsx", "void trySample()"]], pressed: PRESS, waits: "file",
    working: "a dashed drop area lights while a file is over it; the file is read before anything is imported", done: "a preview: what's in it, and Import N messages",
    failed: "“Couldn't read that file.” or why", says: ["Couldn't read that file.", "Couldn't load the sample."] },
  { id: "import-run", how: "click", at: [["Import.tsx", "onClick={start}"], ["Import.tsx", "core.cancelImport()"]], pressed: PRESS, waits: "model",
    working: "a progress bar fills as messages are placed; Stop stops it", done: "“See the map”", failed: "it says why, with Try again", says: ["See the map", "Try again"] },
  { id: "import-after", how: "click", at: [["Import.tsx", "onClick={close}>{job.state"], ["Import.tsx", "onClick={reset}>{job.state"], ["Import.tsx", "Choose another file"]], pressed: PRESS, done: "the dialog closes on the map, or starts over" },

  // Tour and the room.
  { id: "tour", how: "click", at: [["Tour.tsx", "onClick={finish}"], ["Tour.tsx", "onClick={next}"]], pressed: PRESS, done: "the next tip, or the tour ends" },
  { id: "room-menu", how: "key", at: [["room.tsx", `<details className="room-menu" onKeyDown`]], pressed: INSTANT, done: "Esc closes the Share menu, focus back on it" },
  { id: "leave-room", how: "click", at: [["room.tsx", "onClick={actions.leave}"]], pressed: PRESS, done: "“You left. Your thoughts stay.”", says: ["You left. Your thoughts stay."] },
  { id: "copy-invite", how: "click", at: [["room.tsx", "onClick={() => void copyInvite(join)"]], pressed: PRESS, done: "the button says “Link copied”", says: ["Link copied"] },
  { id: "copy-remote-link", how: "click", at: [["room.tsx", "onClick={() => void copyText(phone)"]], pressed: PRESS, done: "the button says “Link copied”: the link that opens Remote on your phone", says: ["Link copied"] },
  { id: "join-room", how: "form", at: [["room.tsx", `<form className="join-card" onSubmit={join}>`]], pressed: PRESS, waits: "network",
    working: "the button says “Joining…” and waits", done: "the map opens", failed: "“Can't reach the shared map. …”, or what's wrong with the code or name",
    says: ["Joining…", "Can't reach the shared map."] },

  // The Messages card (Full preset): a counting message comes down unsent.
  { id: "stop-send", how: "click", at: [["SendCard.tsx", "onClick={() => onStop(card.id)}"]], pressed: PRESS, waits: "core",
    done: "the count stops and the card says “Stopped: not sent”", failed: NOT_CONNECTED, says: ["Stopped: not sent"] },
  { id: "stop-send-key", how: "key", at: [["SendCard.tsx", `window.addEventListener("keydown", key, true)`]], pressed: INSTANT, waits: "core",
    done: "Esc while it counts: the card says “Stopped: not sent”", failed: NOT_CONNECTED, says: ["Stopped: not sent"] },

  // The GitHub card (Full preset): read-only; its rows are links, which open on GitHub in a new tab.
  { id: "close-pulls-card", how: "click", at: [["PullsCard.tsx", `aria-label="Close the GitHub card"`]], pressed: PRESS, done: "the card goes" },
  { id: "close-pulls-card-key", how: "key", at: [["PullsCard.tsx", `onKeyDown={(event) => { if (event.key === "Escape")`]], pressed: INSTANT, done: "Esc from inside the card: the card goes" },
  // The note card (Full preset): a saved note opens in Notes; the card closes. Nothing here changes or deletes a note.
  { id: "open-note", how: "click", at: [["NoteCard.tsx", "onClick={() => onOpen(card.id)}"]], pressed: PRESS, waits: "core",
    done: "Notes comes forward showing the note (only once the card says “Saved to Notes”)", failed: NOT_CONNECTED + "; Notes refusing: notice “Couldn't open it: …”",
    says: ["Saved to Notes", "Open in Notes"] },
  { id: "close-note-card", how: "click", at: [["NoteCard.tsx", `aria-label="Close the note card"`]], pressed: PRESS, done: "the card goes" },
];

/** Handlers that aren't actions of their own: each says why. */
export const NOT_ACTIONS: { at: [file: string, marker: string]; why: string }[] = [
  { at: ["SendCard.tsx", "onBlur={(e) =>"], why: "moving focus within the card keeps its reading time paused; leaving resumes it" },
  { at: ["shell/Shell.tsx", "onBlur={() => window.setTimeout(() => setFocused(false), 120)}"], why: "the field narrows back once focus leaves" },
  { at: ["shell/Shell.tsx", "onPointerDown={(event) => event.preventDefault()}"], why: "keeps focus in the field so a click on a topic lands" },
  { at: ["shell/Shell.tsx", "onClick={onClick} data-guide={guide}"], why: "each corner button's use in App.tsx is its own entry" },
  { at: ["shell/Shell.tsx", "onKeyDown={arrows}"], why: "arrow keys move focus between tabs or switches, with its ring" },
  { at: ["App.tsx", `window.addEventListener("keydown", key, true)`], why: "notes that you're moving around the map, so the map stops following landings" },
  { at: ["Palace.tsx", "onKeyDown={navigate}"], why: "arrow keys between tiles: focus moves, with its ring" },
  { at: ["Tips.tsx", `window.addEventListener("keydown", key, true)`], why: "hides a tip on Esc" },
  { at: ["this-card.ts", `doc.addEventListener("keydown", key, true)`], why: "tracks which card “this” means" },
  { at: ["App.tsx", "event.key === \"Esc"], why: "Esc in search clears it (search's own feedback)" },
  { at: ["Moves.tsx", "onChange={(event) => setQuery(event.target.value)}"], why: "typing in the move list's filter: the list narrows as you type" },
  { at: ["App.tsx", "onKeyDown={submitOnEnter}"], why: "Enter submits the input box through its existing send feedback" },
  { at: ["App.tsx", "typedSinceSend.current = true; setDraft"], why: "typing a thought: the words are the feedback" },
  { at: ["Apps.tsx", "onChange={(e) => setRequest(e.target.value)}"], why: "typing an app request: the words are the feedback" },
  { at: ["room.tsx", "setCode(e.target.value)"], why: "typing the join code" },
  { at: ["room.tsx", "setName(e.target.value)"], why: "typing your name" },
  { at: ["Moves.tsx", "onInput={(event) => {"], why: "typing a title: the words are the feedback, clipped at the cap as you type" },
  { at: ["Moves.tsx", "press.current = { type: event.pointerType"], why: "notes a touch or a mouse, so the title's click that follows knows open from rename" },
  { at: ["App.tsx", "onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNoticeFocused(false); }}"], why: "a notice keeps up while it has focus: no change you see" },
  { at: ["PullsCard.tsx", "onBlur={(event) =>"], why: "the GitHub card keeps up while it has focus: no change you see" },
  { at: ["NoteCard.tsx", "onBlur={(event) =>"], why: "the note card keeps up while it has focus: no change you see" },
  { at: ["App.tsx", `document.addEventListener("pointerdown", outside, true)`], why: "a press outside the shortcuts list closes it: the list going is the feedback" },
  { at: ["App.tsx", `window.addEventListener("pointerdown", down, true)`], why: "notes that you're moving around the map, so the map stops following landings" },
  { at: ["App.tsx", `window.addEventListener("pointerup", up, true)`], why: "as above, on letting go" },
  { at: ["Attention.tsx", `document.addEventListener("pointerdown", touch, true)`], why: "tracks where your attention is, for “this”" },
  { at: ["Explain.tsx", `document.addEventListener("pointerup", onPointerUp)`], why: "selecting words: the Explain chip shows beside them (explain's pressed)" },
  { at: ["Explain.tsx", `document.addEventListener("pointerdown", onPointerDown)`], why: "a press outside the answer closes it: the answer going is the feedback" },
  { at: ["Moves.tsx", `document.addEventListener("pointerdown", outside, true)`], why: "a press outside the move list closes it: the list going is the feedback" },
  { at: ["Tips.tsx", `document.addEventListener("pointerdown", down, true)`], why: "hides a tip on a press" },
];
