// Rooms: two people think out loud on one map, each on their own laptop. When the core runs with a
// room code, everyone joins with a short name (remembered in this browser), and a laptop other than
// the host's also needs the code. Alone, nothing changes: your thoughts are "you".
// In a room the map is a call (talk/): this window's socket also tells the call what it hears (who's here, who has the
// floor, how far each has read) and carries what Talk sends back. A phone's Remote (remote/) joins the same way and says
// so on its socket (`remote`), so the call lists it as a device and not as another person.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import "./room.css";
import { useOnScreen } from "./onscreen";
import { REMOTE, REMOTE_NAME, remoteLink } from "./remote/flag";
import { savedWhere, siteFrom, SiteContext, useSite, type SiteDoor } from "./site";
import { TIPS } from "./Tips";
import { hearPageSpeech, stopPageSpeech } from "./page-speech";
import { closed as callClosed, heard as callHeard, hereNow, named, opened as callOpened, remotesHere, shownCode, stateWord, useCall } from "./talk/call-core";

type Seat = { me: string; code: string };
// What the core says at /room: is a room open, may this page use the map, and (asked with a name) does
// another laptop hold that name? Private things (live words, the mic, notices) go to every window with a name.
// `tunnel`: a trial link (scripts/trial.sh), a fresh map for one person that whoever sent it may watch.
// `code` and `invite`, to a page already in: the join code and the address another person opens with it.
// The rest says how the core runs (site.ts): hosted or on someone's computer, and what that changes on screen.
type Door = { room: boolean; member: boolean; taken?: boolean; tunnel?: boolean; code?: string | null; invite?: string | null } & SiteDoor;

const ALONE: Seat = { me: "you", code: "" };
const NAME = "e2a2o.name";
const CODE = "e2a2o.room";
const JOINED = "e2a2o.joined";
const GUEST_MACHINE = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const TAKEN = "That name is already taken. Pick another.";

// The socket reads the seat each time it connects; Room keeps both current.
let seat = ALONE;
let recheck = () => {};
// The map's socket while it's open: what Talk sends goes on it (`sendToCore`).
let socketNow: WebSocket | null = null;

const Me = createContext(ALONE.me);
const RoomActions = createContext<{ leave: () => void } | null>(null);
/** The join code and the address to share, in a room; null alone (or before the core said). */
const JoinContext = createContext<{ code: string; invite: string | null } | null>(null);

/** In a room: Leave, as the room menu's button does. Null alone. */
export const useLeave = () => useContext(RoomActions)?.leave ?? null;

/** In a room: the join code, as people read it out ("K7M2 X9QP"), and the address another person opens with it. */
export const useJoin = () => useContext(JoinContext);

/** Sends one message to the core on the map's socket (Talk's read mark, the Friend's level); false while it's closed. */
export function sendToCore(message: object): boolean {
  if (socketNow?.readyState !== WebSocket.OPEN) return false;
  socketNow.send(JSON.stringify(message));
  return true;
}

/** Copies words to the clipboard; says whether they went. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies the invite to the clipboard; says whether it went. */
export async function copyInvite(join: { code: string; invite: string | null }): Promise<boolean> {
  return copyText(join.invite ?? shownCode(join.code));
}

/** Room controls are absent when thinking alone. Once the call is on (talk/call-core.ts), who's here now, live;
 *  before it, who has added a thought. */
