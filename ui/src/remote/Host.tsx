import { useEffect, useMemo, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { PhoneRemoteContext, type RemoteGesture, type RemotePosition } from "../bricks/contract";
import { sendToCore, useJoin, useMe } from "../room";
import { useBuiltInsOn } from "../shell/features";
import { DEMO } from "../shell/flag";
import { FILM } from "../film";
import { remoteLink } from "./flag";
import { watchRemote } from "./channel";
import "./touchpad.css";

export function PhoneRemoteHost({ children }: { children: ReactNode }) {
  const enabled = useBuiltInsOn().has("phone-remote") && !FILM && !DEMO;
  const channel = useMemo(() => enabled ? {
    subscribe: (hear: (gesture: RemoteGesture) => void) =>
      watchRemote((message) => { if (message.kind !== "selection") hear(message); }),
    select: (message: RemotePosition) => { sendToCore({ type: "remote_selection", message }); },
  } : null, [enabled]);
  useEffect(() => {
    const off = () => { sendToCore({ type: "remote_selection", message: { kind: "selection", thread_id: null, thought_id: null, label: "Phone remote is off", enabled: false } }); };
    if (enabled) return off;
    return watchRemote((message) => { if (message.kind === "hello") off(); });
  }, [enabled]);
  return <PhoneRemoteContext.Provider value={channel}>{children}</PhoneRemoteContext.Provider>;
}

/** The room already supplies a reachable LAN invite, including HTTPS when configured. */
export function PhonePair() {
  const join = useJoin();
  const me = useMe();
  const [qr, setQr] = useState("");
  const link = join?.invite ? `${remoteLink(join.invite, me)}&touchpad=1` : "";
  useEffect(() => {
    let active = true;
    setQr("");
    if (link) void QRCode.toDataURL(link, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then((image) => { if (active) setQr(image); });
    return () => { active = false; };
  }, [link]);
  if (FILM || DEMO) return null;
  return <section className="phone-pair" aria-label="Pair phone remote">
    {link ? <><p>Same Wi-Fi · scan once to pair</p>{qr && <img src={qr} width="240" height="240" alt="Scan to pair your phone remote" />}
      <a href={link}>{link}</a><p>Join code <strong>{join?.code}</strong></p>
      <p>Swipe sideways for topics, vertically for thoughts. Tap to open; double tap to go back. Hold to talk. Pinch to zoom; drag with two fingers to pan.</p>
      {link.startsWith("http:") && <p>Gestures work here. For the phone mic, start the shared map with HTTPS.</p>}</>
      : <p>Start a shared room to pair a phone on the same Wi-Fi.</p>}
  </section>;
}

export function RememberedRemote() {
  const [link, setLink] = useState("");
  useEffect(() => {
    let active = true;
    if (FILM || DEMO || !matchMedia("(pointer: coarse)").matches) return;
    try {
      const saved = localStorage.getItem("e2a2o.phone-pair");
      if (!saved) return;
      const url = new URL(saved);
      if (url.origin !== location.origin) return;
      void fetch(`/room?room=${encodeURIComponent(url.searchParams.get("room") ?? "")}`).then((r) => r.json()).then((door) => {
        if (active && door.room && door.member) setLink(saved);
      }).catch(() => {});
    } catch { /* no remembered pair */ }
    return () => { active = false; };
  }, []);
  return link ? <a className="phone-return" href={link}>Remote</a> : null;
}
