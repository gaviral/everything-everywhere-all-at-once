import { useEffect, useState } from "react";
import { LiveArea } from "../../intake1411/live-area/LiveArea";
import { SyntheticSource } from "../../intake1411/live-area/SyntheticSource";
import type { ActivityEvent, BuildEvent, VersionEvent } from "../../intake1411/live-area/contracts";
const selected = { runId: "garden-run", branchId: "garden-layout", buildId: "garden-7" };
function createFeed() {
  const activity = new SyntheticSource<ActivityEvent>(), build = new SyntheticSource<BuildEvent>(), version = new SyntheticSource<VersionEvent>();
  let sequence = 0;
  return { adapters: { activity, build, version }, publish() {
    const stamp = { observedAt: Date.now(), sequence: ++sequence };
    activity.emit({ ...stamp, identity: selected, agentId: "north", agentName: "Layout worker", task: "Arrange the garden plan", state: sequence > 1 ? "done" : "running" });
    activity.emit({ ...stamp, identity: { runId: "labels-run", branchId: "garden-labels", buildId: "labels-3" }, agentId: "south", agentName: "Labels worker", task: "Review plant names", state: "waiting" });
    build.emit({ ...stamp, identity: selected, state: "ready", label: "Garden preview ready" });
    version.emit({ ...stamp, identity: selected, branchLabel: "Garden layout", worktreeLabel: "Garden workspace", revision: "sample-7" });
  }, connect(connected: boolean) { [activity, build, version].forEach(source => source.connection(connected ? "connected" : "disconnected")); } };
}
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [example] = useState(createFeed);
const [enabled, setEnabled] = useState(true);
useEffect(() => { if (enabled) example.publish(); }, [example, enabled]);
const [open, setOpen] = useState(true);
return <>{!open && <button className="live-area-reopen" type="button" onClick={() => setOpen(true)}>Open Development activity</button>}
<section hidden={!open} className="live-area-example" aria-label="Development activity example" data-guide="live-area">
<div><strong>Development activity · local example</strong><span><button type="button" onClick={() => actions.openCatalog("live-area")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<div><button onClick={example.publish}>Send newer example status</button> <button onClick={() => example.connect(false)}>Disconnect example feed</button> <button onClick={() => { example.connect(true); example.publish(); }}>Reconnect with new status</button></div>
<LiveArea enabled={enabled} onEnabledChange={setEnabled} adapters={example.adapters} selected={selected} />
</section></>;
}
