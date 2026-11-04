import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveArea } from "./LiveArea";
import type { ActivityEvent, BuildEvent, VersionEvent, RunIdentity } from "./contracts";
import { SyntheticSource } from "./SyntheticSource";
import "./preview.css";

const selected: RunIdentity = { runId: "run-north", branchId: "branch-north", buildId: "build-7" };
const other: RunIdentity = { runId: "run-south", branchId: "branch-south", buildId: "build-9" };
const activity = new SyntheticSource<ActivityEvent>();
const build = new SyntheticSource<BuildEvent>();
const version = new SyntheticSource<VersionEvent>();
const adapters = { activity, build, version };

function useSyntheticScenario() {
  const [enabled, setEnabled] = useState(false);
  const [missing, setMissing] = useState(false);
  const [receipt, setReceipt] = useState("No synthetic events sent.");
  const [subscriptions, setSubscriptions] = useState(0);
  const [sequence, setSequence] = useState(0);
  const inspect = () => setSubscriptions(activity.count + build.count + version.count);
  const sendActivity = () => {
    const next = sequence + 1;
    activity.emit({ identity: selected, agentId: "agent-a", agentName: "Agent North", task: "Check navigation", state: next > 1 ? "done" : "running", observedAt: Date.now(), sequence: next });
    activity.emit({ identity: other, agentId: "agent-b", agentName: "Agent South", task: "Review layout", state: "waiting", observedAt: Date.now(), sequence: next });
    setSequence(next); setReceipt("Synthetic activity sent to two branches."); inspect();
  };
  const sendStatuses = () => {
    const next = sequence + 1;
    build.emit({ identity: selected, sequence: next, observedAt: Date.now(), state: "ready", label: "Preview ready" });
    version.emit({ identity: selected, sequence: next, observedAt: Date.now(), branchLabel: "North", worktreeLabel: "North workspace", revision: "abc1234" });
    setSequence(next); setReceipt("Matching synthetic build and version sent for North only."); inspect();
  };
  const connection = (connected: boolean) => {
    for (const source of [activity, build, version]) source.connection(connected ? "connected" : "disconnected");
    setReceipt(connected ? "Reconnected. Retained identities await newer records." : "Disconnected. Retained records are last known."); inspect();
  };
  const sendOlder = () => {
    activity.emit({ identity: selected, agentId: "agent-a", agentName: "Agent North", task: "Obsolete task", state: "failed", sequence: 0, observedAt: Date.now() - 60_000 });
    build.emit({ identity: selected, sequence: 0, observedAt: Date.now() - 60_000, state: "failed", label: "Obsolete build" });
    version.emit({ identity: selected, sequence: 0, observedAt: Date.now() - 60_000, branchLabel: "Obsolete branch", worktreeLabel: "Obsolete workspace", revision: "old" });
    setReceipt("Older synthetic updates sent; accepted rows should stay unchanged."); inspect();
  };
  return { enabled, setEnabled, missing, setMissing, receipt, subscriptions, inspect, sendActivity, sendStatuses, connection, sendOlder };
}

function SyntheticControls({ scenario }: { scenario: ReturnType<typeof useSyntheticScenario> }) {
  return <aside className="la-preview-controls" aria-label="Synthetic feed controls">
    <button onClick={scenario.sendActivity}>Send activity</button>
    <button onClick={scenario.sendStatuses}>Send matching statuses</button>
    <button onClick={() => scenario.connection(false)}>Disconnect</button>
    <button onClick={() => scenario.connection(true)}>Reconnect</button>
    <button onClick={scenario.sendOlder}>Send older event</button>
    <button onClick={() => scenario.setMissing(!scenario.missing)}>{scenario.missing ? "Provide slots" : "Remove slots"}</button>
    <button onClick={scenario.inspect}>Inspect subscriptions</button>
    <output>Active subscriptions: {scenario.subscriptions}</output><p>{scenario.receipt}</p>
  </aside>;
}

const missingAdapters = { activity };
function SyntheticPreview() {
  const scenario = useSyntheticScenario();
  return <main className="la-preview"><header><p>ISOLATED PREVIEW · SYNTHETIC EVENTS</p><h1>One view of development</h1>
    <p>No external feed is connected. These controls simulate read-only status.</p></header>
    <LiveArea adapters={scenario.missing ? missingAdapters : adapters} enabled={scenario.enabled} onEnabledChange={scenario.setEnabled} selected={selected} />
    <SyntheticControls scenario={scenario} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<SyntheticPreview />);
