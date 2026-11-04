import { useEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { Keyboard } from "./Keyboard";
import { Preview } from "./Preview";
import { Trackpad } from "./Trackpad";
import { PointerLink, takePairingKey, type Input, type Permissions } from "./transport";
import css from "./phone-pointer.css?inline";

function Setup() {
  return <section className="phone-pointer-setup">
    <span className="phone-pointer-orbit" aria-hidden="true">↗</span>
    <h2>Your phone.<br />Your whole desktop.</h2>
    <p>Relative trackpad, current-pointer clicks and keyboard shortcuts. Screen preview is a separate choice.</p>
    <ol><li>Build the UI, then start the local helper on the Mac:<code>python3 ui/src/bricks/phone-pointer/helper.py --bind 0.0.0.0 --host &lt;Mac LAN IP&gt;</code></li>
      <li>Open its private pairing link on your phone, on the same trusted Wi-Fi.</li>
      <li>Allow Accessibility for input. Screen Recording is optional.</li></ol>
    <p>No connection yet. Starting the helper does not start screen capture.</p>
  </section>;
}

function Controller({ pair }: { pair: string }) {
  const [link, setLink] = useState<PointerLink | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [problem, setProblem] = useState("");
  const [active, setActive] = useState(document.visibilityState === "visible" && document.hasFocus());
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => {
    const connection = new PointerLink(pair); setLink(connection);
    const update = (event: Event) => {
      const visible = !["blur", "pagehide"].includes(event.type) && document.visibilityState === "visible" && document.hasFocus();
      activeRef.current = visible; setActive(visible);
      if (!visible) connection.cancelPending();
    };
    for (const name of ["visibilitychange", "blur", "focus", "pagehide", "pageshow"]) window.addEventListener(name, update);
    return () => { connection.stop(); for (const name of ["visibilitychange", "blur", "focus", "pagehide", "pageshow"]) window.removeEventListener(name, update); };
  }, [pair]);
  const refresh = () => { if (link) void link.status().then(value => { setPermissions(value); setProblem(""); }).catch(error => { setPermissions(null); setProblem(error.message); }); };
  useEffect(refresh, [link]);
  const send = async (input: Input) => {
    if (!link || !activeRef.current || !permissions?.input) return false;
    try { const accepted = await link.input(input); if (accepted) setProblem(""); return accepted; }
    catch (error) { setProblem(error instanceof Error ? error.message : "Input not sent."); setPermissions(null); return false; }
  };
  const disabled = !active || !permissions?.input;
  return <>
    <div className="phone-pointer-heading"><div><span>PHONE → MAC</span><h2>Desktop pointer</h2></div><button onClick={refresh}>Check connection</button></div>
    <p className="phone-pointer-status" role="status">{!active ? "Paused while you’re away" : permissions?.input ? "Connected · input ready" : permissions ? "Input needs Accessibility permission on the Mac" : "Check the Mac helper connection"}</p>
    {problem && <p className="phone-pointer-problem" role="alert">{problem}</p>}
    <Trackpad disabled={disabled} send={send} />
    <div className="phone-pointer-clicks"><button disabled={disabled} onClick={() => void send({ kind: "click", button: "left" })}>Click</button>
      <button disabled={disabled} onClick={() => void send({ kind: "click", button: "right" })}>Right click</button></div>
    <Keyboard disabled={disabled} send={send} />
    {link && <Preview link={link} allowed={!!permissions?.preview} active={active} />}
  </>;
}

export default function PhonePointer(_props: BrickProps) {
  const [pair] = useState(takePairingKey);
  const [open, setOpen] = useState(!!pair);
  return open ? <div className="phone-pointer" role="dialog" aria-modal="true" aria-label="Desktop pointer">
    <button className="phone-pointer-close" onClick={() => setOpen(false)}>Close remote</button>
    <main>{pair ? <Controller pair={pair} /> : <Setup />}</main>
  </div> : <button className="phone-pointer-launch" onClick={() => setOpen(true)}>↗ Desktop pointer</button>;
}

export const styles = css;
