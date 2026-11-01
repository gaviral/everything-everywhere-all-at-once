// Rooms: two people think out loud on one map, each on their own laptop. When the core runs with a
// room code, everyone joins with a short name (remembered in this browser), and a laptop other than
// the host's also needs the code. Alone, nothing changes: your thoughts are "you".
import { createContext, useContext, useEffect, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import "./room.css";

type Seat = { me: string; code: string };
// What the core says at /room: is a room open, and may this page use the map?
type Door = { room: boolean; member: boolean };

const ALONE: Seat = { me: "you", code: "" };
const NAME = "e2a2o.name";
const CODE = "e2a2o.room";
const JOINED = "e2a2o.joined";

// The socket reads the seat each time it connects; Room keeps both current.
let seat = ALONE;
let recheck = () => {};

const Me = createContext(ALONE.me);

/** The name this window's own thoughts carry: "you" alone, the name you joined with in a room. */
export const useMe = () => useContext(Me);

/** Who left a dropped thread unfinished, to name on its tag: empty when it's yours, or from before
 * rooms (when everyone was "you"). */
export function leftBy(thread: { dropped_by?: string }, me: string): string {
  const by = thread.dropped_by ?? "";
  return by === me || by === ALONE.me ? "" : by;
}

/** Opens the core's WebSocket as this window's seat; each time it opens or drops, checks the room still takes it. */
export function openSocket(url: string): WebSocket {
  const params = new URLSearchParams();
  if (seat.code) params.set("room", seat.code);
  if (seat !== ALONE) params.set("name", seat.me);
  const query = params.toString();
  const ws = new WebSocket(query ? `${url}?${query}` : url);
  ws.addEventListener("open", () => recheck());
  ws.addEventListener("close", () => recheck());
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

async function knock(code: string): Promise<Door> {
  // Pictures can't carry the code in their address, so it rides along as a cookie for this site only.
  if (code) document.cookie = `room=${code}; path=/; SameSite=Strict`;
  const response = await fetch(code ? `/room?room=${code}` : "/room");
  if (!response.ok) throw new Error(`The core said ${response.status}`);
  return (await response.json()) as Door;
}

export function Room({ children }: { children: ReactNode }) {
  const [door, setDoor] = useState<Door | null>(null);
  const [current, setCurrent] = useState<Seat | null>(null);
  const [name, setName] = useState(() => read(NAME));
  const [code, setCode] = useState(() => normal(new URLSearchParams(location.search).get("room") || read(CODE)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // First look: alone, carry on as "you"; in a room, rejoin quietly if this tab already joined, else ask.
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const look = () =>
      knock(code)
        .then((d) => {
          if (stop) return;
          setDoor(d);
          const joined = read(JOINED, "sessionStorage");
          if (!d.room) setCurrent(ALONE);
          else if (d.member && joined) setCurrent({ me: joined, code });
          else if (!d.member && code) setNote("That code doesn't match this room.");
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

  // A restarted core may be alone again, or a room with a new code: then ask again.
  useEffect(() => {
    if (!current) return;
    recheck = () => {
      knock(current.code)
        .then((d) => {
          if (d.room === (current !== ALONE) && (!d.room || d.member)) return;
          setDoor(d);
          setCurrent(d.room ? null : ALONE);
          setNote(d.room && !d.member ? "The room has a new code. Ask the host for it." : "");
        })
        .catch(() => {}); // the core is down; the socket keeps trying
    };
    return () => {
      recheck = () => {};
    };
  }, [current]);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const me = cleanName(name);
    if (me.toLowerCase() === "you") return setNote("Pick the name the other person will see.");
    const tried = normal(code);
    setBusy(true);
    try {
      const d = await knock(tried);
      setDoor(d);
      if (!d.room) return setCurrent(ALONE);
      if (!d.member) return setNote(tried ? "That code doesn't match this room." : "Type the room code from the host.");
      write(NAME, me);
      if (tried) write(CODE, tried);
      write(JOINED, me, "sessionStorage");
      setNote("");
      setCurrent({ me, code: tried });
    } catch {
      setNote("Can't reach the room. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (current) {
    // A new seat is a new connection: the map starts fresh under the new name.
    return (
      <Me.Provider key={`${current.me}|${current.code}`} value={current.me}>
        {children}
      </Me.Provider>
    );
  }
  if (!door) return <div className="join" />;
  return (
    <div className="join">
      <form className="join-card" onSubmit={join}>
        <h1>Think together.</h1>
        <p>One map, a laptop each. The other person sees your name next to what you say.</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={24}
          autoComplete="nickname"
          autoFocus
        />
        {!door.member && (
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Room code"
            aria-label="Room code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        )}
        <button type="submit" disabled={busy || !cleanName(name) || (!door.member && !normal(code))}>
          Join
        </button>
        {note && (
          <div className="join-note" role="status">
            {note}
          </div>
        )}
      </form>
    </div>
  );
}
