# Canvas workflow

Off by default. Enable **Canvas workflow** in Features, or visit `?canvas-workflow`.
The panel floats above the Canvas; it is a local example rather than a saved Canvas node.
Three labelled sample notes are available immediately. **Run example** collects them,
selects the two priorities, then builds a brief from that step's output. Each step has
six seconds of simulated pacing. No model, network, map mutation or capture is involved.

**Pause** freezes progress within the current step; **Resume** continues from there.
**Cancel** stops future steps and retains completed outputs. **Run again** starts fresh.
Switching the feature off releases its timer and resets the example. Reloads also reset it.
This feature does not control backend jobs or claim a live model workflow.

The entry component orchestrates input, progress, controls and step cards. Example
transformations, state transitions and the mount-owned clock are separate parts.

Focused check: `node scripts/canvas-workflow-check.mjs` (Vite and headless Chrome).