export function RoomControl({ speakers }: { speakers: string[] }) {
  const actions = useContext(RoomActions);
  const me = useMe();
  const { hosted } = useSite();
  const join = useJoin();
  const call = useCall();
  // Copying needs a secure page (this laptop's own, or HTTPS): elsewhere the link shows, to copy by hand.
  const [copied, setCopied] = useState<boolean | null>(null);
  const [phoneCopied, setPhoneCopied] = useState<boolean | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOnScreen(panel, { rendered: !!actions });
  if (!actions) return null;
  const here = hereNow(call, me).filter((person) => person.name !== me);
  // Your own phone's Remote: the invite's address, so it comes in by the same code, and the name it should join under.
  const phone = join?.invite ? remoteLink(join.invite, me) : null;
  const remotes = remotesHere(call);
  const others = [...new Set(speakers)].filter((name) => name && name !== me && name !== ALONE.me);
  return (
    <details className="room-menu" onKeyDown={(event) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }} data-guide="room">
      <summary aria-label="Shared map details">Share <span aria-hidden="true">⌄</span></summary>
      <div ref={panel} className="room-panel">
        <div className="room-panel-title">Shared map</div>
        <p className="room-you"><span className="room-person-mark" aria-hidden="true">●</span> {me} <span>· you</span></p>
        {hosted ? <p className="room-guest">{savedWhere(true)}</p>
          : GUEST_MACHINE && <p className="room-guest">Guest on this map · {savedWhere(false)}</p>}
        {join && <p className="room-code">Join code <b>{shownCode(join.code)}</b>
          <button type="button" className="room-copy" onClick={() => void copyInvite(join).then(setCopied)}>{copied ? "Link copied" : "Copy link"}</button></p>}
        {join && copied === false && <p className="room-link">{join.invite ?? shownCode(join.code)}</p>}
        {phone && <p className="room-code room-remote">Open Remote on your phone
          <button type="button" className="room-copy" onClick={() => void copyText(phone).then(setPhoneCopied)}
            aria-label={phoneCopied ? "Link copied: open it on your phone" : "Copy link to open Remote on your phone"}>{phoneCopied ? "Link copied" : "Copy link"}</button></p>}
        {phone && phoneCopied === false && <p className="room-link">{phone}</p>}
        {call ? <>
          <p className="room-panel-label">Here now</p>
          {here.length > 0 || remotes.length > 0
            ? <ul>
              {here.map((person) => <li key={person.name}><span className={person.ai ? "room-person-mark ai-mark" : "room-person-mark other-mark"} aria-hidden="true" data-tip={person.ai ? TIPS.participant : undefined}>{person.ai ? "✦" : "◆"}</span> {named(person)} <span className="room-state">· {stateWord(person)}</span></li>)}
              {remotes.map((remote) => <li key={remote.name}><span className="room-person-mark" aria-hidden="true" data-tip={TIPS.remote}>◇</span> {remote.name} <span className="room-state">· remote</span></li>)}
            </ul>
            : <p className="room-panel-hint">No one else right now.</p>}
        </> : others.length > 0 ? <>
          <p className="room-panel-label">Also on this map</p>
          <ul>{others.map((name) => <li key={name}><span className="room-person-mark other-mark" aria-hidden="true">◆</span> {name}</li>)}</ul>
          <p className="room-panel-hint">Names appear here after someone adds a thought.</p>
        </> : <p className="room-panel-hint">As people add thoughts, their names appear here.</p>}
        <button type="button" className="room-leave" onClick={actions.leave}>Leave</button>
      </div>
    </details>
  );
}

/** The name this window's own thoughts carry: "you" alone, the name you joined with in a room. */
export const useMe = () => useContext(Me);

/** Who left a dropped thread unfinished, to name on its tag: empty when it's yours, or from before
 * rooms (when everyone was "you"). */
export function leftBy(thread: { dropped_by?: string }, me: string): string {
  const by = thread.dropped_by ?? "";
  return by === me || by === ALONE.me ? "" : by;
}

/** Opens the core's WebSocket as this window's seat; each time it opens or drops, checks the room still takes it. */
export function openSocket(url: string, extra: Record<string, string> = {}): WebSocket {
  const params = new URLSearchParams(extra);
  if (seat.code) params.set("room", seat.code);
  if (seat !== ALONE) params.set("name", seat.me);
  // A phone's Remote says so, so the call lists it as a device and not as another person (core/src/call.rs).
  if (REMOTE) params.set("remote", "1");
  const query = params.toString();
  const ws = new WebSocket(query ? `${url}?${query}` : url);
  socketNow = ws;
  ws.addEventListener("open", () => { callOpened(); recheck(); });
  ws.addEventListener("close", () => { if (socketNow === ws) { socketNow = null; stopPageSpeech(); } callClosed(); recheck(); });
  // The call's own messages, and the world that ends a catch-up (talk/call-core.ts looks at the start only).
  ws.addEventListener("message", (event) => { callHeard(event.data); hearPageSpeech(event.data); });
  return ws;
}

// Codes compare as lowercase letters and digits, as in the core.
const normal = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 24);

// Storage can be off (a private window, blocked site data); then the form just asks again next time.
type Store = "localStorage" | "sessionStorage";
function read(key: string, store: Store = "localStorage") {
  try {
    return window[store].getItem(key) ?? "";
  } catch {
    return "";
  }
}
function write(key: string, value: string, store: Store = "localStorage") {
  try {
    window[store].setItem(key, value);
  } catch {
    // nothing to remember with
  }
}

async function knock(code: string, name = ""): Promise<Door> {
  // Pictures can't carry the code in their address, so it rides along as a cookie for this site only.
  if (code) document.cookie = `room=${code}; path=/; SameSite=Strict`;
  const params = new URLSearchParams();
  if (code) params.set("room", code);
  if (name) params.set("name", name);
  const query = params.toString();
  const response = await fetch(query ? `/room?${query}` : "/room");
  if (!response.ok) throw new Error(`The core said ${response.status}`);
  return (await response.json()) as Door;
}

