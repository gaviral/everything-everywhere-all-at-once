import { pendingSnapshot, type Data, type WorkflowAdapter, type WorkflowCommand, type WorkflowDefinition, type WorkflowSnapshot } from "./contract";

// Canonical references from app-parts.ts; this fixture does not execute those parts.
export const exampleDefinition: WorkflowDefinition = {
  id: "workflow-inspector:example",
  title: "Prepare a shared card",
  trigger: { event: "Manual request", condition: "A note is available and you request a run." },
  steps: [
    { id: "read-note", partId: "input:thoughts", title: "Read the sample note", inputs: ["note"], outputs: ["summary"] },
    { id: "prepare-card", partId: "publisher:card", title: "Prepare the card", inputs: ["summary", "audience"], outputs: ["card"] },
  ],
  handoff: { partId: "workflow-inspector:fill-audience", from: "read-note", to: "prepare-card", field: "audience", reason: "The note has no audience. Fill the gap and approve the handoff before the next step." },
};

/** Deterministic local contract example. No model, microphone, network or host mutation. */
export function createExampleAdapter(): WorkflowAdapter {
  let snapshot = pendingSnapshot(exampleDefinition);
  const listeners = new Set<() => void>();
  const publish = (next: WorkflowSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const run = () => {
    publish({
      phase: "review", trigger: "Manual request · sample note available",
      steps: [
        { id: "read-note", status: "result", input: { note: "The community garden opens Saturday." }, output: { summary: "Community garden opening: Saturday." } },
        { id: "prepare-card", status: "pending", input: {}, output: {} },
      ],
      handoff: { status: "review", approved: null },
    });
  };
  const review = (value: string) => {
    const first = snapshot.steps[0];
    const approved: Data = { ...first.output, audience: value.trim() };
    publish({ ...snapshot, phase: "result", handoff: { status: "approved", approved }, steps: [first,
      { id: "prepare-card", status: "result", input: approved, output: { card: `For ${approved.audience}: ${approved.summary}` } },
    ] });
  };
  const stop = () => publish({ ...snapshot, phase: "stopped", handoff: { status: "stopped", approved: null },
    steps: snapshot.steps.map(step => step.status === "result" ? step : { ...step, status: "stopped" }),
  });
  return {
    source: "local-example", read: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async request(command: WorkflowCommand) {
      if (command.type === "run") {
        if (["running", "review"].includes(snapshot.phase)) throw new Error("Finish or stop this example first.");
        run();
      } else if (command.type === "review") {
        if (snapshot.phase !== "review" || !command.value.trim()) throw new Error("A current review and an audience are required.");
        review(command.value);
      } else {
        if (!["running", "review"].includes(snapshot.phase)) throw new Error("There is no active example to stop.");
        stop();
      }
    },
  };
}
