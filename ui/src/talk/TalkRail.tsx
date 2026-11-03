// STAND-IN (lane L1): the Talk tab in a rail of its own, behind ?shell=2, until the shell's rail (Talk · History ·
// Catalog · Settings) hosts <Talk /> and its corners carry the join code, the people and Leave. Then this file goes.
// In a call only: open on a wide screen once two people are here (closed when it's you and an AI participant), a sheet
// on a phone, and a pill to bring it back when closed, with how many turns wait unread.
import { useEffect, useState } from "react";
import type { BrickHost } from "../BrickSlot";
import { copyInvite, useJoin, useLeave } from "../room";
import { inCall, peopleHere, shownCode, useCall } from "./call-core";
import { Talk, TALK } from "./Talk";
import { turnIndex, turnsOf, unreadOf, newerMark } from "./turns";

const SHELL2 = typeof location !== "undefined" && new URLSearchParams(location.search).get("shell") === "2";
const OPEN_KEY = "e2a2o.talk.open";
const PHONE = "(max-width: 560px)";

function remembered(): boolean | null {
  try { const v = sessionStorage.getItem(OPEN_KEY); return v === null ? null : v === "1"; } catch { return null; }
}

function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE).matches);
  useEffect(() => {
    const query = matchMedia(PHONE);
    const change = () => setPhone(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return phone;
}

export function TalkRail({ host }: { host: BrickHost }) {
  const call = useCall();
  const phone = usePhone();
  const [chosen, setChosen] = useState<boolean | null>(remembered);
  const on = SHELL2 && inCall(call);
  if (!on) return null;
  const open = chosen ?? (!phone && peopleHere(call) >= 2);
  const choose = (value: boolean) => {
    setChosen(value);
    try { sessionStorage.setItem(OPEN_KEY, value ? "1" : "0"); } catch { /* this visit only */ }
  };
  return open
    ? <aside className={phone ? "talk-rail talk-sheet" : "talk-rail"} aria-label="Talk" data-slot="rail">
        <RailHead close={() => choose(false)} />
        <Talk map={host.map} actions={host.actionsFor(TALK)} open />
      </aside>
    : <TalkPill host={host} phone={phone} show={() => choose(true)} />;
}

/** The rail's top: the tab's name, the join code (a click copies the link to share), Leave, and close. */
function RailHead({ close }: { close: () => void }) {
  const join = useJoin();
  const leave = useLeave();
  const [copied, setCopied] = useState<boolean | null>(null);
  return <div className="talk-rail-head">
    <span className="talk-rail-tab">Talk</span>
    {join && <button type="button" className="talk-code" title={join.invite ? `Copy the link to share: ${join.invite}` : "Copy the join code"}
      onClick={() => void copyInvite(join).then(setCopied)}>
      <span className="talk-code-label">{copied ? "Link copied" : copied === false ? "Copy failed" : "Join code"}</span> <b>{shownCode(join.code)}</b></button>}
    {leave && <button type="button" className="talk-leave" onClick={leave}>Leave</button>}
    <button type="button" className="talk-close" onClick={close} aria-label="Close Talk" title="Close Talk">×</button>
  </div>;
}

/** Talk, closed: a pill that opens it, with the turns that wait unread. */
function TalkPill({ host, phone, show }: { host: BrickHost; phone: boolean; show: () => void }) {
  const call = useCall();
  const me = host.map.me;
  const turns = turnsOf(host.map.thoughts, host.map.threads);
  let mark: string | null = null;
  try { mark = localStorage.getItem(`e2a2o.talk.read.${me}`); } catch { /* none kept */ }
  const read = turnIndex(turns, newerMark(turns, mark, call?.people.find((p) => p.name === me)?.read));
  const waiting = unreadOf(turns, read, me, call?.started_ms ?? 0).length;
  const said = turns.filter((t) => t.at >= (call?.started_ms ?? 0)).length;
  const count = waiting ? `${waiting} new` : phone && said ? `${said} ${said === 1 ? "turn" : "turns"}` : "";
  return <button type="button" className={phone ? "talk-pill talk-pill-phone" : "talk-pill"} onClick={show}>
    Talk{count && <span className="talk-pill-count"> · {count}</span>}{phone && <span aria-hidden="true"> ↑</span>}
  </button>;
}