export function Room({ children }: { children: ReactNode }) {
  const [door, setDoor] = useState<Door | null>(null);
  const [current, setCurrent] = useState<Seat | null>(null);
  // A Remote's link carries the name it should join under (remote/flag.ts), so a phone isn't asked for one.
  const [name, setName] = useState(() => REMOTE_NAME || read(NAME));
  const [code, setCode] = useState(() => normal(new URLSearchParams(location.search).get("room") || read(CODE)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // First look: alone, carry on as "you"; in a room, rejoin quietly if this tab already joined, else ask.
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const joined = read(JOINED, "sessionStorage");
    const look = () =>
      knock(code, joined)
        .then((d) => {
          if (stop) return;
          setDoor(d);
          if (!d.room) setCurrent(ALONE);
          else if (d.member && joined && d.taken) setNote(TAKEN);
          else if (d.member && joined) setCurrent({ me: joined, code });
          else if (!d.member && code) setNote("That code doesn't match. Ask for the right one.");
        })
        .catch(() => {
          if (!stop) timer = window.setTimeout(look, 1500);
        });
    void look();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []); // only on load; later checks go through `recheck`

  // Before the map's socket opens: layout effects run ahead of every other effect.
  useLayoutEffect(() => {
    seat = current ?? ALONE;
  }, [current]);

  // A restarted core may be alone again, or a room with a new code; or another laptop holds this name
  // (the core then refuses the map): then ask again.
  useEffect(() => {
    if (!current) return;
    recheck = () => {
      knock(current.code, current === ALONE ? "" : current.me)
        .then((d) => {
          // Always: a restarted core may run with other settings (hosted, models, sample) that site.ts reads.
          setDoor(d);
          if (d.room === (current !== ALONE) && (!d.room || d.member) && !d.taken) return;
          setCurrent(d.room ? null : ALONE);
          setNote(!d.room ? "" : !d.member ? "The code changed. Ask the other person for the new one." : d.taken ? TAKEN : "");
        })
        .catch(() => {}); // the core is down; the socket keeps trying
    };
    return () => {
      recheck = () => {};
    };
  }, [current]);

  const leave = () => {
    write(JOINED, "", "sessionStorage");
    document.cookie = "room=; path=/; Max-Age=0; SameSite=Strict";
    setNote("You left. Your thoughts stay.");
    setCurrent(null);
  };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const me = cleanName(name);
    if (me.toLowerCase() === "you") return setNote("Pick the name the other person will see.");
    const tried = normal(code);
    setBusy(true);
    try {
      const d = await knock(tried, me);
      setDoor(d);
      if (!d.room) return setCurrent(ALONE);
      if (!d.member) return setNote(tried ? "That code doesn't match. Ask for the right one." : "Type the code the other person gave you.");
      if (d.taken) return setNote(TAKEN);
      write(NAME, me);
      if (tried) write(CODE, tried);
      write(JOINED, me, "sessionStorage");
      setNote("");
      setCurrent({ me, code: tried });
    } catch {
      setNote("Can't reach the shared map. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  const site = useMemo(() => siteFrom(door), [door]);
  // The code from the core (the host's own window has none in its address), else the one typed.
  const joinCode = door?.code || current?.code || "";
  const joinInfo = useMemo(() => (joinCode ? { code: joinCode, invite: door?.invite ?? null } : null), [joinCode, door?.invite]);
  if (current) {
    // A new seat is a new connection: the map starts fresh under the new name.
    return (
      <SiteContext.Provider value={site}>
      <Me.Provider key={`${current.me}|${current.code}`} value={current.me}>
        <RoomActions.Provider value={current === ALONE ? null : { leave }}>
          <JoinContext.Provider value={current === ALONE ? null : joinInfo}>
            {children}
          </JoinContext.Provider>
        </RoomActions.Provider>
      </Me.Provider>
      </SiteContext.Provider>
    );
  }
  if (!door) return <div className="join"><div className="join-loading" role="status">Loading…</div></div>;
  return (
    <main className="join">
      <div className="join-brand">E2A2O <span>topics</span></div>
      <form className="join-card" onSubmit={join}>
        {REMOTE ? (
          <>
            <div className="join-kicker">Remote</div>
            <h1>Answer from your phone.</h1>
            <p className="join-intro">What your AI helpers are doing, and the questions they hold for you.</p>
          </>
        ) : door.tunnel ? (
          <>
            <div className="join-kicker">Just for you</div>
            <h1>Think out loud.</h1>
            <p className="join-intro">A fresh map, just for you. Talk, and your thoughts organize themselves as you go.</p>
          </>
        ) : (
          <>
            <div className="join-kicker">A shared map</div>
            <h1>Think together.</h1>
            <p className="join-intro">Two people, one map. Your thoughts find their place together.</p>
          </>
        )}
        {!door.member && (
          <label className="join-field">
            <span>Join code</span>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setNote(""); }}
              placeholder="From the person who started this"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              aria-describedby={note ? "join-note" : undefined}
            />
          </label>
        )}
        <label className="join-field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNote(""); }}
            placeholder="A short name"
            maxLength={24}
            autoComplete="nickname"
            autoFocus={door.member && !(REMOTE && !!name)}
            aria-describedby={note ? "join-note" : "name-hint"}
          />
          <small id="name-hint">
            {REMOTE ? "Your helpers see this next to your answers."
              : door.hosted ? "Shown next to your thoughts." : door.tunnel ? "Shown next to your thoughts. Whoever sent you this link can watch along." : "The other person will see this next to your thoughts."}
          </small>
        </label>
        {note && <div id="join-note" className="join-note" role="status">{note}</div>}
        <button type="submit" disabled={busy || !cleanName(name) || (!door.member && !normal(code))}>
          {busy ? "Joining…" : door.tunnel ? "Start" : "Join"}
        </button>
      </form>
    </main>
  );
}
